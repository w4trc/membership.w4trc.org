/**
 * Small helpers for generating and hashing opaque tokens
 * (password reset tokens, portal verification codes, etc.)
 */

export function generateId(bytes = 16) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken() {
  return generateId(32);
}

export async function hashToken(token) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
