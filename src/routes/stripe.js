/**
 * Stripe payment routes
 *
 * POST /api/stripe/create-checkout           — authenticated member, returns Stripe checkout URL for dues
 * POST /api/stripe/create-donation-checkout  — authenticated member, returns Stripe checkout URL for a donation
 * POST /api/stripe/create-public-donation-checkout — public (the /donate page), returns Stripe checkout URL for a donation
 * POST /api/stripe/webhook                   — Stripe webhook (signature-verified, no session auth)
 */

import { requireAuth } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { duesYear } from '../lib/duesYear.js';
import { familyPayer, coverFamilyDependents } from '../lib/family.js';

export async function handleStripe(request, env, path, user = null) {
  const sub = path.replace('/api/stripe', '').replace(/^\//, '');

  if (request.method === 'POST' && sub === 'webhook') {
    return stripeWebhook(request, env);
  }

  if (request.method === 'POST' && sub === 'create-public-donation-checkout') {
    return createPublicDonationCheckout(request, env);
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

  if (request.method === 'POST' && sub === 'create-donation-checkout') {
    return createDonationCheckout(request, env, user);
  }

  return jsonError('Not found', 404);
}

// ── POST /api/stripe/create-checkout ─────────────────────────────────────────

async function createCheckout(request, env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 400);

  const year = duesYear();

  const existing = await env.DB.prepare(
    `SELECT status FROM memberships WHERE member_id = ? AND year = ? LIMIT 1`
  ).bind(user.memberId, year).first();

  if (existing && ['active', 'honorary', 'waived'].includes(existing.status)) {
    return jsonError(`Dues are already paid for ${year}`, 409);
  }

  const member = await env.DB.prepare(
    `SELECT id, callsign, first_name, last_name, email, membership_type FROM members WHERE id = ?`
  ).bind(user.memberId).first();

  if (!member) return jsonError('Member not found', 404);
  if (member.membership_type === 'lifetime_honorary') {
    return jsonError('Lifetime honorary members do not pay dues', 409);
  }

  // Dependents on someone else's family membership are paid for by that member
  const payer = await familyPayer(env, member.id, year);
  if (payer) {
    const who = [payer.callsign, `${payer.first_name} ${payer.last_name}`].filter(Boolean).join(' — ');
    return jsonError(`Your ${year} dues are covered under the family membership of ${who}. Contact a club officer if that has changed.`, 409);
  }

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

  return createStripeSession(env, params);
}

// ── POST /api/stripe/create-donation-checkout ────────────────────────────────

const DONATION_MIN = 1;
const DONATION_MAX = 5000;

const DONATION_RANGE_ERROR =
  `Donation amount must be between $${DONATION_MIN} and $${DONATION_MAX.toLocaleString('en-US')}`;

// Returns the donation amount in cents, or null if it is missing or out of range
function donationCents(body) {
  const cents = Math.round(Number(body?.amount) * 100);
  if (!Number.isFinite(cents) || cents < DONATION_MIN * 100 || cents > DONATION_MAX * 100) return null;
  return cents;
}

const trimmed = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

async function createDonationCheckout(request, env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 400);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const cents = donationCents(body);
  if (cents === null) return jsonError(DONATION_RANGE_ERROR, 400);
  const note = trimmed(body.note, 200);

  const member = await env.DB.prepare(
    `SELECT id, callsign, email FROM members WHERE id = ?`
  ).bind(user.memberId).first();

  if (!member) return jsonError('Member not found', 404);

  const club   = env.CLUB_NAME || 'Kingsport Amateur Radio Club';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';

  const params = new URLSearchParams({
    mode: 'payment',
    submit_type: 'donate',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `Donation to ${club}`,
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'donation',
    'metadata[member_id]': String(member.id),
    'metadata[callsign]': member.callsign || '',
    'metadata[note]': note,
    success_url: `https://${domain}/?payment=donation-success`,
    cancel_url:  `https://${domain}/?payment=donation-cancelled`,
  });

  if (member.email) params.set('customer_email', member.email);

  return createStripeSession(env, params);
}

// ── POST /api/stripe/create-public-donation-checkout ─────────────────────────
// No login: anyone can give from the /donate page. Stripe collects the email.

