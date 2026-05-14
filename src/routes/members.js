/**
 * Members routes
 * GET    /api/members              - list/search
 * POST   /api/members              - create (board+)
 * GET    /api/members/:id          - single member detail
 * PUT    /api/members/:id          - update (board+)
 * DELETE /api/members/:id          - admin only
 * GET    /api/members/:id/history  - membership year history
 */

import { isAdmin, isBoardOrAbove } from '../lib/auth.js';
import { jsonResponse, jsonError }  from '../lib/response.js';
import { audit }                    from '../lib/audit.js';

// Route dispatcher
export async function handleMembers(request, env, path, user) {
  const method  = request.method;
  const url     = new URL(request.url);

  // Parse path segments
  // /api/members           → ['', 'api', 'members']
  // /api/members/42        → ['', 'api', 'members', '42']
  // /api/members/42/history → ['', 'api', 'members', '42', 'history']
  const segments = path.split('/');
  const memberId = segments[3] ? parseInt(segments[3], 10) : null;
  const sub      = segments[4] || null;

  if (!memberId) {
    if (method === 'GET')  return listMembers(request, env, user, url);
    if (method === 'POST') return createMember(request, env, user);
    return jsonError('Method not allowed', 405);
  }

  if (sub === 'history') return getMemberHistory(request, env, user, memberId);

  if (method === 'GET')    return getMember(request, env, user, memberId);
  if (method === 'PUT')    return updateMember(request, env, user, memberId);
  if (method === 'DELETE') return deleteMember(request, env, user, memberId);

  return jsonError('Method not allowed', 405);
}

