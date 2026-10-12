/**
 * Shared test helpers: database fixtures and signed Stripe webhook requests.
 */

import { env } from 'cloudflare:workers';

export async function resetDb() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM audit_log'),
    env.DB.prepare('DELETE FROM donations'),
    env.DB.prepare('DELETE FROM memberships'),
    env.DB.prepare('DELETE FROM google_group_members'),
    env.DB.prepare('DELETE FROM users'),
    env.DB.prepare('DELETE FROM members'),
  ]);
}

let memberSeq = 0;

/** Insert a member and return its id. */
export async function addMember(fields = {}) {
  memberSeq++;
  const m = {
    callsign: `KT4T${memberSeq}`,
    first_name: 'Test',
    last_name: `Member${memberSeq}`,
    email: `member${memberSeq}@example.com`,
    membership_type: 'individual',
    is_active: 1,
    is_silent_key: 0,
    ...fields,
  };
  const cols = Object.keys(m);
  const result = await env.DB.prepare(
    `INSERT INTO members (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...Object.values(m)).run();
  return result.meta.last_row_id;
}

/** Insert a dues record for a member. */
export async function addMembership(memberId, year, fields = {}) {
  const ms = { member_id: memberId, year, ...fields };
  const cols = Object.keys(ms);
  await env.DB.prepare(
    `INSERT INTO memberships (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...Object.values(ms)).run();
}

export function getMembership(memberId, year) {
  return env.DB.prepare(
    `SELECT * FROM memberships WHERE member_id = ? AND year = ?`
  ).bind(memberId, year).first();
}

export function getMember(memberId) {
  return env.DB.prepare(`SELECT * FROM members WHERE id = ?`).bind(memberId).first();
}

export async function auditActions() {
  const { results } = await env.DB.prepare(`SELECT action, detail FROM audit_log ORDER BY id`).all();
  return results.map(r => ({ action: r.action, detail: r.detail ? JSON.parse(r.detail) : null }));
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** A webhook request signed the way Stripe signs them. */
export async function webhookRequest(event, { secret = env.STRIPE_WEBHOOK_SECRET, timestamp } = {}) {
  const body = JSON.stringify(event);
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = await hmacHex(secret, `${t}.${body}`);
  return new Request('https://members.w4trc.org/api/stripe/webhook', {
    method: 'POST',
    headers: { 'Stripe-Signature': `t=${t},v1=${v1}` },
    body,
  });
}

/** A checkout.session.completed event for a dues payment. */
export function duesEvent({ sessionId = 'cs_test_dues', memberId, year, membershipType = 'individual', amountTotal = 2100 }) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        amount_total: amountTotal,
        metadata: {
          member_id: String(memberId),
          year: String(year),
          membership_type: membershipType,
        },
      },
    },
  };
}

/** A checkout.session.completed event for a donation. */
export function donationEvent({ sessionId = 'cs_test_donation', memberId, amountTotal = 5000, note = '' }) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        amount_total: amountTotal,
        metadata: { kind: 'donation', member_id: String(memberId), note },
      },
    },
  };
}
