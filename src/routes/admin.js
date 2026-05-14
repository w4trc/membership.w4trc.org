/**
 * Admin-only routes
 * GET    /api/admin/users          - list all login accounts
 * POST   /api/admin/users          - create a login account
 * PUT    /api/admin/users/:id      - update role, activate/deactivate
 * DELETE /api/admin/users/:id      - delete login account
 * GET    /api/admin/audit          - view audit log
 * GET    /api/admin/sessions       - active sessions
 * DELETE /api/admin/sessions/:id   - revoke a session
 * POST   /api/admin/password       - change own password
 */

import { isAdmin }                    from '../lib/auth.js';
import { hashPassword }               from '../lib/auth.js';
import { jsonResponse, jsonError }    from '../lib/response.js';
import { audit }                      from '../lib/audit.js';

export async function handleAdmin(request, env, path, user) {
  if (!isAdmin(user)) return jsonError('Forbidden - admin only', 403);

  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  // /api/admin/users     → segments[3] = 'users'
  // /api/admin/users/42  → segments[3] = 'users', segments[4] = '42'
  const resource = segments[3];
  const resId    = segments[4] ? parseInt(segments[4], 10) : null;

  // ── Users ──────────────────────────────────────────────────────────────
  if (resource === 'users') {
    if (!resId) {
      if (method === 'GET')  return listUsers(env);
      if (method === 'POST') return createUser(request, env, user);
    } else {
      if (method === 'PUT')    return updateUser(request, env, user, resId);
      if (method === 'DELETE') return deleteUser(request, env, user, resId);
    }
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  if (resource === 'audit' && method === 'GET') {
    return getAuditLog(env, url);
  }

  // ── Sessions ───────────────────────────────────────────────────────────
  if (resource === 'sessions') {
    if (method === 'GET' && !resId) return listSessions(env);
    if (method === 'DELETE' && resId) return revokeSession(env, user, resId);
  }

  // ── Change own password ────────────────────────────────────────────────
  if (resource === 'password' && method === 'POST') {
    return changePassword(request, env, user);
  }

  // ── Stats summary ──────────────────────────────────────────────────────
  if (resource === 'stats' && method === 'GET') {
    return getDashboardStats(env);
  }

  return jsonError('Not found', 404);
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.is_active, u.created_at, u.last_login,
           m.callsign, m.first_name, m.last_name
    FROM users u
    LEFT JOIN members m ON m.id = u.member_id
    ORDER BY u.role, u.email
  `).all();
  return jsonResponse({ users: results });
}

async function createUser(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { email, password, role, member_id } = body;
  if (!email || !password) return jsonError('email and password required', 400);
  if (password.length < 10) return jsonError('Password must be at least 10 characters', 400);
  if (!['admin','board','member'].includes(role)) return jsonError('Invalid role', 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return jsonError('Email already in use', 409);

  const hash = await hashPassword(password);
  const result = await env.DB.prepare(`
    INSERT INTO users (email, password_hash, role, member_id) VALUES (?,?,?,?)
  `).bind(email.toLowerCase().trim(), hash, role, member_id || null).run();

  await audit(env, { userId: user.id, action: 'user.create', targetType: 'user', targetId: result.meta.last_row_id, detail: { email, role }, request });
  return jsonResponse({ ok: true, id: result.meta.last_row_id }, 201);
}

async function updateUser(request, env, user, targetId) {
  const existing = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(targetId).first();
  if (!existing) return jsonError('User not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  // Prevent removing the last admin
  if (body.role && body.role !== 'admin' && existing.role === 'admin') {
    const adminCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND is_active = 1`
    ).first();
    if (adminCount?.c <= 1) return jsonError('Cannot remove last admin account', 400);
  }

  await env.DB.prepare(`
    UPDATE users SET role = ?, is_active = ?, member_id = ? WHERE id = ?
  `).bind(
    body.role      ?? existing.role,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
    body.member_id ?? existing.member_id,
    targetId
  ).run();

  await audit(env, { userId: user.id, action: 'user.update', targetType: 'user', targetId, detail: body, request });
  return jsonResponse({ ok: true });
}

