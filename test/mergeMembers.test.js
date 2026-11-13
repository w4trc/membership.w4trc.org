import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleMembers } from '../src/routes/members.js';
import { resetDb, addMember, addMembership, getMembership, getMember, auditActions } from './helpers.js';

const admin = { id: null, role: 'admin' };
const board = { id: null, role: 'board' };

async function call(method, path, body, user = admin) {
  const res = await handleMembers(
    new Request(`https://members.w4trc.org/api/members${path}`, {
      method, ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    env, `/api/members${path.split('?')[0]}`, user
  );
  return { status: res.status, body: await res.json() };
}

const preview = (from, into, user) => call('GET', `/${from}/merge?into=${into}`, null, user);
const merge   = (from, into, user) => call('POST', `/${from}/merge`, { into }, user);

const rows = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
const run  = (sql, ...args) => env.DB.prepare(sql).bind(...args).run();

async function addUser(email, memberId, role = 'member') {
  const r = await run(`INSERT INTO users (email, password_hash, role, member_id) VALUES (?, 'x', ?, ?)`, email, role, memberId);
  return r.meta.last_row_id;
}

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM meeting_attendees'),
    env.DB.prepare('DELETE FROM meetings'),
    env.DB.prepare('DELETE FROM inventory_events'),
    env.DB.prepare('DELETE FROM inventory_items'),
  ]);
});

