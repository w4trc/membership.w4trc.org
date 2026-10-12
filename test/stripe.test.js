import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleStripe } from '../src/routes/stripe.js';
import {
  resetDb, addMember, addMembership, getMember, getMembership, auditActions,
  webhookRequest, duesEvent, donationEvent,
} from './helpers.js';

const WEBHOOK = '/api/stripe/webhook';

// Mid-March: dues are for the current year. November: dues are for next year.
const MARCH    = new Date('2026-03-15T15:00:00Z');
const NOVEMBER = new Date('2026-11-10T15:00:00Z');

const deliver = async (event, options) =>
  handleStripe(await webhookRequest(event, options), env, WEBHOOK);

async function count(table) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
}

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MARCH);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('webhook signature', () => {
  it('rejects a request with no signature header', async () => {
    const res = await handleStripe(
      new Request('https://members.w4trc.org/api/stripe/webhook', { method: 'POST', body: '{}' }),
      env, WEBHOOK
    );
    expect(res.status).toBe(400);
  });

  it('rejects a body signed with the wrong secret', async () => {
    const member = await addMember();
    const res = await deliver(duesEvent({ memberId: member, year: 2026 }), { secret: 'whsec_wrong' });

    expect(res.status).toBe(400);
    expect(await count('memberships')).toBe(0);
  });

  it('rejects a body that was changed after signing', async () => {
    const member = await addMember();
    const signed = await webhookRequest(duesEvent({ memberId: member, year: 2026, amountTotal: 2100 }));
    const tampered = new Request(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: (await signed.text()).replace('2100', '9900'),
    });

    const res = await handleStripe(tampered, env, WEBHOOK);

    expect(res.status).toBe(400);
    expect(await count('memberships')).toBe(0);
  });

  it('rejects a signature older than five minutes', async () => {
    const member = await addMember();
    const stale = Math.floor(Date.now() / 1000) - 301;
    const res = await deliver(duesEvent({ memberId: member, year: 2026 }), { timestamp: stale });

    expect(res.status).toBe(400);
    expect(await count('memberships')).toBe(0);
  });

  it('rejects a malformed signature header', async () => {
    const res = await handleStripe(
      new Request('https://members.w4trc.org/api/stripe/webhook', {
        method: 'POST', headers: { 'Stripe-Signature': 'garbage' }, body: '{}',
      }),
      env, WEBHOOK
    );
    expect(res.status).toBe(400);
  });
});

