/**
 * Meeting agenda routes (board+)
 * GET    /api/agendas                      - agendas with their meetings, newest first (optional ?year=YYYY)
 * POST   /api/agendas                      - start an agenda { meeting_type, meeting_date, title, location, start_time }
 * GET    /api/agendas/:id                  - the whole agenda: checklist, reports, items, motions, attendance, income
 * PATCH  /api/agendas/:id                  - change agenda fields; only the fields sent are changed
 * DELETE /api/agendas/:id                  - delete an agenda; its meeting and attendance stay (admin only)
 * POST   /api/agendas/:id/checks           - tick or untick a checklist step { step, checked }
 * PUT    /api/agendas/:id/reports/:key     - an officer report { body, given }
 * POST   /api/agendas/:id/carry            - copy open business from the previous agenda again
 * POST   /api/agendas/:id/items            - add business or an announcement { section, title, details, owner }
 * PATCH  /api/agendas/:id/items/:itemId    - change an item { title, details, owner, status }
 * DELETE /api/agendas/:id/items/:itemId
 * POST   /api/agendas/:id/motions          - record a motion { motion, moved_by, seconded_by, votes_yes, votes_no, votes_abstain, result }
 * PATCH  /api/agendas/:id/motions/:motionId
 * DELETE /api/agendas/:id/motions/:motionId
 *
 * Starting an agenda uses the meeting already recorded for that date and type
 * if there is one, or creates it, so attendance is taken on the same meeting.
 * Every save changes only what was sent, so officers working on different
 * parts at once do not overwrite each other.
 */

import { isBoardOrAbove, isAdmin } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import {
  agendaTemplate, stepKeys, REPORT_SLOTS, isReportKey, ITEM_SECTIONS, ITEM_STATUSES, MOTION_RESULTS, MAX_TEXT,
  cleanAgendaFields, officerLabel, previousAgenda, carryOpenItems, incomeSinceLastMeeting,
} from '../lib/agenda.js';

const MEETING_TYPES = ['monthly', 'board', 've_session', 'field_day', 'special', 'other'];

export async function handleAgendas(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const method = request.method;
  const url    = new URL(request.url);
  const [, , , rawId, sub, rawSubId] = path.split('/');

  if (!rawId) {
    if (method === 'GET')  return listAgendas(env, url);
    if (method === 'POST') return createAgenda(request, env, user);
    return jsonError('Method not allowed', 405);
  }

  const id = parseInt(rawId, 10);
  if (!id) return jsonError('Not found', 404);
  const agenda = await env.DB.prepare(`
    SELECT a.*, m.meeting_type, m.meeting_date, m.title FROM agendas a JOIN meetings m ON m.id = a.meeting_id WHERE a.id = ?
  `).bind(id).first();
  if (!agenda) return jsonError('Not found', 404);

  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await request.json().catch(() => null) : null;
  if (['POST', 'PUT', 'PATCH'].includes(method) && (!body || typeof body !== 'object')) return jsonError('Invalid JSON', 400);
  // Items and motions are addressed by number; reports by position key
  const subId = rawSubId ? parseInt(rawSubId, 10) : null;
  if (rawSubId && ['items', 'motions'].includes(sub) && !subId) return jsonError('Not found', 404);

  const ctx = { request, env, user, agenda, body };
  if (!sub) {
    if (method === 'GET')    return getAgenda(env, id);
    if (method === 'PATCH')  return updateAgenda(ctx);
    if (method === 'DELETE') return deleteAgenda(ctx);
  } else if (sub === 'checks' && method === 'POST' && !rawSubId) {
    return setCheck(ctx);
  } else if (sub === 'reports' && method === 'PUT' && rawSubId) {
    return saveReport(ctx, rawSubId);
  } else if (sub === 'carry' && method === 'POST' && !rawSubId) {
    return carryAgain(ctx);
  } else if (sub === 'items') {
    if (method === 'POST' && !subId)  return createItem(ctx);
    if (method === 'PATCH' && subId)  return updateItem(ctx, subId);
    if (method === 'DELETE' && subId) return deleteItem(ctx, subId);
  } else if (sub === 'motions') {
    if (method === 'POST' && !subId)  return createMotion(ctx);
    if (method === 'PATCH' && subId)  return updateMotion(ctx, subId);
    if (method === 'DELETE' && subId) return deleteMotion(ctx, subId);
  }

  return jsonError('Method not allowed', 405);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Who did something, as a short label: the member's callsign, else the login email
const WHO = (alias) => `COALESCE(${alias}m.callsign, ${alias}u.email)`;
const whoJoin = (alias, col) =>
  `LEFT JOIN users ${alias}u ON ${alias}u.id = ${col} LEFT JOIN members ${alias}m ON ${alias}m.id = ${alias}u.member_id`;

function text(v, name, { required = false } = {}) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (required && !s) return { error: `${name} is required` };
  if (s.length > MAX_TEXT) return { error: `${name} is too long` };
  return { value: s || null };
}