describe('merging a duplicate member record', () => {
  it('moves the history to the kept record and deletes the duplicate', async () => {
    const old = await addMember({ callsign: 'KO4OLD', first_name: 'Pat', last_name: 'Ham', joined_date: '2019-03-01' });
    const neu = await addMember({ callsign: 'W4NEW', first_name: 'Pat', last_name: 'Ham', joined_date: '2026-02-01' });
    const child = await addMember({ callsign: 'KO4KID' });
    await addMembership(old, 2024, { status: 'active', amount_paid: 20, payment_method: 'check' });
    await addMembership(old, 2025, { status: 'active', amount_paid: 30, membership_type: 'family' });
    await addMembership(child, 2025, { status: 'active', covered_by_member_id: old });
    await addMembership(neu, 2026, { status: 'active', amount_paid: 20 });

    await run(`INSERT INTO notes (member_id, note_text) VALUES (?, 'Net control on Tuesdays')`, old);
    await run(`INSERT INTO donations (donor_type, member_id, donation_kind, amount, donation_date) VALUES ('member', ?, 'monetary', 50, '2024-06-01')`, old);
    await run(`INSERT INTO renewal_reminders (member_id, year, email) VALUES (?, 2025, 'pat@example.com')`, old);
    await run(`INSERT INTO officers (year, position, name, callsign, member_id) VALUES (2023, 'president', 'Pat Ham', 'KO4OLD', ?)`, old);
    await run(`INSERT INTO google_group_members (year, email, member_id) VALUES (2025, 'pat@example.com', ?)`, old);
    await run(`INSERT INTO inventory_items (name, assigned_member_id) VALUES ('Go kit', ?)`, old);
    const meeting = (await run(`INSERT INTO meetings (meeting_date) VALUES ('2025-05-06')`)).meta.last_row_id;
    await run(`INSERT INTO meeting_attendees (meeting_id, member_id, callsign, name) VALUES (?, ?, 'KO4OLD', 'Pat Ham')`, meeting, old);

    const plan = await preview(old, neu);
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({
      from: { id: old, callsign: 'KO4OLD' },
      into: { id: neu, callsign: 'W4NEW' },
      blockers: [],
      fill: { joined_date: '2019-03-01' },
      dues: { move: [2024, 2025], conflicts: [] },
      counts: { notes: 1, donations: 1, attendance: 1, officers: 1, inventory: 1, reminders: 1, covers: 1 },
      login: null,
    });
    expect(plan.body.removed).toBeUndefined();
    expect(await getMember(old)).toBeTruthy(); // a preview changes nothing

    expect((await merge(old, neu)).status).toBe(200);

    expect(await getMember(old)).toBeNull();
    expect(await getMember(neu)).toMatchObject({ callsign: 'W4NEW', joined_date: '2019-03-01' });
    expect((await rows(`SELECT year FROM memberships WHERE member_id = ? ORDER BY year`, neu)).map(r => r.year))
      .toEqual([2024, 2025, 2026]);
    expect((await getMembership(child, 2025)).covered_by_member_id).toBe(neu);

    for (const table of ['notes', 'donations', 'renewal_reminders', 'officers', 'google_group_members', 'meeting_attendees']) {
      expect(await rows(`SELECT member_id FROM ${table}`), table).toEqual([{ member_id: neu }]);
    }
    expect(await rows(`SELECT assigned_member_id FROM inventory_items`)).toEqual([{ assigned_member_id: neu }]);

    const log = (await auditActions()).find(a => a.action === 'member.merge');
    expect(log.detail).toMatchObject({ merged: 'KO4OLD Pat Ham', into: 'W4NEW Pat Ham', removed: { id: old, callsign: 'KO4OLD' } });
  });

  it('fills blanks on the kept record, and never overwrites what it has', async () => {
    const dup = await addMember({
      callsign: 'W4NEW', email: 'new@example.com', phone: '423-555-0100',
      address: '1 New St', city: 'Kingsport', state: 'TN', zip: '37660',
      emergency_name: 'Sam', emergency_phone: '423-555-0199', license_class: 'General',
    });
    const kept = await addMember({
      callsign: null, email: 'kept@example.com', phone: null, address: null, city: 'Church Hill',
      emergency_name: null, emergency_phone: null, license_class: 'Technician', is_active: 0,
    });

    expect((await merge(dup, kept)).status).toBe(200);
    expect(await getMember(kept)).toMatchObject({
      callsign: 'W4NEW',             // the duplicate's callsign is free once it is deleted
      email: 'kept@example.com',
      phone: '423-555-0100',
      address: '1 New St', city: 'Kingsport', state: 'TN', zip: '37660',
      emergency_name: 'Sam', emergency_phone: '423-555-0199',
      license_class: 'Technician',
      is_active: 1,
    });
  });

  it('keeps the better dues record when both have the same year', async () => {
    const dup = await addMember({ callsign: 'KO4OLD' });
    const kept = await addMember({ callsign: 'W4NEW' });
    await addMembership(dup, 2025, { status: 'active', amount_paid: 20, payment_method: 'cash' });
    await addMembership(kept, 2025, { status: 'pending' });
    await addMembership(dup, 2026, { status: 'pending' });
    await addMembership(kept, 2026, { status: 'active', amount_paid: 20, payment_method: 'stripe' });

    const plan = await preview(dup, kept);
    expect(plan.body.blockers).toEqual([]);
    expect(plan.body.dues.conflicts.map(c => [c.year, c.keep, c.kept.amount_paid, c.dropped.status])).toEqual([
      [2025, 'from', 20, 'pending'],
      [2026, 'into', 20, 'pending'],
    ]);

    expect((await merge(dup, kept)).status).toBe(200);
    expect(await rows(`SELECT year, amount_paid, payment_method FROM memberships WHERE member_id = ? ORDER BY year`, kept)).toEqual([
      { year: 2025, amount_paid: 20, payment_method: 'cash' },
      { year: 2026, amount_paid: 20, payment_method: 'stripe' },
    ]);
    expect(await rows(`SELECT id FROM memberships WHERE member_id != ?`, kept)).toEqual([]);
  });

  it('refuses when both records were paid for the same year, and changes nothing', async () => {
    const dup = await addMember({ callsign: 'KO4OLD' });
    const kept = await addMember({ callsign: 'W4NEW' });
    await addMembership(dup, 2026, { status: 'active', amount_paid: 20 });
    await addMembership(kept, 2026, { status: 'active', amount_paid: 20 });

    const plan = await preview(dup, kept);
    expect(plan.body.blockers).toHaveLength(1);
    expect(plan.body.blockers[0]).toContain('2026');

    const res = await merge(dup, kept);
    expect(res.status).toBe(409);
    expect(await getMember(dup)).toBeTruthy();
    expect(await getMembership(dup, 2026)).toBeTruthy();
    expect((await auditActions()).filter(a => a.action === 'member.merge')).toEqual([]);
  });

  it('counts a meeting once when both records signed in to it', async () => {
    const dup = await addMember({ callsign: 'KO4OLD' });
    const kept = await addMember({ callsign: 'W4NEW' });
    const both = (await run(`INSERT INTO meetings (meeting_date) VALUES ('2026-05-05')`)).meta.last_row_id;
    const one  = (await run(`INSERT INTO meetings (meeting_date) VALUES ('2026-04-07')`)).meta.last_row_id;
    await run(`INSERT INTO meeting_attendees (meeting_id, member_id, callsign) VALUES (?, ?, 'KO4OLD')`, both, dup);
    await run(`INSERT INTO meeting_attendees (meeting_id, member_id, callsign) VALUES (?, ?, 'W4NEW')`, both, kept);
    await run(`INSERT INTO meeting_attendees (meeting_id, member_id, callsign) VALUES (?, ?, 'KO4OLD')`, one, dup);

    expect((await merge(dup, kept)).status).toBe(200);
    expect(await rows(`SELECT meeting_id, member_id, callsign FROM meeting_attendees ORDER BY meeting_id`)).toEqual([
      { meeting_id: both, member_id: kept, callsign: 'W4NEW' },
      { meeting_id: one, member_id: kept, callsign: 'KO4OLD' },
    ]);
  });

  it('clears family cover between the two records, which would cover itself', async () => {
    const dup = await addMember({ callsign: 'KO4OLD' });
    const kept = await addMember({ callsign: 'W4NEW' });
    await addMembership(kept, 2026, { status: 'active', covered_by_member_id: dup });

    expect((await merge(dup, kept)).status).toBe(200);
    expect((await getMembership(kept, 2026)).covered_by_member_id).toBeNull();
  });

  describe('portal sign-ins', () => {
    const logins = () => rows(`SELECT email, member_id FROM users ORDER BY email`);

    it('moves the sign-in when the kept record has none', async () => {
      const dup = await addMember();
      const kept = await addMember();
      await addUser('dup@example.com', dup);

      expect((await preview(dup, kept)).body.login).toEqual({ email: 'dup@example.com', action: 'move' });
      await merge(dup, kept);
      expect(await logins()).toEqual([{ email: 'dup@example.com', member_id: kept }]);
    });

    it('deletes the duplicate\'s sign-in when the kept record has its own', async () => {
      const dup = await addMember();
      const kept = await addMember();
      await addUser('dup@example.com', dup);
      await addUser('kept@example.com', kept);

      expect((await preview(dup, kept)).body.login).toEqual({ email: 'dup@example.com', action: 'delete' });
      await merge(dup, kept);
      expect(await logins()).toEqual([{ email: 'kept@example.com', member_id: kept }]);
    });

    it('leaves an officer\'s sign-in in place, off the member record', async () => {
      const dup = await addMember();
      const kept = await addMember();
      await addUser('officer@example.com', dup, 'board');
      await addUser('kept@example.com', kept);

      expect((await preview(dup, kept)).body.login).toEqual({ email: 'officer@example.com', action: 'unlink' });
      await merge(dup, kept);
      expect(await logins()).toEqual([
        { email: 'kept@example.com', member_id: kept },
        { email: 'officer@example.com', member_id: null },
      ]);
    });
  });

  it('is for admins only, and needs two different records that exist', async () => {
    const a = await addMember();
    const b = await addMember();

    expect((await preview(a, b, board)).status).toBe(403);
    expect((await merge(a, b, board)).status).toBe(403);
    expect((await merge(a, a)).status).toBe(400);
    expect((await call('POST', `/${a}/merge`, {})).status).toBe(400);
    expect((await merge(a, 99999)).status).toBe(404);
    expect((await call('DELETE', `/${a}/merge`)).status).toBe(405);
    expect(await getMember(a)).toBeTruthy();
    expect(await getMember(b)).toBeTruthy();
  });
});
