/**
 * Member portal
 *
 * Public API (no auth):
 *   POST /api/portal/lookup          — find member by callsign or email
 *   POST /api/portal/request-token   — send 6-digit code to email on file
 *   POST /api/portal/claim           — verify code + create account (existing member)
 *   POST /api/portal/register        — new member self-registration
 *   GET  /api/portal/directory       — opt-in member list
 *
 * Authenticated (member role, own data only):
 *   GET  /api/portal/me              — own profile + current dues status
 *   PUT  /api/portal/me              — update own profile
 *   GET  /api/portal/history         — own membership year history
 *   PUT  /api/portal/directory-opt-in — toggle show_in_directory
 *
 * Public HTML pages:
 *   GET /register  — multi-step registration / claim flow
 *   GET /directory — public member directory
 */

import { requireAuth, hashPassword, createSession } from '../lib/auth.js';
import { jsonResponse, jsonError, setCookieHeader } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { sendVerificationCode } from '../lib/email.js';
import { fetchHamDB } from './lookup.js';
import { normalizeName } from '../lib/normalize.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  const arr = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateCode() {
  const arr = crypto.getRandomValues(new Uint8Array(3));
  const n = ((arr[0] << 16) | (arr[1] << 8) | arr[2]) % 1000000;
  return n.toString().padStart(6, '0');
}