function count(v, name) {
  if (v === null || v === undefined || v === '') return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: `${name} must be a whole number` };
  return { value: n };
}

/** Run `rules` ({ column: (value) => { value } | { error } }) over the keys present in body. */
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

function updateStatement(env, table, values, where, whereBinds) {
  const cols = Object.keys(values);
  return env.DB.prepare(
    `UPDATE ${table} SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE ${where}`
  ).bind(...Object.values(values), ...whereBinds);
}

const touch = (env, id) => env.DB.prepare(`UPDATE agendas SET updated_at = datetime('now') WHERE id = ?`).bind(id);

// ── List / create / read ─────────────────────────────────────────────────────

async function listAgendas(env, url) {
  const year = (url.searchParams.get('year') || '').replace(/\D/g, '');
  const { results } = await env.DB.prepare(`
    SELECT a.id, a.meeting_id, a.location, a.start_time, a.called_to_order, a.adjourned_at, a.updated_at,
           m.meeting_type, m.meeting_date, m.title,
           (SELECT COUNT(*) FROM agenda_items i WHERE i.agenda_id = a.id AND i.section IN ('old', 'new')) AS business_count,
           (SELECT COUNT(*) FROM agenda_items i WHERE i.agenda_id = a.id AND i.section IN ('old', 'new') AND i.status = 'open') AS open_count,
           (SELECT COUNT(*) FROM agenda_motions x WHERE x.agenda_id = a.id) AS motion_count,
           (SELECT COUNT(*) FROM meeting_attendees x WHERE x.meeting_id = m.id) AS attendee_count
    FROM agendas a JOIN meetings m ON m.id = a.meeting_id
    ${year ? "WHERE strftime('%Y', m.meeting_date) = ?" : ''}
    ORDER BY m.meeting_date DESC, m.id DESC
  `).bind(...(year ? [year] : [])).all();
  return jsonResponse({ agendas: results });
}

