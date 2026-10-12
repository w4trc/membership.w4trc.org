/**
 * Google Groups sync.
 *
 * Keeps each year's Google Group (2026members@w4trc.org, ...) in step with
 * the members who are current for that year. Runs hourly from cron and on
 * demand from the admin UI; see "Google Groups" in the README for setup.
 *
 * The sync records every address it puts in a group (google_group_members)
 * and works from that record rather than reading the group back from Google.
 * It only ever removes addresses it added itself, so anyone added to a group
 * by hand in Google is left alone. Groups are not created automatically.
 */

import { audit } from './audit.js';
import { duesYear } from './duesYear.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API       = 'https://admin.googleapis.com/admin/directory/v1';
const SCOPE     = 'https://www.googleapis.com/auth/admin.directory.group.member';

// Each change is one request to Google. Capped so a run stays inside the
// Workers free plan's 50 subrequests; the next run picks up the rest.
export const MAX_CHANGES_PER_RUN = 35;

export function isConfigured(env) {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

export function groupAddress(env, year) {
  return (env.GOOGLE_GROUP_FORMAT || '{year}members@w4trc.org').replace('{year}', String(year));
}

/**
 * The current year, plus next year once renewal season has opened. Years
 * before GOOGLE_SYNC_START_YEAR, when set, are left alone entirely.
 */
export function syncYears(env, now = new Date()) {
  const year  = now.getUTCFullYear();
  const dues  = duesYear(now);
  const start = parseInt(env.GOOGLE_SYNC_START_YEAR, 10) || 0;
  return (dues === year ? [year] : [year, dues]).filter(y => y >= start);
}

// Current members for a year: paid, covered by a paid family membership,
// paid for by Eastman, honorary or waived for the year, or lifetime honorary.
// Binds: year.
const CURRENT_MEMBERS = `
  SELECT m.id, lower(trim(m.email)) AS email
  FROM members m
  LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.year = ?
  WHERE m.is_silent_key = 0
    AND (
      m.membership_type = 'lifetime_honorary'
      OR ms.status IN ('honorary', 'waived')
      OR (ms.status = 'active' AND (
        ms.amount_paid IS NOT NULL
        OR ms.covered_by_member_id IS NOT NULL
        OR ms.payment_method = 'eastman'
      ))
    )
  ORDER BY m.id
`;

/**
 * What a sync would do for each year, without contacting Google.
 * Returns [{ year, group, in_group, no_email, add: [{ email, member_id }], remove: [{ email, added_by_sync }] }].
 */
export async function planSync(env, now = new Date()) {
  const years = syncYears(env, now);
  if (!years.length) return [];
  const results = await env.DB.batch(years.flatMap(year => [
    env.DB.prepare(CURRENT_MEMBERS).bind(year),
    env.DB.prepare(`SELECT lower(email) AS email, added_by_sync FROM google_group_members WHERE year = ? ORDER BY id`).bind(year),
  ]));

  return years.map((year, i) => {
    const current = results[i * 2].results;
    const tracked = results[i * 2 + 1].results;

    // Family members often share an address; it goes in the group once
    const desired = new Map();
    for (const m of current) {
      if (m.email && !desired.has(m.email)) desired.set(m.email, m.id);
    }
    const trackedEmails = new Set(tracked.map(t => t.email));

    return {
      year,
      group: groupAddress(env, year),
      in_group: tracked.filter(t => desired.has(t.email)).length,
      no_email: current.filter(m => !m.email).length,
      add: [...desired].filter(([email]) => !trackedEmails.has(email)).map(([email, member_id]) => ({ email, member_id })),
      remove: tracked.filter(t => !desired.has(t.email)),
    };
  });
}

// ── Google API ────────────────────────────────────────────────────────────────

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** Exchange a signed JWT for an access token (service account flow). */
async function accessToken(env) {
  const key = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const iat = Math.floor(Date.now() / 1000);
  const claims = { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 600 };
  // With domain-wide delegation the service account acts as this admin user
  if (env.GOOGLE_ADMIN_EMAIL) claims.sub = env.GOOGLE_ADMIN_EMAIL;

  const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const unsigned  = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson(claims)}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(unsigned));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(new Uint8Array(signature))}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google sign-in failed (${res.status}): ${body.error_description || body.error || 'no access token'}`);
  }
  return body.access_token;
}

// Google refused the service account itself; no point trying further changes
class GoogleAccessError extends Error {}

async function googleError(res) {
  const body = await res.json().catch(() => ({}));
  return body.error?.message || `HTTP ${res.status}`;
}

/** Add an address to a group. Returns 'added', 'exists', or 'no-group'; throws otherwise. */
async function addToGroup(token, group, email) {
  const res = await fetch(`${API}/groups/${encodeURIComponent(group)}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role: 'MEMBER' }),
  });
  if (res.ok) return 'added';
  if (res.status === 409) return 'exists';
  if (res.status === 404) return 'no-group';
  const message = await googleError(res);
  if (res.status === 401 || res.status === 403) throw new GoogleAccessError(`Google refused access (${res.status}): ${message}`);
  throw new Error(message);
}

