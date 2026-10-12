import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { familyDependents, familyPayer, coverFamilyDependents } from '../src/lib/family.js';
import { resetDb, addMember, addMembership, getMembership } from './helpers.js';

const ids = (rows) => rows.map(r => r.id);

describe('family links', () => {
  let payer;
  let dependent;

  beforeEach(async () => {
    await resetDb();
    payer     = await addMember({ membership_type: 'family', callsign: 'KT4PAY', first_name: 'Pat', last_name: 'Payer' });
    dependent = await addMember();
  });

  it('finds a dependent linked on that year\'s dues record', async () => {
    await addMembership(dependent, 2026, { covered_by_member_id: payer });

    expect(ids(await familyDependents(env, payer, 2026))).toEqual([dependent]);
    expect(await familyPayer(env, dependent, 2026)).toEqual({
      id: payer, callsign: 'KT4PAY', first_name: 'Pat', last_name: 'Payer',
    });
  });

  it('carries the link forward to a year with no dues record yet', async () => {
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    expect(ids(await familyDependents(env, payer, 2026))).toEqual([dependent]);
    expect((await familyPayer(env, dependent, 2026)).id).toBe(payer);
  });

  it('carries the link forward when this year\'s record names no payer', async () => {
    await addMembership(dependent, 2025, { covered_by_member_id: payer });
    await addMembership(dependent, 2026, { status: 'pending' });

    expect(ids(await familyDependents(env, payer, 2026))).toEqual([dependent]);
  });

  it('only carries forward from the most recent earlier record', async () => {
    // Covered in 2024, paid on their own in 2025: the link has ended.
    await addMembership(dependent, 2024, { covered_by_member_id: payer });
    await addMembership(dependent, 2025, { amount_paid: 20 });

    expect(await familyDependents(env, payer, 2026)).toEqual([]);
    expect(await familyPayer(env, dependent, 2026)).toBeNull();
  });

  it('does not apply a link to years before it started', async () => {
    await addMembership(dependent, 2026, { covered_by_member_id: payer });

    expect(await familyDependents(env, payer, 2025)).toEqual([]);
    expect(await familyPayer(env, dependent, 2025)).toBeNull();
  });

  it('follows a dependent who moves to a different payer', async () => {
    const newPayer = await addMember({ membership_type: 'family' });
    await addMembership(dependent, 2025, { covered_by_member_id: payer });
    await addMembership(dependent, 2026, { covered_by_member_id: newPayer });

    expect(await familyDependents(env, payer, 2026)).toEqual([]);
    expect(ids(await familyDependents(env, newPayer, 2026))).toEqual([dependent]);
  });

  it('skips silent-key dependents', async () => {
    const silentKey = await addMember({ is_silent_key: 1 });
    await addMembership(silentKey, 2025, { covered_by_member_id: payer });

    expect(await familyDependents(env, payer, 2026)).toEqual([]);
  });

  it('has no payer for a member with no family link', async () => {
    expect(await familyPayer(env, dependent, 2026)).toBeNull();
    expect(await familyPayer(env, payer, 2026)).toBeNull();
  });
});

describe('coverFamilyDependents', () => {
  let payer;

  beforeEach(async () => {
    await resetDb();
    payer = await addMember({ membership_type: 'family' });
  });

  it('creates a covered dues record for a dependent carried forward from last year', async () => {
    const dependent = await addMember();
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    const covered = await coverFamilyDependents(env, payer, 2026, '2026-02-10');

    expect(covered).toEqual([dependent]);
    expect(await getMembership(dependent, 2026)).toMatchObject({
      status: 'active',
      membership_type: 'family',
      amount_due: 0,
      amount_paid: null,
      paid_date: '2026-02-10',
      covered_by_member_id: payer,
    });
  });

  it('updates a dependent\'s unpaid record for the year', async () => {
    const dependent = await addMember();
    await addMembership(dependent, 2026, { status: 'pending', covered_by_member_id: payer });

    const covered = await coverFamilyDependents(env, payer, 2026, '2026-02-10');

    expect(covered).toEqual([dependent]);
    expect(await getMembership(dependent, 2026)).toMatchObject({
      status: 'active', membership_type: 'family', amount_due: 0, paid_date: '2026-02-10', covered_by_member_id: payer,
    });
  });

  it('leaves dependents who already paid, or are honorary or waived', async () => {
    const paid     = await addMember();
    const honorary = await addMember();
    const waived   = await addMember();
    await addMembership(paid, 2026, {
      covered_by_member_id: payer, amount_paid: 20, paid_date: '2026-01-05', payment_method: 'check',
    });
    await addMembership(honorary, 2026, { covered_by_member_id: payer, status: 'honorary' });
    await addMembership(waived, 2026, { covered_by_member_id: payer, status: 'waived' });

    const covered = await coverFamilyDependents(env, payer, 2026, '2026-02-10');

    expect(covered).toEqual([]);
    expect(await getMembership(paid, 2026)).toMatchObject({
      amount_paid: 20, paid_date: '2026-01-05', payment_method: 'check', amount_due: 20,
    });
    expect((await getMembership(honorary, 2026)).status).toBe('honorary');
    expect((await getMembership(waived, 2026)).status).toBe('waived');
  });

  it('covers nobody when the payer has no dependents', async () => {
    await addMember();

    expect(await coverFamilyDependents(env, payer, 2026, '2026-02-10')).toEqual([]);
  });
});
