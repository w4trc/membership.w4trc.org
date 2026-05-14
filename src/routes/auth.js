/**
 * Auth routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 */

import { verifyPassword, createSession, destroySession, requireAuth } from '../lib/auth.js';
import { jsonResponse, jsonError, setCookieHeader, clearCookieHeader } from '../lib/response.js';
import { audit } from '../lib/audit.js';

export async function handleAuth(request, env, path) {
  const method = request.method;

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

    const { email, password } = body || {};
    if (!email || !password) return jsonError('Email and password required', 400);

    // Look up user
    const user = await env.DB.prepare(
      `SELECT id, email, password_hash, role, is_active, member_id
       FROM users WHERE email = ? COLLATE NOCASE`
    ).bind(email.trim()).first();

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (!user || !user.is_active) {
      // Still verify to prevent timing attacks
      await verifyPassword(password, '$2b$12$dummyhashtopreventtimingattacks');
      await audit(env, { action: 'login.failed', detail: { email, reason: 'user_not_found' }, request });
      return jsonError('Invalid email or password', 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await audit(env, { userId: user.id, action: 'login.failed', detail: { reason: 'bad_password' }, request });
      return jsonError('Invalid email or password', 401);
    }

    const sessionId = await createSession(user.id, request, env);
    await audit(env, { userId: user.id, action: 'login.success', request });

    const response = jsonResponse({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, memberId: user.member_id },
    });

    response.headers.set('Set-Cookie', setCookieHeader('karc_session', sessionId));
    return response;
  }

  // POST /api/auth/logout
  if (path === '/api/auth/logout' && method === 'POST') {
    const authResult = await requireAuth(request, env);
    if (authResult.ok) {
      await destroySession(authResult.user.sessionId, env);
      await audit(env, { userId: authResult.user.id, action: 'logout', request });
    }
    const response = jsonResponse({ ok: true });
    response.headers.set('Set-Cookie', clearCookieHeader('karc_session'));
    return response;
  }

  // GET /api/auth/me
  if (path === '/api/auth/me' && method === 'GET') {
    const authResult = await requireAuth(request, env);
    if (!authResult.ok) return jsonError('Not authenticated', 401);
    return jsonResponse({ ok: true, user: authResult.user });
  }

  return jsonError('Not found', 404);
}
