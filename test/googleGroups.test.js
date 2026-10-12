import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { MAX_CHANGES_PER_RUN, planSync, syncGoogleGroups, syncYears } from '../src/lib/googleGroups.js';
import { handleAdmin } from '../src/routes/admin.js';
import { resetDb, addMember, addMembership, auditActions } from './helpers.js';

const MARCH    = new Date('2026-03-15T15:00:00Z');
const NOVEMBER = new Date('2026-11-10T15:00:00Z');
const G2026 = '2026members@w4trc.org';
const G2027 = '2027members@w4trc.org';

let keyPair;
let testEnv;

// ── A stand-in for Google ─────────────────────────────────────────────────────
// groups: group address → Set of member addresses. calls: every request made.
let groups;
let calls;
let tokenAssertions;
let failWith; // optional (method, group, email) => Response | undefined

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeGoogle() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method || 'GET';

    if (url.href === 'https://oauth2.googleapis.com/token') {
      tokenAssertions.push(new URLSearchParams(init.body).get('assertion'));
      return json(200, { access_token: 'test-token', expires_in: 600 });
    }

    const match = url.pathname.match(/^\/admin\/directory\/v1\/groups\/([^/]+)\/members(?:\/([^/]+))?$/);
    if (url.host !== 'admin.googleapis.com' || !match) throw new Error(`Unexpected request: ${method} ${url}`);
    if (init.headers.Authorization !== 'Bearer test-token') return json(401, { error: { message: 'Bad token' } });

    const group = decodeURIComponent(match[1]);
    const email = match[2] ? decodeURIComponent(match[2]) : JSON.parse(init.body).email;
    calls.push(`${method} ${group} ${email}`);

    const forced = failWith?.(method, group, email);
    if (forced) return forced;

    const members = groups.get(group);
    if (!members) return json(404, { error: { message: 'Resource Not Found: groupKey' } });
    if (method === 'POST') {
      if (members.has(email)) return json(409, { error: { message: 'Member already exists.' } });
      members.add(email);
      return json(200, { email, role: 'MEMBER' });
    }
    if (method === 'DELETE') {
      if (!members.delete(email)) return json(404, { error: { message: 'Resource Not Found: memberKey' } });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected method ${method}`);
  });
}

const sync = (now = MARCH, e = testEnv) => syncGoogleGroups(e, { now });
const inGroup = (group) => [...groups.get(group)].sort();

async function tracked(year = 2026) {
  const { results } = await env.DB.prepare(
    `SELECT email, added_by_sync FROM google_group_members WHERE year = ? ORDER BY email`
  ).bind(year).all();
  return results;
}

/** A member who has paid for `year`. */
async function paidMember(email, year = 2026, fields = {}) {
  const id = await addMember({ email, ...fields });
  await addMembership(id, year, { status: 'active', amount_paid: 20, paid_date: `${year}-01-10` });
  return id;
}

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const base64 = btoa(String.fromCharCode(...pkcs8)).match(/.{1,64}/g).join('\n');
  testEnv = {
    DB: env.DB,
    GOOGLE_GROUP_FORMAT: '{year}members@w4trc.org',
    GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify({
      client_email: 'sync@karc-test.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`,
    }),
  };
});

beforeEach(async () => {
  await resetDb();
  groups = new Map([[G2026, new Set()], [G2027, new Set()]]);
  calls = [];
  tokenAssertions = [];
  failWith = null;
  fakeGoogle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncYears', () => {
  it('is the current year, plus next year during renewal season', () => {
    expect(syncYears({}, MARCH)).toEqual([2026]);
    expect(syncYears({}, NOVEMBER)).toEqual([2026, 2027]);
  });

  it('skips years before GOOGLE_SYNC_START_YEAR', () => {
    const from2027 = { GOOGLE_SYNC_START_YEAR: '2027' };
    expect(syncYears(from2027, MARCH)).toEqual([]);
    expect(syncYears(from2027, NOVEMBER)).toEqual([2027]);
    expect(syncYears(from2027, new Date('2027-03-15T15:00:00Z'))).toEqual([2027]);
    expect(syncYears({ GOOGLE_SYNC_START_YEAR: '2026' }, NOVEMBER)).toEqual([2026, 2027]);
  });
});

