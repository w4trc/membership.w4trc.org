/**
 * Authentication utilities
 * Uses Web Crypto API (available in Workers runtime) for JWT
 * and PBKDF2 for password hashing (no bcrypt dependency needed)
 */

// ── Password hashing (PBKDF2 via Web Crypto) ─────────────────────────────────

export async function hashPassword(password) {
  const enc     = new TextEncoder();
  const keyMat  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMat, 256
  );
  const hashArr  = Array.from(new Uint8Array(bits));
  const saltArr  = Array.from(salt);
  return btoa(JSON.stringify({ salt: saltArr, hash: hashArr, iter: 100000 }));
}

export async function verifyPassword(password, stored) {
  try {
    const { salt, hash: storedHash, iter } = JSON.parse(atob(stored));
    const enc    = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits   = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: iter, hash: 'SHA-256' },
      keyMat, 256
    );
    const newHash = Array.from(new Uint8Array(bits));
    // Constant-time compare
    if (newHash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < newHash.length; i++) diff |= newHash[i] ^ storedHash[i];
    return diff === 0;
  } catch {
    return false;
  }
}

// ── Session tokens (HMAC-SHA256 signed, stored in D1) ────────────────────────

function generateId() {
  const arr = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_TTL_SECS = {
  admin: 30 * 24 * 60 * 60, // 30 days
  board: 30 * 24 * 60 * 60, // 30 days
  default: 8 * 60 * 60,     // 8 hours
};

export async function createSession(userId, request, env, role = 'member') {
  const sessionId = generateId();
  const ttlSecs   = SESSION_TTL_SECS[role] ?? SESSION_TTL_SECS.default;
  const expiresAt = new Date(Date.now() + ttlSecs * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    sessionId,
    userId,
    request.headers.get('CF-Connecting-IP') || '',
    request.headers.get('User-Agent') || '',
    expiresAt
  ).run();

  // Update last_login
  await env.DB.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`)
    .bind(userId).run();

  return { sessionId, maxAge: ttlSecs };
}

export async function requireAuth(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match  = cookie.match(/karc_session=([a-f0-9]{64})/);
  if (!match) return { ok: false, error: 'Not authenticated' };

  const sessionId = match[1];
  const row = await env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at,
            u.email, u.role, u.is_active, u.member_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(sessionId).first();

  if (!row)           return { ok: false, error: 'Session expired or invalid' };
  if (!row.is_active) return { ok: false, error: 'Account disabled' };

  return {
    ok: true,
    user: {
      id:       row.user_id,
      email:    row.email,
      role:     row.role,
      memberId: row.member_id,
      sessionId,
    },
  };
}

export async function destroySession(sessionId, env) {
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function cleanExpiredSessions(env) {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
}

// ── Role helpers ─────────────────────────────────────────────────────────────

export function isAdmin(user)       { return user.role === 'admin'; }
export function isBoardOrAbove(user){ return user.role === 'admin' || user.role === 'board'; }
export function requireRole(user, role) {
  if (role === 'admin' && !isAdmin(user))       return false;
  if (role === 'board' && !isBoardOrAbove(user)) return false;
  return true;
}
