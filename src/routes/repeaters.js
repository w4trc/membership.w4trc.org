/**
 * Club repeater routes (board+)
 * GET    /api/repeaters                          - every repeater with open reports, last visit, and what is coming due
 * POST   /api/repeaters                          - add a repeater
 * GET    /api/repeaters/:id                      - one repeater with its visits, reports, maintenance, notes, photos, documents
 * PATCH  /api/repeaters/:id                      - change repeater fields; only the fields sent are changed
 * DELETE /api/repeaters/:id                      - delete a repeater and everything on it (admin only)
 *
 * POST   /api/repeaters/:id/visits               - log a site visit { visit_date, time_in, time_out, visitors, purpose, notes }
 * POST   /api/repeaters/:id/reports              - log a report { report_date, category, reported_by, description, status, resolution, resolved_date }
 * POST   /api/repeaters/:id/maintenance          - log maintenance or a renewal { kind, title, done_date, next_due, done_by, cost, notes }
 * POST   /api/repeaters/:id/notes                - add a site note { note, pinned }
 * PATCH  /api/repeaters/:id/<list>/:entryId      - change an entry in any of the four lists above
 * DELETE /api/repeaters/:id/<list>/:entryId
 *
 * POST   /api/repeaters/:id/photos               - add a site photo { image, thumb, caption, taken_date } (JPEG data URLs)
 * GET    /api/repeaters/:id/photos/:photoId      - the photo (?size=thumb for the small one)
 * PATCH  /api/repeaters/:id/photos/:photoId      - { caption, taken_date }
 * DELETE /api/repeaters/:id/photos/:photoId
 *
 * POST   /api/repeaters/:id/documents            - JSON { title, kind, url } adds a link; any other body is a
 *                                                  file upload, named by ?title=&kind=&filename=
 * GET    /api/repeaters/:id/documents/:docId     - download an uploaded file
 * PATCH  /api/repeaters/:id/documents/:docId     - { title, kind }
 * DELETE /api/repeaters/:id/documents/:docId
 *
 * The screen PIN is in the repeater record. Every route here is board-only;
 * the MCP tools leave the PIN out.
 */

import { isBoardOrAbove, isAdmin } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { clubToday } from '../lib/clubDate.js';

export const REPEATER_STATUSES  = ['active', 'testing', 'offline', 'planned', 'retired'];
export const REPORT_CATEGORIES  = ['noise', 'interference', 'unlicensed', 'kerchunking', 'conduct', 'outage', 'audio', 'coverage', 'other'];
export const REPORT_STATUSES    = ['open', 'investigating', 'resolved'];
export const MAINTENANCE_KINDS  = ['maintenance', 'repair', 'upgrade', 'inspection', 'listing', 'coordination', 'license', 'lease', 'insurance', 'other'];
export const DOCUMENT_KINDS     = ['manual', 'programming', 'license', 'agreement', 'diagram', 'other'];

const MAX_TEXT = 5000;
// D1 caps a row at 2 MB; the browser resizes well under this before uploading
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_THUMB_BYTES = 100_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Files the browser may show in the page; anything else is sent as a download
const INLINE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'text/plain']);
// Within 60 days counts as coming due
export const DUE_SOON_DAYS = 60;