async function createAgenda(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(body.meeting_date || '')) return jsonError('meeting_date (YYYY-MM-DD) is required', 400);
  if (!MEETING_TYPES.includes(body.meeting_type)) return jsonError('meeting_type must be one of: ' + MEETING_TYPES.join(', '), 400);
  const fields = cleanAgendaFields({ location: body.location, start_time: body.start_time });
  if (fields.error) return jsonError(fields.error, 400);
  const title = text(body.title, 'title');
  if (title.error) return jsonError(title.error, 400);

  // Use the meeting already recorded for this date and type, if there is one
  let meeting = await env.DB.prepare(`
    SELECT mt.id, mt.meeting_type, mt.meeting_date, a.id AS agenda_id
    FROM meetings mt LEFT JOIN agendas a ON a.meeting_id = mt.id
    WHERE mt.meeting_date = ? AND mt.meeting_type = ?
    ORDER BY a.id IS NOT NULL, mt.id LIMIT 1
  `).bind(body.meeting_date, body.meeting_type).first();
  if (meeting?.agenda_id) {
    return jsonResponse({ error: 'There is already an agenda for that meeting', agenda_id: meeting.agenda_id }, 409);
  }
  if (!meeting) {
    const r = await env.DB.prepare(`
      INSERT INTO meetings (meeting_type, meeting_date, title, recorded_by) VALUES (?, ?, ?, ?)
    `).bind(body.meeting_type, body.meeting_date, title.value, user.id).run();
    meeting = { id: r.meta.last_row_id, meeting_type: body.meeting_type, meeting_date: body.meeting_date };
  } else if (title.value) {
    await env.DB.prepare(`UPDATE meetings SET title = COALESCE(title, ?) WHERE id = ?`).bind(title.value, meeting.id).run();
  }

  // The year's president presides and its secretary takes the minutes, unless changed
  const { results: officers } = await env.DB.prepare(`
    SELECT position, name, callsign FROM officers WHERE year = ? AND position IN ('president', 'secretary') ORDER BY id
  `).bind(Number(body.meeting_date.slice(0, 4))).all();
  const officer = (pos) => officerLabel(officers.find(o => o.position === pos));

  const r = await env.DB.prepare(`
    INSERT INTO agendas (meeting_id, location, start_time, presiding, secretary, created_by) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(meeting.id, fields.values.location ?? null, fields.values.start_time ?? null,
    officer('president'), officer('secretary'), user.id).run();
  const id = r.meta.last_row_id;

  const carried = await carryOpenItems(env, id, meeting, user.id);

  await audit(env, {
    userId: user.id, action: 'agenda.create', targetType: 'agenda', targetId: id,
    detail: { meeting_id: meeting.id, meeting_date: meeting.meeting_date, meeting_type: meeting.meeting_type, carried },
    request,
  });

  return jsonResponse(await agendaData(env, id), 201);
}

async function getAgenda(env, id) {
  const data = await agendaData(env, id);
  return data ? jsonResponse(data) : jsonError('Not found', 404);
}

/** Everything on one agenda, or null. Also used by the printed agenda. */
export async function agendaData(env, id) {
  const agenda = await env.DB.prepare(`
    SELECT a.*, m.meeting_type, m.meeting_date, m.title, m.notes AS meeting_notes
    FROM agendas a JOIN meetings m ON m.id = a.meeting_id WHERE a.id = ?
  `).bind(id).first();
  if (!agenda) return null;

  const [checks, reports, items, motions, attendance, officers] = await env.DB.batch([
    env.DB.prepare(`
      SELECT c.step, c.checked_at, ${WHO('c')} AS checked_by FROM agenda_checks c ${whoJoin('c', 'c.checked_by')}
      WHERE c.agenda_id = ?
    `).bind(id),
    env.DB.prepare(`
      SELECT r.report_key, r.body, r.given, r.updated_at, ${WHO('r')} AS updated_by FROM agenda_reports r ${whoJoin('r', 'r.updated_by')}
      WHERE r.agenda_id = ?
    `).bind(id),
    env.DB.prepare(`
      SELECT i.id, i.section, i.title, i.details, i.owner, i.status, i.carried_from_id, i.created_at, i.updated_at,
             ${WHO('i')} AS added_by, pm.meeting_date AS carried_from_date
      FROM agenda_items i ${whoJoin('i', 'i.created_by')}
      LEFT JOIN agenda_items pi ON pi.id = i.carried_from_id
      LEFT JOIN agendas pa ON pa.id = pi.agenda_id
      LEFT JOIN meetings pm ON pm.id = pa.meeting_id
      WHERE i.agenda_id = ?
      ORDER BY i.id
    `).bind(id),
    env.DB.prepare(`SELECT * FROM agenda_motions WHERE agenda_id = ? ORDER BY id`).bind(id),
    env.DB.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN member_id IS NOT NULL THEN 1 ELSE 0 END) AS members,
             SUM(CASE WHEN member_id IS NULL AND callsign IS NOT NULL THEN 1 ELSE 0 END) AS visitors,
             SUM(CASE WHEN callsign IS NULL THEN 1 ELSE 0 END) AS guests
      FROM meeting_attendees WHERE meeting_id = ?
    `).bind(agenda.meeting_id),
    env.DB.prepare(`SELECT position, name, callsign FROM officers WHERE year = ? ORDER BY id`)
      .bind(Number(agenda.meeting_date.slice(0, 4))),
  ]);

  const [previous, income] = await Promise.all([
    previousAgenda(env, agenda),
    incomeSinceLastMeeting(env, agenda),
  ]);

  const a = attendance.results[0] || {};
  return {
    agenda,
    template: agendaTemplate(agenda.meeting_type),
    report_slots: REPORT_SLOTS.map(s => ({
      key: s.key, label: s.label,
      officers: officers.results.filter(o => o.position === s.key).map(o => ({ name: o.name, callsign: o.callsign })),
    })),
    reports: reports.results,
    checks: checks.results,
    items: items.results,
    motions: motions.results,
    attendance: { total: a.total || 0, members: a.members || 0, visitors: a.visitors || 0, guests: a.guests || 0 },
    income,
    previous: previous ? { id: previous.id, meeting_date: previous.meeting_date } : null,
  };
}

// ── Agenda fields, checklist, reports ────────────────────────────────────────

async function updateAgenda({ env, agenda, body }) {
  const { values, error } = cleanAgendaFields(body);
  if (error) return jsonError(error, 400);
  if (!Object.keys(values).length) return jsonError('Nothing to change', 400);
  await updateStatement(env, 'agendas', values, 'id = ?', [agenda.id]).run();
  return jsonResponse({ ok: true, ...values });
}