/** Remove an address from a group. Already gone counts as removed. */
async function removeFromGroup(token, group, email) {
  const res = await fetch(`${API}/groups/${encodeURIComponent(group)}/members/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok || res.status === 404) return;
  const message = await googleError(res);
  if (res.status === 401 || res.status === 403) throw new GoogleAccessError(`Google refused access (${res.status}): ${message}`);
  throw new Error(message);
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/**
 * Bring the Google Groups up to date. Returns
 * { configured, error, years: [{ year, group, added, removed, pending, errors }] }.
 * `pending` is how many changes are left for the next run.
 */
export async function syncGoogleGroups(env, { now = new Date(), userId = null, request } = {}) {
  if (!isConfigured(env)) return { configured: false, error: null, years: [] };

  const plans = await planSync(env, now);
  const years = plans.map(p => ({ year: p.year, group: p.group, added: [], removed: [], pending: 0, errors: [] }));
  const writes = [];
  let error  = null;
  let budget = MAX_CHANGES_PER_RUN;
  let token  = null;

  try {
    for (const [i, plan] of plans.entries()) {
      const out = years[i];

      for (const { email, added_by_sync } of plan.remove) {
        // An address that was already in the group before the sync saw it
        // stays in Google; only the sync's record of it is dropped.
        if (added_by_sync) {
          if (budget === 0) { out.pending++; continue; }
          budget--;
          token ??= await accessToken(env);
          try {
            await removeFromGroup(token, plan.group, email);
          } catch (err) {
            if (err instanceof GoogleAccessError) throw err;
            out.errors.push(`${email}: ${err.message}`);
            continue;
          }
          out.removed.push(email);
        }
        writes.push(env.DB.prepare(`DELETE FROM google_group_members WHERE year = ? AND email = ?`).bind(plan.year, email));
      }

      for (const [n, { email, member_id }] of plan.add.entries()) {
        if (budget === 0) { out.pending++; continue; }
        budget--;
        token ??= await accessToken(env);
        let result;
        try {
          result = await addToGroup(token, plan.group, email);
        } catch (err) {
          if (err instanceof GoogleAccessError) throw err;
          out.errors.push(`${email}: ${err.message}`);
          continue;
        }
        if (result === 'no-group') {
          out.errors.push(`The group ${plan.group} does not exist. Create it in Google, then sync again.`);
          out.pending += plan.add.length - n;
          break;
        }
        if (result === 'added') out.added.push(email);
        writes.push(env.DB.prepare(
          `INSERT OR IGNORE INTO google_group_members (year, email, member_id, added_by_sync) VALUES (?, ?, ?, ?)`
        ).bind(plan.year, email, member_id, result === 'added' ? 1 : 0));
      }
    }
  } catch (err) {
    // Sign-in or permission failure: keep what was done so far, stop the run
    error = err.message;
  }

  if (writes.length) await env.DB.batch(writes);

  for (const y of years) {
    if (!y.added.length && !y.removed.length) continue;
    await audit(env, {
      userId,
      action: 'google_group.sync',
      detail: { year: y.year, group: y.group, added: y.added, removed: y.removed },
      request,
    });
  }

  return { configured: true, error, years };
}