async function hashCode(code) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(code.trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function maskEmail(email) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const shown = user.length <= 2 ? user[0] : user.slice(0, 2);
  return `${shown}***@${domain}`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Route dispatcher ──────────────────────────────────────────────────────────

export async function handlePortal(request, env, path) {
  const method = request.method;
  const sub = path.replace('/api/portal', '').replace(/^\//, '');

  // Public routes (no auth required)
  if (method === 'POST' && sub === 'lookup')         return portalLookup(request, env);
  if (method === 'POST' && sub === 'request-token')  return portalRequestToken(request, env);
  if (method === 'POST' && sub === 'claim')          return portalClaim(request, env);
  if (method === 'POST' && sub === 'register')       return portalRegister(request, env);
  if (method === 'GET'  && sub === 'directory')      return portalDirectory(env);

  // Authenticated routes
  const authResult = await requireAuth(request, env);
  if (!authResult.ok) return jsonError(authResult.error, 401);
  const user = authResult.user;

  if (method === 'GET' && sub === 'me')                   return portalMe(env, user);
  if (method === 'PUT' && sub === 'me')                   return portalUpdateMe(request, env, user);
  if (method === 'GET' && sub === 'history')              return portalHistory(env, user);
  if (method === 'PUT' && sub === 'directory-opt-in')     return portalDirectoryOptIn(request, env, user);

  return jsonError('Not found', 404);
}

// ── POST /api/portal/lookup ───────────────────────────────────────────────────

async function portalLookup(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const identifier = (body?.identifier || '').trim();
  if (!identifier) return jsonError('Callsign or email required', 400);

  let member;
  if (identifier.includes('@')) {
    member = await env.DB.prepare(
      `SELECT id, first_name, last_name, email, callsign FROM members WHERE email = ? COLLATE NOCASE LIMIT 1`
    ).bind(identifier).first();
  } else {
    const cs = identifier.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    member = await env.DB.prepare(
      `SELECT id, first_name, last_name, email, callsign FROM members WHERE callsign = ? COLLATE NOCASE LIMIT 1`
    ).bind(cs).first();
  }

  if (!member) return jsonResponse({ found: false });

  const existingUser = await env.DB.prepare(
    `SELECT id FROM users WHERE member_id = ? LIMIT 1`
  ).bind(member.id).first();

  return jsonResponse({
    found: true,
    memberId: member.id,
    firstName: member.first_name,
    callsign: member.callsign || '',
    hasEmail: !!member.email,
    maskedEmail: maskEmail(member.email),
    alreadyClaimed: !!existingUser,
  });
}

// ── POST /api/portal/request-token ───────────────────────────────────────────

async function portalRequestToken(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const memberId = parseInt(body?.memberId, 10);
  if (!memberId) return jsonError('Member ID required', 400);

  // Passive cleanup of old tokens (best-effort, doesn't affect the response)
  env.DB.prepare(`DELETE FROM portal_tokens WHERE expires_at < datetime('now', '-1 day')`).run().catch(() => {});

  const member = await env.DB.prepare(
    `SELECT id, first_name, email FROM members WHERE id = ?`
  ).bind(memberId).first();

  if (!member)       return jsonError('Member not found', 404);
  if (!member.email) return jsonError('No email on file for this callsign. Please contact a club administrator to claim your account.', 422);

  // Max 3 tokens per member per hour
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM portal_tokens WHERE member_id = ? AND created_at > datetime('now', '-1 hour')`
  ).bind(memberId).first();
  if (recent.cnt >= 3) return jsonError('Too many verification requests. Please wait an hour and try again.', 429);

  const code      = generateCode();
  const codeHash  = await hashCode(code);
  const tokenId   = generateId();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO portal_tokens (id, member_id, email, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(tokenId, memberId, member.email, codeHash, expiresAt).run();

  try {
    await sendVerificationCode(env, { to: member.email, code, name: member.first_name });
  } catch (err) {
    console.error('Verification email failed:', err);
    // Clean up the token we just created so they can retry
    await env.DB.prepare(`DELETE FROM portal_tokens WHERE id = ?`).bind(tokenId).run();
    return jsonError('Failed to send verification email. Please contact a club administrator.', 500);
  }

  return jsonResponse({ ok: true, tokenId, maskedEmail: maskEmail(member.email) });
}

// ── POST /api/portal/claim ────────────────────────────────────────────────────

async function portalClaim(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { tokenId, code, password } = body || {};
  if (!tokenId || !code || !password) return jsonError('Token, code, and password required', 400);
  if (password.length < 10)          return jsonError('Password must be at least 10 characters', 400);

  const token = await env.DB.prepare(
    `SELECT * FROM portal_tokens WHERE id = ? AND expires_at > datetime('now') AND used_at IS NULL`
  ).bind(tokenId).first();

  if (!token) return jsonError('Verification code has expired or already been used. Please request a new one.', 400);

  const codeHash = await hashCode(code);
  if (codeHash !== token.code_hash) return jsonError('Invalid verification code.', 400);

  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE member_id = ?`
  ).bind(token.member_id).first();
  if (existing) return jsonError('This member account is already claimed. Please use the sign-in form.', 409);

  const member = await env.DB.prepare(
    `SELECT id, email, callsign FROM members WHERE id = ?`
  ).bind(token.member_id).first();

  const hash   = await hashPassword(password);
  const email  = member.email || token.email;
  const result = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role, member_id, is_active) VALUES (?, ?, 'member', ?, 1)`
  ).bind(email, hash, token.member_id).run();
  const userId = result.meta.last_row_id;

  await env.DB.prepare(`UPDATE portal_tokens SET used_at = datetime('now') WHERE id = ?`).bind(tokenId).run();

  await audit(env, {
    userId,
    action: 'portal.claim',
    targetType: 'member',
    targetId: token.member_id,
    detail: { callsign: member.callsign },
    request,
  });

  const { sessionId, maxAge } = await createSession(userId, request, env, 'member');

  const response = jsonResponse({ ok: true, user: { id: userId, email, role: 'member', memberId: token.member_id } });
  response.headers.set('Set-Cookie', setCookieHeader('karc_session', sessionId, { maxAge }));
  return response;
}

// ── POST /api/portal/register ─────────────────────────────────────────────────

async function portalRegister(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { callsign, firstName, lastName, email, phone, password } = body || {};
  if (!firstName || !lastName || !email || !password) return jsonError('First name, last name, email, and password are required', 400);
  if (password.length < 10) return jsonError('Password must be at least 10 characters', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return jsonError('Invalid email address', 400);

  // Check email not already used as a login
  const existingByEmail = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`
  ).bind(email.trim()).first();
  if (existingByEmail) return jsonError('An account with this email already exists. Please sign in instead.', 409);

  let memberData = {};
  let normalizedCallsign = null;

  if (callsign) {
    normalizedCallsign = callsign.toUpperCase().replace(/[^A-Z0-9/]/g, '');

    // Check if callsign is already in the DB
    const existingMember = await env.DB.prepare(
      `SELECT id FROM members WHERE callsign = ? COLLATE NOCASE LIMIT 1`
    ).bind(normalizedCallsign).first();
    if (existingMember) {
      return jsonError('This callsign is already in our system. Please use "Claim my record" on the previous screen instead.', 409);
    }

    // Try HamDB to auto-fill license info
    try {
      const hamData = await fetchHamDB(normalizedCallsign);
      if (hamData?.found) {
        memberData = {
          callsign:       hamData.callsign,
          license_class:  hamData.license_class,
          license_expiry: hamData.license_expiry,
          license_status: hamData.license_status,
        };
        // Use HamDB's normalized callsign
        normalizedCallsign = hamData.callsign;
      }
    } catch { /* HamDB unavailable — proceed without */ }
  }

  const today = new Date().toISOString().slice(0, 10);

  const memberResult = await env.DB.prepare(`
    INSERT INTO members
      (callsign, first_name, last_name, email, phone, license_class, license_expiry, license_status, joined_date, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    memberData.callsign || normalizedCallsign || null,
    normalizeName(firstName.trim()),
    normalizeName(lastName.trim()),
    email.trim(),
    phone?.trim() || null,
    memberData.license_class  || null,
    memberData.license_expiry || null,
    memberData.license_status || null,
    today,
  ).run();
  const memberId = memberResult.meta.last_row_id;

  const hash = await hashPassword(password);
  const userResult = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role, member_id, is_active) VALUES (?, ?, 'member', ?, 1)`
  ).bind(email.trim(), hash, memberId).run();
  const userId = userResult.meta.last_row_id;

  await audit(env, {
    userId,
    action: 'portal.register',
    targetType: 'member',
    targetId: memberId,
    detail: { callsign: memberData.callsign || normalizedCallsign, email: email.trim() },
    request,
  });

  const { sessionId, maxAge } = await createSession(userId, request, env, 'member');

  const response = jsonResponse({ ok: true, user: { id: userId, email: email.trim(), role: 'member', memberId } });
  response.headers.set('Set-Cookie', setCookieHeader('karc_session', sessionId, { maxAge }));
  return response;
}

