/**
 * Officer history routes (board+)
 * GET    /api/officers        - every officer on record, newest year first
 * POST   /api/officers        - add one officer { year, position, name, callsign, notes }
 * POST   /api/officers/bulk   - add a pasted list for one position { position, text }
 * PUT    /api/officers/:id    - update an officer
 * DELETE /api/officers/:id    - remove an officer
 *
 * A name can be left out when the callsign belongs to a member; the member's
 * name is used. Either way a matching callsign links the entry to the member.
 */

import { isBoardOrAbove } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { POSITIONS, isPosition, isOfficerYear, FIRST_YEAR, lastYear, parseOfficerLines } from '../lib/officers.js';

const MAX_BULK = 300;

export async function handleOfficers(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const method = request.method;
  const id     = path.split('/')[3];

  if (id === 'bulk' && method === 'POST') return bulkAdd(request, env, user);
  if (!id) {
    if (method === 'GET')  return listOfficers(env);
    if (method === 'POST') return createOfficer(request, env, user);
  } else {
    const officerId = parseInt(id, 10);
    if (!officerId) return jsonError('Not found', 404);
    if (method === 'PUT')    return updateOfficer(request, env, user, officerId);
    if (method === 'DELETE') return deleteOfficer(request, env, user, officerId);
  }

  return jsonError('Method not allowed', 405);
}

async function listOfficers(env) {
  const { results } = await env.DB.prepare(`
    SELECT id, year, position, name, callsign, member_id, notes
    FROM officers ORDER BY year DESC, id
  `).all();
  return jsonResponse({ positions: POSITIONS, first_year: FIRST_YEAR, last_year: lastYear(), officers: results });
}

/** Members by upper-case callsign, for linking entries and filling in names. */
async function membersByCallsign(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, upper(callsign) AS callsign, first_name, last_name FROM members WHERE callsign IS NOT NULL`
  ).all();
  return new Map(results.map(m => [m.callsign, m]));
}

/** { name, callsign, member_id } for an entry, or { error }. */
function resolvePerson(members, name, callsign) {
  const call   = String(callsign || '').trim().toUpperCase() || null;
  const member = call ? members.get(call) : null;
  const who    = String(name || '').trim().replace(/\s+/g, ' ')
    || (member ? `${member.first_name} ${member.last_name}`.trim() : '');
  if (!who) {
    return { error: call ? `${call} is not on the membership list, so a name is needed` : 'A name is required' };
  }
  return { name: who, callsign: call, member_id: member?.id ?? null };
}

function checkYearAndPosition(year, position) {
  if (!isOfficerYear(year)) return `The year must be between ${FIRST_YEAR} and ${lastYear()}`;
  if (!isPosition(position)) return 'Unknown position';
  return null;
}

const isDuplicate = (err) => /UNIQUE constraint failed/i.test(err?.message || '');

async function createOfficer(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const year = Number(body.year);
  const invalid = checkYearAndPosition(year, body.position);
  if (invalid) return jsonError(invalid, 400);

  const who = resolvePerson(await membersByCallsign(env), body.name, body.callsign);
  if (who.error) return jsonError(who.error, 400);

  let result;
  try {
    result = await env.DB.prepare(`
      INSERT INTO officers (year, position, name, callsign, member_id, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(year, body.position, who.name, who.callsign, who.member_id, body.notes?.trim() || null, user.id).run();
  } catch (err) {
    if (isDuplicate(err)) return jsonError(`${who.name} is already listed in that position for ${year}`, 409);
    throw err;
  }

  const id = result.meta.last_row_id;
  await audit(env, {
    userId: user.id, action: 'officer.create', targetType: 'officer', targetId: id,
    detail: { year, position: body.position, name: who.name, callsign: who.callsign },
    request,
  });
  return jsonResponse(await env.DB.prepare('SELECT * FROM officers WHERE id = ?').bind(id).first(), 201);
}

async function bulkAdd(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  if (!isPosition(body.position)) return jsonError('Unknown position', 400);

  const { entries, errors } = parseOfficerLines(body.text);
  if (!entries.length && !errors.length) return jsonError('Nothing to add', 400);
  if (entries.length > MAX_BULK) return jsonError(`That is more than ${MAX_BULK} entries; add the list in parts`, 400);

  const members = await membersByCallsign(env);
  const people = entries.map(e => ({ year: e.year, ...resolvePerson(members, e.name, e.callsign) }));
  for (const p of people) {
    if (p.error && !errors.some(e => e.error === p.error)) errors.push({ line: null, text: String(p.year), error: p.error });
  }
  // One bad line and nothing is added, so a list never goes in half-done
  if (errors.length) return jsonError('Some lines could not be read', 400, errors);

  const results = await env.DB.batch(people.map(p => env.DB.prepare(`
    INSERT OR IGNORE INTO officers (year, position, name, callsign, member_id, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(p.year, body.position, p.name, p.callsign, p.member_id, user.id)));

  const added = results.reduce((n, r) => n + (r.meta.changes || 0), 0);
  if (added) {
    await audit(env, {
      userId: user.id, action: 'officer.bulk_add', targetType: 'officer',
      detail: { position: body.position, added, years: [people[0].year, people[people.length - 1].year] },
      request,
    });
  }
  return jsonResponse({ added, already_listed: people.length - added }, 201);
}

async function updateOfficer(request, env, user, id) {
  const existing = await env.DB.prepare('SELECT * FROM officers WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const year     = body.year !== undefined ? Number(body.year) : existing.year;
  const position = body.position ?? existing.position;
  const invalid  = checkYearAndPosition(year, position);
  if (invalid) return jsonError(invalid, 400);

  const who = resolvePerson(
    await membersByCallsign(env),
    body.name     !== undefined ? body.name     : existing.name,
    body.callsign !== undefined ? body.callsign : existing.callsign,
  );
  if (who.error) return jsonError(who.error, 400);
  const notes = body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes;

  try {
    await env.DB.prepare(`
      UPDATE officers SET year = ?, position = ?, name = ?, callsign = ?, member_id = ?, notes = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(year, position, who.name, who.callsign, who.member_id, notes, id).run();
  } catch (err) {
    if (isDuplicate(err)) return jsonError(`${who.name} is already listed in that position for ${year}`, 409);
    throw err;
  }

  await audit(env, {
    userId: user.id, action: 'officer.update', targetType: 'officer', targetId: id,
    detail: {
      before: { year: existing.year, position: existing.position, name: existing.name, callsign: existing.callsign },
      after:  { year, position, name: who.name, callsign: who.callsign },
    },
    request,
  });
  return jsonResponse(await env.DB.prepare('SELECT * FROM officers WHERE id = ?').bind(id).first());
}

async function deleteOfficer(request, env, user, id) {
  const existing = await env.DB.prepare('SELECT * FROM officers WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  await env.DB.prepare('DELETE FROM officers WHERE id = ?').bind(id).run();
  await audit(env, {
    userId: user.id, action: 'officer.delete', targetType: 'officer', targetId: id,
    detail: { year: existing.year, position: existing.position, name: existing.name, callsign: existing.callsign },
    request,
  });
  return jsonResponse({ ok: true });
}
