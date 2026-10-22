/**
 * Renewal demo for officers
 *
 * /demo serves the member portal signed in as a made-up member, with the
 * portal data faked in the browser. Nothing about the demo is stored.
 *
 * POST /api/demo/checkout — public, returns a Stripe Checkout URL in test mode
 *
 * The checkout only ever uses a Stripe test key, so no real card is charged,
 * and the webhook ignores it (metadata kind = demo).
 */

import { jsonError } from '../lib/response.js';
import { duesYear } from '../lib/duesYear.js';
import { createStripeSession } from './stripe.js';

// STRIPE_TEST_SECRET_KEY keeps the demo in sandbox once the main key is live.
// Before go-live the main key is itself a test key and is used instead.
export function demoStripeKey(env) {
  const key = env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY || '';
  return key.startsWith('sk_test_') ? key : null;
}

export async function handleDemoCheckout(request, env) {
  const key = demoStripeKey(env);
  if (!key) return jsonError('The demo checkout is not set up. Ask the site admin to add a Stripe test key.', 503);

  let body = {};
  try { body = await request.json(); } catch { /* no body: individual */ }

  const year     = duesYear();
  const isFamily = body?.membership_type === 'family';
  const domain   = env.CLUB_DOMAIN || 'members.w4trc.org';

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': isFamily ? '3100' : '2100',
    'line_items[0][price_data][product_data][name]': `W4TRC Annual Dues ${year} (DEMO)`,
    'line_items[0][price_data][product_data][description]':
      `Demo of the ${isFamily ? 'family' : 'individual'} renewal. Test mode: use card 4242 4242 4242 4242. Nothing is charged or recorded.`,
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'demo',
    'metadata[year]': String(year),
    'metadata[membership_type]': isFamily ? 'family' : 'individual',
    success_url: `https://${domain}/demo?payment=success`,
    cancel_url:  `https://${domain}/demo?payment=cancelled`,
  });

  return createStripeSession(env, params, key);
}