export async function handleRepeaters(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const method = request.method;
  const url    = new URL(request.url);
  const [, , , rawId, sub, rawSubId, extra] = path.split('/');
  if (extra !== undefined) return jsonError('Not found', 404);

  if (!rawId) {
    if (method === 'GET')  return listRepeaters(env);
    if (method === 'POST') return createRepeater(request, env, user);
    return jsonError('Method not allowed', 405);
  }

  const id = parseInt(rawId, 10);
  if (!id || String(id) !== rawId) return jsonError('Not found', 404);
  const repeater = await env.DB.prepare(`SELECT * FROM repeaters WHERE id = ?`).bind(id).first();
  if (!repeater) return jsonError('Not found', 404);

  const subId = rawSubId ? parseInt(rawSubId, 10) : null;
  if (rawSubId && !subId) return jsonError('Not found', 404);
  const ctx = { request, env, user, repeater, url };

  if (!sub) {
    if (method === 'GET')    return jsonResponse(await repeaterData(env, id));
    if (method === 'PATCH')  return updateRepeater(ctx);
    if (method === 'DELETE') return deleteRepeater(ctx);
    return jsonError('Method not allowed', 405);
  }

  const list = LISTS[sub];
  if (list) {
    if (method === 'POST'   && !subId) return createEntry(ctx, list);
    if (method === 'PATCH'  && subId)  return updateEntry(ctx, list, subId);
    if (method === 'DELETE' && subId)  return deleteEntry(ctx, list, subId);
    return jsonError('Method not allowed', 405);
  }
  if (sub === 'photos') {
    if (method === 'POST'   && !subId) return addPhoto(ctx);
    if (method === 'GET'    && subId)  return getPhoto(ctx, subId);
    if (method === 'PATCH'  && subId)  return updatePhoto(ctx, subId);
    if (method === 'DELETE' && subId)  return deletePhoto(ctx, subId);
    return jsonError('Method not allowed', 405);
  }
  if (sub === 'documents') {
    if (method === 'POST'   && !subId) return addDocument(ctx);
    if (method === 'GET'    && subId)  return getDocument(ctx, subId);
    if (method === 'PATCH'  && subId)  return updateDocument(ctx, subId);
    if (method === 'DELETE' && subId)  return deleteDocument(ctx, subId);
    return jsonError('Method not allowed', 405);
  }
  return jsonError('Not found', 404);
}

// ── Field rules ──────────────────────────────────────────────────────────────

function text(name, { required = false, max = MAX_TEXT } = {}) {
  return (v) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (required && !s) return { error: `${name} is required` };
    if (s.length > max) return { error: `${name} is too long` };
    return { value: s || null };
  };
}

function day(name, { required = false } = {}) {
  return (v) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (!s) return required ? { error: `${name} is required` } : { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) return { error: `${name} must be a date (YYYY-MM-DD)` };
    return { value: s };
  };
}

function time(name) {
  return (v) => {
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (!s) return { value: null };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return { error: `${name} must be a time (HH:MM)` };
    return { value: s };
  };
}

function oneOf(name, options, { fallback } = {}) {
  return (v) => {
    if ((v === null || v === undefined || v === '') && fallback) return { value: fallback };
    return options.includes(v) ? { value: v } : { error: `${name} must be one of: ${options.join(', ')}` };
  };
}

// A frequency in MHz, kept as typed (146.970), so trailing zeros stay put
function freq(name) {
  return (v) => {
    const s = v === null || v === undefined ? '' : String(v).trim().replace(/\s*mhz$/i, '');
    if (!s) return { value: null };
    if (!/^\d{1,4}(\.\d{1,6})?$/.test(s) || Number(s) <= 0) return { error: `${name} must be a frequency in MHz, e.g. 146.970` };
    return { value: s };
  };
}

function money(name) {
  return (v) => {
    if (v === null || v === undefined || v === '') return { value: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: `${name} must be a number, zero or more` };
    return { value: Math.round(n * 100) / 100 };
  };
}

const flag = () => (v) => ({ value: v ? 1 : 0 });

function sortOrder(v) {
  if (v === null || v === undefined || v === '') return { value: 0 };
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 9999) return { error: 'sort_order must be a whole number' };
  return { value: n };
}

/** Run `rules` ({ column: (value) => { value } | { error } }) over the keys present in body (or all of them). */
function pick(body, rules, { all = false } = {}) {
  const values = {};
  for (const [col, rule] of Object.entries(rules)) {
    if (!all && !(col in body)) continue;
    const r = rule(body[col]);
    if (r.error) return { error: r.error };
    values[col] = r.value;
  }
  return { values };
}

