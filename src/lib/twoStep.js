/**
 * Checking the second step of a sign-in: a code from the user's authenticator
 * app, or one of their recovery codes.
 */

import { matchTotp, looksLikeRecoveryCode, hashRecoveryCode } from './totp.js';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

/** The columns checkSecondStep() needs from a users row. */
export const TWO_STEP_COLUMNS = 'totp_secret, totp_enabled, totp_last_step, totp_recovery, totp_fails, totp_locked_until';

export function recoveryHashes(user) {
  try { return JSON.parse(user.totp_recovery || '[]'); } catch { return []; }
}

/**
 * Check a typed code for a user who has two-step sign-in on.
 * Returns { ok: true, recovery } when it is right (recovery: a recovery code
 * was used up), { ok: false, locked } when it is not.
 *
 * A 6-digit code has only a million values, so five wrong ones in a row lock
 * the second step for 15 minutes, whatever address they come from.
 */
export async function checkSecondStep(env, user, code, now = Date.now()) {
  if (user.totp_locked_until && Date.parse(user.totp_locked_until) > now) {
    return { ok: false, locked: true };
  }

  if (looksLikeRecoveryCode(code)) {
    const hash = await hashRecoveryCode(code);
    const left = recoveryHashes(user);
    if (left.includes(hash)) {
      await env.DB.prepare(
        `UPDATE users SET totp_recovery = ?, totp_fails = 0, totp_locked_until = NULL WHERE id = ?`
      ).bind(JSON.stringify(left.filter(h => h !== hash)), user.id).run();
      return { ok: true, recovery: true };
    }
  } else {
    const step = await matchTotp(user.totp_secret, code, { now, after: user.totp_last_step });
    if (step != null) {
      // Only the first request with this code gets to move the marker forward
      const used = await env.DB.prepare(`
        UPDATE users SET totp_last_step = ?, totp_fails = 0, totp_locked_until = NULL
        WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)
      `).bind(step, user.id, step).run();
      if (used.meta.changes) return { ok: true, recovery: false };
    }
  }

  const row = await env.DB.prepare(
    `UPDATE users SET totp_fails = totp_fails + 1 WHERE id = ? RETURNING totp_fails`
  ).bind(user.id).first();
  if ((row?.totp_fails ?? 0) >= MAX_FAILS) {
    await env.DB.prepare(`UPDATE users SET totp_fails = 0, totp_locked_until = ? WHERE id = ?`)
      .bind(new Date(now + LOCK_MINUTES * 60 * 1000).toISOString(), user.id).run();
    return { ok: false, locked: true };
  }
  return { ok: false, locked: false };
}

/** Turn two-step sign-in off for a user and forget their key and codes. */
export function clearTwoStep(env, userId) {
  return env.DB.prepare(`
    UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL,
      totp_recovery = NULL, totp_fails = 0, totp_locked_until = NULL
    WHERE id = ?
  `).bind(userId).run();
}
