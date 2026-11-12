import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { handleReminders, reminderList } from '../src/routes/reminders.js';
import { resetDb, addMember, addMembership, auditActions } from './helpers.js';

const YEAR = new Date().getFullYear();
const testEnv = { ...env, RESEND_API_KEY: 're_vitest' };
const OFFICER = { id: null, email: 'treasurer@example.com', role: 'board' };

const paid = (member, year) => addMembership(member, year, { status: 'active', amount_paid: 20 });

let batches;      // what was posted to Resend's batch endpoint
let resendAnswer; // what Resend says back
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare('DELETE FROM renewal_reminders').run();
  batches = [];
  resendAnswer = () => new Response('{"data":[]}', { status: 200 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://api.resend.com/emails/batch') {
      batches.push(JSON.parse(init.body));
      return resendAnswer();
    }
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function call(method, action, body, { user = OFFICER, e = testEnv } = {}) {
  const path = '/api/reminders' + action;
  const res = await handleReminders(new Request('https://members.w4trc.org' + path, {
    method, body: body ? JSON.stringify(body) : undefined,
  }), e, path.split('?')[0], user);
  return { status: res.status, body: await res.json() };
}

const callsigns = (list) => list.map(m => m.callsign).sort();
const reminded = async () => (await env.DB.prepare('SELECT member_id, year, email FROM renewal_reminders ORDER BY id').all()).results;

describe('who gets a renewal reminder', () => {
  it('lists members on the roll who have not paid for the year', async () => {
    await addMember({ callsign: 'W4NEW' });                                   // active, never paid
    await paid(await addMember({ callsign: 'W4LAST', is_active: 0 }), YEAR - 1); // paid last year, since cut off
    await paid(await addMember({ callsign: 'W4PAID' }), YEAR);                // paid
    await addMember({ callsign: 'W4GONE', is_active: 0 });                    // lapsed long ago
    await addMember({ callsign: 'W4SK', is_silent_key: 1 });
    await addMember({ callsign: 'W4LIFE', membership_type: 'lifetime_honorary' });
    await addMembership(await addMember({ callsign: 'W4HON' }), YEAR, { status: 'honorary' });
    await addMembership(await addMember({ callsign: 'W4PEND' }), YEAR, { status: 'pending' }); // a record, but unpaid

    const { recipients, skipped } = await reminderList(env, YEAR);
    expect(callsigns(recipients)).toEqual(['W4LAST', 'W4NEW', 'W4PEND']);
    expect(skipped).toEqual([]);
  });

  it('leaves out, and says why: family dependents, Eastman members, and no usable email', async () => {
    const payer = await addMember({ callsign: 'W4PAY', membership_type: 'family' });
    const dependent = await addMember({ callsign: 'W4DEP' });
    await addMembership(payer, YEAR - 1, { status: 'active', amount_paid: 30, membership_type: 'family' });
    await addMembership(dependent, YEAR - 1, { status: 'active', covered_by_member_id: payer });
    await addMember({ callsign: 'W4EMN', is_eastman_member: 1 });
    await addMember({ callsign: 'W4NONE', email: null });
    await addMember({ callsign: 'W4BAD', email: 'not an address' });

    const { recipients, skipped } = await reminderList(env, YEAR);
    expect(callsigns(recipients)).toEqual(['W4PAY']);
    expect(Object.fromEntries(skipped.map(m => [m.callsign, m.reason]))).toEqual({
      W4DEP: 'family', W4EMN: 'eastman', W4NONE: 'no_email', W4BAD: 'bad_email',
    });
    expect(skipped.find(m => m.callsign === 'W4DEP').payer).toContain('W4PAY');
  });

  it('takes this year, last year or next year only', async () => {
    expect((await call('GET', `?year=${YEAR + 1}`)).status).toBe(200);
    expect((await call('GET', `?year=${YEAR - 1}`)).status).toBe(200);
    expect((await call('GET', `?year=${YEAR + 2}`)).status).toBe(400);
    expect((await call('GET', '?year=soon')).status).toBe(400);
  });
});

describe('sending renewal reminders', () => {
  it('emails only the chosen members who still owe, one email each', async () => {
    const a = await addMember({ callsign: 'W4AAA', first_name: 'Alex', email: 'alex@example.com' });
    const b = await addMember({ callsign: 'W4BBB', email: 'blair@example.com', membership_type: 'family' });
    const c = await addMember({ callsign: 'W4CCC', email: 'casey@example.com' });
    const justPaid = await addMember({ callsign: 'W4PAID', email: 'paid@example.com' });
    await paid(justPaid, YEAR);

    const res = await call('POST', '/send', { year: YEAR, member_ids: [a, b, justPaid, 99999], note: 'See you at the <June> meeting' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: YEAR, sent: 2, failed: [], not_sent: 2 });

    expect(batches).toHaveLength(1);
    expect(batches[0].map(m => m.to)).toEqual([['alex@example.com'], ['blair@example.com']]);
    const [alex, blair] = batches[0];
    expect(alex.subject).toContain(`${YEAR} dues reminder`);
    expect(alex.html).toContain('Hi Alex,');
    expect(alex.html).toContain('<strong>$20</strong>');
    expect(alex.html).toContain('See you at the &lt;June&gt; meeting');
    expect(alex.reply_to).toBe(env.CONTACT_EMAIL);
    expect(blair.html).toContain('<strong>$30</strong>');

    expect(await reminded()).toEqual([
      { member_id: a, year: YEAR, email: 'alex@example.com' },
      { member_id: b, year: YEAR, email: 'blair@example.com' },
    ]);
    const { recipients } = await reminderList(env, YEAR);
    expect(recipients.find(m => m.id === a).last_reminded).toBeTruthy();
    expect(recipients.find(m => m.id === c).last_reminded).toBeNull();
    expect(await auditActions()).toContainEqual({
      action: 'reminder.sent', detail: { year: YEAR, sent_count: 2, failed_count: 0, member_ids: [a, b] },
    });
  });

  it('does not email the same member twice when Send is pressed twice', async () => {
    const a = await addMember({ callsign: 'W4AAA' });
    expect((await call('POST', '/send', { year: YEAR, member_ids: [a] })).status).toBe(200);
    expect((await call('POST', '/send', { year: YEAR, member_ids: [a] })).status).toBe(409);
    expect(batches).toHaveLength(1);
    expect(await reminded()).toHaveLength(1);
  });

  it('records only the emails Resend took', async () => {
    const a = await addMember({ callsign: 'W4AAA' });
    const b = await addMember({ callsign: 'W4BBB' });
    resendAnswer = () => new Response(JSON.stringify({ data: [{ id: 'e1' }], errors: [{ index: 1, message: 'Invalid `to` field' }] }), { status: 200 });

    const res = await call('POST', '/send', { year: YEAR, member_ids: [a, b] });
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toMatchObject([{ id: b, callsign: 'W4BBB', error: 'Invalid `to` field' }]);
    expect((await reminded()).map(r => r.member_id)).toEqual([a]);
  });

  it('records nothing when Resend turns the whole batch down', async () => {
    const a = await addMember({ callsign: 'W4AAA' });
    resendAnswer = () => new Response('{"message":"You have reached your daily email sending quota"}', { status: 429 });

    const res = await call('POST', '/send', { year: YEAR, member_ids: [a] });
    expect(res.body.sent).toBe(0);
    expect(res.body.failed[0].error).toContain('daily email sending quota');
    expect(await reminded()).toEqual([]);
  });

  it('says so when email is not set up, and sends nothing', async () => {
    const a = await addMember({ callsign: 'W4AAA' });
    const res = await call('POST', '/send', { year: YEAR, member_ids: [a] }, { e: env });
    expect(res.status).toBe(500);
    expect(batches).toEqual([]);
    expect((await call('GET', `?year=${YEAR}`, null, { e: env })).body.email_ready).toBe(false);
  });

  it('shows the email first, and sends a test copy only to the officer', async () => {
    await addMember({ callsign: 'W4AAA', first_name: 'Alex' });
    const preview = await call('POST', '/preview', { year: YEAR, note: '' });
    expect(preview.body.subject).toContain(String(YEAR));
    expect(preview.body.html).toContain('Hi Alex,');
    expect(batches).toEqual([]);

    const test = await call('POST', '/test', { year: YEAR });
    expect(test.body).toEqual({ ok: true, to: 'treasurer@example.com' });
    expect(batches[0].map(m => m.to)).toEqual([['treasurer@example.com']]);
    expect(batches[0][0].subject).toMatch(/^\[Test\] /);
    expect(await reminded()).toEqual([]);
  });

  it('is for officers', async () => {
    const res = await call('GET', `?year=${YEAR}`, null, { user: { id: 1, email: 'm@example.com', role: 'member' } });
    expect(res.status).toBe(403);
  });

  it('is never sent by a scheduled run', async () => {
    await addMember({ callsign: 'W4AAA' });
    for (const cron of ['0 8 * * *', '15 * * * *', '0 23 * * SUN']) {
      const ctx = createExecutionContext();
      await worker.scheduled({ cron, scheduledTime: Date.UTC(2026, 10, 15, 3) }, testEnv, ctx);
      await waitOnExecutionContext(ctx);
    }
    expect(batches).toEqual([]);
    expect(await reminded()).toEqual([]);
  });
});