// ── GET /api/portal/me ────────────────────────────────────────────────────────

async function portalMe(env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 404);

  const year = new Date().getFullYear();
  const member = await env.DB.prepare(`
    SELECT
      m.*,
      (SELECT ms.status      FROM memberships ms WHERE ms.member_id = m.id AND ms.year = ? ORDER BY ms.id DESC LIMIT 1) AS dues_status,
      (SELECT ms.paid_date   FROM memberships ms WHERE ms.member_id = m.id AND ms.year = ? ORDER BY ms.id DESC LIMIT 1) AS dues_paid_date,
      (SELECT ms.amount_paid FROM memberships ms WHERE ms.member_id = m.id AND ms.year = ? ORDER BY ms.id DESC LIMIT 1) AS dues_amount_paid,
      (SELECT ms.amount_due  FROM memberships ms WHERE ms.member_id = m.id AND ms.year = ? ORDER BY ms.id DESC LIMIT 1) AS dues_amount_due
    FROM members m
    WHERE m.id = ?
  `).bind(year, year, year, year, user.memberId).first();

  if (!member) return jsonError('Member record not found', 404);

  return jsonResponse({ ok: true, member, year });
}

// ── PUT /api/portal/me ────────────────────────────────────────────────────────

async function portalUpdateMe(request, env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const {
    first_name, last_name, email, phone,
    address, city, state, zip,
    bio, interests,
    emergency_name, emergency_phone,
  } = body || {};

  if (!first_name || !last_name) return jsonError('First and last name are required', 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return jsonError('Invalid email address', 400);

  // If changing email, make sure it's not used by another user account
  if (email) {
    const clash = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ? COLLATE NOCASE AND id != ?`
    ).bind(email.trim(), user.id).first();
    if (clash) return jsonError('That email address is already in use by another account', 409);
  }

  await env.DB.prepare(`
    UPDATE members SET
      first_name      = ?,
      last_name       = ?,
      email           = ?,
      phone           = ?,
      address         = ?,
      city            = ?,
      state           = ?,
      zip             = ?,
      bio             = ?,
      interests       = ?,
      emergency_name  = ?,
      emergency_phone = ?,
      updated_at      = datetime('now')
    WHERE id = ?
  `).bind(
    normalizeName(first_name.trim()),
    normalizeName(last_name.trim()),
    email?.trim() || null,
    phone?.trim() || null,
    address?.trim() || null,
    city?.trim() || null,
    state?.trim() || null,
    zip?.trim() || null,
    bio?.trim() || null,
    interests?.trim() || null,
    emergency_name?.trim() || null,
    emergency_phone?.trim() || null,
    user.memberId,
  ).run();

  // Keep user email in sync if member email changed
  if (email) {
    await env.DB.prepare(`UPDATE users SET email = ? WHERE id = ?`).bind(email.trim(), user.id).run();
  }

  await audit(env, { userId: user.id, action: 'portal.profile_update', targetType: 'member', targetId: user.memberId, request });

  return jsonResponse({ ok: true });
}

// ── GET /api/portal/history ───────────────────────────────────────────────────

async function portalHistory(env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 404);

  const { results } = await env.DB.prepare(`
    SELECT year, status, membership_type, amount_due, amount_paid, paid_date, payment_method, notes
    FROM memberships
    WHERE member_id = ?
    ORDER BY year DESC
  `).bind(user.memberId).all();

  return jsonResponse({ ok: true, history: results });
}

// ── PUT /api/portal/directory-opt-in ─────────────────────────────────────────

async function portalDirectoryOptIn(request, env, user) {
  if (!user.memberId) return jsonError('No member record linked to this account', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const show = body?.show ? 1 : 0;
  await env.DB.prepare(`UPDATE members SET show_in_directory = ? WHERE id = ?`).bind(show, user.memberId).run();
  await audit(env, { userId: user.id, action: 'portal.directory_opt_in', targetType: 'member', targetId: user.memberId, detail: { show: !!show }, request });

  return jsonResponse({ ok: true, show: !!show });
}

// ── GET /api/portal/directory ─────────────────────────────────────────────────

async function portalDirectory(env) {
  const { results } = await env.DB.prepare(`
    SELECT callsign, first_name, last_name, license_class, city, state, interests
    FROM members
    WHERE show_in_directory = 1 AND is_active = 1 AND is_silent_key = 0
    ORDER BY callsign ASC
  `).all();

  return jsonResponse({ ok: true, members: results });
}

// ═════════════════════════════════════════════════════════════════════════════
// Public HTML pages
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /register ─────────────────────────────────────────────────────────────

export function handleRegisterPage() {
  const html = registerPageHtml();
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  });
}

function registerPageHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>W4TRC Member Portal — Register</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0f1117; --surface: #181c27; --surface2: #1f2438;
  --border: #2a3050; --accent: #3b7dd8; --accent-h: #5594f0;
  --success: #2ecc71; --warn: #f39c12; --danger: #e74c3c;
  --text: #e8eaf0; --text-muted: #8892aa;
  --radius: 6px; --shadow: 0 4px 24px rgba(0,0,0,.4);
  --mono: 'Courier New', monospace;
}
body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; font-size: 14px; line-height: 1.6; display: flex; align-items: center; justify-content: center; padding: 24px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px; width: 100%; max-width: 480px; box-shadow: var(--shadow); }
.logo { text-align: center; margin-bottom: 28px; }
.logo .call { font-family: var(--mono); font-size: 28px; color: var(--accent); font-weight: bold; letter-spacing: .1em; }
.logo h1 { font-size: 18px; font-weight: 600; margin-top: 4px; }
.logo p { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
.step { display: none; }
.step.active { display: block; }
.form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
input { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius); padding: 9px 12px; font-size: 13px; width: 100%; outline: none; transition: border-color .15s; font-family: inherit; }
input:focus { border-color: var(--accent); }
.btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: all .15s; width: 100%; }
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: var(--accent-h); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); margin-top: 8px; }
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
.err { color: var(--danger); font-size: 13px; margin-top: 10px; text-align: center; min-height: 20px; }
.ok { color: var(--success); font-size: 13px; margin-top: 10px; text-align: center; }
.code-input { font-family: var(--mono); font-size: 28px; letter-spacing: .4em; text-align: center; }
.hint { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.info-box { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 16px; font-size: 13px; }
.info-box .call { font-family: var(--mono); color: var(--accent); font-weight: bold; }
.divider { text-align: center; color: var(--text-muted); font-size: 12px; margin: 16px 0; display: flex; align-items: center; gap: 8px; }
.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.back-link { text-align: center; margin-top: 16px; }
.back-link a, .back-link span { color: var(--text-muted); font-size: 13px; cursor: pointer; text-decoration: none; }
.back-link a:hover, .back-link span:hover { color: var(--accent); }
.success-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
.spinner-inline { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3); border-top-color: white; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
a { color: var(--accent); }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <img src="/logo.png" alt="KARC" style="height:72px;margin-bottom:10px">
    <h1>Member Portal</h1>
    <p>Kingsport Amateur Radio Club</p>
  </div>

  <!-- Step 1: Lookup -->
  <div class="step active" id="step-lookup">
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;text-align:center">
      Already a member? Enter your callsign or email to find your record.
    </p>
    <div class="form-group">
      <label>Callsign or Email Address</label>
      <input type="text" id="lookup-identifier" placeholder="W4TRC or member@example.com" autocomplete="off" autocorrect="off" autocapitalize="off">
    </div>
    <button class="btn btn-primary" onclick="doLookup()" id="lookup-btn">Find My Record</button>
    <div class="err" id="lookup-err"></div>
    <div class="divider">or</div>
    <button class="btn btn-secondary" onclick="goRegister()">I'm a New Member — Register</button>
    <div class="back-link" style="margin-top:20px">
      <a href="/">Back to Sign In</a>
    </div>
  </div>

  <!-- Step 2A: Existing member — send code -->
  <div class="step" id="step-found">
    <div class="info-box" id="found-info"></div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
      We'll send a 6-digit verification code to your email on file.
    </p>
    <button class="btn btn-primary" onclick="doRequestToken()" id="send-code-btn">Send Verification Code</button>
    <div class="err" id="found-err"></div>
    <div class="back-link"><span onclick="goBack('step-lookup')">← Back</span></div>
  </div>

  <!-- Step 2B: Enter verification code -->
  <div class="step" id="step-verify">
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;text-align:center">
      We sent a code to <strong id="masked-email-display"></strong>.
    </p>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:20px;text-align:center">Check your spam folder if you don't see it within a minute.</p>
    <div class="form-group">
      <label>Verification Code</label>
      <input type="text" id="verify-code" class="code-input" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    </div>
    <div class="form-group">
      <label>New Password (10+ characters)</label>
      <input type="password" id="claim-password" placeholder="Choose a strong password" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label>Confirm Password</label>
      <input type="password" id="claim-password-confirm" placeholder="Repeat your password" autocomplete="new-password">
    </div>
    <button class="btn btn-primary" onclick="doClaim()" id="claim-btn">Claim My Account</button>
    <div class="err" id="verify-err"></div>
    <div class="back-link"><span onclick="resendCode()">Resend code</span> · <span onclick="goBack('step-lookup')">Start over</span></div>
  </div>

  <!-- Step 3: New member registration form -->
  <div class="step" id="step-register">
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px">
      Fill in your details to create a new member account. A club administrator will see your record.
    </p>
    <div class="form-group">
      <label>Callsign (optional)</label>
      <input type="text" id="reg-callsign" placeholder="W4TRC" autocomplete="off" autocorrect="off" autocapitalize="characters" oninput="scheduleCallsignLookup()">
      <span class="hint" id="callsign-hint"></span>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>First Name *</label>
        <input type="text" id="reg-first" placeholder="Jane" autocomplete="given-name">
      </div>
      <div class="form-group">
        <label>Last Name *</label>
        <input type="text" id="reg-last" placeholder="Smith" autocomplete="family-name">
      </div>
    </div>
    <div class="form-group">
      <label>Email Address *</label>
      <input type="email" id="reg-email" placeholder="jane@example.com" autocomplete="email">
    </div>
    <div class="form-group">
      <label>Phone (optional)</label>
      <input type="tel" id="reg-phone" placeholder="(423) 555-0100" autocomplete="tel">
    </div>
    <div class="form-group">
      <label>Password * (10+ characters)</label>
      <input type="password" id="reg-password" placeholder="Choose a strong password" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label>Confirm Password *</label>
      <input type="password" id="reg-password-confirm" placeholder="Repeat your password" autocomplete="new-password">
    </div>
    <button class="btn btn-primary" onclick="doRegister()" id="register-btn">Create My Account</button>
    <div class="err" id="register-err"></div>
    <div class="back-link"><span onclick="goBack('step-lookup')">← Back</span></div>
  </div>

  <!-- Step 4: Success -->
  <div class="step" id="step-success">
    <div class="success-icon">✅</div>
    <h2 style="text-align:center;margin-bottom:8px">You're all set!</h2>
    <p style="text-align:center;color:var(--text-muted);font-size:13px;margin-bottom:24px" id="success-msg">Your account has been created. Redirecting…</p>
    <a href="/" class="btn btn-primary" style="text-decoration:none">Go to My Portal</a>
  </div>
</div>

<script>
const state = { memberId: null, tokenId: null, maskedEmail: null };
let callsignTimer = null;

// ── Redirect if already logged in ─────────────────────────────────────────
(async () => {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (r.ok) window.location.href = '/';
  } catch {}
})();

// ── Step navigation ───────────────────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goBack(stepId) { showStep(stepId); }

function goRegister() { showStep('step-register'); }

// ── Step 1: Lookup ────────────────────────────────────────────────────────
async function doLookup() {
  const identifier = document.getElementById('lookup-identifier').value.trim();
  const err = document.getElementById('lookup-err');
  err.textContent = '';
  if (!identifier) { err.textContent = 'Please enter your callsign or email.'; return; }

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> Looking up…';

  try {
    const resp = await fetch('/api/portal/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    const data = await resp.json();

    if (!resp.ok) { err.textContent = data.error || 'Lookup failed.'; return; }

    if (!data.found) {
      // Pre-fill callsign if they entered one
      if (!identifier.includes('@')) document.getElementById('reg-callsign').value = identifier.toUpperCase();
      showStep('step-register');
      return;
    }

    if (data.alreadyClaimed) {
      err.innerHTML = 'This account has already been claimed. <a href="/">Sign in here</a>.';
      return;
    }

    if (!data.hasEmail) {
      err.textContent = 'No email on file for this callsign. Please contact a club administrator to claim your account.';
      return;
    }

    state.memberId = data.memberId;
    const callsign = data.callsign ? \`<span class="call">\${data.callsign}</span> — \` : '';
    document.getElementById('found-info').innerHTML = \`
      \${callsign}<strong>\${escHtml(data.firstName)}</strong><br>
      <span style="color:var(--text-muted);font-size:12px;margin-top:4px;display:block">
        We'll send a code to \${escHtml(data.maskedEmail)}
      </span>
    \`;
    state.maskedEmail = data.maskedEmail;
    showStep('step-found');
  } catch (e) {
    err.textContent = 'Network error. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find My Record';
  }
}

document.getElementById('lookup-identifier').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLookup();
});

// ── Step 2A: Request token ─────────────────────────────────────────────────
async function doRequestToken() {
  const err = document.getElementById('found-err');
  err.textContent = '';
  const btn = document.getElementById('send-code-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> Sending…';

  try {
    const resp = await fetch('/api/portal/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: state.memberId }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Failed to send code.'; return; }

    state.tokenId     = data.tokenId;
    state.maskedEmail = data.maskedEmail;
    document.getElementById('masked-email-display').textContent = data.maskedEmail;
    showStep('step-verify');
  } catch (e) {
    err.textContent = 'Network error. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Verification Code';
  }
}

async function resendCode() {
  const err = document.getElementById('verify-err');
  err.textContent = '';
  try {
    const resp = await fetch('/api/portal/request-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: state.memberId }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Failed to resend.'; return; }
    state.tokenId = data.tokenId;
    err.style.color = 'var(--success)';
    err.textContent = 'Code resent! Check your email.';
    setTimeout(() => { err.textContent = ''; err.style.color = ''; }, 4000);
  } catch { err.textContent = 'Network error.'; }
}

// ── Step 2B: Claim ────────────────────────────────────────────────────────
async function doClaim() {
  const code     = document.getElementById('verify-code').value.trim();
  const password = document.getElementById('claim-password').value;
  const confirm  = document.getElementById('claim-password-confirm').value;
  const err      = document.getElementById('verify-err');
  err.textContent = '';
  err.style.color = '';

  if (!code || code.length !== 6) { err.textContent = 'Please enter the 6-digit code.'; return; }
  if (!password) { err.textContent = 'Please choose a password.'; return; }
  if (password.length < 10) { err.textContent = 'Password must be at least 10 characters.'; return; }
  if (password !== confirm)  { err.textContent = 'Passwords do not match.'; return; }

  const btn = document.getElementById('claim-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> Claiming account…';

  try {
    const resp = await fetch('/api/portal/claim', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenId: state.tokenId, code, password }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Claim failed.'; return; }

    document.getElementById('success-msg').textContent = 'Your account has been claimed successfully. Redirecting…';
    showStep('step-success');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  } catch (e) {
    err.textContent = 'Network error. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Claim My Account';
  }
}

document.getElementById('verify-code').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\\D/g, '').slice(0, 6);
});

// ── Step 3: Register ──────────────────────────────────────────────────────
function scheduleCallsignLookup() {
  clearTimeout(callsignTimer);
  const cs = document.getElementById('reg-callsign').value.trim().toUpperCase().replace(/[^A-Z0-9\\/]/g, '');
  const hint = document.getElementById('callsign-hint');
  if (cs.length < 3) { hint.textContent = ''; return; }
  hint.textContent = 'Looking up…';
  callsignTimer = setTimeout(() => lookupCallsign(cs), 700);
}

async function lookupCallsign(cs) {
  const hint = document.getElementById('callsign-hint');
  try {
    const resp = await fetch('/api/portal/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: cs }),
    });
    const data = await resp.json();
    if (!resp.ok) { hint.textContent = ''; return; }

    if (data.found) {
      // Already in DB — redirect to claim flow
      hint.style.color = 'var(--warn)';
      hint.textContent = 'This callsign is already in our system. Use "Find My Record" above.';
      return;
    }

    // Try HamDB to auto-fill
    const hamResp = await fetch('/api/lookup/' + cs, { credentials: 'include' }).catch(() => null);
    if (hamResp?.ok) {
      const ham = await hamResp.json();
      if (ham.found) {
        if (!document.getElementById('reg-first').value) document.getElementById('reg-first').value = ham.first_name || '';
        if (!document.getElementById('reg-last').value)  document.getElementById('reg-last').value  = ham.last_name  || '';
        hint.style.color = 'var(--success)';
        hint.textContent = 'Found! License class: ' + (ham.license_class || 'Unknown');
      } else {
        hint.style.color = 'var(--text-muted)';
        hint.textContent = 'Callsign not found in FCC database.';
      }
    } else {
      hint.textContent = '';
    }
  } catch { hint.textContent = ''; }
}

async function doRegister() {
  const callsign = document.getElementById('reg-callsign').value.trim();
  const first    = document.getElementById('reg-first').value.trim();
  const last     = document.getElementById('reg-last').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const phone    = document.getElementById('reg-phone').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-password-confirm').value;
  const err      = document.getElementById('register-err');
  err.textContent = '';

  if (!first || !last)  { err.textContent = 'First and last name are required.'; return; }
  if (!email)           { err.textContent = 'Email address is required.'; return; }
  if (!password)        { err.textContent = 'Please choose a password.'; return; }
  if (password.length < 10) { err.textContent = 'Password must be at least 10 characters.'; return; }
  if (password !== confirm)  { err.textContent = 'Passwords do not match.'; return; }

  const btn = document.getElementById('register-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-inline"></span> Creating account…';

  try {
    const resp = await fetch('/api/portal/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callsign: callsign || null, firstName: first, lastName: last, email, phone: phone || null, password }),
    });
    const data = await resp.json();
    if (!resp.ok) { err.textContent = data.error || 'Registration failed.'; return; }

    document.getElementById('success-msg').textContent = 'Welcome to the KARC member portal! Redirecting…';
    showStep('step-success');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  } catch (e) {
    err.textContent = 'Network error. Please try again.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create My Account';
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>
</body>
</html>`;
}

// ── GET /directory ────────────────────────────────────────────────────────────

export async function handleDirectoryPage(request, env) {
  const { results } = await env.DB.prepare(`
    SELECT callsign, first_name, last_name, license_class, city, state, interests
    FROM members
    WHERE show_in_directory = 1 AND is_active = 1 AND is_silent_key = 0
    ORDER BY callsign ASC
  `).all();

  const html = directoryPageHtml(results);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300', // 5-minute public cache OK
    },
  });
}

