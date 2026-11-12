/**
 * Auth routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 * Login takes { email, password } and, for a login with two-step sign-in on,
 * { code } as well; without it the answer is 401 with details.two_step = true.
 */

import { verifyPassword, hashPassword, createSession, destroySession, requireAuth, DUMMY_HASH, withD1Retry } from '../lib/auth.js';
import { jsonResponse, jsonError, setCookieHeader, clearCookieHeader } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { generateId, generateToken, hashToken } from '../lib/tokens.js';
import { TWO_STEP_COLUMNS, checkSecondStep } from '../lib/twoStep.js';
import { handleTwoStep } from './twoStep.js';

export async function handleAuth(request, env, path) {
  const method = request.method;

  // Setting up two-step sign-in for your own login
  if (path === '/api/auth/two-step' || path.startsWith('/api/auth/two-step/')) {
    return handleTwoStep(request, env, path);
  }

  // POST /api/auth/login
  if (path === '/api/auth/login' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

    const { email, password } = body || {};
    if (!email || !password) return jsonError('Email and password required', 400);

    // Look up user
    const user = await withD1Retry(() => env.DB.prepare(
      `SELECT id, email, password_hash, role, is_active, member_id, ${TWO_STEP_COLUMNS}
       FROM users WHERE email = ? COLLATE NOCASE`
    ).bind(email.trim()).first());

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (!user || !user.is_active) {
      // Still verify to prevent timing attacks
      await verifyPassword(password, await DUMMY_HASH);
      await audit(env, { action: 'login.failed', detail: { email, reason: 'user_not_found' }, request });
      return jsonError('Invalid email or password', 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await audit(env, { userId: user.id, action: 'login.failed', detail: { reason: 'bad_password' }, request });
      return jsonError('Invalid email or password', 401);
    }

    // Second step, for a login that has it turned on: the same request again
    // with a code from the authenticator app (or a recovery code)
    let usedRecovery = false;
    if (user.totp_enabled) {
      const code = String(body.code ?? '').trim();
      if (!code) {
        return jsonError('Enter the 6-digit code from your authenticator app', 401, { two_step: true });
      }
      const check = await checkSecondStep(env, user, code);
      if (!check.ok) {
        await audit(env, { userId: user.id, action: 'login.failed', detail: { reason: check.locked ? 'two_step_locked' : 'bad_code' }, request });
        return check.locked
          ? jsonError('Too many wrong codes. Try again in 15 minutes.', 429, { two_step: true })
          : jsonError('That code is not right', 401, { two_step: true });
      }
      usedRecovery = check.recovery;
    }

    const { sessionId, maxAge } = await createSession(user.id, request, env, user.role);
    await audit(env, {
      userId: user.id, action: 'login.success', request,
      detail: usedRecovery ? { recovery_code: true } : undefined,
    });

    const response = jsonResponse({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, memberId: user.member_id },
    });

    response.headers.set('Set-Cookie', setCookieHeader('karc_session', sessionId, { maxAge }));
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

  // POST /api/auth/forgot-password
  if (path === '/api/auth/forgot-password' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
    const { email } = body || {};
    if (!email) return jsonError('Email required', 400);

    // Always return success to prevent email enumeration
    const user = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1`
    ).bind(email.trim()).first();

    if (user) {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      const id = generateId();

      // Invalidate any existing unused tokens for this user
      await env.DB.prepare(
        `DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL`
      ).bind(user.id).run();

      await env.DB.prepare(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`
      ).bind(id, user.id, tokenHash, expiresAt).run();

      const domain = env.CLUB_DOMAIN || 'members.w4trc.org';
      const resetUrl = `https://${domain}/reset-password?token=${token}`;
      await sendPasswordResetEmail(env, { to: email.trim(), resetUrl }).catch(err => {
        console.error('Failed to send password reset email:', err);
      });

      await audit(env, { userId: user.id, action: 'password.reset_requested', request });
    }

    return jsonResponse({ ok: true, message: 'If that email is on file, a reset link has been sent.' });
  }

  // POST /api/auth/reset-password
  if (path === '/api/auth/reset-password' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
    const { token, password } = body || {};
    if (!token || !password) return jsonError('Token and password required', 400);
    if (password.length < 10) return jsonError('Password must be at least 10 characters', 400);

    const tokenHash = await hashToken(token);
    const row = await env.DB.prepare(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`
    ).bind(tokenHash).first();

    if (!row) return jsonError('Reset link is invalid or has expired', 400);

    const newHash = await hashPassword(password);

    await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .bind(newHash, row.user_id).run();

    await env.DB.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?`)
      .bind(row.id).run();

    // Invalidate all sessions so the old password can't be reused
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id).run();

    await audit(env, { userId: row.user_id, action: 'password.reset_completed', request });

    return jsonResponse({ ok: true, message: 'Password updated successfully.' });
  }

  return jsonError('Not found', 404);
}