// ── GET /api/members ──────────────────────────────────────────────────────────
async function listMembers(request, env, user, url) {
  const search   = url.searchParams.get('q')         || '';
  const status   = url.searchParams.get('status')    || 'all'; // all|active|inactive
  const year     = url.searchParams.get('year')      || '';
  const page     = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const pageSize = 50;
  const offset   = (page - 1) * pageSize;

  let where  = [];
  let params = [];

  if (search) {
    where.push(`(m.callsign LIKE ? OR m.first_name LIKE ? OR m.last_name LIKE ? OR m.email LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (status === 'active')   { where.push('m.is_active = 1'); }
  if (status === 'inactive') { where.push('m.is_active = 0'); }

  const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // If filtering by membership year, join memberships
  let joinSQL = '';
  if (year) {
    joinSQL = `JOIN memberships ms ON ms.member_id = m.id AND ms.year = ?`;
    params.unshift(parseInt(year, 10)); // prepend year param
    // Need to adjust param order — rebuild cleanly:
    params = year ? [parseInt(year, 10), ...params.slice(1)] : params;
  }

  // Get total count
  const countParams = [...params];
  const countSQL = `SELECT COUNT(*) as total FROM members m ${joinSQL} ${whereSQL}`;
  const countRow  = await env.DB.prepare(countSQL).bind(...countParams).first();
  const total     = countRow?.total || 0;

  // Get page of results
  const dataSQL = `
    SELECT m.id, m.callsign, m.first_name, m.last_name, m.email,
           m.phone, m.city, m.state, m.license_class, m.membership_type,
           m.is_active, m.joined_date,
           (SELECT ms2.status FROM memberships ms2
            WHERE ms2.member_id = m.id AND ms2.year = strftime('%Y', 'now')
            LIMIT 1) AS current_year_status,
           (SELECT ms2.amount_paid FROM memberships ms2
            WHERE ms2.member_id = m.id AND ms2.year = strftime('%Y', 'now')
            LIMIT 1) AS current_year_paid
    FROM members m ${joinSQL}
    ${whereSQL}
    ORDER BY m.last_name ASC, m.first_name ASC
    LIMIT ? OFFSET ?
  `;
  const { results } = await env.DB.prepare(dataSQL)
    .bind(...params, pageSize, offset)
    .all();

  return jsonResponse({
    members: results,
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  });
}

// ── GET /api/members/:id ──────────────────────────────────────────────────────
async function getMember(request, env, user, memberId) {
  const member = await env.DB.prepare(
    `SELECT m.*,
            (SELECT json_group_array(json_object(
               'id', ms.id, 'year', ms.year, 'status', ms.status,
               'membership_type', ms.membership_type, 'amount_due', ms.amount_due,
               'amount_paid', ms.amount_paid, 'paid_date', ms.paid_date,
               'payment_method', ms.payment_method, 'check_number', ms.check_number,
               'notes', ms.notes,
               'covered_by_member_id', ms.covered_by_member_id,
               'covered_by_callsign',    (SELECT cb.callsign    FROM members cb WHERE cb.id = ms.covered_by_member_id),
               'covered_by_first_name',  (SELECT cb.first_name  FROM members cb WHERE cb.id = ms.covered_by_member_id),
               'covered_by_last_name',   (SELECT cb.last_name   FROM members cb WHERE cb.id = ms.covered_by_member_id)
             )) FROM memberships ms WHERE ms.member_id = m.id ORDER BY ms.year DESC
            ) AS memberships_json,
            (SELECT json_group_array(json_object(
               'id', n.id, 'note_text', n.note_text, 'is_private', n.is_private,
               'created_at', n.created_at,
               'author_email', (SELECT u2.email FROM users u2 WHERE u2.id = n.author_id)
             )) FROM notes n WHERE n.member_id = m.id ORDER BY n.created_at DESC
            ) AS notes_json
     FROM members m WHERE m.id = ?`
  ).bind(memberId).first();

  if (!member) return jsonError('Member not found', 404);

  // Parse JSON subfields
  try { member.memberships = JSON.parse(member.memberships_json || '[]'); } catch { member.memberships = []; }
  try { member.notes       = JSON.parse(member.notes_json       || '[]'); } catch { member.notes = []; }
  delete member.memberships_json;
  delete member.notes_json;

  // Filter private notes for non-board users (future member portal)
  if (!isBoardOrAbove(user)) {
    member.notes = member.notes.filter(n => !n.is_private);
  }

  return jsonResponse(member);
}

// ── POST /api/members ─────────────────────────────────────────────────────────
async function createMember(request, env, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const required = ['first_name', 'last_name'];
  for (const f of required) {
    if (!body[f]?.trim()) return jsonError(`${f} is required`, 400);
  }

  // Normalize callsign
  if (body.callsign) body.callsign = body.callsign.toUpperCase().trim();

  // Check callsign uniqueness
  if (body.callsign) {
    const existing = await env.DB.prepare(
      'SELECT id FROM members WHERE callsign = ?'
    ).bind(body.callsign).first();
    if (existing) return jsonError(`Callsign ${body.callsign} already exists`, 409);
  }

  const result = await env.DB.prepare(`
    INSERT INTO members (
      callsign, first_name, last_name, email, phone,
      address, city, state, zip,
      license_class, license_expiry, license_status,
      membership_type, joined_date, is_active,
      bio, interests, emergency_name, emergency_phone
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    body.callsign         || null,
    body.first_name.trim(),
    body.last_name.trim(),
    body.email            || null,
    body.phone            || null,
    body.address          || null,
    body.city             || null,
    body.state            || null,
    body.zip              || null,
    body.license_class    || null,
    body.license_expiry   || null,
    body.license_status   || null,
    body.membership_type  || 'individual',
    body.joined_date      || new Date().toISOString().slice(0,10),
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
    body.bio              || null,
    body.interests        || null,
    body.emergency_name   || null,
    body.emergency_phone  || null,
  ).run();

  const newId = result.meta.last_row_id;
  await audit(env, { userId: user.id, action: 'member.create', targetType: 'member', targetId: newId, detail: { callsign: body.callsign }, request });

  // Auto-create current-year membership record if requested
  if (body.create_membership) {
    const year    = new Date().getFullYear();
    const amtDue  = body.membership_type === 'family' ? 30.00 : 20.00;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO memberships (member_id, year, status, membership_type, amount_due)
      VALUES (?, ?, 'active', ?, ?)
    `).bind(newId, year, body.membership_type || 'individual', amtDue).run();
  }

  const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(newId).first();
  return jsonResponse(member, 201);
}

// ── PUT /api/members/:id ──────────────────────────────────────────────────────
async function updateMember(request, env, user, memberId) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
  if (!existing) return jsonError('Member not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  if (body.callsign) body.callsign = body.callsign.toUpperCase().trim();

  // Callsign uniqueness check (excluding this member)
  if (body.callsign && body.callsign !== existing.callsign) {
    const dup = await env.DB.prepare(
      'SELECT id FROM members WHERE callsign = ? AND id != ?'
    ).bind(body.callsign, memberId).first();
    if (dup) return jsonError(`Callsign ${body.callsign} already exists`, 409);
  }

  await env.DB.prepare(`
    UPDATE members SET
      callsign        = ?,
      first_name      = ?,
      last_name       = ?,
      email           = ?,
      phone           = ?,
      address         = ?,
      city            = ?,
      state           = ?,
      zip             = ?,
      license_class   = ?,
      license_expiry  = ?,
      license_status  = ?,
      membership_type = ?,
      joined_date     = ?,
      is_active       = ?,
      bio             = ?,
      interests       = ?,
      emergency_name  = ?,
      emergency_phone = ?,
      updated_at      = datetime('now')
    WHERE id = ?
  `).bind(
    body.callsign        ?? existing.callsign,
    body.first_name      ?? existing.first_name,
    body.last_name       ?? existing.last_name,
    body.email           ?? existing.email,
    body.phone           ?? existing.phone,
    body.address         ?? existing.address,
    body.city            ?? existing.city,
    body.state           ?? existing.state,
    body.zip             ?? existing.zip,
    body.license_class   ?? existing.license_class,
    body.license_expiry  ?? existing.license_expiry,
    body.license_status  ?? existing.license_status,
    body.membership_type ?? existing.membership_type,
    body.joined_date     ?? existing.joined_date,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
    body.bio             ?? existing.bio,
    body.interests       ?? existing.interests,
    body.emergency_name  ?? existing.emergency_name,
    body.emergency_phone ?? existing.emergency_phone,
    memberId,
  ).run();

  await audit(env, { userId: user.id, action: 'member.update', targetType: 'member', targetId: memberId, detail: { before: existing, changes: body }, request });

  const updated = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
  return jsonResponse(updated);
}

// ── DELETE /api/members/:id ───────────────────────────────────────────────────
async function deleteMember(request, env, user, memberId) {
  if (!isAdmin(user)) return jsonError('Forbidden - admin only', 403);

  const member = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(memberId).first();
  if (!member) return jsonError('Member not found', 404);

  // Soft delete by default — safer
  await env.DB.prepare(`UPDATE members SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(memberId).run();

  await audit(env, { userId: user.id, action: 'member.delete', targetType: 'member', targetId: memberId, detail: { callsign: member.callsign, name: `${member.first_name} ${member.last_name}` }, request });

  return jsonResponse({ ok: true, message: 'Member deactivated' });
}

// ── GET /api/members/:id/history ─────────────────────────────────────────────
async function getMemberHistory(request, env, user, memberId) {
  const { results } = await env.DB.prepare(
    `SELECT ms.*, u.email as recorded_by_email
     FROM memberships ms
     LEFT JOIN users u ON u.id = ms.recorded_by
     WHERE ms.member_id = ?
     ORDER BY ms.year DESC`
  ).bind(memberId).all();

  return jsonResponse({ memberships: results });
}
