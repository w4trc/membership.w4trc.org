/**
 * Equipment inventory routes (board+)
 * GET    /api/inventory              - list items (optional ?q=search, ?location=<id>|out)
 * GET    /api/inventory/meta         - locations and members for the form dropdowns
 * POST   /api/inventory/locations    - add a storage location
 * POST   /api/inventory              - add an item
 * GET    /api/inventory/:id          - item with its history
 * PUT    /api/inventory/:id          - update item details
 * DELETE /api/inventory/:id          - delete an item and its history (admin only)
 * POST   /api/inventory/:id/move     - move to a location or check out to a member
 * POST   /api/inventory/:id/notes    - add a dated note to the item's history
 * GET    /api/inventory/:id/photo    - item photo (?size=thumb for the small one)
 * PUT    /api/inventory/:id/photo    - set photo: { image, thumb } as JPEG data URLs
 * DELETE /api/inventory/:id/photo    - remove photo
 *
 * Destination input (create + move): { location_id } or { member_id }, exactly one.
 */

import { isBoardOrAbove, isAdmin } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';

// D1 caps a row at 2 MB; the browser resizes well under this before uploading
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_THUMB_BYTES = 100_000;

export async function handleInventory(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  const id       = segments[3];
  const sub      = segments[4];

  if (id === 'meta'      && method === 'GET')  return getMeta(env);
  if (id === 'locations' && method === 'POST') return createLocation(request, env, user);
  if (!id) {
    if (method === 'GET')  return listItems(env, url);
    if (method === 'POST') return createItem(request, env, user);
  } else {
    const itemId = parseInt(id, 10);
    if (!itemId) return jsonError('Not found', 404);
    if (!sub) {
      if (method === 'GET')    return getItem(env, itemId);
      if (method === 'PUT')    return updateItem(request, env, user, itemId);
      if (method === 'DELETE') return deleteItem(request, env, user, itemId);
    } else if (sub === 'move'  && method === 'POST') {
      return moveItem(request, env, user, itemId);
    } else if (sub === 'notes' && method === 'POST') {
      return addNote(request, env, user, itemId);
    } else if (sub === 'photo') {
      if (method === 'GET')    return getPhoto(env, url, itemId);
      if (method === 'PUT')    return setPhoto(request, env, user, itemId);
      if (method === 'DELETE') return deletePhoto(request, env, user, itemId);
    } else {
      return jsonError('Not found', 404);
    }
  }

  return jsonError('Method not allowed', 405);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ITEM_SELECT = `
  SELECT i.*, l.name AS location_name,
         m.callsign AS member_callsign,
         TRIM(COALESCE(m.first_name, '') || ' ' || COALESCE(m.last_name, '')) AS member_name
  FROM inventory_items i
  LEFT JOIN inventory_locations l ON l.id = i.location_id
  LEFT JOIN members m             ON m.id = i.assigned_member_id
`;

const today = () => new Date().toISOString().slice(0, 10);
const clean = v => String(v ?? '').trim() || null;

function itemFields(body) {
  return {
    name:          clean(body.name),
    manufacturer:  clean(body.manufacturer),
    model:         clean(body.model),
    serial_number: clean(body.serial_number),
  };
}

function eventDate(body) {
  if (!body.event_date) return { date: today() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.event_date)) return { error: 'event_date must be YYYY-MM-DD' };
  return { date: body.event_date };
}

// Returns { location_id, member_id } with exactly one set, or { error }
async function resolveDestination(env, body) {
  const locationId = parseInt(body.location_id, 10) || null;
  const memberId   = parseInt(body.member_id, 10)   || null;
  if (!locationId === !memberId) return { error: 'Choose a location or a member' };

  if (locationId) {
    const loc = await env.DB.prepare(`SELECT id FROM inventory_locations WHERE id = ? AND is_active = 1`).bind(locationId).first();
    if (!loc) return { error: 'Location not found' };
  } else {
    const member = await env.DB.prepare(`SELECT id FROM members WHERE id = ?`).bind(memberId).first();
    if (!member) return { error: 'Member not found' };
  }
  return { location_id: locationId, member_id: memberId };
}

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

// ── Lookups ──────────────────────────────────────────────────────────────────

