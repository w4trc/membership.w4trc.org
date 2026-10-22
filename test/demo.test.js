import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleDemoCheckout } from '../src/routes/demo.js';
import { handleStripe } from '../src/routes/stripe.js';
import { resetDb, addMember, webhookRequest, duesEvent } from './helpers.js';

const NOVEMBER = new Date('2026-11-10T15:00:00Z');

const post = (body) => new Request('https://members.w4trc.org/api/demo/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// Stands in for the Stripe API; returns the form fields and key we sent it.
function mockStripe() {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => Response.json({ url: 'https://checkout.stripe.test/demo' })
  );
  return () => {
    const [, init] = spy.mock.calls[0];
    return { fields: Object.fromEntries(init.body), auth: init.headers.Authorization };
  };
}

async function count(table) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
}

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOVEMBER);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('demo checkout', () => {
  it('starts a $21 individual renewal for next year, tagged as a demo', async () => {
    const sent = mockStripe();

    const res = await handleDemoCheckout(post({}), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.test/demo' });
    const { fields } = sent();
    expect(fields).toMatchObject({
      'line_items[0][price_data][unit_amount]': '2100',
      'line_items[0][price_data][product_data][name]': 'W4TRC Annual Dues 2027 (DEMO)',
      'metadata[kind]': 'demo',
      'metadata[year]': '2027',
      success_url: 'https://members.w4trc.org/demo?payment=success',
      cancel_url: 'https://members.w4trc.org/demo?payment=cancelled',
    });
    expect(fields).not.toHaveProperty('metadata[member_id]');
  });

  it('charges $31 for the family version', async () => {
    const sent = mockStripe();
    await handleDemoCheckout(post({ membership_type: 'family' }), env);
    expect(sent().fields['line_items[0][price_data][unit_amount]']).toBe('3100');
  });

  it('prefers the separate test key once the main key is live', async () => {
    const sent = mockStripe();
    const liveEnv = { ...env, STRIPE_SECRET_KEY: 'sk_live_real', STRIPE_TEST_SECRET_KEY: 'sk_test_demo' };

    const res = await handleDemoCheckout(post({}), liveEnv);

    expect(res.status).toBe(200);
    expect(sent().auth).toBe('Bearer sk_test_demo');
  });

  it('never uses a live key', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const liveEnv = { ...env, STRIPE_SECRET_KEY: 'sk_live_real', STRIPE_TEST_SECRET_KEY: undefined };

    const res = await handleDemoCheckout(post({}), liveEnv);

    expect(res.status).toBe(503);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('demo webhook', () => {
  it('records nothing for a completed demo checkout', async () => {
    await addMember();
    const event = duesEvent({ sessionId: 'cs_test_demo', memberId: 1, year: 2027 });
    event.data.object.metadata = { kind: 'demo', year: '2027', membership_type: 'individual' };

    const res = await handleStripe(await webhookRequest(event), env, '/api/stripe/webhook');

    expect(res.status).toBe(200);
    expect(await count('memberships')).toBe(0);
    expect(await count('audit_log')).toBe(0);
  });
});
