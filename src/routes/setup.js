/**
 * One-time setup endpoint
 * POST /api/setup
 * Body: { setup_key, email, password, callsign }
 *
 * Creates the first admin account.
 * Disabled once any admin user exists.
 * Protected by a secret key set via: wrangler secret put ADMIN_SETUP_KEY
 */

import { hashPassword }          from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';

export async function handleSetup(request, env) {
  // Check if any admin already exists
  const adminExists = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM users WHERE role = 'admin'`
  ).first();

  if (adminExists?.c > 0) {
    return jsonError('Setup already completed', 403);
  }

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { setup_key, email, password, callsign, first_name, last_name } = body;

  // Verify setup key
  if (!env.ADMIN_SETUP_KEY || setup_key !== env.ADMIN_SETUP_KEY) {
    return jsonError('Invalid setup key', 403);
  }

  if (!email || !password) return jsonError('email and password required', 400);
  if (password.length < 10) return jsonError('Password must be at least 10 characters', 400);

  // Create the member record first
  const memberResult = await env.DB.prepare(`
    INSERT INTO members (callsign, first_name, last_name, email, membership_type, joined_date, is_active)
    VALUES (?, ?, ?, ?, 'individual', date('now'), 1)
  `).bind(
    callsign?.toUpperCase() || null,
    first_name || 'Admin',
    last_name  || (callsign?.toUpperCase() || 'User'),
    email,
  ).run();

  const memberId = memberResult.meta.last_row_id;

  // Hash password and create admin user
  const hash = await hashPassword(password);
  await env.DB.prepare(`
    INSERT INTO users (email, password_hash, role, member_id)
    VALUES (?, ?, 'admin', ?)
  `).bind(email.toLowerCase().trim(), hash, memberId).run();

  return jsonResponse({
    ok: true,
    message: 'Admin account created. Please log in.',
    email,
  }, 201);
}
