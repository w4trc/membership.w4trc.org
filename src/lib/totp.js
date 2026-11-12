/**
 * Two-step sign-in codes: the 6-digit, 30-second codes authenticator apps
 * make (TOTP, RFC 6238, HMAC-SHA1), and one-time recovery codes for a lost phone.
 */

import { hashToken } from './tokens.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECS = 30;
const DIGITS = 6;

export function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1; // keep only the bits not yet written
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

/** A new shared key: 20 random bytes, as the base32 text authenticator apps take. */
export function generateSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECS);
}

/** The code for one 30-second step. */
export async function totpCode(secret, step) {
  const key = await crypto.subtle.importKey(
    'raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const counter = new ArrayBuffer(8);
  new DataView(counter).setUint32(4, step); // high 4 bytes stay zero until the year 6053
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1] & 15;
  const number = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(number % 10 ** DIGITS).padStart(DIGITS, '0');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The step a code belongs to, or null if it is wrong. Accepts the step before
 * and after now, for a phone clock that is a little off. Steps at or before
 * `after` (the last one accepted) do not count, so a code cannot be used twice.
 */
export async function matchTotp(secret, code, { now = Date.now(), after = null } = {}) {
  const typed = String(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const step = currentStep(now);
  let found = null;
  for (const s of [step - 1, step, step + 1]) {
    if (sameText(await totpCode(secret, s), typed) && (after == null || s > after)) found = s;
  }
  return found;
}

/** What the QR code holds: the key, and the names the app shows for it. */
export function otpauthUri(secret, account, issuer) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECS}`;
}

// ── Recovery codes ───────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
const RECOVERY_COUNT = 8;

function recoveryCode() {
  let out = '';
  // Take only bytes below 248 (8 × 31) so every letter is equally likely
  while (out.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && out.length < 10) out += RECOVERY_ALPHABET[b % 31];
    }
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

const normalizeRecovery = (code) => String(code).toLowerCase().replace(/[^a-z0-9]/g, '');

/** True if the text has the shape of a recovery code rather than a 6-digit one. */
export const looksLikeRecoveryCode = (code) => normalizeRecovery(code).length === 10;

export const hashRecoveryCode = (code) => hashToken(normalizeRecovery(code));

/** New codes to show the user once, and the hashes to store. */
export async function generateRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, recoveryCode);
  return { codes, hashes: await Promise.all(codes.map(hashRecoveryCode)) };
}
