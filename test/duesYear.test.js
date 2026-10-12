import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { duesYear, activateRenewedMembers } from '../src/lib/duesYear.js';
import { resetDb, addMember, addMembership, getMember, auditActions } from './helpers.js';

const utc = (iso) => new Date(`${iso}Z`);

describe('duesYear', () => {
  it('is the current year before renewal season', () => {
    expect(duesYear(utc('2026-01-01T00:00:00'))).toBe(2026);
    expect(duesYear(utc('2026-06-15T12:00:00'))).toBe(2026);
    expect(duesYear(utc('2026-09-30T23:59:59'))).toBe(2026);
  });

  it('is the following year from October 1 through December 31', () => {
    expect(duesYear(utc('2026-10-01T00:00:00'))).toBe(2027);
    expect(duesYear(utc('2026-11-20T12:00:00'))).toBe(2027);
    expect(duesYear(utc('2026-12-31T23:59:59'))).toBe(2027);
  });

  it('rolls back to the current year on January 1', () => {
    expect(duesYear(utc('2027-01-01T00:00:00'))).toBe(2027);
  });
});

describe('activateRenewedMembers', () => {
  const january = utc('2027-01-05T08:00:00');

  beforeEach(resetDb);

  it('reactivates a lapsed member who paid in advance for the new year', async () => {
    const id = await addMember({ is_active: 0 });
    await addMembership(id, 2027, { status: 'active', amount_paid: 21, paid_date: '2026-11-02' });

    await activateRenewedMembers(env, january);

    expect((await getMember(id)).is_active).toBe(1);
    expect(await auditActions()).toEqual([
      { action: 'member.renewal_activated', detail: { year: 2027, activated_count: 1, member_ids: [id] } },
    ]);
  });

  it('reactivates a dependent covered by a family payment made in advance', async () => {
    const payer = await addMember({ membership_type: 'family' });
    const dependent = await addMember({ is_active: 0 });
    await addMembership(dependent, 2027, {
      status: 'active', amount_due: 0, paid_date: '2026-12-01', covered_by_member_id: payer,
    });

    await activateRenewedMembers(env, january);

    expect((await getMember(dependent)).is_active).toBe(1);
  });

  it('does nothing outside January', async () => {
    const id = await addMember({ is_active: 0 });
    await addMembership(id, 2027, { status: 'active', amount_paid: 21, paid_date: '2026-11-02' });

    await activateRenewedMembers(env, utc('2027-02-01T08:00:00'));

    expect((await getMember(id)).is_active).toBe(0);
    expect(await auditActions()).toEqual([]);
  });

  it('leaves a member alone when they paid on or after January 1', async () => {
    // Paying in the new year reactivates at payment time; a member who is
    // inactive after that was deactivated by an officer.
    const id = await addMember({ is_active: 0 });
    await addMembership(id, 2027, { status: 'active', amount_paid: 21, paid_date: '2027-01-02' });

    await activateRenewedMembers(env, january);

    expect((await getMember(id)).is_active).toBe(0);
  });

  it('leaves unpaid and silent-key members inactive', async () => {
    const unpaid = await addMember({ is_active: 0 });
    await addMembership(unpaid, 2027, { status: 'pending', paid_date: '2026-11-02' });
    const noRecord = await addMember({ is_active: 0 });
    const silentKey = await addMember({ is_active: 0, is_silent_key: 1 });
    await addMembership(silentKey, 2027, { status: 'active', amount_paid: 21, paid_date: '2026-11-02' });
    const lastYearOnly = await addMember({ is_active: 0 });
    await addMembership(lastYearOnly, 2026, { status: 'active', amount_paid: 21, paid_date: '2025-11-02' });

    await activateRenewedMembers(env, january);

    for (const id of [unpaid, noRecord, silentKey, lastYearOnly]) {
      expect((await getMember(id)).is_active).toBe(0);
    }
    expect(await auditActions()).toEqual([]);
  });
});