describe('webhook: dues payment', () => {
  it('records an individual payment', async () => {
    const member = await addMember();

    const res = await deliver(duesEvent({ sessionId: 'cs_1', memberId: member, year: 2026 }));

    expect(res.status).toBe(200);
    expect(await getMembership(member, 2026)).toMatchObject({
      status: 'active',
      membership_type: 'individual',
      amount_due: 20,
      amount_paid: 21,
      paid_date: '2026-03-15',
      payment_method: 'stripe',
      stripe_session_id: 'cs_1',
    });
    expect(await auditActions()).toEqual([{
      action: 'membership.stripe_paid',
      detail: { year: 2026, amount_paid: 21, stripe_session_id: 'cs_1', covered_member_ids: [] },
    }]);
  });

  it('records a family payment and covers the dependents', async () => {
    const payer     = await addMember({ membership_type: 'family' });
    const dependent = await addMember();
    const unrelated = await addMember();
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    await deliver(duesEvent({
      sessionId: 'cs_fam', memberId: payer, year: 2026, membershipType: 'family', amountTotal: 3100,
    }));

    expect(await getMembership(payer, 2026)).toMatchObject({
      status: 'active', membership_type: 'family', amount_due: 30, amount_paid: 31, payment_method: 'stripe',
    });
    expect(await getMembership(dependent, 2026)).toMatchObject({
      status: 'active', membership_type: 'family', amount_due: 0, amount_paid: null,
      paid_date: '2026-03-15', covered_by_member_id: payer,
    });
    expect(await getMembership(unrelated, 2026)).toBeNull();
    expect((await auditActions())[0].detail.covered_member_ids).toEqual([dependent]);
  });

  it('does not cover dependents on an individual payment', async () => {
    const payer     = await addMember();
    const dependent = await addMember();
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    await deliver(duesEvent({ memberId: payer, year: 2026 }));

    expect(await getMembership(dependent, 2026)).toBeNull();
  });

  it('falls back to the member record when the session has no membership type', async () => {
    const payer = await addMember({ membership_type: 'family' });
    const event = duesEvent({ memberId: payer, year: 2026, amountTotal: 3100 });
    delete event.data.object.metadata.membership_type;

    await deliver(event);

    expect(await getMembership(payer, 2026)).toMatchObject({ membership_type: 'family', amount_due: 30 });
  });

  it('marks an existing unpaid record as paid', async () => {
    const member = await addMember();
    await addMembership(member, 2026, { status: 'pending' });

    await deliver(duesEvent({ sessionId: 'cs_2', memberId: member, year: 2026 }));

    expect(await count('memberships')).toBe(1);
    expect(await getMembership(member, 2026)).toMatchObject({
      status: 'active', amount_paid: 21, paid_date: '2026-03-15', payment_method: 'stripe', stripe_session_id: 'cs_2',
    });
  });

  it('processes a redelivered event only once', async () => {
    const payer     = await addMember({ membership_type: 'family' });
    const dependent = await addMember();
    await addMembership(dependent, 2025, { covered_by_member_id: payer });
    const event = duesEvent({ sessionId: 'cs_dup', memberId: payer, year: 2026, membershipType: 'family', amountTotal: 3100 });

    await deliver(event);
    vi.setSystemTime(new Date('2026-03-18T15:00:00Z'));
    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(await count('memberships')).toBe(3);
    expect((await getMembership(payer, 2026)).paid_date).toBe('2026-03-15');
    expect((await getMembership(dependent, 2026)).paid_date).toBe('2026-03-15');
    expect(await auditActions()).toHaveLength(1);
  });

  it('keeps a payment already recorded by an officer', async () => {
    const member = await addMember();
    await addMembership(member, 2026, {
      status: 'active', amount_paid: 20, paid_date: '2026-01-20', payment_method: 'check', check_number: '1042',
    });

    await deliver(duesEvent({ sessionId: 'cs_3', memberId: member, year: 2026 }));

    expect(await getMembership(member, 2026)).toMatchObject({
      amount_paid: 20, paid_date: '2026-01-20', payment_method: 'check', check_number: '1042',
      stripe_session_id: 'cs_3',
    });
    expect(await auditActions()).toEqual([]);
  });

  it('reactivates a lapsed member paying for the current year', async () => {
    const payer     = await addMember({ membership_type: 'family', is_active: 0 });
    const dependent = await addMember({ is_active: 0 });
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    await deliver(duesEvent({ memberId: payer, year: 2026, membershipType: 'family', amountTotal: 3100 }));

    expect((await getMember(payer)).is_active).toBe(1);
    expect((await getMember(dependent)).is_active).toBe(1);
  });

  it('leaves a lapsed member inactive when they renew in advance for next year', async () => {
    vi.setSystemTime(NOVEMBER);
    const member = await addMember({ is_active: 0 });

    await deliver(duesEvent({ memberId: member, year: 2027 }));

    expect(await getMembership(member, 2027)).toMatchObject({ status: 'active', paid_date: '2026-11-10' });
    expect((await getMember(member)).is_active).toBe(0);
  });

  it('never reactivates a silent key', async () => {
    const member = await addMember({ is_active: 0, is_silent_key: 1 });

    await deliver(duesEvent({ memberId: member, year: 2026 }));

    expect((await getMember(member)).is_active).toBe(0);
  });

  it('acknowledges a session with missing metadata without recording anything', async () => {
    const event = duesEvent({ memberId: 1, year: 2026 });
    event.data.object.metadata = {};

    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(await count('memberships')).toBe(0);
  });

  it('ignores other event types', async () => {
    const member = await addMember();
    const event = { ...duesEvent({ memberId: member, year: 2026 }), type: 'checkout.session.expired' };

    const res = await deliver(event);

    expect(res.status).toBe(200);
    expect(await count('memberships')).toBe(0);
  });
});

describe('webhook: donation', () => {
  it('records a donation without touching dues', async () => {
    const member = await addMember();

    const res = await deliver(donationEvent({ sessionId: 'cs_don', memberId: member, amountTotal: 5000, note: ' Repeater fund ' }));

    expect(res.status).toBe(200);
    const donation = await env.DB.prepare(`SELECT * FROM donations`).first();
    expect(donation).toMatchObject({
      donor_type: 'member',
      member_id: member,
      donation_kind: 'monetary',
      amount: 50,
      donation_date: '2026-03-15',
      payment_method: 'stripe',
      notes: 'Repeater fund',
      stripe_session_id: 'cs_don',
    });
    expect(await count('memberships')).toBe(0);
    expect(await auditActions()).toEqual([{
      action: 'donation.stripe_paid',
      detail: { member_id: member, amount: 50, stripe_session_id: 'cs_don' },
    }]);
  });

  it('processes a redelivered donation only once', async () => {
    const member = await addMember();
    const event = donationEvent({ memberId: member });

    await deliver(event);
    await deliver(event);

    expect(await count('donations')).toBe(1);
    expect(await auditActions()).toHaveLength(1);
  });

  it('skips a donation session with no amount', async () => {
    const member = await addMember();

    const res = await deliver(donationEvent({ memberId: member, amountTotal: 0 }));

    expect(res.status).toBe(200);
    expect(await count('donations')).toBe(0);
  });
});

