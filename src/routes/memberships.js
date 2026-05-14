/**
 * Memberships routes (annual dues)
 * GET    /api/memberships?year=2024       - list all memberships for a year
 * POST   /api/memberships                 - create/record a membership payment
 * PUT    /api/memberships/:id             - update membership record
 * GET    /api/memberships/stats           - stats (paid count, revenue, etc.)
 */

import { isBoardOrAbove } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';

export async function handleMemberships(request, env, path, user) {
  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  const id       = segments[3];

  if (id === 'stats') return getStats(request, env, user, url);
  if (!id) {
    if (method === 'GET')  return listMemberships(request, env, user, url);
    if (method === 'POST') return createMembership(request, env, user);
  } else {
    const msId = parseInt(id, 10);
    if (method === 'PUT')  return updateMembership(request, env, user, msId);
    if (method === 'GET')  return getMembership(request, env, user, msId);
  }

  return jsonError('Method not allowed', 405);
}

async function listMemberships(request, env, user, url) {
  const year     = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10);
  const status   = url.searchParams.get('status') || 'all';

  let where  = ['ms.year = ?'];
  let params = [year];

  if (status !== 'all') { where.push('ms.status = ?'); params.push(status); }

  const { results } = await env.DB.prepare(`
    SELECT ms.*, m.callsign, m.first_name, m.last_name, m.email, m.membership_type as member_type
    FROM memberships ms
    JOIN members m ON m.id = ms.member_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.last_name ASC, m.first_name ASC
  `).bind(...params).all();

  return jsonResponse({ year, memberships: results });
}

async function getMembership(request, env, user, id) {
  const ms = await env.DB.prepare(
    `SELECT ms.*, m.callsign, m.first_name, m.last_name FROM memberships ms
     JOIN members m ON m.id = ms.member_id WHERE ms.id = ?`
  ).bind(id).first();
  if (!ms) return jsonError('Not found', 404);
  return jsonResponse(ms);
}

async function createMembership(request, env, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { member_id, year } = body;
  if (!member_id || !year) return jsonError('member_id and year are required', 400);

  const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(member_id).first();
  if (!member) return jsonError('Member not found', 404);

  const membershipType = body.membership_type || member.membership_type || 'individual';
  const amtDue = membershipType === 'family' ? 30.00 : 20.00;

  try {
    const result = await env.DB.prepare(`
      INSERT INTO memberships (member_id, year, status, membership_type, amount_due, amount_paid, paid_date, payment_method, check_number, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      member_id,
      year,
      body.status          || 'active',
      membershipType,
      body.amount_due      ?? amtDue,
      body.amount_paid     ?? null,
      body.paid_date       ?? null,
      body.payment_method  ?? null,
      body.check_number    ?? null,
      body.notes           ?? null,
      user.id,
    ).run();

    const newId = result.meta.last_row_id;
    await audit(env, { userId: user.id, action: 'membership.create', targetType: 'membership', targetId: newId, detail: { member_id, year }, request });

    const created = await env.DB.prepare('SELECT * FROM memberships WHERE id = ?').bind(newId).first();
    return jsonResponse(created, 201);

  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return jsonError(`Membership record for year ${year} already exists for this member`, 409);
    }
    throw err;
  }
}

async function updateMembership(request, env, user, id) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare('SELECT * FROM memberships WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  await env.DB.prepare(`
    UPDATE memberships SET
      status         = ?,
      membership_type = ?,
      amount_due     = ?,
      amount_paid    = ?,
      paid_date      = ?,
      payment_method = ?,
      check_number   = ?,
      notes          = ?,
      recorded_by    = ?,
      updated_at     = datetime('now')
    WHERE id = ?
  `).bind(
    body.status          ?? existing.status,
    body.membership_type ?? existing.membership_type,
    body.amount_due      ?? existing.amount_due,
    body.amount_paid     ?? existing.amount_paid,
    body.paid_date       ?? existing.paid_date,
    body.payment_method  ?? existing.payment_method,
    body.check_number    ?? existing.check_number,
    body.notes           ?? existing.notes,
    user.id,
    id,
  ).run();

  await audit(env, { userId: user.id, action: 'membership.update', targetType: 'membership', targetId: id, detail: { changes: body }, request });

  const updated = await env.DB.prepare('SELECT * FROM memberships WHERE id = ?').bind(id).first();
  return jsonResponse(updated);
}

async function getStats(request, env, user, url) {
  const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10);

  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*)                                        AS total_memberships,
      SUM(CASE WHEN status = 'active'   THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN status = 'honorary' THEN 1 ELSE 0 END) AS honorary_count,
      SUM(CASE WHEN amount_paid IS NOT NULL THEN 1 ELSE 0 END) AS paid_count,
      SUM(amount_paid)                                AS total_collected,
      SUM(CASE WHEN membership_type = 'individual' THEN 1 ELSE 0 END) AS individual_count,
      SUM(CASE WHEN membership_type = 'family'     THEN 1 ELSE 0 END) AS family_count
    FROM memberships WHERE year = ?
  `).bind(year).first();

  const totalMembers = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM members WHERE is_active = 1`
  ).first();

  return jsonResponse({ year, stats, total_active_members: totalMembers?.count });
}
