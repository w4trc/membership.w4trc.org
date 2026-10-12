import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { requireAuth, cleanExpiredSessions } from '../src/lib/auth.js';
import { handleAdmin } from '../src/routes/admin.js';
import { resetDb, addMember, auditActions } from './helpers.js';

const MINUTE = 60 * 1000;
const hex64 = (ch) => ch.repeat(64);

async function addUser(email, role, memberId = null) {
  const result = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role, member_id) VALUES (?, 'x', ?, ?)`
  ).bind(email, role, memberId).run();
  return result.meta.last_row_id;
}

// Sessions are stored the way createSession() stores them: ISO 8601 expiry
async function addSession(id, userId, { expiresInMs = 60 * MINUTE, userAgent = 'Mozilla/5.0 Chrome/140.0', ip = '203.0.113.7' } = {}) {
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, ip, userAgent, new Date(Date.now() + expiresInMs).toISOString()).run();
}

async function sessionIds() {
  const { results } = await env.DB.prepare(`SELECT id FROM sessions ORDER BY id`).all();
  return results.map(r => r.id);
}

const withCookie = (sessionId) =>
  new Request('https://members.w4trc.org/api/members', { headers: { Cookie: `karc_session=${sessionId}` } });

beforeEach(resetDb);

describe('session expiry', () => {
  it('accepts a session that has not expired', async () => {
    const user = await addUser('admin@example.com', 'admin');
    await addSession(hex64('a'), user);

    const result = await requireAuth(withCookie(hex64('a')), env);

    expect(result).toMatchObject({ ok: true, user: { id: user, role: 'admin', sessionId: hex64('a') } });
  });

  it('rejects a session the moment it expires, not at the end of the day', async () => {
    const user = await addUser('admin@example.com', 'admin');
    await addSession(hex64('a'), user, { expiresInMs: -MINUTE });

    expect(await requireAuth(withCookie(hex64('a')), env)).toMatchObject({ ok: false });
  });

  it('cleans up expired sessions and keeps live ones', async () => {
    const user = await addUser('admin@example.com', 'admin');
    await addSession(hex64('a'), user);
    await addSession(hex64('b'), user, { expiresInMs: -MINUTE });

    await cleanExpiredSessions(env);

    expect(await sessionIds()).toEqual([hex64('a')]);
  });
});

describe('admin sessions', () => {
  let admin;
  let member;
  let me;

  const call = (method, ref = '', user = me) => handleAdmin(
    new Request(`https://members.w4trc.org/api/admin/sessions${ref && '/' + ref}`, { method }),
    env, `/api/admin/sessions${ref && '/' + ref}`, user
  );

  const list = async () => (await (await call('GET')).json()).sessions;

  beforeEach(async () => {
    admin  = await addUser('admin@example.com', 'admin');
    member = await addUser('member@example.com', 'member', await addMember({ callsign: 'KT4MEM' }));
    me     = { id: admin, role: 'admin', sessionId: hex64('a') };
    await addSession(hex64('a'), admin);
    await addSession(hex64('b'), member, { userAgent: 'Mozilla/5.0 (iPhone) Safari/605', ip: '198.51.100.9' });
  });

  it('lists who is signed in and marks the current session', async () => {
    const sessions = await list();

    expect(sessions).toHaveLength(2);
    expect(sessions.find(s => s.email === 'admin@example.com')).toMatchObject({
      role: 'admin', callsign: null, ip_address: '203.0.113.7', current: true,
    });
    expect(sessions.find(s => s.email === 'member@example.com')).toMatchObject({
      role: 'member', callsign: 'KT4MEM', ip_address: '198.51.100.9',
      user_agent: 'Mozilla/5.0 (iPhone) Safari/605', current: false,
    });
  });

  it('never sends a real session ID to the browser', async () => {
    const body = await (await call('GET')).text();

    expect(body).not.toContain(hex64('a'));
    expect(body).not.toContain(hex64('b'));
  });

  it('leaves out expired sessions', async () => {
    await addSession(hex64('c'), member, { expiresInMs: -MINUTE });

    expect(await list()).toHaveLength(2);
  });

  it('signs out another user\'s session and records it', async () => {
    const target = (await list()).find(s => s.email === 'member@example.com');

    const res = await call('DELETE', target.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, current: false });
    expect(await sessionIds()).toEqual([hex64('a')]);
    expect(await requireAuth(withCookie(hex64('b')), env)).toMatchObject({ ok: false });
    expect(await auditActions()).toEqual([
      { action: 'session.revoke', detail: { email: 'member@example.com', session: target.id } },
    ]);
  });

  it('reports when an admin signs out their own session', async () => {
    const mine = (await list()).find(s => s.current);

    const res = await call('DELETE', mine.id);

    expect(await res.json()).toEqual({ ok: true, current: true });
    expect(await sessionIds()).toEqual([hex64('b')]);
  });

  it('returns 404 for an unknown session and for a raw session ID', async () => {
    expect((await call('DELETE', 'deadbeefdeadbeef')).status).toBe(404);
    expect((await call('DELETE', hex64('b'))).status).toBe(404);
    expect(await sessionIds()).toEqual([hex64('a'), hex64('b')]);
    expect(await auditActions()).toEqual([]);
  });

  it('is admin only', async () => {
    const board = { id: admin, role: 'board', sessionId: hex64('a') };
    const target = (await list())[0];

    expect((await call('GET', '', board)).status).toBe(403);
    expect((await call('DELETE', target.id, board)).status).toBe(403);
    expect(await sessionIds()).toHaveLength(2);
  });
});
