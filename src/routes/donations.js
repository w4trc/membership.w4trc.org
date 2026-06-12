/**
 * Donations routes
 * GET    /api/donations              - list all donations (optional ?member_id=X, ?year=YYYY, ?kind=monetary|item)
 * GET    /api/donations/stats        - aggregated stats
 * POST   /api/donations              - record a donation (board+)
 * PUT    /api/donations/:id          - update a donation (board+)
 * DELETE /api/donations/:id          - delete a donation (admin only)
 */

import { isBoardOrAbove, isAdmin } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';

export async function handleDonations(request, env, path, user) {
  const method   = request.method;
  const url      = new URL(request.url);
  const segments = path.split('/');
  const id       = segments[3];

  if (id === 'stats') return getStats(request, env, user, url);
  if (!id) {
    if (method === 'GET')  return listDonations(request, env, user, url);
    if (method === 'POST') return createDonation(request, env, user);
  } else {
    const donId = parseInt(id, 10);
    if (method === 'GET')    return getDonation(request, env, user, donId);
    if (method === 'PUT')    return updateDonation(request, env, user, donId);
    if (method === 'DELETE') return deleteDonation(request, env, user, donId);
  }

  return jsonError('Method not allowed', 405);
}

async function listDonations(request, env, user, url) {
  const memberId = url.searchParams.get('member_id');
  const year     = url.searchParams.get('year');
  const kind     = url.searchParams.get('kind');

  const where  = [];
  const params = [];

  if (memberId) { where.push('d.member_id = ?');         params.push(parseInt(memberId, 10)); }
  if (year)     { where.push("strftime('%Y', d.donation_date) = ?"); params.push(year); }
  if (kind)     { where.push('d.donation_kind = ?');      params.push(kind); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(`
    SELECT d.*,
      m.callsign, m.first_name, m.last_name,
      u.email AS recorded_by_email
    FROM donations d
    LEFT JOIN members m ON m.id = d.member_id
    LEFT JOIN users   u ON u.id = d.recorded_by
    ${whereClause}
    ORDER BY d.donation_date DESC, d.id DESC
  `).bind(...params).all();

  return jsonResponse({ donations: results });
}

async function getDonation(request, env, user, id) {
  const d = await env.DB.prepare(`
    SELECT d.*,
      m.callsign, m.first_name, m.last_name,
      u.email AS recorded_by_email
    FROM donations d
    LEFT JOIN members m ON m.id = d.member_id
    LEFT JOIN users   u ON u.id = d.recorded_by
    WHERE d.id = ?
  `).bind(id).first();
  if (!d) return jsonError('Not found', 404);
  return jsonResponse(d);
}

async function createDonation(request, env, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const { donor_type, donation_kind, donation_date } = body;
  if (!donor_type)    return jsonError('donor_type is required', 400);
  if (!donation_kind) return jsonError('donation_kind is required', 400);
  if (!donation_date) return jsonError('donation_date is required', 400);

  if (!['member', 'organization', 'anonymous'].includes(donor_type)) {
    return jsonError('donor_type must be member, organization, or anonymous', 400);
  }
  if (!['monetary', 'item'].includes(donation_kind)) {
    return jsonError('donation_kind must be monetary or item', 400);
  }

  if (donor_type === 'member' && !body.member_id) {
    return jsonError('member_id is required when donor_type is member', 400);
  }
  if (donor_type === 'organization' && !body.organization_name?.trim()) {
    return jsonError('organization_name is required when donor_type is organization', 400);
  }
  if (donation_kind === 'monetary' && (body.amount == null || isNaN(parseFloat(body.amount)))) {
    return jsonError('amount is required for monetary donations', 400);
  }
  if (donation_kind === 'item' && !body.item_description?.trim()) {
    return jsonError('item_description is required for item donations', 400);
  }

  if (donor_type === 'member') {
    const member = await env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(body.member_id).first();
    if (!member) return jsonError('Member not found', 404);
  }

  const result = await env.DB.prepare(`
    INSERT INTO donations (
      donor_type, member_id, organization_name,
      donation_kind, amount, item_description, estimated_value,
      donation_date, payment_method, check_number, notes, recorded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    donor_type,
    donor_type === 'member' ? (body.member_id || null) : null,
    donor_type === 'organization' ? (body.organization_name?.trim() || null) : null,
    donation_kind,
    donation_kind === 'monetary' ? (parseFloat(body.amount) || null) : null,
    donation_kind === 'item' ? (body.item_description?.trim() || null) : null,
    body.estimated_value != null ? (parseFloat(body.estimated_value) || null) : null,
    donation_date,
    body.payment_method || null,
    body.check_number   || null,
    body.notes          || null,
    user.id,
  ).run();

  const newId = result.meta.last_row_id;
  await audit(env, {
    userId: user.id, action: 'donation.create', targetType: 'donation', targetId: newId,
    detail: { donor_type, donation_kind, amount: body.amount, member_id: body.member_id },
    request,
  });

  const created = await env.DB.prepare(`
    SELECT d.*, m.callsign, m.first_name, m.last_name
    FROM donations d LEFT JOIN members m ON m.id = d.member_id
    WHERE d.id = ?
  `).bind(newId).first();
  return jsonResponse(created, 201);
}

async function updateDonation(request, env, user, id) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare('SELECT * FROM donations WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }

  const donorType    = body.donor_type    ?? existing.donor_type;
  const donationKind = body.donation_kind ?? existing.donation_kind;

  await env.DB.prepare(`
    UPDATE donations SET
      donor_type        = ?,
      member_id         = ?,
      organization_name = ?,
      donation_kind     = ?,
      amount            = ?,
      item_description  = ?,
      estimated_value   = ?,
      donation_date     = ?,
      payment_method    = ?,
      check_number      = ?,
      notes             = ?,
      recorded_by       = ?,
      updated_at        = datetime('now')
    WHERE id = ?
  `).bind(
    donorType,
    donorType === 'member'       ? ('member_id' in body ? (body.member_id || null) : existing.member_id) : null,
    donorType === 'organization' ? ('organization_name' in body ? (body.organization_name?.trim() || null) : existing.organization_name) : null,
    donationKind,
    donationKind === 'monetary'  ? ('amount' in body ? (parseFloat(body.amount) || null) : existing.amount) : null,
    donationKind === 'item'      ? ('item_description' in body ? (body.item_description?.trim() || null) : existing.item_description) : null,
    'estimated_value' in body ? (body.estimated_value != null ? (parseFloat(body.estimated_value) || null) : null) : existing.estimated_value,
    body.donation_date   ?? existing.donation_date,
    body.payment_method  !== undefined ? (body.payment_method  || null) : existing.payment_method,
    body.check_number    !== undefined ? (body.check_number    || null) : existing.check_number,
    body.notes           !== undefined ? (body.notes           || null) : existing.notes,
    user.id,
    id,
  ).run();

  await audit(env, {
    userId: user.id, action: 'donation.update', targetType: 'donation', targetId: id,
    detail: { changes: body }, request,
  });

  const updated = await env.DB.prepare(`
    SELECT d.*, m.callsign, m.first_name, m.last_name
    FROM donations d LEFT JOIN members m ON m.id = d.member_id
    WHERE d.id = ?
  `).bind(id).first();
  return jsonResponse(updated);
}

async function deleteDonation(request, env, user, id) {
  if (!isAdmin(user)) return jsonError('Forbidden', 403);

  const existing = await env.DB.prepare('SELECT * FROM donations WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Not found', 404);

  await env.DB.prepare('DELETE FROM donations WHERE id = ?').bind(id).run();
  await audit(env, {
    userId: user.id, action: 'donation.delete', targetType: 'donation', targetId: id,
    detail: { donor_type: existing.donor_type, donation_kind: existing.donation_kind, amount: existing.amount },
    request,
  });

  return jsonResponse({ deleted: true });
}

async function getStats(request, env, user, url) {
  const year = url.searchParams.get('year');
  const whereClause = year ? `WHERE strftime('%Y', donation_date) = '${year.replace(/\D/g, '')}'` : '';

  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*)                                                       AS total_count,
      SUM(CASE WHEN donation_kind = 'monetary' THEN 1 ELSE 0 END)  AS monetary_count,
      SUM(CASE WHEN donation_kind = 'item'     THEN 1 ELSE 0 END)  AS item_count,
      SUM(CASE WHEN donor_type   = 'member'    THEN 1 ELSE 0 END)  AS member_donor_count,
      SUM(CASE WHEN donor_type   = 'organization' THEN 1 ELSE 0 END) AS org_donor_count,
      SUM(CASE WHEN donor_type   = 'anonymous' THEN 1 ELSE 0 END)  AS anonymous_donor_count,
      SUM(CASE WHEN donation_kind = 'monetary' THEN amount ELSE 0 END) AS total_monetary,
      SUM(CASE WHEN donation_kind = 'item' THEN COALESCE(estimated_value, 0) ELSE 0 END) AS total_item_value
    FROM donations
    ${whereClause}
  `).first();

  return jsonResponse({ year: year || 'all', stats: stats || {} });
}