async function deleteAgenda({ request, env, user, agenda }) {
  if (!isAdmin(user)) return jsonError('Forbidden', 403);
  await env.DB.batch(agendaDeleteStatements(env, '?', [agenda.id]));
  await audit(env, {
    userId: user.id, action: 'agenda.delete', targetType: 'agenda', targetId: agenda.id,
    detail: { meeting_id: agenda.meeting_id, meeting_date: agenda.meeting_date, meeting_type: agenda.meeting_type },
    request,
  });
  return jsonResponse({ deleted: true });
}

/**
 * Statements that delete agendas and everything on them. `ids` is SQL giving
 * the agenda ids: '?' for one agenda, or a subquery such as
 * 'SELECT id FROM agendas WHERE meeting_id = ?'.
 */
export function agendaDeleteStatements(env, ids, binds) {
  const del = (table, col = 'agenda_id') => env.DB.prepare(`DELETE FROM ${table} WHERE ${col} IN (${ids})`).bind(...binds);
  return [
    // Items copied from these agendas into later ones lose the link, not the item
    env.DB.prepare(`
      UPDATE agenda_items SET carried_from_id = NULL
      WHERE carried_from_id IN (SELECT id FROM agenda_items WHERE agenda_id IN (${ids}))
    `).bind(...binds),
    del('agenda_checks'),
    del('agenda_reports'),
    del('agenda_items'),
    del('agenda_motions'),
    del('agendas', 'id'),
  ];
}

async function setCheck({ env, user, agenda, body }) {
  if (!stepKeys(agenda.meeting_type).has(body.step)) return jsonError('Unknown step', 400);
  await env.DB.batch([
    body.checked
      ? env.DB.prepare(`INSERT OR IGNORE INTO agenda_checks (agenda_id, step, checked_by) VALUES (?, ?, ?)`).bind(agenda.id, body.step, user.id)
      : env.DB.prepare(`DELETE FROM agenda_checks WHERE agenda_id = ? AND step = ?`).bind(agenda.id, body.step),
    touch(env, agenda.id),
  ]);
  return jsonResponse({ step: body.step, checked: !!body.checked });
}