describe('start year', () => {
  it('never contacts or plans for a group before the start year', async () => {
    const from2027 = { ...testEnv, GOOGLE_SYNC_START_YEAR: '2027' };
    await paidMember('this@example.com', 2026);
    await paidMember('next@example.com', 2027);

    const result = await sync(NOVEMBER, from2027);

    expect(calls).toEqual([`POST ${G2027} next@example.com`]);
    expect(inGroup(G2026)).toEqual([]);
    expect(result.years.map(y => y.year)).toEqual([2027]);
    expect((await planSync(from2027, NOVEMBER)).map(p => p.year)).toEqual([2027]);
    expect(await tracked(2026)).toEqual([]);
  });

  it('does nothing at all when no year qualifies', async () => {
    const from2027 = { ...testEnv, GOOGLE_SYNC_START_YEAR: '2027' };
    await paidMember('this@example.com', 2026);

    const result = await sync(MARCH, from2027);

    expect(result).toEqual({ configured: true, error: null, years: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('always-added addresses', () => {
  const withExtras = (value) => ({ ...testEnv, GOOGLE_GROUP_ALWAYS_ADD: value });

  it('adds them to every synced group, member or not', async () => {
    await paidMember('this@example.com', 2026);

    const result = await sync(NOVEMBER, withExtras('Automations@n4jhc.com, second@example.com'));

    expect(inGroup(G2026)).toEqual(['automations@n4jhc.com', 'second@example.com', 'this@example.com']);
    expect(inGroup(G2027)).toEqual(['automations@n4jhc.com', 'second@example.com']);
    expect(result.years.every(y => y.errors.length === 0)).toBe(true);
  });

  it('adds them once and does not count them as members', async () => {
    const e = withExtras('automations@n4jhc.com');
    await paidMember('paid@example.com');
    await sync(MARCH, e);
    calls = [];

    await sync(MARCH, e);

    expect(calls).toEqual([]);
    expect((await planSync(e, MARCH))[0]).toMatchObject({ in_group: 1, add: [], remove: [] });
  });

  it('does not duplicate an address that is also a member', async () => {
    await paidMember('automations@n4jhc.com');

    await sync(MARCH, withExtras('automations@n4jhc.com'));

    expect(calls).toEqual([`POST ${G2026} automations@n4jhc.com`]);
  });

  it('removes them once they are taken out of the setting', async () => {
    await sync(MARCH, withExtras('automations@n4jhc.com'));
    expect(inGroup(G2026)).toEqual(['automations@n4jhc.com']);

    const result = await sync(MARCH, testEnv);

    expect(result.years[0].removed).toEqual(['automations@n4jhc.com']);
    expect(inGroup(G2026)).toEqual([]);
  });
});

describe('who is synced', () => {
  it('adds every kind of current member', async () => {
    await paidMember('paid@example.com');
    const payer = await paidMember('payer@example.com', 2026, { membership_type: 'family' });
    const covered = await addMember({ email: 'covered@example.com' });
    await addMembership(covered, 2026, { status: 'active', amount_due: 0, covered_by_member_id: payer });
    const honorary = await addMember({ email: 'honorary@example.com' });
    await addMembership(honorary, 2026, { status: 'honorary' });
    const waived = await addMember({ email: 'waived@example.com' });
    await addMembership(waived, 2026, { status: 'waived' });
    const eastman = await addMember({ email: 'eastman@example.com', is_eastman_member: 1 });
    await addMembership(eastman, 2026, { status: 'active', amount_due: 0, payment_method: 'eastman' });
    await addMember({ email: 'lifetime@example.com', membership_type: 'lifetime_honorary' });

    const result = await sync();

    expect(result).toMatchObject({ configured: true, error: null });
    expect(inGroup(G2026)).toEqual([
      'covered@example.com', 'eastman@example.com', 'honorary@example.com', 'lifetime@example.com',
      'paid@example.com', 'payer@example.com', 'waived@example.com',
    ]);
    expect(result.years[0]).toMatchObject({ year: 2026, group: G2026, removed: [], pending: 0, errors: [] });
    expect(result.years[0].added).toHaveLength(7);
    expect((await tracked()).every(t => t.added_by_sync === 1)).toBe(true);
  });

  it('leaves out everyone who is not current', async () => {
    const unpaid = await addMember({ email: 'unpaid@example.com' });
    await addMembership(unpaid, 2026, { status: 'active' });
    const pending = await addMember({ email: 'pending@example.com' });
    await addMembership(pending, 2026, { status: 'pending', covered_by_member_id: unpaid });
    const expired = await addMember({ email: 'expired@example.com' });
    await addMembership(expired, 2026, { status: 'expired', amount_paid: 20 });
    await paidMember('lastyear@example.com', 2025);
    await paidMember('silentkey@example.com', 2026, { is_silent_key: 1 });
    await addMember({ email: 'norecord@example.com' });

    const result = await sync();

    expect(inGroup(G2026)).toEqual([]);
    expect(calls).toEqual([]);
    expect(tokenAssertions).toEqual([]);
    expect(result.years[0]).toMatchObject({ added: [], removed: [], pending: 0, errors: [] });
  });

  it('skips members with no email and reports how many', async () => {
    await paidMember(null);
    await paidMember('   ');
    await paidMember('has@example.com');

    await sync();

    expect(inGroup(G2026)).toEqual(['has@example.com']);
    expect((await planSync(testEnv, MARCH))[0]).toMatchObject({ no_email: 2, in_group: 1, add: [], remove: [] });
  });

  it('adds a shared family address once, in lower case', async () => {
    await paidMember('Family@Example.com');
    await paidMember(' family@example.com ');

    await sync();

    expect(calls).toEqual([`POST ${G2026} family@example.com`]);
    expect(await tracked()).toEqual([{ email: 'family@example.com', added_by_sync: 1 }]);
  });

  it('puts advance renewals in next year\'s group during renewal season', async () => {
    await paidMember('this@example.com', 2026);
    await paidMember('next@example.com', 2027);
    await paidMember('both@example.com', 2026).then(id =>
      addMembership(id, 2027, { status: 'active', amount_paid: 20 }));

    const result = await sync(NOVEMBER);

    expect(inGroup(G2026)).toEqual(['both@example.com', 'this@example.com']);
    expect(inGroup(G2027)).toEqual(['both@example.com', 'next@example.com']);
    expect(result.years.map(y => y.year)).toEqual([2026, 2027]);
  });

  it('does not touch next year\'s group outside renewal season', async () => {
    await paidMember('next@example.com', 2027);

    await sync(MARCH);

    expect(inGroup(G2027)).toEqual([]);
  });
});

describe('keeping the group up to date', () => {
  it('does nothing, and does not sign in to Google, when already in sync', async () => {
    await paidMember('paid@example.com');
    await sync();
    calls = [];
    tokenAssertions = [];

    const result = await sync();

    expect(calls).toEqual([]);
    expect(tokenAssertions).toEqual([]);
    expect(result.years[0]).toMatchObject({ added: [], removed: [], pending: 0, errors: [] });
  });

  it('removes a member whose payment is voided', async () => {
    const id = await paidMember('voided@example.com');
    await paidMember('stays@example.com');
    await sync();
    await env.DB.prepare(`UPDATE memberships SET amount_paid = NULL, status = 'pending' WHERE member_id = ?`).bind(id).run();

    const result = await sync();

    expect(result.years[0]).toMatchObject({ added: [], removed: ['voided@example.com'] });
    expect(inGroup(G2026)).toEqual(['stays@example.com']);
    expect(await tracked()).toEqual([{ email: 'stays@example.com', added_by_sync: 1 }]);
  });

  it('swaps the address when a member\'s email changes', async () => {
    const id = await paidMember('old@example.com');
    await sync();
    await env.DB.prepare(`UPDATE members SET email = 'new@example.com' WHERE id = ?`).bind(id).run();

    const result = await sync();

    expect(result.years[0]).toMatchObject({ added: ['new@example.com'], removed: ['old@example.com'] });
    expect(inGroup(G2026)).toEqual(['new@example.com']);
  });

  it('never removes an address that was already in the group', async () => {
    groups.get(G2026).add('byhand@example.com');
    const id = await paidMember('byhand@example.com');

    const first = await sync();
    expect(first.years[0].added).toEqual([]);
    expect(await tracked()).toEqual([{ email: 'byhand@example.com', added_by_sync: 0 }]);

    await env.DB.prepare(`DELETE FROM memberships WHERE member_id = ?`).bind(id).run();
    calls = [];
    const second = await sync();

    expect(calls).toEqual([]);
    expect(second.years[0].removed).toEqual([]);
    expect(inGroup(G2026)).toEqual(['byhand@example.com']);
    expect(await tracked()).toEqual([]);
  });

  it('leaves addresses added by hand in Google alone', async () => {
    groups.get(G2026).add('friend-of-the-club@example.com');
    await paidMember('paid@example.com');

    await sync();

    expect(inGroup(G2026)).toEqual(['friend-of-the-club@example.com', 'paid@example.com']);
  });

  it('counts an address that is already gone from Google as removed', async () => {
    const id = await paidMember('gone@example.com');
    await sync();
    groups.get(G2026).delete('gone@example.com');
    await env.DB.prepare(`DELETE FROM memberships WHERE member_id = ?`).bind(id).run();

    const result = await sync();

    expect(result.years[0]).toMatchObject({ removed: ['gone@example.com'], errors: [] });
    expect(await tracked()).toEqual([]);
  });

  it('records what changed in the audit log', async () => {
    await paidMember('paid@example.com');

    await sync();
    await sync();

    expect(await auditActions()).toEqual([{
      action: 'google_group.sync',
      detail: { year: 2026, group: G2026, added: ['paid@example.com'], removed: [] },
    }]);
  });
});

describe('limits and failures', () => {
  it('spreads a large change over several runs', async () => {
    const total = MAX_CHANGES_PER_RUN + 5;
    for (let i = 0; i < total; i++) await paidMember(`m${String(i).padStart(2, '0')}@example.com`);

    const first = await sync();
    expect(first.years[0].added).toHaveLength(MAX_CHANGES_PER_RUN);
    expect(first.years[0].pending).toBe(5);
    expect(calls).toHaveLength(MAX_CHANGES_PER_RUN);

    const second = await sync();
    expect(second.years[0].added).toHaveLength(5);
    expect(second.years[0].pending).toBe(0);
    expect(groups.get(G2026).size).toBe(total);
  });

  it('reports a missing group and still syncs the other year', async () => {
    groups.delete(G2027);
    await paidMember('this@example.com', 2026);
    await paidMember('next1@example.com', 2027);
    await paidMember('next2@example.com', 2027);

    const result = await sync(NOVEMBER);

    expect(inGroup(G2026)).toEqual(['this@example.com']);
    expect(result.years[1]).toMatchObject({
      year: 2027, added: [], pending: 2,
      errors: [`The group ${G2027} does not exist. Create it in Google, then sync again.`],
    });
    expect(await tracked(2027)).toEqual([]);
    // One attempt is enough to learn the group is missing
    expect(calls.filter(c => c.includes(G2027))).toHaveLength(1);
  });

  it('keeps going past one address Google rejects', async () => {
    await paidMember('bad@example.com');
    await paidMember('good@example.com');
    failWith = (method, group, email) =>
      email === 'bad@example.com' ? json(400, { error: { message: 'Invalid Input: memberKey' } }) : undefined;

    const result = await sync();

    expect(result.error).toBeNull();
    expect(result.years[0]).toMatchObject({
      added: ['good@example.com'], errors: ['bad@example.com: Invalid Input: memberKey'],
    });
    expect(await tracked()).toEqual([{ email: 'good@example.com', added_by_sync: 1 }]);
  });

  it('stops when Google refuses the service account, keeping what was done', async () => {
    await paidMember('a@example.com');
    await paidMember('b@example.com');
    await paidMember('c@example.com');
    failWith = (method, group, email) =>
      email === 'b@example.com' ? json(403, { error: { message: 'Not Authorized to access this resource/api' } }) : undefined;

    const result = await sync();

    expect(result.error).toBe('Google refused access (403): Not Authorized to access this resource/api');
    expect(calls).toHaveLength(2);
    expect(await tracked()).toEqual([{ email: 'a@example.com', added_by_sync: 1 }]);
  });

  it('reports a failed sign-in', async () => {
    await paidMember('a@example.com');
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
    );

    const result = await sync();

    expect(result.error).toBe('Google sign-in failed (400): Invalid JWT Signature.');
    expect(await tracked()).toEqual([]);
  });

  it('does nothing when the service account key is not set', async () => {
    await paidMember('a@example.com');

    const result = await sync(MARCH, { DB: env.DB });

    expect(result).toEqual({ configured: false, error: null, years: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('Google sign-in', () => {
  const decode = (part) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));

  async function assertion(e = testEnv) {
    await paidMember('a@example.com');
    await sync(MARCH, e);
    expect(tokenAssertions).toHaveLength(1);
    return tokenAssertions[0].split('.');
  }

  it('signs a JWT for the service account with the group-member scope', async () => {
    const [header, claims, signature] = await assertion();

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const c = decode(claims);
    expect(c).toMatchObject({
      iss: 'sync@karc-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/admin.directory.group.member',
      aud: 'https://oauth2.googleapis.com/token',
    });
    expect(c.sub).toBeUndefined();
    expect(c.exp - c.iat).toBe(600);

    const sig = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', keyPair.publicKey, sig, new TextEncoder().encode(`${header}.${claims}`)
    );
    expect(valid).toBe(true);
  });

  it('acts as the admin user when domain-wide delegation is configured', async () => {
    const [, claims] = await assertion({ ...testEnv, GOOGLE_ADMIN_EMAIL: 'webmaster@w4trc.org' });

    expect(decode(claims).sub).toBe('webmaster@w4trc.org');
  });
});

describe('/api/admin/google-sync', () => {
  const call = (method, user, e = testEnv) => handleAdmin(
    new Request('https://members.w4trc.org/api/admin/google-sync', { method }),
    e, '/api/admin/google-sync', user
  );

  async function addAdmin() {
    const result = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@example.com', 'x', 'admin')`
    ).run();
    return { id: result.meta.last_row_id, role: 'admin' };
  }

  it('previews the changes without contacting Google', async () => {
    const admin = await addAdmin();
    const year = new Date().getUTCFullYear();
    await paidMember('new@example.com', year);

    const res = await call('GET', admin);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.years[0]).toMatchObject({ year, in_group: 0, no_email: 0, to_add: ['new@example.com'], to_remove: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('runs the sync for an admin', async () => {
    const admin = await addAdmin();
    const year = new Date().getUTCFullYear();
    groups.set(`${year}members@w4trc.org`, new Set());
    await paidMember('new@example.com', year);

    const res = await call('POST', admin);

    expect(res.status).toBe(200);
    expect((await res.json()).years[0].added).toEqual(['new@example.com']);
    expect(inGroup(`${year}members@w4trc.org`)).toEqual(['new@example.com']);
  });

  it('says so when the sync is not set up', async () => {
    const admin = await addAdmin();

    expect((await (await call('GET', admin, { DB: env.DB })).json()).configured).toBe(false);
    expect((await call('POST', admin, { DB: env.DB })).status).toBe(400);
  });

  it('is admin only', async () => {
    expect((await call('GET', { id: 1, role: 'board' })).status).toBe(403);
    expect((await call('POST', { id: 1, role: 'board' })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