async function readJson(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

const REPEATER_RULES = {
  name:         text('Name', { required: true, max: 100 }),
  callsign:     (v) => { const r = text('Callsign', { max: 20 })(v); return r.value ? { value: r.value.toUpperCase() } : r; },
  status:       oneOf('status', REPEATER_STATUSES, { fallback: 'active' }),
  band:         text('Band', { max: 40 }),
  mode:         text('Mode', { max: 60 }),
  output_freq:  freq('Output frequency'),
  input_freq:   freq('Input frequency'),
  tone_in:      text('Access tone', { max: 40 }),
  tone_out:     text('Repeater tone', { max: 40 }),
  digital_info: text('Digital settings'),
  screen_pin:   text('Screen PIN', { max: 40 }),
  equipment:    text('Equipment'),
  antenna:      text('Antenna'),
  power:        text('Power', { max: 60 }),
  site_name:    text('Site name', { max: 200 }),
  site_address: text('Site address', { max: 500 }),
  site_access:  text('Site access'),
  notes:        text('Notes'),
  sort_order:   sortOrder,
};

// The four dated lists on a repeater share create/update/delete
const LISTS = {
  visits: {
    table: 'repeater_visits', label: 'visit', orderBy: 'e.visit_date DESC, e.id DESC',
    rules: {
      visit_date: day('Visit date', { required: true }),
      time_in:    time('Time in'),
      time_out:   time('Time out'),
      visitors:   text('Who visited', { required: true, max: 500 }),
      purpose:    text('Reason for the visit', { required: true, max: 500 }),
      notes:      text('Notes'),
    },
    defaults: () => ({ visit_date: clubToday() }),
    summary: (e) => ({ visit_date: e.visit_date, visitors: e.visitors, purpose: e.purpose }),
  },
  reports: {
    table: 'repeater_reports', label: 'report', orderBy: "CASE e.status WHEN 'resolved' THEN 1 ELSE 0 END, e.report_date DESC, e.id DESC",
    rules: {
      report_date:   day('Report date', { required: true }),
      category:      oneOf('category', REPORT_CATEGORIES),
      reported_by:   text('Reported by', { max: 200 }),
      description:   text('Description', { required: true }),
      status:        oneOf('status', REPORT_STATUSES, { fallback: 'open' }),
      resolution:    text('Resolution'),
      resolved_date: day('Resolved date'),
    },
    defaults: () => ({ report_date: clubToday(), status: 'open' }),
    // A resolved report keeps its resolved date, or is dated today; reopening clears it
    adjust: (values, existing) => {
      if (!('status' in values) && !('resolved_date' in values)) return;
      const status = values.status ?? existing?.status;
      if (status === 'resolved') values.resolved_date = values.resolved_date || existing?.resolved_date || clubToday();
      else values.resolved_date = null;
    },
    summary: (e) => ({ report_date: e.report_date, category: e.category, status: e.status }),
  },
  maintenance: {
    table: 'repeater_maintenance', label: 'maintenance', orderBy: 'COALESCE(e.done_date, e.next_due) DESC, e.id DESC',
    rules: {
      kind:      oneOf('kind', MAINTENANCE_KINDS),
      title:     text('Title', { required: true, max: 200 }),
      done_date: day('Date done'),
      next_due:  day('Next due'),
      done_by:   text('Done by', { max: 200 }),
      cost:      money('Cost'),
      notes:     text('Notes'),
    },
    defaults: () => ({}),
    check: (values) => (!values.done_date && !values.next_due ? 'Give the date it was done, the date it is next due, or both' : null),
    summary: (e) => ({ kind: e.kind, title: e.title, done_date: e.done_date, next_due: e.next_due }),
  },
  notes: {
    table: 'repeater_notes', label: 'note', orderBy: 'e.pinned DESC, e.created_at DESC, e.id DESC',
    rules: {
      note:   text('Note', { required: true }),
      pinned: flag(),
    },
    defaults: () => ({ pinned: 0 }),
    summary: (e) => ({ note: e.note.length > 80 ? e.note.slice(0, 77) + '…' : e.note }),
  },
};

// Who did something, as a short label: the member's callsign, else the login email
const WHO = (a) => `COALESCE(${a}m.callsign, ${a}u.email)`;
const whoJoin = (a, col) => `LEFT JOIN users ${a}u ON ${a}u.id = ${col} LEFT JOIN members ${a}m ON ${a}m.id = ${a}u.member_id`;

const touch = (env, id) => env.DB.prepare(`UPDATE repeaters SET updated_at = datetime('now') WHERE id = ?`).bind(id);

function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Maintenance and renewals still to do: the latest entry of each kind and
 * title on a repeater, when it has a next-due date. A newer entry for the same
 * thing (the renewal being done again) replaces the older one's due date.
 */
function dueSql(where = '') {
  return `
    SELECT x.id, x.repeater_id, r.name AS repeater_name, x.kind, x.title, x.done_date, x.next_due FROM (
      SELECT mt.*, ROW_NUMBER() OVER (
        PARTITION BY mt.repeater_id, mt.kind, LOWER(mt.title)
        ORDER BY COALESCE(mt.done_date, date(mt.created_at)) DESC, mt.id DESC
      ) AS rn
      FROM repeater_maintenance mt
    ) x JOIN repeaters r ON r.id = x.repeater_id
    WHERE x.rn = 1 AND x.next_due IS NOT NULL ${where}
    ORDER BY x.next_due, r.sort_order, r.id
  `;
}

// Maintenance and renewals overdue or due within DUE_SOON_DAYS of `today`, on repeaters still in use
const comingDueStatement = (env, today) =>
  env.DB.prepare(dueSql(`AND x.next_due <= ? AND r.status != 'retired'`)).bind(addDays(today, DUE_SOON_DAYS));

/** What is coming due across every repeater, soonest first. Used by the weekly roundup. */
export async function repeatersComingDue(env, today = clubToday()) {
  const { results } = await comingDueStatement(env, today).all();
  return results;
}

// ── Repeaters ────────────────────────────────────────────────────────────────

async function listRepeaters(env) {
  const today = clubToday();
  const [repeaters, due] = await env.DB.batch([
    env.DB.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM repeater_reports x WHERE x.repeater_id = r.id AND x.status != 'resolved') AS open_reports,
        (SELECT MAX(visit_date) FROM repeater_visits x WHERE x.repeater_id = r.id) AS last_visit,
        (SELECT COUNT(*) FROM repeater_photos x WHERE x.repeater_id = r.id) AS photo_count,
        (SELECT COUNT(*) FROM repeater_documents x WHERE x.repeater_id = r.id) AS document_count
      FROM repeaters r
      ORDER BY r.status = 'retired', r.sort_order, r.id
    `),
    comingDueStatement(env, today),
  ]);
  return jsonResponse({ repeaters: repeaters.results, due: due.results, today, due_soon_days: DUE_SOON_DAYS });
}

async function createRepeater(request, env, user) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick(body, REPEATER_RULES, { all: true });
  if (error) return jsonError(error, 400);
  if (!('sort_order' in body)) {
    const row = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM repeaters`).first();
    values.sort_order = row.n;
  }
  const cols = Object.keys(values);
  const r = await env.DB.prepare(`
    INSERT INTO repeaters (${cols.join(', ')}, created_by) VALUES (${cols.map(() => '?').join(', ')}, ?)
  `).bind(...Object.values(values), user.id).run();
  const id = r.meta.last_row_id;
  await audit(env, {
    userId: user.id, action: 'repeater.create', targetType: 'repeater', targetId: id,
    detail: { name: values.name, output_freq: values.output_freq }, request,
  });
  return jsonResponse(await repeaterData(env, id), 201);
}