async function saveReport({ env, user, agenda, body }, key) {
  if (!isReportKey(key)) return jsonError('Unknown report', 400);
  const values = {};
  if ('body' in body) {
    const t = text(body.body, 'Report');
    if (t.error) return jsonError(t.error, 400);
    values.body = t.value;
  }
  if ('given' in body) values.given = body.given ? 1 : 0;
  if (!Object.keys(values).length) return jsonError('Nothing to change', 400);

  const cols = Object.keys(values);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO agenda_reports (agenda_id, report_key, updated_by) VALUES (?, ?, ?)`).bind(agenda.id, key, user.id),
    env.DB.prepare(`
      UPDATE agenda_reports SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now')
      WHERE agenda_id = ? AND report_key = ?
    `).bind(...Object.values(values), user.id, agenda.id, key),
    touch(env, agenda.id),
  ]);
  return jsonResponse({ report_key: key, ...values });
}

async function carryAgain({ request, env, user, agenda }) {
  const carried = await carryOpenItems(env, agenda.id, agenda, user.id);
  if (carried) {
    await audit(env, {
      userId: user.id, action: 'agenda.carry', targetType: 'agenda', targetId: agenda.id, detail: { carried }, request,
    });
  }
  return jsonResponse({ carried });
}

// ── Items ────────────────────────────────────────────────────────────────────

const ITEM_RULES = {
  title:   (v) => text(v, 'Title', { required: true }),
  details: (v) => text(v, 'Details'),
  owner:   (v) => text(v, 'Brought by'),
  status:  (v) => (ITEM_STATUSES.includes(v) ? { value: v } : { error: 'status must be one of: ' + ITEM_STATUSES.join(', ') }),
};

async function createItem({ request, env, user, agenda, body }) {
  if (!ITEM_SECTIONS.includes(body.section)) return jsonError('section must be one of: ' + ITEM_SECTIONS.join(', '), 400);
  const { values, error } = pick({ status: 'open', ...body }, ITEM_RULES, { all: true });
  if (error) return jsonError(error, 400);

  const r = await env.DB.prepare(`
    INSERT INTO agenda_items (agenda_id, section, title, details, owner, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(agenda.id, body.section, values.title, values.details, values.owner, values.status, user.id).run();
  const id = r.meta.last_row_id;
  await touch(env, agenda.id).run();
  await audit(env, {
    userId: user.id, action: 'agenda.item.create', targetType: 'agenda', targetId: agenda.id,
    detail: { item_id: id, section: body.section, title: values.title }, request,
  });
  return jsonResponse(await env.DB.prepare(`SELECT * FROM agenda_items WHERE id = ?`).bind(id).first(), 201);
}

async function updateItem({ env, agenda, body }, itemId) {
  const { values, error } = pick(body, ITEM_RULES);
  if (error) return jsonError(error, 400);
  if (!Object.keys(values).length) return jsonError('Nothing to change', 400);
  const [res] = await env.DB.batch([
    updateStatement(env, 'agenda_items', values, 'id = ? AND agenda_id = ?', [itemId, agenda.id]),
    touch(env, agenda.id),
  ]);
  if (!res.meta.changes) return jsonError('Not found', 404);
  return jsonResponse(await env.DB.prepare(`SELECT * FROM agenda_items WHERE id = ?`).bind(itemId).first());
}

async function deleteItem({ request, env, user, agenda }, itemId) {
  const item = await env.DB.prepare(`SELECT * FROM agenda_items WHERE id = ? AND agenda_id = ?`).bind(itemId, agenda.id).first();
  if (!item) return jsonError('Not found', 404);
  await env.DB.batch([
    env.DB.prepare(`UPDATE agenda_items SET carried_from_id = NULL WHERE carried_from_id = ?`).bind(itemId),
    env.DB.prepare(`DELETE FROM agenda_items WHERE id = ?`).bind(itemId),
    touch(env, agenda.id),
  ]);
  await audit(env, {
    userId: user.id, action: 'agenda.item.delete', targetType: 'agenda', targetId: agenda.id,
    detail: { item_id: itemId, section: item.section, title: item.title }, request,
  });
  return jsonResponse({ deleted: true });
}

// ── Motions ──────────────────────────────────────────────────────────────────

const MOTION_RULES = {
  motion:        (v) => text(v, 'Motion', { required: true }),
  moved_by:      (v) => text(v, 'Moved by'),
  seconded_by:   (v) => text(v, 'Seconded by'),
  votes_yes:     (v) => count(v, 'Yes votes'),
  votes_no:      (v) => count(v, 'No votes'),
  votes_abstain: (v) => count(v, 'Abstentions'),
  result:        (v) => (!v ? { value: null } : MOTION_RESULTS.includes(v) ? { value: v } : { error: 'result must be one of: ' + MOTION_RESULTS.join(', ') }),
};

async function createMotion({ request, env, user, agenda, body }) {
  const { values, error } = pick(body, MOTION_RULES, { all: true });
  if (error) return jsonError(error, 400);
  const cols = Object.keys(values);
  const r = await env.DB.prepare(`
    INSERT INTO agenda_motions (agenda_id, ${cols.join(', ')}, created_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
  `).bind(agenda.id, ...Object.values(values), user.id).run();
  const id = r.meta.last_row_id;
  await touch(env, agenda.id).run();
  await audit(env, {
    userId: user.id, action: 'agenda.motion.create', targetType: 'agenda', targetId: agenda.id,
    detail: { motion_id: id, motion: values.motion, result: values.result }, request,
  });
  return jsonResponse(await env.DB.prepare(`SELECT * FROM agenda_motions WHERE id = ?`).bind(id).first(), 201);
}

async function updateMotion({ env, agenda, body }, motionId) {
  const { values, error } = pick(body, MOTION_RULES);
  if (error) return jsonError(error, 400);
  if (!Object.keys(values).length) return jsonError('Nothing to change', 400);
  const [res] = await env.DB.batch([
    updateStatement(env, 'agenda_motions', values, 'id = ? AND agenda_id = ?', [motionId, agenda.id]),
    touch(env, agenda.id),
  ]);
  if (!res.meta.changes) return jsonError('Not found', 404);
  return jsonResponse(await env.DB.prepare(`SELECT * FROM agenda_motions WHERE id = ?`).bind(motionId).first());
}

async function deleteMotion({ request, env, user, agenda }, motionId) {
  const motion = await env.DB.prepare(`SELECT * FROM agenda_motions WHERE id = ? AND agenda_id = ?`).bind(motionId, agenda.id).first();
  if (!motion) return jsonError('Not found', 404);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM agenda_motions WHERE id = ?`).bind(motionId),
    touch(env, agenda.id),
  ]);
  await audit(env, {
    userId: user.id, action: 'agenda.motion.delete', targetType: 'agenda', targetId: agenda.id,
    detail: { motion_id: motionId, motion: motion.motion }, request,
  });
  return jsonResponse({ deleted: true });
}
