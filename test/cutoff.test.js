import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleAdmin } from '../src/routes/admin.js';
import { resetDb, addMember, addMembership, getMember, auditActions } from './helpers.js';

let admin;

const cutoff = (body, user = admin) => handleAdmin(
  new Request('https://members.w4trc.org/api/admin/cutoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  env, '/api/admin/cutoff', user
);

const isActive = async (id) => (await getMember(id)).is_active === 1;

beforeEach(async () => {
  await resetDb();
  const result = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES ('admin@example.com', 'x', 'admin')`
  ).run();
  admin = { id: result.meta.last_row_id, role: 'admin' };
});

describe('membership cutoff', () => {
  it('deactivates members with no record, or an unpaid one, for the year', async () => {
    const noRecord = await addMember();
    const unpaid = await addMember();
    await addMembership(unpaid, 2027, { status: 'active' });
    const lastYearOnly = await addMember();
    await addMembership(lastYearOnly, 2026, { status: 'active', amount_paid: 20 });

    const res = await cutoff({ year: 2027, dry_run: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dry_run: false, year: 2027, deactivated_count: 3 });
    for (const id of [noRecord, unpaid, lastYearOnly]) expect(await isActive(id)).toBe(false);
    expect(await auditActions()).toEqual([{
      action: 'member.cutoff',
      detail: { year: 2027, deactivated_count: 3, member_ids: expect.arrayContaining([noRecord, unpaid, lastYearOnly]) },
    }]);
  });

  it('keeps everyone who is current for the year', async () => {
    const paid = await addMember();
    await addMembership(paid, 2027, { status: 'active', amount_paid: 20 });
    const honorary = await addMember();
    await addMembership(honorary, 2027, { status: 'honorary' });
    const waived = await addMember();
    await addMembership(waived, 2027, { status: 'waived' });
    const covered = await addMember();
    await addMembership(covered, 2027, { status: 'active', amount_due: 0, covered_by_member_id: paid });
    const lifetime = await addMember({ membership_type: 'lifetime_honorary' });

    const res = await cutoff({ year: 2027, dry_run: false });

    expect((await res.json()).deactivated_count).toBe(0);
    for (const id of [paid, honorary, waived, covered, lifetime]) expect(await isActive(id)).toBe(true);
  });

  it('keeps Eastman members, whose dues record has no amount paid', async () => {
    const eastman = await addMember({ is_eastman_member: 1 });
    await addMembership(eastman, 2027, { status: 'active', amount_due: 0, payment_method: 'eastman' });

    const res = await cutoff({ year: 2027, dry_run: false });

    expect((await res.json()).deactivated_count).toBe(0);
    expect(await isActive(eastman)).toBe(true);
  });

  it('still cuts an Eastman member with no record for the year', async () => {
    const eastman = await addMember({ is_eastman_member: 1 });
    await addMembership(eastman, 2026, { status: 'active', amount_due: 0, payment_method: 'eastman' });

    await cutoff({ year: 2027, dry_run: false });

    expect(await isActive(eastman)).toBe(false);
  });

  it('only previews by default', async () => {
    const lapsed = await addMember({ callsign: 'KT4LAP' });

    const res = await cutoff({ year: 2027 });

    const body = await res.json();
    expect(body).toMatchObject({ dry_run: true, affected_count: 1 });
    expect(body.members[0]).toMatchObject({ id: lapsed, callsign: 'KT4LAP' });
    expect(await isActive(lapsed)).toBe(true);
    expect(await auditActions()).toEqual([]);
  });

  it('never touches silent keys or members who are already inactive', async () => {
    await addMember({ is_silent_key: 1 });
    await addMember({ is_active: 0 });

    const res = await cutoff({ year: 2027, dry_run: false });

    expect((await res.json()).deactivated_count).toBe(0);
  });

  it('is admin only', async () => {
    const lapsed = await addMember();

    const res = await cutoff({ year: 2027, dry_run: false }, { id: admin.id, role: 'board' });

    expect(res.status).toBe(403);
    expect(await isActive(lapsed)).toBe(true);
  });
});
