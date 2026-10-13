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

// Reading a group is one request per 200 members
const MAX_LIST_PAGES = 10;

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

/** Addresses in GOOGLE_GROUP_ALWAYS_ADD: placed in every synced group, member or not. */
function alwaysAdd(env) {
  return (env.GOOGLE_GROUP_ALWAYS_ADD || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

// Current members for a year: paid, covered by a paid family membership,
// paid for by Eastman, honorary or waived for the year, or lifetime honorary.
// Binds: year.
const CURRENT_MEMBERS = `
  SELECT m.id, m.callsign, m.first_name, m.last_name, lower(trim(m.email)) AS email
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
    const memberEmails = new Set(desired.keys());
    for (const email of alwaysAdd(env)) {
      if (!desired.has(email)) desired.set(email, null);
    }
    const trackedEmails = new Set(tracked.map(t => t.email));

    return {
      year,
      group: groupAddress(env, year),
      in_group: tracked.filter(t => memberEmails.has(t.email)).length,
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

/**
 * Everyone in a group, as Google has it: [{ email, role }]. Returns null when
 * the group does not exist.
 */
async function listGroup(token, group) {
  const members = [];
  let pageToken = '';
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const query = new URLSearchParams({ maxResults: '200' });
    if (pageToken) query.set('pageToken', pageToken);
    const res = await fetch(`${API}/groups/${encodeURIComponent(group)}/members?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const message = await googleError(res);
      if (res.status === 401 || res.status === 403) throw new GoogleAccessError(`Google refused access (${res.status}): ${message}`);
      throw new Error(message);
    }
    const body = await res.json();
    for (const m of body.members || []) {
      // "Everyone in the organization" entries have no address
      if (m.email) members.push({ email: m.email.trim().toLowerCase(), role: m.role || 'MEMBER' });
    }
    pageToken = body.nextPageToken || '';
    if (!pageToken) return members;
  }
  throw new Error(`${group} has more than ${MAX_LIST_PAGES * 200} members`);
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

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * The current year, plus next year once renewal season has opened. The audit
 * only reads, so it is not held back by GOOGLE_SYNC_START_YEAR.
 */
export function auditYears(now = new Date()) {
  const year = now.getUTCFullYear();
  const dues = duesYear(now);
  return dues === year ? [year] : [year, dues];
}

const person = (m) => ({ id: m.id, callsign: m.callsign, name: `${m.first_name || ''} ${m.last_name || ''}`.trim() });

/**
 * Compare each year's group, as Google has it, with the membership list.
 * Changes nothing. Returns { configured, error, years: [{
 *   year, group, error, group_size, club_addresses,
 *   expected: [{ email, members: [{ id, callsign, name }], in_group, tracked }],
 *   extra:    [{ email, role, members: [{ id, callsign, name }] }],
 *   no_email: [{ id, callsign, name }],
 * }] }.
 *
 * `expected` is every address that should be in the group; `in_group` false
 * means it is missing. `tracked` means the sync has a record of putting it
 * there, so the sync will not add it again by itself. `extra` is every address
 * in the group that does not belong to a current member; `members` names
 * anyone on the membership list with that address who is not current.
 *
 * Addresses on the club's own domain (the group's domain) are officers' club
 * mailboxes, there to manage the group. They are never reported as extra;
 * `club_addresses` is how many were passed over.
 */
export async function auditGoogleGroups(env, { now = new Date() } = {}) {
  if (!isConfigured(env)) return { configured: false, error: null, years: [] };

  const yearList = auditYears(now);
  const results = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, callsign, first_name, last_name, lower(trim(email)) AS email
       FROM members WHERE trim(coalesce(email, '')) != '' ORDER BY id`
    ),
    ...yearList.flatMap(year => [
      env.DB.prepare(CURRENT_MEMBERS).bind(year),
      env.DB.prepare(`SELECT lower(email) AS email FROM google_group_members WHERE year = ?`).bind(year),
    ]),
  ]);

  const byEmail = new Map();
  for (const m of results[0].results) {
    if (!byEmail.has(m.email)) byEmail.set(m.email, []);
    byEmail.get(m.email).push(m);
  }

  const years = [];
  let error = null;
  let token = null;

  for (const [i, year] of yearList.entries()) {
    const current = results[1 + i * 2].results;
    const tracked = new Set(results[2 + i * 2].results.map(t => t.email));
    const out = {
      year, group: groupAddress(env, year), error: null, group_size: null, club_addresses: 0,
      expected: [], extra: [], no_email: current.filter(m => !m.email).map(person),
    };
    years.push(out);
    if (error) continue;

    let listed;
    try {
      token ??= await accessToken(env);
      listed = await listGroup(token, out.group);
    } catch (err) {
      if (err instanceof GoogleAccessError || !token) { error = err.message; continue; }
      out.error = err.message;
      continue;
    }
    if (!listed) {
      out.error = `The group ${out.group} does not exist.`;
      continue;
    }

    // Family members often share an address; it is one entry in the group
    const expected = new Map();
    for (const m of current) {
      if (!m.email) continue;
      if (!expected.has(m.email)) expected.set(m.email, []);
      expected.get(m.email).push(person(m));
    }
    for (const email of alwaysAdd(env)) {
      if (!expected.has(email)) expected.set(email, []);
    }

    const inGoogle = new Set(listed.map(g => g.email));
    out.group_size = inGoogle.size;
    out.expected = [...expected].map(([email, members]) => ({
      email, members, in_group: inGoogle.has(email), tracked: tracked.has(email),
    }));
    const clubDomain = out.group.slice(out.group.lastIndexOf('@')).toLowerCase();
    const unexpected = listed.filter(g => !expected.has(g.email));
    out.club_addresses = unexpected.filter(g => g.email.endsWith(clubDomain)).length;
    out.extra = unexpected.filter(g => !g.email.endsWith(clubDomain)).map(g => ({
      email: g.email, role: g.role, members: (byEmail.get(g.email) || []).map(person),
    }));
  }

  return { configured: true, error, years };
}