async function getMeta(env) {
  const [locations, members] = await Promise.all([
    env.DB.prepare(`SELECT id, name FROM inventory_locations WHERE is_active = 1 ORDER BY sort_order, name`).all(),
    env.DB.prepare(`
      SELECT id, callsign, first_name, last_name FROM members
      WHERE is_active = 1 ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
    `).all(),
  ]);
  return jsonResponse({ locations: locations.results, members: members.results });
}

async function createLocation(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const name = clean(body.name);
  if (!name) return jsonError('name is required', 400);

  const existing = await env.DB.prepare(`SELECT id FROM inventory_locations WHERE name = ?`).bind(name).first();
  if (existing) return jsonError('That location already exists', 409);

  const result = await env.DB.prepare(`
    INSERT INTO inventory_locations (name, sort_order)
    VALUES (?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM inventory_locations))
  `).bind(name).run();
  const id = result.meta.last_row_id;

  await audit(env, {
    userId: user.id, action: 'inventory.location_create', targetType: 'inventory_location', targetId: id,
    detail: { name }, request,
  });

  return jsonResponse({ location: { id, name } }, 201);
}

// ── Items ────────────────────────────────────────────────────────────────────

async function listItems(env, url) {
  const q        = (url.searchParams.get('q') || '').trim();
  const location = url.searchParams.get('location') || '';
  const where  = [];
  const params = [];

  if (q) {
    where.push(`(i.name LIKE ? OR i.manufacturer LIKE ? OR i.model LIKE ? OR i.serial_number LIKE ?
                 OR m.callsign LIKE ? OR m.first_name LIKE ? OR m.last_name LIKE ?)`);
    params.push(...Array(7).fill(`%${q}%`));
  }
  if (location === 'out') {
    where.push('i.assigned_member_id IS NOT NULL');
  } else if (parseInt(location, 10)) {
    where.push('i.location_id = ?');
    params.push(parseInt(location, 10));
  }

  const { results } = await env.DB.prepare(`
    ${ITEM_SELECT}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.name COLLATE NOCASE, i.id
  `).bind(...params).all();

  return jsonResponse({ items: results });
}

async function getItem(env, id) {
  const item = await env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first();
  if (!item) return jsonError('Not found', 404);

  const { results } = await env.DB.prepare(`
    SELECT e.*, fl.name AS from_location, tl.name AS to_location,
           fm.callsign AS from_callsign,
           TRIM(COALESCE(fm.first_name, '') || ' ' || COALESCE(fm.last_name, '')) AS from_member,
           tm.callsign AS to_callsign,
           TRIM(COALESCE(tm.first_name, '') || ' ' || COALESCE(tm.last_name, '')) AS to_member,
           u.email AS user_email
    FROM inventory_events e
    LEFT JOIN inventory_locations fl ON fl.id = e.from_location_id
    LEFT JOIN inventory_locations tl ON tl.id = e.to_location_id
    LEFT JOIN members fm             ON fm.id = e.from_member_id
    LEFT JOIN members tm             ON tm.id = e.to_member_id
    LEFT JOIN users u                ON u.id  = e.user_id
    WHERE e.item_id = ?
    ORDER BY e.event_date DESC, e.id DESC
  `).bind(id).all();

  return jsonResponse({ item, events: results });
}