async function deleteUser(request, env, user, targetId) {
  if (targetId === user.id) return jsonError('Cannot delete your own account', 400);

  const target = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(targetId).first();
  if (!target) return jsonError('User not found', 404);

  if (target.role === 'admin') {
    const adminCount = await env.DB.prepare(
      `SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND is_active = 1`
    ).first();
    if (adminCount?.c <= 1) return jsonError('Cannot delete last admin account', 400);
  }

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
  await audit(env, { userId: user.id, action: 'user.delete', targetType: 'user', targetId, request });
  return jsonResponse({ ok: true });
}

async function getAuditLog(env, url) {
  const page   = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit  = 100;
  const offset = (page - 1) * limit;
  const action = url.searchParams.get('action') || '';

  const where  = action ? 'WHERE al.action LIKE ?' : '';
  const params = action ? [`%${action}%`, limit, offset] : [limit, offset];

  const { results } = await env.DB.prepare(`
    SELECT al.*, u.email as user_email,
      CASE al.target_type
        WHEN 'member' THEN (SELECT first_name || ' ' || last_name FROM members WHERE id = al.target_id)
        WHEN 'membership' THEN (
          SELECT m.first_name || ' ' || m.last_name
          FROM memberships ms JOIN members m ON m.id = ms.member_id
          WHERE ms.id = al.target_id
        )
      END as target_name,
      CASE al.target_type
        WHEN 'member' THEN (SELECT callsign FROM members WHERE id = al.target_id)
        WHEN 'membership' THEN (
          SELECT m.callsign
          FROM memberships ms JOIN members m ON m.id = ms.member_id
          WHERE ms.id = al.target_id
        )
      END as target_callsign,
      CASE al.target_type
        WHEN 'membership' THEN (SELECT year FROM memberships WHERE id = al.target_id)
      END as target_year
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ${where}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params).all();

  return jsonResponse({ log: results, page });
}

async function listSessions(env) {
  const { results } = await env.DB.prepare(`
    SELECT s.id, s.user_id, s.ip_address, s.created_at, s.expires_at,
           u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.expires_at > datetime('now')
    ORDER BY s.created_at DESC
  `).all();
  return jsonResponse({ sessions: results });
}

async function revokeSession(env, user, sessionId) {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  await audit(env, { userId: user.id, action: 'session.revoke', detail: { sessionId } });
  return jsonResponse({ ok: true });
}

async function changePassword(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { current_password, new_password } = body;
  if (!current_password || !new_password) return jsonError('current_password and new_password required', 400);
  if (new_password.length < 10) return jsonError('New password must be at least 10 characters', 400);

  const { verifyPassword } = await import('../lib/auth.js');
  const userRow = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
  const valid   = await verifyPassword(current_password, userRow.password_hash);
  if (!valid) return jsonError('Current password is incorrect', 401);

  const newHash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();
  await audit(env, { userId: user.id, action: 'user.password_change', request });

  return jsonResponse({ ok: true });
}

async function getDashboardStats(env) {
  const year = new Date().getFullYear();

  const [members, memberships, recentActivity, notRenewed] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
             SUM(CASE WHEN is_arrl_member = 1 THEN 1 ELSE 0 END) as arrl_count
      FROM members
    `).first(),

    env.DB.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN amount_paid IS NOT NULL THEN 1 ELSE 0 END) as paid,
             SUM(amount_paid) as revenue
      FROM memberships WHERE year = ?
    `).bind(year).first(),

    env.DB.prepare(`
      SELECT al.action, al.created_at, u.email
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      ORDER BY al.created_at DESC LIMIT 10
    `).all(),

    env.DB.prepare(`
      SELECT m.id, m.callsign, m.first_name, m.last_name, m.email
      FROM memberships ms
      JOIN members m ON m.id = ms.member_id
      WHERE ms.year = ?
        AND ms.status IN ('active', 'honorary')
        AND m.is_active = 1
        AND m.id NOT IN (SELECT member_id FROM memberships WHERE year = ?)
      ORDER BY m.last_name, m.first_name
    `).bind(year - 1, year).all(),
  ]);

  return jsonResponse({
    year,
    members,
    memberships,
    recent_activity: recentActivity.results,
    not_renewed: notRenewed.results,
  });
}