/** Everything on one repeater. */
export async function repeaterData(env, id) {
  const [repeater, visits, reports, maintenance, notes, photos, documents, due] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM repeaters WHERE id = ?`).bind(id),
    ...['visits', 'reports', 'maintenance', 'notes'].map(key => {
      const l = LISTS[key];
      return env.DB.prepare(`
        SELECT e.*, ${WHO('c')} AS added_by FROM ${l.table} e ${whoJoin('c', 'e.created_by')}
        WHERE e.repeater_id = ? ORDER BY ${l.orderBy}
      `).bind(id);
    }),
    env.DB.prepare(`
      SELECT p.id, p.caption, p.taken_date, p.created_at, ${WHO('c')} AS added_by
      FROM repeater_photos p ${whoJoin('c', 'p.created_by')}
      WHERE p.repeater_id = ? ORDER BY COALESCE(p.taken_date, date(p.created_at)) DESC, p.id DESC
    `).bind(id),
    env.DB.prepare(`
      SELECT d.id, d.title, d.kind, d.url, d.filename, d.content_type, d.size, d.created_at, ${WHO('c')} AS added_by
      FROM repeater_documents d ${whoJoin('c', 'd.created_by')}
      WHERE d.repeater_id = ? ORDER BY d.kind, d.title COLLATE NOCASE, d.id
    `).bind(id),
    env.DB.prepare(dueSql('AND x.repeater_id = ?')).bind(id),
  ]);
  if (!repeater.results[0]) return null;
  return {
    repeater: repeater.results[0],
    visits: visits.results,
    reports: reports.results,
    maintenance: maintenance.results,
    notes: notes.results,
    photos: photos.results,
    documents: documents.results,
    due: due.results,
    today: clubToday(),
    due_soon_days: DUE_SOON_DAYS,
  };
}

async function updateRepeater({ request, env, user, repeater }) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick(body, REPEATER_RULES);
  if (error) return jsonError(error, 400);
  const cols = Object.keys(values);
  if (!cols.length) return jsonError('Nothing to change', 400);
  await env.DB.prepare(`
    UPDATE repeaters SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?
  `).bind(...Object.values(values), repeater.id).run();
  const changed = cols.filter(c => (values[c] ?? null) !== (repeater[c] ?? null));
  if (changed.length) {
    await audit(env, {
      userId: user.id, action: 'repeater.update', targetType: 'repeater', targetId: repeater.id,
      detail: { name: values.name ?? repeater.name, changed }, request,
    });
  }
  return jsonResponse(await repeaterData(env, repeater.id));
}

async function deleteRepeater({ request, env, user, repeater }) {
  if (!isAdmin(user)) return jsonError('Forbidden', 403);
  const { results: files } = await env.DB.prepare(
    `SELECT r2_key FROM repeater_documents WHERE repeater_id = ? AND r2_key IS NOT NULL`
  ).bind(repeater.id).all();
  if (files.length) {
    if (!env.BACKUP_BUCKET) return jsonError('File storage is not configured', 503);
    await env.BACKUP_BUCKET.delete(files.map(f => f.r2_key));
  }
  const del = (table) => env.DB.prepare(`DELETE FROM ${table} WHERE repeater_id = ?`).bind(repeater.id);
  await env.DB.batch([
    ...['repeater_visits', 'repeater_reports', 'repeater_maintenance', 'repeater_notes', 'repeater_photos', 'repeater_documents'].map(del),
    env.DB.prepare(`DELETE FROM repeaters WHERE id = ?`).bind(repeater.id),
  ]);
  await audit(env, {
    userId: user.id, action: 'repeater.delete', targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, output_freq: repeater.output_freq }, request,
  });
  return jsonResponse({ deleted: true });
}

// ── Visits, reports, maintenance, notes ──────────────────────────────────────

async function createEntry({ request, env, user, repeater }, list) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick({ ...list.defaults(), ...stripEmpty(body) }, list.rules, { all: true });
  if (error) return jsonError(error, 400);
  list.adjust?.(values, null);
  const problem = list.check?.(values);
  if (problem) return jsonError(problem, 400);

  const cols = Object.keys(values);
  const r = await env.DB.prepare(`
    INSERT INTO ${list.table} (repeater_id, ${cols.join(', ')}, created_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
  `).bind(repeater.id, ...Object.values(values), user.id).run();
  const id = r.meta.last_row_id;
  await touch(env, repeater.id).run();
  await audit(env, {
    userId: user.id, action: `repeater.${list.label}.create`, targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, entry_id: id, ...list.summary(values) }, request,
  });
  return jsonResponse(await env.DB.prepare(`SELECT * FROM ${list.table} WHERE id = ?`).bind(id).first(), 201);
}

// Blank optional fields on a new entry fall back to the defaults (today's date, open)
function stripEmpty(body) {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

async function updateEntry({ request, env, user, repeater }, list, entryId) {
  const existing = await env.DB.prepare(`SELECT * FROM ${list.table} WHERE id = ? AND repeater_id = ?`).bind(entryId, repeater.id).first();
  if (!existing) return jsonError('Not found', 404);
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick(body, list.rules);
  if (error) return jsonError(error, 400);
  list.adjust?.(values, existing);
  const cols = Object.keys(values);
  if (!cols.length) return jsonError('Nothing to change', 400);
  const problem = list.check?.({ ...existing, ...values });
  if (problem) return jsonError(problem, 400);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE ${list.table} SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?
    `).bind(...Object.values(values), entryId),
    touch(env, repeater.id),
  ]);
  const updated = await env.DB.prepare(`SELECT * FROM ${list.table} WHERE id = ?`).bind(entryId).first();
  const changed = cols.filter(c => (values[c] ?? null) !== (existing[c] ?? null));
  if (changed.length) {
    await audit(env, {
      userId: user.id, action: `repeater.${list.label}.update`, targetType: 'repeater', targetId: repeater.id,
      detail: { name: repeater.name, entry_id: entryId, changed, ...list.summary(updated) }, request,
    });
  }
  return jsonResponse(updated);
}

