/**
 * Prospects routes — local hams outreach tracking
 * GET  /api/prospects        - list with member cross-reference
 * GET  /api/prospects/stats  - summary counts
 * PUT  /api/prospects/:id    - update outreach status / postcard / notes
 */

import { isBoardOrAbove }           from '../lib/auth.js';
import { jsonResponse, jsonError }  from '../lib/response.js';
import { fetchHamDB }               from './lookup.js';

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

  if (sub === 'sync') {
    if (method === 'POST') return syncProspectsHamDB(request, env);
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
  const search   = url.searchParams.get('q')       || '';
  const city     = url.searchParams.get('city')    || 'all';
  const status   = url.searchParams.get('status')  || 'all';
  const postcard = url.searchParams.get('postcard')|| 'all';
  const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
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

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const countSQL = `
    SELECT COUNT(*) as total
    FROM prospects p
    LEFT JOIN members m ON UPPER(m.callsign) = UPPER(p.callsign)
    ${whereSQL}
  `;

  const rowSQL = `
    SELECT
      p.id, p.callsign, p.first_name, p.last_name, p.city, p.state, p.zip,
      p.email, p.outreach_status, p.postcard_sent, p.postcard_sent_date, p.notes,
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

// ── POST /api/prospects/sync ─────────────────────────────────────────────────
// Fetches street address + license data from HamDB for un-synced prospects.
// ?limit=N  — records per call (default 20, max 50)
// ?force=1  — re-sync even if already synced
async function syncProspectsHamDB(request, env) {
  const url   = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));

  const staleClause = `hamdb_synced_at IS NULL`;
  const where = force ? '' : `AND ${staleClause}`;

  const { results: batch } = await env.DB.prepare(`
    SELECT id, callsign FROM prospects
    WHERE callsign IS NOT NULL AND callsign != '' ${where}
    ORDER BY hamdb_synced_at ASC NULLS FIRST, id ASC
    LIMIT ?
  `).bind(limit).all();

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) as total FROM prospects
    WHERE callsign IS NOT NULL AND callsign != '' ${where}
  `).first();

  const summary = {
    processed: batch.length,
    remaining: Math.max(0, (remaining?.total ?? 0) - batch.length),
    synced:    0,
    not_found: 0,
    errors:    0,
    details:   [],
  };

  for (const prospect of batch) {
    try {
      const data = await fetchHamDB(prospect.callsign);

      if (!data) {
        summary.errors++;
        summary.details.push({ callsign: prospect.callsign, status: 'error', reason: 'api_unavailable' });
        continue;
      }

      if (!data.found) {
        summary.not_found++;
        summary.details.push({ callsign: prospect.callsign, status: 'not_found' });
        await env.DB.prepare(
          `UPDATE prospects SET hamdb_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).bind(prospect.id).run();
        continue;
      }

      await env.DB.prepare(`
        UPDATE prospects SET
          address         = ?,
          city            = COALESCE(NULLIF(?, ''), city),
          state           = COALESCE(NULLIF(?, ''), state),
          zip             = COALESCE(NULLIF(?, ''), zip),
          license_class   = ?,
          license_expiry  = ?,
          license_status  = ?,
          hamdb_synced_at = datetime('now'),
          updated_at      = datetime('now')
        WHERE id = ?
      `).bind(
        data.address || null,
        data.city    || '',
        data.state   || '',
        data.zip     || '',
        data.license_class  || null,
        data.license_expiry || null,
        data.license_status || null,
        prospect.id,
      ).run();

      summary.synced++;
      summary.details.push({ callsign: prospect.callsign, status: 'synced', address: data.address });

    } catch (err) {
      summary.errors++;
      summary.details.push({ callsign: prospect.callsign, status: 'error', reason: err.message });
    }
  }

  return jsonResponse(summary);
}
