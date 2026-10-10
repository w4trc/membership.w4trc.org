/**
 * Meeting attendance routes (board+)
 * GET    /api/meetings              - list meetings with attendee counts (optional ?year=YYYY)
 * GET    /api/meetings/:id          - meeting with attendee list
 * POST   /api/meetings/resolve      - look up callsigns (members → local hams → HamDB) without saving
 * POST   /api/meetings              - record a meeting and its attendees
 * PUT    /api/meetings/:id          - update a meeting; replaces its attendee list
 * DELETE /api/meetings/:id          - delete a meeting (admin only)
 *
 * Attendee input: { callsigns: "W4TRC, KN4ABC\nKQ4XYZ" | [..], guests: ["Jane Doe", ..] }
 */

import { isBoardOrAbove, isAdmin } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { fetchHamDB } from './lookup.js';

const MEETING_TYPES = ['monthly', 'board', 've_session', 'field_day', 'special', 'other'];
const MAX_HAMDB_LOOKUPS = 25;

export async function handleMeetings(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  const id       = segments[3];

  if (id === 'resolve' && method === 'POST') return resolveRequest(request, env);
  if (!id) {
    if (method === 'GET')  return listMeetings(env, url);
    if (method === 'POST') return createMeeting(request, env, user);
  } else {
    const meetingId = parseInt(id, 10);
    if (!meetingId) return jsonError('Not found', 404);
    if (method === 'GET')    return getMeeting(env, meetingId);
    if (method === 'PUT')    return updateMeeting(request, env, user, meetingId);
    if (method === 'DELETE') return deleteMeeting(request, env, user, meetingId);
  }

  return jsonError('Method not allowed', 405);
}

// ── Callsign resolution ──────────────────────────────────────────────────────

export function parseCallsigns(input) {
  const raw = Array.isArray(input) ? input.join(' ') : String(input || '');
  const seen = new Set();
  const out  = [];
  for (const tok of raw.toUpperCase().split(/[\s,;]+/)) {
    // Portable indicators (K1ABC/P, VE3/K1ABC): keep the longest part, the base call
    const base = tok.split('/').reduce((a, b) => (b.length > a.length ? b : a), '');
    const call = base.replace(/[^A-Z0-9]/g, '');
    if (call.length < 3 || call.length > 7 || !/\d/.test(call) || seen.has(call)) continue;
    seen.add(call);
    out.push(call);
  }
  return out;
}