async function deleteEntry({ request, env, user, repeater }, list, entryId) {
  const existing = await env.DB.prepare(`SELECT * FROM ${list.table} WHERE id = ? AND repeater_id = ?`).bind(entryId, repeater.id).first();
  if (!existing) return jsonError('Not found', 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${list.table} WHERE id = ?`).bind(entryId),
    touch(env, repeater.id),
  ]);
  await audit(env, {
    userId: user.id, action: `repeater.${list.label}.delete`, targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, entry_id: entryId, ...list.summary(existing) }, request,
  });
  return jsonResponse({ deleted: true });
}

// ── Photos ───────────────────────────────────────────────────────────────────

function decodeJpeg(dataUrl, maxBytes) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match || match[1].length > maxBytes * 1.4) return null;
  let bin;
  try { bin = atob(match[1]); } catch { return null; }
  if (bin.length > maxBytes || bin.charCodeAt(0) !== 0xFF || bin.charCodeAt(1) !== 0xD8) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const PHOTO_RULES = {
  caption:    text('Caption', { max: 500 }),
  taken_date: day('Date taken'),
};

async function addPhoto({ request, env, user, repeater }) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const image = decodeJpeg(body.image, MAX_IMAGE_BYTES);
  const thumb = decodeJpeg(body.thumb, MAX_THUMB_BYTES);
  if (!image || !thumb) return jsonError('Photo must be a JPEG no larger than 1.5 MB', 400);
  const { values, error } = pick(body, PHOTO_RULES, { all: true });
  if (error) return jsonError(error, 400);

  const r = await env.DB.prepare(`
    INSERT INTO repeater_photos (repeater_id, caption, taken_date, image, thumb, created_by) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(repeater.id, values.caption, values.taken_date, image.buffer, thumb.buffer, user.id).run();
  const id = r.meta.last_row_id;
  await touch(env, repeater.id).run();
  await audit(env, {
    userId: user.id, action: 'repeater.photo.create', targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, photo_id: id, caption: values.caption }, request,
  });
  return jsonResponse({ id, caption: values.caption, taken_date: values.taken_date }, 201);
}

