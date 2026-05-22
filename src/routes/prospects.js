/**
 * Prospects routes — local hams outreach tracking
 * GET  /api/prospects        - list with member cross-reference
 * GET  /api/prospects/stats  - summary counts
 * PUT  /api/prospects/:id    - update outreach status / postcard / notes
 */

import { isBoardOrAbove }           from '../lib/auth.js';
import { jsonResponse, jsonError }  from '../lib/response.js';

export async function handleProspects(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Board access required', 403);

  const method   = request.method;
  const segments = path.split('/');
  const sub      = segments[3] || null; // 'stats' or an id

  if (!sub || sub === '') {
    if (method === 'GET') return listProspects(request, env);
    return jsonError('Method not allowed', 405);
  }

  if (sub === 'stats') {
    if (method === 'GET') return getStats(env);
    return jsonError('Method not allowed', 405);
  }

  const id = parseInt(sub, 10);
  if (isNaN(id)) return jsonError('Invalid id', 400);

  if (method === 'PUT') return updateProspect(request, env, id);
  return jsonError('Method not allowed', 405);
}

// ── GET /api/prospects ───────────────────────────────────────────────────────
async function listProspects(request, env) {
  const url      = new URL(request.url);
  const search     = url.searchParams.get('q')          || '';
  const city       = url.searchParams.get('city')       || 'all';
  const status     = url.searchParams.get('status')     || 'all';
  const postcard   = url.searchParams.get('postcard')   || 'all';
  const licenseAge = url.searchParams.get('license_age')|| 'all';
  const page       = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = 75;
  const offset   = (page - 1) * pageSize;

  let where  = [];
  let params = [];

  if (search) {
    where.push(`(p.callsign LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  if (city !== 'all') {
    where.push(`UPPER(p.city) = UPPER(?)`);
    params.push(city);
  }

  if (status === 'members') {
    where.push(`m.id IS NOT NULL`);
  } else if (status === 'non_members') {
    where.push(`m.id IS NULL`);
  } else if (['not_contacted','contacted','interested','not_interested'].includes(status)) {
    where.push(`p.outreach_status = ?`);
    where.push(`m.id IS NULL`); // outreach statuses only apply to non-members
    params.push(status);
  }

  if (postcard === 'sent')     { where.push(`p.postcard_sent = 1`); }
  if (postcard === 'not_sent') { where.push(`p.postcard_sent = 0`); }

  // license_expiry = issue_date + 10 yrs, so issue_date = expiry - 10 yrs
  // new (0-3 yrs):    expiry > now+7yrs
  // recent (3-5 yrs): expiry between now+5yrs and now+7yrs
  // established (5+): expiry <= now+5yrs (and not null)
  if (licenseAge === 'new') {
    where.push(`p.license_expiry > date('now', '+7 years')`);
  } else if (licenseAge === 'recent') {
    where.push(`p.license_expiry >  date('now', '+5 years')`);
    where.push(`p.license_expiry <= date('now', '+7 years')`);
  } else if (licenseAge === 'established') {
    where.push(`p.license_expiry IS NOT NULL`);
    where.push(`p.license_expiry <= date('now', '+5 years')`);
  }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countSQL = `
    SELECT COUNT(*) as total
    FROM prospects p
    LEFT JOIN members m ON UPPER(m.callsign) = UPPER(p.callsign)
    ${whereSQL}
  `;

  const rowSQL = `
    SELECT
      p.id, p.callsign, p.first_name, p.last_name, p.address, p.city, p.state, p.zip,
      p.email, p.outreach_status, p.postcard_sent, p.postcard_sent_date, p.notes,
      p.license_class, p.license_expiry, p.license_status, p.hamdb_synced_at,
      p.created_at, p.updated_at,
      m.id       AS member_id,
      m.is_active AS member_active
    FROM prospects p
    LEFT JOIN members m ON UPPER(m.callsign) = UPPER(p.callsign)
    ${whereSQL}
    ORDER BY p.city, p.last_name, p.first_name
    LIMIT ? OFFSET ?
  `;

  const [countRes, rowRes] = await Promise.all([
    env.DB.prepare(countSQL).bind(...params).first(),
    env.DB.prepare(rowSQL).bind(...params, pageSize, offset).all(),
  ]);

  return jsonResponse({
    prospects: rowRes.results,
    total:     countRes?.total ?? 0,
    page,
    pageSize,
  });
}

// ── GET /api/prospects/stats ─────────────────────────────────────────────────
async function getStats(env) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*)                                                      AS total,
      COUNT(m.id)                                                   AS member_count,
      COUNT(*) - COUNT(m.id)                                        AS non_member_count,
      SUM(CASE WHEN m.id IS NULL AND p.outreach_status = 'not_contacted'  THEN 1 ELSE 0 END) AS not_contacted,
      SUM(CASE WHEN m.id IS NULL AND p.outreach_status = 'contacted'       THEN 1 ELSE 0 END) AS contacted,
      SUM(CASE WHEN m.id IS NULL AND p.outreach_status = 'interested'      THEN 1 ELSE 0 END) AS interested,
      SUM(CASE WHEN m.id IS NULL AND p.outreach_status = 'not_interested'  THEN 1 ELSE 0 END) AS not_interested,
      SUM(p.postcard_sent)                                          AS postcard_sent
    FROM prospects p
    LEFT JOIN members m ON UPPER(m.callsign) = UPPER(p.callsign)
  `).first();

  return jsonResponse({ stats: row });
}

// ── PUT /api/prospects/:id ───────────────────────────────────────────────────
async function updateProspect(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const allowed = ['outreach_status','postcard_sent','postcard_sent_date','notes'];
  const validStatuses = ['not_contacted','contacted','interested','not_interested'];

  if (body.outreach_status !== undefined && !validStatuses.includes(body.outreach_status)) {
    return jsonError('Invalid outreach_status', 400);
  }
  if (body.postcard_sent !== undefined) {
    body.postcard_sent = body.postcard_sent ? 1 : 0;
  }

  const sets   = [];
  const params = [];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(body[key] ?? null);
    }
  }

  if (!sets.length) return jsonError('Nothing to update', 400);

  sets.push(`updated_at = datetime('now')`);
  params.push(id);

  const result = await env.DB.prepare(
    `UPDATE prospects SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  if (!result.success) return jsonError('Update failed', 500);

  const updated = await env.DB.prepare(`
    SELECT p.*, m.id AS member_id, m.is_active AS member_active
    FROM prospects p
    LEFT JOIN members m ON UPPER(m.callsign) = UPPER(p.callsign)
    WHERE p.id = ?
  `).bind(id).first();

  if (!updated) return jsonError('Prospect not found', 404);

  return jsonResponse({ prospect: updated });
}

