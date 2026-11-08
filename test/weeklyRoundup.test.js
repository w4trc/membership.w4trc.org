import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import worker from '../src/index.js';
import { handleWeeklyRoundup } from '../src/routes/admin.js';
import { resetDb, addMember, addMembership } from './helpers.js';

const testEnv = { ...env, CRON_SECRET: 'cron_vitest', RESEND_API_KEY: 're_vitest' };

const RENEWAL_SEASON = new Date('2026-10-28T12:00:00Z');
const SUMMER         = new Date('2026-06-15T12:00:00Z');

function roundup(now) {
  return handleWeeklyRoundup(
    new Request('https://members.w4trc.org/api/admin/weekly-roundup', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron_vitest' },
    }),
    testEnv,
    now,
  );
}

const paid = (member, year) => addMembership(member, year, { status: 'active', amount_paid: 20 });

let emails;
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare('DELETE FROM prospects').run();
  emails = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.resend.com/')) emails.push(JSON.parse(init.body));
    return new Response('{"id":"email_1"}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('weekly roundup', () => {
  it('includes payments for next year made during renewal season', async () => {
    await paid(await addMember({ callsign: 'W4AAA' }), 2026);
    await paid(await addMember({ callsign: 'W4BBB' }), 2027);

    const body = await (await roundup(RENEWAL_SEASON)).json();

    expect(body).toMatchObject({ sent: true, new_payments: 2 });
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain('W4AAA');
    expect(emails[0].html).toContain('W4BBB');
  });

  it('counts this year and next year members during renewal season', async () => {
    const renewed = await addMember();
    await paid(renewed, 2026);
    await paid(renewed, 2027);
    await paid(await addMember(), 2026);
    await addMembership(await addMember(), 2026, { status: 'honorary' });
    await addMember({ membership_type: 'lifetime_honorary' });
    await addMembership(await addMember(), 2027, { status: 'pending' });

    await roundup(RENEWAL_SEASON);

    const html = emails[0].html;
    expect(html).toMatch(/>4<\/div>\s*<div[^>]*>2026 members</);
    expect(html).toMatch(/>2<\/div>\s*<div[^>]*>2027 members</);
    expect(html).toContain('>Year</th>');
  });

  it('counts only this year outside renewal season', async () => {
    await paid(await addMember(), 2026);

    await roundup(SUMMER);

    const html = emails[0].html;
    expect(html).toMatch(/>1<\/div>\s*<div[^>]*>2026 members</);
    expect(html).not.toContain('2027 members');
    expect(html).not.toContain('>Year</th>');
  });

  it('sends nothing when no dues were recorded and no local hams were added this week', async () => {
    await addMembership(await addMember(), 2027, {
      status: 'active', amount_paid: 20, created_at: '2020-01-01 00:00:00',
    });
    await env.DB.prepare(
      `INSERT INTO prospects (callsign, city, auto_added_at) VALUES ('KR4OLD', 'Kingsport', '2020-01-01 00:00:00')`
    ).run();

    expect(await (await roundup(RENEWAL_SEASON)).json()).toEqual({ sent: false, reason: 'nothing_new' });
    expect(emails).toHaveLength(0);
  });

  it('lists local hams added from the FCC this week', async () => {
    await env.DB.prepare(`
      INSERT INTO prospects (callsign, first_name, last_name, city, license_class, added_reason, auto_added_at)
      VALUES ('KR4NEW', 'Jane', 'Doe', 'Church Hill', 'Technician', 'new_license', datetime('now', '-1 day'))
    `).run();

    const body = await (await roundup(RENEWAL_SEASON)).json();

    expect(body).toMatchObject({ sent: true, new_payments: 0, new_prospects: 1 });
    expect(emails[0].html).toContain('New local hams this week (1)');
    expect(emails[0].html).toContain('KR4NEW');
    expect(emails[0].html).toContain('New license');
    expect(emails[0].html).toContain('No new dues payments this week.');
  });

  it('sends a week with only donations, and lists each one', async () => {
    const member = await addMember({ callsign: 'W4DON', first_name: 'Dana', last_name: 'Giver' });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO donations (donor_type, member_id, donation_kind, amount, donation_date, payment_method)
                      VALUES ('member', ?, 'monetary', 50, '2026-10-26', 'check')`).bind(member),
      env.DB.prepare(`INSERT INTO donations (donor_type, organization_name, donation_kind, item_description, estimated_value, donation_date)
                      VALUES ('organization', 'Acme Radio', 'item', 'HF transceiver', 400, '2026-10-27')`),
      env.DB.prepare(`INSERT INTO donations (donor_type, donor_name, donation_kind, amount, donation_date, payment_method)
                      VALUES ('individual', 'Pat Public', 'monetary', 25, '2026-10-27', 'stripe')`),
      env.DB.prepare(`INSERT INTO donations (donor_type, donation_kind, amount, donation_date, created_at)
                      VALUES ('anonymous', 'monetary', 999, '2020-01-01', '2020-01-01 00:00:00')`),
    ]);

    const body = await (await roundup(RENEWAL_SEASON)).json();

    expect(body).toMatchObject({ sent: true, new_payments: 0, new_prospects: 0, new_donations: 3 });
    const html = emails[0].html;
    expect(html).toContain('Donations this week (3)');
    expect(html).toContain('W4DON');
    expect(html).toContain('Dana Giver');
    expect(html).toContain('Acme Radio');
    expect(html).toContain('HF transceiver (est. $400.00)');
    expect(html).toContain('Pat Public');
    expect(html).toContain('$75.00');
    expect(html).not.toContain('$999.00');
  });

  it('leaves out hams added by a catch-up run', async () => {
    await env.DB.prepare(`
      INSERT INTO prospects (callsign, city, source, added_reason, auto_added_at)
      VALUES ('KR4BAK', 'Kingsport', 'fcc_backfill', 'backfill', datetime('now', '-1 day'))
    `).run();

    expect(await (await roundup(RENEWAL_SEASON)).json()).toEqual({ sent: false, reason: 'nothing_new' });
  });
});

describe('Sunday cron', () => {
  it('sends the roundup on its own', async () => {
    await paid(await addMember({ callsign: 'W4CCC' }), 2027);

    const pending = [];
    const ctx = { waitUntil: p => pending.push(p), passThroughOnException() {} };
    await worker.scheduled(
      { cron: '0 23 * * SUN', scheduledTime: RENEWAL_SEASON.getTime() },
      testEnv,
      ctx,
    );
    await Promise.all(pending);

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(['contact@w4trc.org']);
    expect(emails[0].html).toContain('W4CCC');
    expect(emails[0].html).toContain('2027 members');
  });
});