async function createPublicDonationCheckout(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const cents = donationCents(body);
  if (cents === null) return jsonError(DONATION_RANGE_ERROR, 400);
  const name = trimmed(body.name, 100);
  const note = trimmed(body.note, 200);

  const club   = env.CLUB_NAME || 'Kingsport Amateur Radio Club';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';

  const params = new URLSearchParams({
    mode: 'payment',
    submit_type: 'donate',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(cents),
    'line_items[0][price_data][product_data][name]': `Donation to ${club}`,
    'line_items[0][quantity]': '1',
    'metadata[kind]': 'donation',
    'metadata[source]': 'public',
    'metadata[donor_name]': name,
    'metadata[note]': note,
    success_url: `https://${domain}/donate?payment=success`,
    cancel_url:  `https://${domain}/donate?payment=cancelled`,
  });

  return createStripeSession(env, params);
}

export async function createStripeSession(env, params, secretKey = env.STRIPE_SECRET_KEY) {
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
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
    const session = event.data.object;
    // Demo checkouts from /demo are never recorded
    if (session.metadata?.kind === 'demo') return new Response('ok', { status: 200 });
    if (session.metadata?.kind === 'donation') await handleDonationCompleted(session, env);
    else await handleCheckoutCompleted(session, env);
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

  // A family payment also covers the members linked under the payer
  const coveredIds = membershipType === 'family'
    ? await coverFamilyDependents(env, memberId, year, paidDate)
    : [];

  // A lapsed member paying for the current year is active again now. Advance
  // renewals (Oct–Dec) take effect Jan 1 via activateRenewedMembers().
  if (year <= new Date().getUTCFullYear()) {
    for (const id of [memberId, ...coveredIds]) {
      await env.DB.prepare(
        `UPDATE members SET is_active = 1, updated_at = datetime('now') WHERE id = ? AND is_active = 0 AND is_silent_key = 0`
      ).bind(id).run();
    }
  }

  await audit(env, {
    userId: null,
    action: 'membership.stripe_paid',
    targetType: 'member',
    targetId: memberId,
    detail: { year, amount_paid: amountPaid, stripe_session_id: sessionId, covered_member_ids: coveredIds },
  });
}

async function handleDonationCompleted(session, env) {
  // A donation from the public /donate page has no member behind it
  const isPublic  = session.metadata?.source === 'public';
  const memberId  = isPublic ? null : parseInt(session.metadata?.member_id, 10);
  const amount    = (session.amount_total || 0) / 100;
  const sessionId = session.id;

  if ((!isPublic && !memberId) || !amount) {
    console.error('Stripe webhook: bad donation session', session.metadata, session.amount_total);
    return;
  }

  // Idempotency: skip if this session was already processed
  const bySession = await env.DB.prepare(
    `SELECT id FROM donations WHERE stripe_session_id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (bySession) return;

  const donationDate = new Date().toISOString().slice(0, 10);
  const note = session.metadata?.note?.trim() || null;

  // Public donors who leave the name blank are recorded as anonymous
  const donorName  = isPublic ? (session.metadata?.donor_name?.trim() || null) : null;
  const donorEmail = isPublic ? (session.customer_details?.email || null) : null;
  const donorType  = !isPublic ? 'member' : donorName ? 'individual' : 'anonymous';

  let result;
  try {
    result = await env.DB.prepare(`
      INSERT INTO donations
        (donor_type, member_id, donor_name, donor_email, donation_kind, amount, donation_date, payment_method, notes, stripe_session_id)
      VALUES (?, ?, ?, ?, 'monetary', ?, ?, 'stripe', ?, ?)
    `).bind(donorType, memberId, donorName, donorEmail, amount, donationDate, note, sessionId).run();
  } catch (err) {
    // A duplicate delivery raced us past the check above
    if (err.message?.includes('UNIQUE')) return;
    throw err;
  }

  await audit(env, {
    userId: null,
    action: 'donation.stripe_paid',
    targetType: 'donation',
    targetId: result.meta.last_row_id,
    detail: isPublic
      ? { donor_name: donorName, amount, stripe_session_id: sessionId }
      : { member_id: memberId, amount, stripe_session_id: sessionId },
  });
}

// ── Webhook signature verification───────────────────────────────────────────

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
