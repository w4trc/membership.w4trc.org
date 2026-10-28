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

  it('sends nothing when no dues were recorded this week', async () => {
    await addMembership(await addMember(), 2027, {
      status: 'active', amount_paid: 20, created_at: '2020-01-01 00:00:00',
    });

    expect(await (await roundup(RENEWAL_SEASON)).json()).toEqual({ sent: false, reason: 'no_new_payments' });
    expect(emails).toHaveLength(0);
  });
});

describe('Sunday cron', () => {
  it('sends the roundup on its own', async () => {
    await paid(await addMember({ callsign: 'W4CCC' }), 2027);

    const pending = [];
    const ctx = { waitUntil: p => pending.push(p), passThroughOnException() {} };
    await worker.scheduled(
      { cron: '0 23 * * 0', scheduledTime: RENEWAL_SEASON.getTime() },
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
