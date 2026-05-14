/**
 * Notes routes
 * GET    /api/notes?member_id=X  - get notes for a member
 * POST   /api/notes              - add note
 * PUT    /api/notes/:id          - edit note (admin only)
 * DELETE /api/notes/:id          - delete note (admin only)
 */

import { isAdmin, isBoardOrAbove } from '../lib/auth.js';
import { jsonResponse, jsonError }  from '../lib/response.js';
import { audit }                    from '../lib/audit.js';

export async function handleNotes(request, env, path, user) {
  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  const noteId   = segments[3] ? parseInt(segments[3], 10) : null;

  if (!noteId) {
    if (method === 'GET')  return getNotes(request, env, user, url);
    if (method === 'POST') return createNote(request, env, user);
  } else {
    if (method === 'PUT')    return updateNote(request, env, user, noteId);
    if (method === 'DELETE') return deleteNote(request, env, user, noteId);
  }

  return jsonError('Method not allowed', 405);
}

async function getNotes(request, env, user, url) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const memberId = url.searchParams.get('member_id');
  if (!memberId)  return jsonError('member_id required', 400);

  const { results } = await env.DB.prepare(`
    SELECT n.*, u.email as author_email
    FROM notes n
    LEFT JOIN users u ON u.id = n.author_id
    WHERE n.member_id = ?
    ORDER BY n.created_at DESC
  `).bind(parseInt(memberId, 10)).all();

  return jsonResponse({ notes: results });
}

async function createNote(request, env, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { member_id, note_text } = body;
  if (!member_id || !note_text?.trim()) return jsonError('member_id and note_text required', 400);

  const member = await env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(member_id).first();
  if (!member) return jsonError('Member not found', 404);

  const result = await env.DB.prepare(`
    INSERT INTO notes (member_id, author_id, note_text, is_private)
    VALUES (?, ?, ?, ?)
  `).bind(member_id, user.id, note_text.trim(), body.is_private !== false ? 1 : 0).run();

  const newId = result.meta.last_row_id;
  await audit(env, { userId: user.id, action: 'note.create', targetType: 'note', targetId: newId, detail: { member_id }, request });

  const note = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(newId).first();
  return jsonResponse(note, 201);
}

async function updateNote(request, env, user, noteId) {
  if (!isAdmin(user)) return jsonError('Forbidden - admin only', 403);

  const existing = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(noteId).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  await env.DB.prepare(`
    UPDATE notes SET note_text = ?, is_private = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(body.note_text ?? existing.note_text, body.is_private !== undefined ? (body.is_private ? 1 : 0) : existing.is_private, noteId).run();

  await audit(env, { userId: user.id, action: 'note.update', targetType: 'note', targetId: noteId, request });
  const updated = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(noteId).first();
  return jsonResponse(updated);
}

async function deleteNote(request, env, user, noteId) {
  if (!isAdmin(user)) return jsonError('Forbidden - admin only', 403);

  const note = await env.DB.prepare('SELECT * FROM notes WHERE id = ?').bind(noteId).first();
  if (!note) return jsonError('Not found', 404);

  await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(noteId).run();
  await audit(env, { userId: user.id, action: 'note.delete', targetType: 'note', targetId: noteId, request });

  return jsonResponse({ ok: true });
}
