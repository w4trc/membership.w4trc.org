/**
 * Stripe payment routes
 *
 * POST /api/stripe/create-checkout  — authenticated member, returns Stripe checkout URL
 * POST /api/stripe/webhook          — Stripe webhook (signature-verified, no session auth)
 */

import { requireAuth } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';

export async function handleStripe(request, env, path, user = null) {
  const sub = path.replace('/api/stripe', '').replace(/^\//, '');

  if (request.method === 'POST' && sub === 'webhook') {
    return stripeWebhook(request, env);
  }

  // user is passed in from the global auth gate in index.js for non-webhook routes
  if (!user) {
    const authResult = await requireAuth(request, env);
    if (!authResult.ok) return jsonError(authResult.error, 401);
    user = authResult.user;
  }

  if (request.method === 'POST' && sub === 'create-checkout') {
    return createCheckout(request, env, user);
  }

  return jsonError('Not found', 404);
}

// ── POST /api/stripe/create-checkout ─────────────────────────────────────────

async function createCheckout(request, env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 400);

  const year = new Date().getFullYear();

  const existing = await env.DB.prepare(
    `SELECT status FROM memberships WHERE member_id = ? AND year = ? LIMIT 1`
  ).bind(user.memberId, year).first();

  if (existing && ['active', 'honorary', 'waived'].includes(existing.status)) {
    return jsonError('Dues are already paid for this year', 409);
  }

  const member = await env.DB.prepare(
    `SELECT id, callsign, first_name, last_name, email, membership_type FROM members WHERE id = ?`
  ).bind(user.memberId).first();

  if (!member) return jsonError('Member not found', 404);

  // $21 individual, $31 family — includes $1 online processing fee
  const isFamily   = member.membership_type === 'family';
  const amountBase = isFamily ? 30 : 20;
  const amount     = isFamily ? 3100 : 2100;
  const domain     = env.CLUB_DOMAIN || 'members.w4trc.org';

  const params = new URLSearchParams({
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': `W4TRC Annual Dues ${year}`,
    'line_items[0][price_data][product_data][description]':
      `Kingsport Amateur Radio Club ${isFamily ? 'family' : 'individual'} membership dues for ${year}. Base: $${amountBase}, includes $1 online processing fee.`,
    'line_items[0][quantity]': '1',
    'metadata[member_id]': String(member.id),
    'metadata[year]': String(year),
    'metadata[callsign]': member.callsign || '',
    'metadata[membership_type]': member.membership_type || 'individual',
    success_url: `https://${domain}/?payment=success`,
    cancel_url:  `https://${domain}/?payment=cancelled`,
  });

  if (member.email) params.set('customer_email', member.email);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Stripe create-checkout error:', err);
    return jsonError('Failed to create payment session. Please try again.', 502);
  }

  const session = await res.json();
  return jsonResponse({ url: session.url });
}

// ── POST /api/stripe/webhook ──────────────────────────────────────────────────

async function stripeWebhook(request, env) {
  const sig = request.headers.get('Stripe-Signature');
  if (!sig) return jsonError('Missing Stripe-Signature', 400);

  const rawBody = await request.text();

  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return jsonError('Invalid signature', 400);

  let event;
  try { event = JSON.parse(rawBody); } catch { return jsonError('Invalid JSON', 400); }

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutCompleted(event.data.object, env);
  }

  return new Response('ok', { status: 200 });
}

async function handleCheckoutCompleted(session, env) {
  const memberId  = parseInt(session.metadata?.member_id, 10);
  const year      = parseInt(session.metadata?.year, 10);
  const sessionId = session.id;

  if (!memberId || !year) {
    console.error('Stripe webhook: missing metadata', session.metadata);
    return;
  }

  // Idempotency: skip if this session was already processed
  const bySession = await env.DB.prepare(
    `SELECT id FROM memberships WHERE stripe_session_id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (bySession) return;

  // Use membership_type from Stripe metadata (stored at checkout time), with DB as fallback
  const metaType = session.metadata?.membership_type;
  const membershipType = (metaType === 'family' || metaType === 'individual')
    ? metaType
    : ((await env.DB.prepare(`SELECT membership_type FROM members WHERE id = ?`).bind(memberId).first())?.membership_type || 'individual');
  const amountDue = membershipType === 'family' ? 30.00 : 20.00;

  const existing = await env.DB.prepare(
    `SELECT id, status FROM memberships WHERE member_id = ? AND year = ? LIMIT 1`
  ).bind(memberId, year).first();

  const amountPaid = (session.amount_total || 0) / 100;
  const paidDate   = new Date().toISOString().slice(0, 10);

  if (existing && ['active', 'honorary', 'waived'].includes(existing.status)) {
    // Already paid via another method — just stamp the session ID
    await env.DB.prepare(
      `UPDATE memberships SET stripe_session_id = ? WHERE id = ?`
    ).bind(sessionId, existing.id).run().catch(() => {});
    return;
  }

  if (existing) {
    await env.DB.prepare(`
      UPDATE memberships SET
        status = 'active', amount_paid = ?, paid_date = ?,
        payment_method = 'stripe', check_number = ?, stripe_session_id = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(amountPaid, paidDate, sessionId, sessionId, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO memberships
        (member_id, year, status, membership_type, amount_due, amount_paid, paid_date, payment_method, check_number, stripe_session_id)
      VALUES (?, ?, 'active', ?, ?, ?, ?, 'stripe', ?, ?)
    `).bind(memberId, year, membershipType, amountDue, amountPaid, paidDate, sessionId, sessionId).run();
  }

  await audit(env, {
    userId: null,
    action: 'membership.stripe_paid',
    targetType: 'member',
    targetId: memberId,
    detail: { year, amount_paid: amountPaid, stripe_session_id: sessionId },
  });
}

// ── Webhook signature verification ───────────────────────────────────────────

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = {};
  for (const part of sigHeader.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts[part.slice(0, eq)] = part.slice(eq + 1);
  }

  const t  = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