function parseGuests(input) {
  const list = Array.isArray(input) ? input : String(input || '').split('\n');
  const seen = new Set();
  return list
    .map(n => String(n).trim().replace(/\s+/g, ' '))
    .filter(n => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

// Returns [{ callsign, source: 'member'|'local_ham'|'hamdb'|'not_found', member_id, name }]
async function resolveCallsigns(env, callsigns) {
  if (!callsigns.length) return [];

  const placeholders = callsigns.map(() => '?').join(',');
  const [members, prospects] = await Promise.all([
    env.DB.prepare(`SELECT id, callsign, first_name, last_name FROM members WHERE callsign IN (${placeholders})`)
      .bind(...callsigns).all(),
    env.DB.prepare(`SELECT callsign, first_name, last_name FROM prospects WHERE UPPER(callsign) IN (${placeholders})`)
      .bind(...callsigns).all(),
  ]);

  const memberBy   = new Map(members.results.map(r => [r.callsign.toUpperCase(), r]));
  const prospectBy = new Map(prospects.results.map(r => [r.callsign.toUpperCase(), r]));
  const fullName   = r => [r.first_name, r.last_name].filter(Boolean).join(' ') || null;

  const missing = callsigns.filter(c => !memberBy.has(c) && !prospectBy.has(c)).slice(0, MAX_HAMDB_LOOKUPS);
  const hamdb = new Map(await Promise.all(missing.map(async c => {
    try { return [c, await fetchHamDB(c)]; } catch { return [c, null]; }
  })));

  return callsigns.map(callsign => {
    const m = memberBy.get(callsign);
    if (m) return { callsign, source: 'member', member_id: m.id, name: fullName(m) };
    const p = prospectBy.get(callsign);
    if (p) return { callsign, source: 'local_ham', member_id: null, name: fullName(p) };
    const h = hamdb.get(callsign);
    if (h?.found) return { callsign, source: 'hamdb', member_id: null, name: fullName(h) };
    return { callsign, source: 'not_found', member_id: null, name: null };
  });
}

async function resolveRequest(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  return jsonResponse({ attendees: await resolveCallsigns(env, parseCallsigns(body.callsigns)) });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

async function listMeetings(env, url) {
  const year = url.searchParams.get('year');
  const where  = year ? "WHERE strftime('%Y', mt.meeting_date) = ?" : '';
  const params = year ? [year.replace(/\D/g, '')] : [];

  const { results } = await env.DB.prepare(`
    SELECT mt.*,
      COUNT(a.id)                                                          AS total_count,
      SUM(CASE WHEN a.member_id IS NOT NULL THEN 1 ELSE 0 END)             AS member_count,
      SUM(CASE WHEN a.member_id IS NULL AND a.callsign IS NOT NULL THEN 1 ELSE 0 END) AS visitor_count,
      SUM(CASE WHEN a.callsign IS NULL THEN 1 ELSE 0 END)                  AS guest_count
    FROM meetings mt
    LEFT JOIN meeting_attendees a ON a.meeting_id = mt.id
    ${where}
    GROUP BY mt.id
    ORDER BY mt.meeting_date DESC, mt.id DESC
  `).bind(...params).all();

  return jsonResponse({ meetings: results });
}

async function getMeeting(env, id) {
  const meeting = await env.DB.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first();
  if (!meeting) return jsonError('Not found', 404);

  const { results } = await env.DB.prepare(`
    SELECT a.id, a.member_id, a.callsign, a.name, m.is_active
    FROM meeting_attendees a
    LEFT JOIN members m ON m.id = a.member_id
    WHERE a.meeting_id = ?
    ORDER BY a.callsign IS NULL, a.member_id IS NULL, a.callsign, a.name
  `).bind(id).all();

  return jsonResponse({ meeting, attendees: results });
}

function validateMeeting(body) {
  if (!body.meeting_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.meeting_date)) return 'meeting_date (YYYY-MM-DD) is required';
  if (!MEETING_TYPES.includes(body.meeting_type)) return 'meeting_type must be one of: ' + MEETING_TYPES.join(', ');
  return null;
}

async function attendeeStatements(env, meetingId, body) {
  const resolved = await resolveCallsigns(env, parseCallsigns(body.callsigns));
  const guests   = parseGuests(body.guests);
  const insert   = `INSERT INTO meeting_attendees (meeting_id, member_id, callsign, name) VALUES (?, ?, ?, ?)`;
  return {
    resolved,
    guests,
    statements: [
      ...resolved.map(r => env.DB.prepare(insert).bind(meetingId, r.member_id, r.callsign, r.name)),
      ...guests.map(n => env.DB.prepare(insert).bind(meetingId, null, null, n)),
    ],
  };
}

async function createMeeting(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const err = validateMeeting(body);
  if (err) return jsonError(err, 400);

  const result = await env.DB.prepare(`
    INSERT INTO meetings (meeting_type, meeting_date, title, notes, recorded_by) VALUES (?, ?, ?, ?, ?)
  `).bind(body.meeting_type, body.meeting_date, body.title?.trim() || null, body.notes?.trim() || null, user.id).run();
  const id = result.meta.last_row_id;

  const { resolved, guests, statements } = await attendeeStatements(env, id, body);
  if (statements.length) await env.DB.batch(statements);

  await audit(env, {
    userId: user.id, action: 'meeting.create', targetType: 'meeting', targetId: id,
    detail: { meeting_date: body.meeting_date, meeting_type: body.meeting_type, hams: resolved.length, guests: guests.length },
    request,
  });

  return getMeeting(env, id);
}

async function updateMeeting(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT id FROM meetings WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const err = validateMeeting(body);
  if (err) return jsonError(err, 400);

  const { resolved, guests, statements } = await attendeeStatements(env, id, body);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE meetings SET meeting_type = ?, meeting_date = ?, title = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(body.meeting_type, body.meeting_date, body.title?.trim() || null, body.notes?.trim() || null, id),
    env.DB.prepare(`DELETE FROM meeting_attendees WHERE meeting_id = ?`).bind(id),
    ...statements,
  ]);

  await audit(env, {
    userId: user.id, action: 'meeting.update', targetType: 'meeting', targetId: id,
    detail: { meeting_date: body.meeting_date, meeting_type: body.meeting_type, hams: resolved.length, guests: guests.length },
    request,
  });

  return getMeeting(env, id);
}

async function deleteMeeting(request, env, user, id) {
  if (!isAdmin(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM meeting_attendees WHERE meeting_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM meetings WHERE id = ?`).bind(id),
  ]);

  await audit(env, {
    userId: user.id, action: 'meeting.delete', targetType: 'meeting', targetId: id,
    detail: { meeting_date: existing.meeting_date, meeting_type: existing.meeting_type },
    request,
  });

  return jsonResponse({ deleted: true });
}