function directoryPageHtml(members) {
  const year = new Date().getFullYear();
  const count = members.length;

  const rows = members.map(m => {
    const name      = `${esc(m.first_name)} ${esc(m.last_name)}`;
    const callsign  = m.callsign || '—';
    const cls       = m.license_class || '—';
    const location  = [m.city, m.state].filter(Boolean).join(', ') || '—';
    const interests = m.interests || '—';
    return `<tr>
      <td class="call">${esc(callsign)}</td>
      <td>${name}</td>
      <td>${esc(cls)}</td>
      <td>${esc(location)}</td>
      <td class="interests">${esc(interests)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KARC Member Directory ${year}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e8eaf0; min-height: 100vh; padding: 32px 24px; font-size: 14px; }
.header { max-width: 900px; margin: 0 auto 32px; }
.header .call { font-family: 'Courier New', monospace; font-size: 32px; color: #3b7dd8; font-weight: bold; letter-spacing: .08em; }
.header h1 { font-size: 20px; font-weight: 600; margin-top: 4px; }
.header p { color: #8892aa; font-size: 13px; margin-top: 6px; }
.wrap { max-width: 900px; margin: 0 auto; background: #181c27; border: 1px solid #2a3050; border-radius: 8px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 14px; font-size: 11px; color: #8892aa; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #2a3050; }
td { padding: 11px 14px; border-bottom: 1px solid rgba(42,48,80,.4); font-size: 13px; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #1f2438; }
.call { font-family: 'Courier New', monospace; font-weight: bold; color: #3b7dd8; font-size: 13px; letter-spacing: .05em; }
.interests { color: #8892aa; font-size: 12px; }
.empty { text-align: center; padding: 40px; color: #8892aa; }
.footer { text-align: center; padding: 24px; color: #555f7a; font-size: 12px; }
.opt-in-note { max-width: 900px; margin: 0 auto 24px; background: rgba(59,125,216,.08); border: 1px solid rgba(59,125,216,.25); border-radius: 8px; padding: 14px 18px; font-size: 13px; color: #8892aa; }
.opt-in-note strong { color: #e8eaf0; }
</style>
</head>
<body>
<div class="header">
  <img src="/logo.png" alt="KARC" style="height:56px;margin-bottom:8px;display:block">
  <div class="call">W4TRC</div>
  <h1>Member Directory — ${year}</h1>
  <p>Kingsport Amateur Radio Club &mdash; ${count} member${count !== 1 ? 's' : ''} listed</p>
</div>

<div class="opt-in-note">
  <strong>This is an opt-in directory.</strong> Members control their own visibility from the <a href="/" style="color:#3b7dd8">Member Portal</a> under My Profile.
</div>

<div class="wrap">
${count === 0 ? `
  <div class="empty">No members have opted into the public directory yet.</div>
` : `
  <table>
    <thead>
      <tr>
        <th>Callsign</th>
        <th>Name</th>
        <th>License</th>
        <th>Location</th>
        <th>Interests</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
`}
</div>

<div class="footer">
  Members: <a href="/" style="color:#3b7dd8">members.w4trc.org</a>
</div>
</body>
</html>`;
}