describe('checkout', () => {
  const post = (sub, body) => new Request(`https://members.w4trc.org/api/stripe/${sub}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Stands in for the Stripe API; returns the form fields we sent it.
  function mockStripe() {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => Response.json({ url: 'https://checkout.stripe.test/session' })
    );
    return () => Object.fromEntries(spy.mock.calls[0][1].body);
  }

  const createCheckout = (memberId) =>
    handleStripe(post('create-checkout'), env, '/api/stripe/create-checkout', { memberId });

  const createDonation = (memberId, body) =>
    handleStripe(post('create-donation-checkout', body), env, '/api/stripe/create-donation-checkout', { memberId });

  it('charges an individual member $21 for the current dues year', async () => {
    const sent = mockStripe();
    const member = await addMember({ callsign: 'KT4IND', email: 'ind@example.com' });

    const res = await createCheckout(member);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/session' });
    expect(sent()).toMatchObject({
      'line_items[0][price_data][unit_amount]': '2100',
      'metadata[member_id]': String(member),
      'metadata[year]': '2026',
      'metadata[callsign]': 'KT4IND',
      'metadata[membership_type]': 'individual',
      customer_email: 'ind@example.com',
    });
  });

  it('charges a family member $31', async () => {
    const sent = mockStripe();
    const member = await addMember({ membership_type: 'family' });

    await createCheckout(member);

    expect(sent()).toMatchObject({
      'line_items[0][price_data][unit_amount]': '3100',
      'metadata[membership_type]': 'family',
    });
  });

  it('bills next year once renewal season opens', async () => {
    vi.setSystemTime(NOVEMBER);
    const sent = mockStripe();
    const member = await addMember();
    await addMembership(member, 2026, { status: 'active', amount_paid: 20 });

    const res = await createCheckout(member);

    expect(res.status).toBe(200);
    expect(sent()['metadata[year]']).toBe('2027');
  });

  it('refuses when dues are already paid, honorary, or waived', async () => {
    const sent = vi.spyOn(globalThis, 'fetch');
    for (const status of ['active', 'honorary', 'waived']) {
      const member = await addMember();
      await addMembership(member, 2026, { status });

      expect((await createCheckout(member)).status).toBe(409);
    }
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses lifetime honorary members', async () => {
    const member = await addMember({ membership_type: 'lifetime_honorary' });

    expect((await createCheckout(member)).status).toBe(409);
  });

  it('refuses a dependent covered by someone else\'s family membership', async () => {
    const payer     = await addMember({ membership_type: 'family', callsign: 'KT4PAY' });
    const dependent = await addMember();
    await addMembership(dependent, 2025, { covered_by_member_id: payer });

    const res = await createCheckout(dependent);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('KT4PAY');
  });

  it('refuses a login with no member record', async () => {
    expect((await createCheckout(null)).status).toBe(400);
  });

  it('reports a Stripe failure as a 502', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => Response.json({ error: { message: 'boom' } }, { status: 500 })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const member = await addMember();

    expect((await createCheckout(member)).status).toBe(502);
  });

  it('creates a donation checkout in cents with a trimmed note', async () => {
    const sent = mockStripe();
    const member = await addMember();

    const res = await createDonation(member, { amount: 25.5, note: '  For the repeater  ' });

    expect(res.status).toBe(200);
    expect(sent()).toMatchObject({
      submit_type: 'donate',
      'line_items[0][price_data][unit_amount]': '2550',
      'metadata[kind]': 'donation',
      'metadata[member_id]': String(member),
      'metadata[note]': 'For the repeater',
    });
  });

  it('refuses donations outside $1–$5,000', async () => {
    const sent = vi.spyOn(globalThis, 'fetch');
    const member = await addMember();

    for (const amount of [0, 0.99, 5000.01, -5, 'abc', null]) {
      expect((await createDonation(member, { amount })).status).toBe(400);
    }
    expect(sent).not.toHaveBeenCalled();
  });
});