async function getPhoto({ env, url, repeater }, photoId) {
  const column = url.searchParams.get('size') === 'thumb' ? 'thumb' : 'image';
  const row = await env.DB.prepare(`SELECT ${column} AS data FROM repeater_photos WHERE id = ? AND repeater_id = ?`)
    .bind(photoId, repeater.id).first();
  if (!row) return jsonError('Not found', 404);
  // A photo never changes once added (only its caption), so it can be cached
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function updatePhoto({ request, env, user, repeater }, photoId) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick(body, PHOTO_RULES);
  if (error) return jsonError(error, 400);
  const cols = Object.keys(values);
  if (!cols.length) return jsonError('Nothing to change', 400);
  const res = await env.DB.prepare(`
    UPDATE repeater_photos SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ? AND repeater_id = ?
  `).bind(...Object.values(values), photoId, repeater.id).run();
  if (!res.meta.changes) return jsonError('Not found', 404);
  return jsonResponse(await env.DB.prepare(`SELECT id, caption, taken_date FROM repeater_photos WHERE id = ?`).bind(photoId).first());
}

async function deletePhoto({ request, env, user, repeater }, photoId) {
  const photo = await env.DB.prepare(`SELECT id, caption FROM repeater_photos WHERE id = ? AND repeater_id = ?`).bind(photoId, repeater.id).first();
  if (!photo) return jsonError('Not found', 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM repeater_photos WHERE id = ?`).bind(photoId),
    touch(env, repeater.id),
  ]);
  await audit(env, {
    userId: user.id, action: 'repeater.photo.delete', targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, photo_id: photoId, caption: photo.caption }, request,
  });
  return jsonResponse({ deleted: true });
}

// ── Documents (manuals, programming files, licenses) ─────────────────────────

const DOC_RULES = {
  title: text('Title', { required: true, max: 200 }),
  kind:  oneOf('kind', DOCUMENT_KINDS, { fallback: 'manual' }),
};

function cleanUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return { error: 'url is required' };
  if (s.length > 2000) return { error: 'url is too long' };
  let u;
  try { u = new URL(s); } catch { return { error: 'url must be a full web address (https://…)' }; }
  if (!['http:', 'https:'].includes(u.protocol)) return { error: 'url must start with http:// or https://' };
  return { value: u.toString() };
}

// Keep a filename safe to put in an R2 key and a Content-Disposition header
function cleanFilename(v) {
  const base = String(v ?? '').split(/[\\/]/).pop().replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').trim();
  return base.slice(-150) || 'file';
}

function cleanContentType(v) {
  const t = String(v ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t : 'application/octet-stream';
}

async function addDocument({ request, env, user, repeater, url }) {
  const isJson = cleanContentType(request.headers.get('Content-Type')) === 'application/json';
  let values, file = null;

  if (isJson) {
    const body = await readJson(request);
    if (!body) return jsonError('Invalid JSON', 400);
    const picked = pick(body, DOC_RULES, { all: true });
    if (picked.error) return jsonError(picked.error, 400);
    const link = cleanUrl(body.url);
    if (link.error) return jsonError(link.error, 400);
    values = { ...picked.values, url: link.value };
  } else {
    if (!env.BACKUP_BUCKET) return jsonError('File storage is not configured', 503);
    const q = Object.fromEntries(url.searchParams);
    const filename = cleanFilename(q.filename);
    const picked = pick({ title: q.title || filename.replace(/\.[^.]+$/, ''), kind: q.kind }, DOC_RULES, { all: true });
    if (picked.error) return jsonError(picked.error, 400);
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > MAX_FILE_BYTES) return jsonError('Files can be up to 25 MB', 413);
    const data = await request.arrayBuffer();
    if (!data.byteLength) return jsonError('The file is empty', 400);
    if (data.byteLength > MAX_FILE_BYTES) return jsonError('Files can be up to 25 MB', 413);
    file = { data, filename, content_type: cleanContentType(request.headers.get('Content-Type')) };
    values = { ...picked.values, filename, content_type: file.content_type, size: data.byteLength };
  }

  const cols = Object.keys(values);
  // An uploaded file's key needs the row id, so the row starts with a placeholder key
  const r = await env.DB.prepare(`
    INSERT INTO repeater_documents (repeater_id, ${cols.join(', ')}, ${file ? 'r2_key, ' : ''}created_by)
    VALUES (?, ${cols.map(() => '?').join(', ')}, ${file ? "'pending', " : ''}?)
  `).bind(repeater.id, ...Object.values(values), user.id).run();
  const id = r.meta.last_row_id;

  if (file) {
    const key = `repeaters/${repeater.id}/${id}-${file.filename}`;
    try {
      await env.BACKUP_BUCKET.put(key, file.data, { httpMetadata: { contentType: file.content_type } });
    } catch (err) {
      await env.DB.prepare(`DELETE FROM repeater_documents WHERE id = ?`).bind(id).run();
      console.error('Repeater document upload failed:', err);
      return jsonError('The file could not be stored', 500);
    }
    await env.DB.prepare(`UPDATE repeater_documents SET r2_key = ? WHERE id = ?`).bind(key, id).run();
  }
  await touch(env, repeater.id).run();
  await audit(env, {
    userId: user.id, action: 'repeater.document.create', targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, document_id: id, title: values.title, kind: values.kind, ...(file ? { filename: file.filename, size: values.size } : { url: values.url }) },
    request,
  });
  return jsonResponse(await env.DB.prepare(`
    SELECT id, title, kind, url, filename, content_type, size, created_at FROM repeater_documents WHERE id = ?
  `).bind(id).first(), 201);
}

async function getDocument({ env, repeater }, docId) {
  const doc = await env.DB.prepare(`SELECT * FROM repeater_documents WHERE id = ? AND repeater_id = ?`).bind(docId, repeater.id).first();
  if (!doc) return jsonError('Not found', 404);
  if (!doc.r2_key) return Response.redirect(doc.url, 302);
  if (!env.BACKUP_BUCKET) return jsonError('File storage is not configured', 503);
  const obj = await env.BACKUP_BUCKET.get(doc.r2_key);
  if (!obj) return jsonError('The file is missing from storage', 404);

  // Only types that cannot run script on this site open in the browser
  const inline = INLINE_TYPES.has(doc.content_type);
  const name = doc.filename || 'file';
  return new Response(obj.body, {
    headers: {
      'Content-Type': inline ? doc.content_type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function updateDocument({ request, env, user, repeater }, docId) {
  const body = await readJson(request);
  if (!body) return jsonError('Invalid JSON', 400);
  const { values, error } = pick(body, DOC_RULES);
  if (error) return jsonError(error, 400);
  const existing = await env.DB.prepare(`SELECT * FROM repeater_documents WHERE id = ? AND repeater_id = ?`).bind(docId, repeater.id).first();
  if (!existing) return jsonError('Not found', 404);
  if ('url' in body) {
    if (!existing.url) return jsonError('An uploaded file has no link to change', 400);
    const link = cleanUrl(body.url);
    if (link.error) return jsonError(link.error, 400);
    values.url = link.value;
  }
  const cols = Object.keys(values);
  if (!cols.length) return jsonError('Nothing to change', 400);
  await env.DB.prepare(`UPDATE repeater_documents SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`)
    .bind(...Object.values(values), docId).run();
  return jsonResponse(await env.DB.prepare(`
    SELECT id, title, kind, url, filename, content_type, size, created_at FROM repeater_documents WHERE id = ?
  `).bind(docId).first());
}

async function deleteDocument({ request, env, user, repeater }, docId) {
  const doc = await env.DB.prepare(`SELECT * FROM repeater_documents WHERE id = ? AND repeater_id = ?`).bind(docId, repeater.id).first();
  if (!doc) return jsonError('Not found', 404);
  if (doc.r2_key) {
    if (!env.BACKUP_BUCKET) return jsonError('File storage is not configured', 503);
    await env.BACKUP_BUCKET.delete(doc.r2_key);
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM repeater_documents WHERE id = ?`).bind(docId),
    touch(env, repeater.id),
  ]);
  await audit(env, {
    userId: user.id, action: 'repeater.document.delete', targetType: 'repeater', targetId: repeater.id,
    detail: { name: repeater.name, document_id: docId, title: doc.title, filename: doc.filename }, request,
  });
  return jsonResponse({ deleted: true });
}
