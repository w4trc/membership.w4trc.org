import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleWeeklyRoundup } from '../src/routes/admin.js';
import { resetDb, addMember, addMembership } from './helpers.js';

const testEnv = { ...env, CRON_SECRET: 'cron_vitest', RESEND_API_KEY: 're_vitest' };

function roundup() {
  return handleWeeklyRoundup(
    new Request('https://members.w4trc.org/api/admin/weekly-roundup', {
      method: 'POST',
      headers: { Authorization: 'Bearer cron_vitest' },
    }),
    testEnv,
  );
}

let emails;
beforeEach(async () => {
  await resetDb();
  emails = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    emails.push(JSON.parse(init.body));
    return new Response('{"id":"email_1"}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

describe('weekly roundup', () => {
  it('includes payments for next year made during renewal season', async () => {
    const thisYear = new Date().getFullYear();
    await addMembership(await addMember({ callsign: 'W4AAA' }), thisYear, { status: 'active', amount_paid: 20 });
    await addMembership(await addMember({ callsign: 'W4BBB' }), thisYear + 1, { status: 'active', amount_paid: 20 });

    const body = await (await roundup()).json();

    expect(body).toMatchObject({ sent: true, new_payments: 2 });
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain('W4AAA');
    expect(emails[0].html).toContain('W4BBB');
  });

  it('sends nothing when no dues were recorded this week', async () => {
    await addMembership(await addMember(), new Date().getFullYear() + 1, {
      status: 'active', amount_paid: 20, created_at: '2020-01-01 00:00:00',
    });

    expect(await (await roundup()).json()).toEqual({ sent: false, reason: 'no_new_payments' });
    expect(emails).toHaveLength(0);
  });
});
