/**
 * Two-step sign-in, set up by each user for their own login.
 *
 * GET  /api/auth/two-step          - { enabled, recovery_left }
 * POST /api/auth/two-step/setup    - { password } → a new key as text and as a QR code
 * POST /api/auth/two-step/enable   - { code } from the app → turns it on, returns recovery codes (shown once)
 * POST /api/auth/two-step/disable  - { password, code } → turns it off
 *
 * An admin can turn it off for someone who lost their phone and their recovery
 * codes: DELETE /api/admin/users/:id/two-step (src/routes/admin.js).
 */

import { requireAuth, verifyPassword } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { qrSvg } from '../lib/qr.js';
import { generateSecret, matchTotp, otpauthUri, generateRecoveryCodes } from '../lib/totp.js';
import { TWO_STEP_COLUMNS, checkSecondStep, clearTwoStep, recoveryHashes } from '../lib/twoStep.js';

export async function handleTwoStep(request, env, path) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok) return jsonError(authResult.error, 401);
  const session = authResult.user;
  const method  = request.method;
  const action  = path.replace('/api/auth/two-step', '').replace(/^\//, '');

  const user = await env.DB.prepare(
    `SELECT id, email, password_hash, ${TWO_STEP_COLUMNS} FROM users WHERE id = ?`
  ).bind(session.id).first();
  if (!user) return jsonError('Not authenticated', 401);

  if (method === 'GET' && action === '') {
    return jsonResponse({
      enabled: !!user.totp_enabled,
      recovery_left: user.totp_enabled ? recoveryHashes(user).length : 0,
    });
  }

  if (method !== 'POST') return jsonError('Not found', 404);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  if (action === 'setup') {
    if (user.totp_enabled) return jsonError('Two-step sign-in is already on', 409);
    if (!body?.password || !(await verifyPassword(body.password, user.password_hash))) {
      return jsonError('Password is incorrect', 401);
    }
    // Kept with totp_enabled = 0 until a code from the app proves it was saved
    const secret = generateSecret();
    await env.DB.prepare(`UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?`)
      .bind(secret, user.id).run();
    const uri = otpauthUri(secret, user.email, env.CLUB_CALLSIGN ? `${env.CLUB_CALLSIGN} Members` : 'KARC Members');
    return jsonResponse({ secret, qr: qrSvg(uri) });
  }

  if (action === 'enable') {
    if (user.totp_enabled) return jsonError('Two-step sign-in is already on', 409);
    if (!user.totp_secret) return jsonError('Start the setup again', 400);
    const step = await matchTotp(user.totp_secret, body?.code ?? '');
    if (step == null) return jsonError('That code is not right. Check the time on your phone and try the next code.', 400);

    const { codes, hashes } = await generateRecoveryCodes();
    await env.DB.prepare(`
      UPDATE users SET totp_enabled = 1, totp_last_step = ?, totp_recovery = ?,
        totp_fails = 0, totp_locked_until = NULL
      WHERE id = ?
    `).bind(step, JSON.stringify(hashes), user.id).run();
    // Anywhere else this login is signed in has to sign in again, with a code
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`)
      .bind(user.id, session.sessionId).run();
    await audit(env, { userId: user.id, action: 'two_step.enabled', request });
    return jsonResponse({ ok: true, recovery_codes: codes });
  }

  if (action === 'disable') {
    if (!user.totp_enabled) return jsonError('Two-step sign-in is not on', 409);
    if (!body?.password || !(await verifyPassword(body.password, user.password_hash))) {
      return jsonError('Password is incorrect', 401);
    }
    const check = await checkSecondStep(env, user, body?.code ?? '');
    if (!check.ok) {
      return jsonError(check.locked ? 'Too many wrong codes. Try again in 15 minutes.' : 'That code is not right', check.locked ? 429 : 400);
    }
    await clearTwoStep(env, user.id);
    await audit(env, { userId: user.id, action: 'two_step.disabled', request });
    return jsonResponse({ ok: true });
  }

  return jsonError('Not found', 404);
}
