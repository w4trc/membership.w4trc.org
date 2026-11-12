import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { handleAuth } from '../src/routes/auth.js';
import { handleAdmin } from '../src/routes/admin.js';
import { hashPassword } from '../src/lib/auth.js';
import { totpCode, currentStep } from '../src/lib/totp.js';
import { resetDb, auditActions } from './helpers.js';

const EMAIL = 'officer@example.com';
const PASSWORD = 'correct horse battery';
let passwordHash;
let userId;
let clock; // what Date.now() says, so a test can let time pass

beforeAll(async () => { passwordHash = await hashPassword(PASSWORD); });

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare('DELETE FROM sessions').run();
  const user = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'board')`
  ).bind(EMAIL, passwordHash).run();
  userId = user.meta.last_row_id;
  clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

const wait = (secs) => { clock += secs * 1000; };

// The auth routes themselves, without the worker's per-address rate limit in front
async function auth(method, path, body, cookie) {
  const res = await handleAuth(new Request('https://members.w4trc.org' + path, {
    method,
    headers: cookie ? { Cookie: cookie } : {},
    body: body ? JSON.stringify(body) : undefined,
  }), env, path);
  const setCookie = res.headers.get('Set-Cookie') || '';
  return { status: res.status, body: await res.json(), cookie: setCookie.split(';')[0] };
}

const login = (extra = {}) => auth('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD, ...extra });
const codeNow = (secret) => totpCode(secret, currentStep(clock));
const userRow = () => env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

// Sign in, set two-step sign-in up and turn it on. Returns { cookie, secret, codes }.
async function turnOn() {
  const { cookie } = await login();
  const setup = await auth('POST', '/api/auth/two-step/setup', { password: PASSWORD }, cookie);
  const enabled = await auth('POST', '/api/auth/two-step/enable', { code: await codeNow(setup.body.secret) }, cookie);
  expect(enabled.status).toBe(200);
  wait(60); // the code used to turn it on cannot be used again
  return { cookie, secret: setup.body.secret, codes: enabled.body.recovery_codes };
}

describe('two-step sign-in', () => {
  it('leaves a login without it alone', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.cookie).toMatch(/^karc_session=[a-f0-9]{64}$/);
    expect((await auth('GET', '/api/auth/two-step', null, res.cookie)).body).toEqual({ enabled: false, recovery_left: 0 });
  });

  it('needs a login to set up, and the password again', async () => {
    expect((await auth('POST', '/api/auth/two-step/setup', { password: PASSWORD })).status).toBe(401);
    const { cookie } = await login();
    expect((await auth('POST', '/api/auth/two-step/setup', { password: 'not the password' }, cookie)).status).toBe(401);
    expect((await userRow()).totp_secret).toBeNull();
  });

  it('is not on until a code from the app proves the key was saved', async () => {
    const { cookie } = await login();
    const setup = await auth('POST', '/api/auth/two-step/setup', { password: PASSWORD }, cookie);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.qr).toContain('<svg');

    expect((await auth('POST', '/api/auth/two-step/enable', { code: '000000' }, cookie)).status).toBe(400);
    expect((await userRow()).totp_enabled).toBe(0);
    expect((await login()).status).toBe(200); // still password only
  });

  it('turns on, gives eight recovery codes once, and signs out other browsers', async () => {
    const other = await login();
    const { cookie, codes } = await turnOn();

    expect(codes).toHaveLength(8);
    const row = await userRow();
    expect(row.totp_enabled).toBe(1);
    expect(row.totp_recovery).not.toContain(codes[0].replace('-', ''));
    expect((await auth('GET', '/api/auth/two-step', null, cookie)).body).toEqual({ enabled: true, recovery_left: 8 });
    expect((await auth('GET', '/api/auth/me', null, other.cookie)).status).toBe(401);
    expect((await auditActions()).map(a => a.action)).toContain('two_step.enabled');
    // A second key cannot be put over the first
    expect((await auth('POST', '/api/auth/two-step/setup', { password: PASSWORD }, cookie)).status).toBe(409);
  });

  it('asks for the code after the password, and gives no session without it', async () => {
    const { secret } = await turnOn();

    const first = await login();
    expect(first.status).toBe(401);
    expect(first.body.details).toEqual({ two_step: true });
    expect(first.cookie).toBe('');

    const wrong = await login({ code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.cookie).toBe('');

    const right = await login({ code: await codeNow(secret) });
    expect(right.status).toBe(200);
    expect(right.cookie).toMatch(/^karc_session=/);
  });

  it('does not say a code is needed when the password is wrong', async () => {
    const { secret } = await turnOn();
    const res = await auth('POST', '/api/auth/login', { email: EMAIL, password: 'not the password', code: await codeNow(secret) });
    expect(res.status).toBe(401);
    expect(res.body.details).toBeUndefined();
  });

  it('takes each code once', async () => {
    const { secret } = await turnOn();
    const code = await codeNow(secret);
    expect((await login({ code })).status).toBe(200);
    expect((await login({ code })).status).toBe(401);
    wait(30);
    expect((await login({ code: await codeNow(secret) })).status).toBe(200);
  });

  it('takes a recovery code once, in place of the app', async () => {
    const { cookie, codes } = await turnOn();
    const typed = codes[0].toUpperCase().replace('-', ' ');
    expect((await login({ code: typed })).status).toBe(200);
    expect((await login({ code: codes[0] })).status).toBe(401);
    expect((await auth('GET', '/api/auth/two-step', null, cookie)).body.recovery_left).toBe(7);
    expect((await auditActions()).some(a => a.action === 'login.success' && a.detail?.recovery_code)).toBe(true);
  });

  it('locks the second step for 15 minutes after five wrong codes', async () => {
    const { secret } = await turnOn();
    for (let i = 0; i < 4; i++) expect((await login({ code: '000000' })).status).toBe(401);
    expect((await login({ code: '000000' })).status).toBe(429);
    expect((await login({ code: await codeNow(secret) })).status).toBe(429);
    wait(16 * 60);
    expect((await login({ code: await codeNow(secret) })).status).toBe(200);
  });

  it('forgets wrong codes after a right one', async () => {
    const { secret } = await turnOn();
    for (let i = 0; i < 4; i++) await login({ code: '000000' });
    expect((await login({ code: await codeNow(secret) })).status).toBe(200);
    expect((await userRow()).totp_fails).toBe(0);
  });

  it('turns off only with the password and a code', async () => {
    const { cookie, secret } = await turnOn();
    const off = (body) => auth('POST', '/api/auth/two-step/disable', body, cookie);
    expect((await off({ password: 'not the password', code: await codeNow(secret) })).status).toBe(401);
    expect((await off({ password: PASSWORD, code: '000000' })).status).toBe(400);
    expect((await userRow()).totp_enabled).toBe(1);

    expect((await off({ password: PASSWORD, code: await codeNow(secret) })).status).toBe(200);
    const row = await userRow();
    expect([row.totp_enabled, row.totp_secret, row.totp_recovery]).toEqual([0, null, null]);
    expect((await login()).status).toBe(200);
  });

  it('lets an admin turn it off for someone who lost their phone, and only an admin', async () => {
    await turnOn();
    const reset = (role) => handleAdmin(
      new Request(`https://members.w4trc.org/api/admin/users/${userId}/two-step`, { method: 'DELETE' }),
      env, `/api/admin/users/${userId}/two-step`, { id: 999, role },
    );
    expect((await reset('board')).status).toBe(403);
    expect((await userRow()).totp_enabled).toBe(1);

    expect((await reset('admin')).status).toBe(200);
    expect((await userRow()).totp_enabled).toBe(0);
    const { results } = await env.DB.prepare('SELECT id FROM sessions WHERE user_id = ?').bind(userId).all();
    expect(results).toHaveLength(0);
    expect((await login()).status).toBe(200);
    expect((await reset('admin')).status).toBe(409);
  });

  it('shows admins who has it on, without the key', async () => {
    await turnOn();
    const res = await handleAdmin(new Request('https://members.w4trc.org/api/admin/users'), env, '/api/admin/users', { id: 999, role: 'admin' });
    const { users } = await res.json();
    expect(users[0].two_step).toBe(1);
    expect(JSON.stringify(users)).not.toMatch(/totp_secret|totp_recovery|password_hash/);
  });

  it('is reachable through the worker for any signed-in user', async () => {
    await env.DB.prepare(`UPDATE users SET role = 'member' WHERE id = ?`).bind(userId).run();
    const { cookie } = await login();
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('https://members.w4trc.org/api/auth/two-step', { headers: { Cookie: cookie } }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});