async function createItem(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const f = itemFields(body);
  if (!f.name) return jsonError('name is required', 400);
  const when = eventDate(body);
  if (when.error) return jsonError(when.error, 400);
  const dest = await resolveDestination(env, body);
  if (dest.error) return jsonError(dest.error, 400);

  const result = await env.DB.prepare(`
    INSERT INTO inventory_items (name, manufacturer, model, serial_number, location_id, assigned_member_id, location_since, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(f.name, f.manufacturer, f.model, f.serial_number, dest.location_id, dest.member_id, when.date, user.id).run();
  const id = result.meta.last_row_id;

  await env.DB.prepare(`
    INSERT INTO inventory_events (item_id, event_type, event_date, to_location_id, to_member_id, note, user_id)
    VALUES (?, 'added', ?, ?, ?, ?, ?)
  `).bind(id, when.date, dest.location_id, dest.member_id, clean(body.note), user.id).run();

  await audit(env, {
    userId: user.id, action: 'inventory.create', targetType: 'inventory_item', targetId: id,
    detail: { name: f.name, serial_number: f.serial_number }, request,
  });

  return getItem(env, id);
}

async function updateItem(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const f = itemFields(body);
  if (!f.name) return jsonError('name is required', 400);

  await env.DB.prepare(`
    UPDATE inventory_items SET name = ?, manufacturer = ?, model = ?, serial_number = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(f.name, f.manufacturer, f.model, f.serial_number, id).run();

  const changed = Object.keys(f).filter(k => (f[k] ?? '') !== (existing[k] ?? ''));
  await audit(env, {
    userId: user.id, action: 'inventory.update', targetType: 'inventory_item', targetId: id,
    detail: { name: f.name, changed }, request,
  });

  return getItem(env, id);
}

async function deleteItem(request, env, user, id) {
  if (!isAdmin(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM inventory_events WHERE item_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM inventory_photos WHERE item_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM inventory_items  WHERE id = ?`).bind(id),
  ]);

  await audit(env, {
    userId: user.id, action: 'inventory.delete', targetType: 'inventory_item', targetId: id,
    detail: { name: existing.name, serial_number: existing.serial_number }, request,
  });

  return jsonResponse({ deleted: true });
}

// ── Movement & notes ─────────────────────────────────────────────────────────

async function moveItem(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const when = eventDate(body);
  if (when.error) return jsonError(when.error, 400);
  const dest = await resolveDestination(env, body);
  if (dest.error) return jsonError(dest.error, 400);

  if (dest.location_id === existing.location_id && dest.member_id === existing.assigned_member_id) {
    return jsonError('The item is already there', 400);
  }

  const type = dest.member_id ? 'checked_out' : 'moved';
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE inventory_items SET location_id = ?, assigned_member_id = ?, location_since = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(dest.location_id, dest.member_id, when.date, id),
    env.DB.prepare(`
      INSERT INTO inventory_events
        (item_id, event_type, event_date, from_location_id, from_member_id, to_location_id, to_member_id, note, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, type, when.date, existing.location_id, existing.assigned_member_id,
            dest.location_id, dest.member_id, clean(body.note), user.id),
  ]);

  await audit(env, {
    userId: user.id, action: 'inventory.move', targetType: 'inventory_item', targetId: id,
    detail: { name: existing.name, event_type: type, event_date: when.date, ...dest }, request,
  });

  return getItem(env, id);
}

async function addNote(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT id, name FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const note = clean(body.note);
  if (!note) return jsonError('note is required', 400);
  const when = eventDate(body);
  if (when.error) return jsonError(when.error, 400);

  await env.DB.prepare(`
    INSERT INTO inventory_events (item_id, event_type, event_date, note, user_id) VALUES (?, 'note', ?, ?, ?)
  `).bind(id, when.date, note, user.id).run();

  await audit(env, {
    userId: user.id, action: 'inventory.note', targetType: 'inventory_item', targetId: id,
    detail: { name: existing.name }, request,
  });

  return getItem(env, id);
}

// ── Photos ───────────────────────────────────────────────────────────────────

async function getPhoto(env, url, id) {
  const column = url.searchParams.get('size') === 'thumb' ? 'thumb' : 'image';
  const row = await env.DB.prepare(`SELECT ${column} AS data FROM inventory_photos WHERE item_id = ?`).bind(id).first();
  if (!row) return jsonError('Not found', 404);

  // The UI adds ?v=<photo_updated_at>, so a replaced photo gets a new URL
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function setPhoto(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT id, name FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const image = decodeJpeg(body.image, MAX_IMAGE_BYTES);
  const thumb = decodeJpeg(body.thumb, MAX_THUMB_BYTES);
  if (!image || !thumb) return jsonError('Photo must be a JPEG no larger than 1.5 MB', 400);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO inventory_photos (item_id, image, thumb) VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET image = excluded.image, thumb = excluded.thumb, updated_at = datetime('now')
    `).bind(id, image.buffer, thumb.buffer),
    env.DB.prepare(`UPDATE inventory_items SET photo_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).bind(id),
  ]);

  await audit(env, {
    userId: user.id, action: 'inventory.photo', targetType: 'inventory_item', targetId: id,
    detail: { name: existing.name }, request,
  });

  return getItem(env, id);
}

async function deletePhoto(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT id, name FROM inventory_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM inventory_photos WHERE item_id = ?`).bind(id),
    env.DB.prepare(`UPDATE inventory_items SET photo_updated_at = NULL, updated_at = datetime('now') WHERE id = ?`).bind(id),
  ]);

  await audit(env, {
    userId: user.id, action: 'inventory.photo_delete', targetType: 'inventory_item', targetId: id,
    detail: { name: existing.name }, request,
  });

  return getItem(env, id);
}
