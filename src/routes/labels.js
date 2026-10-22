/**
 * Equipment QR labels (board and admin)
 *
 * GET /print/labels               — a label for every inventory item
 * GET /print/labels?ids=3,7,12    — labels for these items
 *     &skip=N                     — leave the first N labels blank, to reuse a partly used sheet
 *
 * Laid out for Avery 5160 / 8160 address labels: 30 per letter sheet, 1" x 2-5/8".
 *
 * GET /i/:id                      — where each label's QR code points. Officers who are
 *                                   signed in get the item in the inventory page; anyone
 *                                   else gets a public "found this?" page with club contact
 *                                   info (?signin shows the sign-in screen instead).
 */

import { requireAuth, isBoardOrAbove } from '../lib/auth.js';
import { qrSvg } from '../lib/qr.js';

const PER_SHEET = 30;
const MAX_LABELS = 600; // 20 sheets

export function itemLink(env, id) {
  return `https://${env.CLUB_DOMAIN || 'members.w4trc.org'}/i/${id}`;
}

// "3,7,x,7" -> [3, 7]; null when the parameter is missing
export function parseIds(value) {
  if (value == null) return null;
  const ids = value.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  return [...new Set(ids)].slice(0, MAX_LABELS);
}

export async function handlePrintLabels(request, env) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok || !isBoardOrAbove(authResult.user)) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }

  const params = new URL(request.url).searchParams;
  const ids = parseIds(params.get('ids'));
  const skip = Math.min(Math.max(parseInt(params.get('skip'), 10) || 0, 0), PER_SHEET - 1);

  let items = [];
  if (ids === null) {
    ({ results: items } = await env.DB.prepare(`
      SELECT id, name, manufacturer, model, serial_number FROM inventory_items
      ORDER BY name COLLATE NOCASE, id LIMIT ?
    `).bind(MAX_LABELS).all());
  } else if (ids.length) {
    ({ results: items } = await env.DB.prepare(`
      SELECT id, name, manufacturer, model, serial_number FROM inventory_items
      WHERE id IN (${ids.map(() => '?').join(',')})
      ORDER BY name COLLATE NOCASE, id
    `).bind(...ids).all());
  }

  const clubCall = env.CLUB_CALLSIGN || 'W4TRC';
  return new Response(labelsPage(env, items, { ids: params.get('ids'), skip, clubCall }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function labelHtml(env, it, clubCall) {
  const makeModel = [it.manufacturer, it.model].filter(Boolean).join(' ');
  return `<div class="label">
  <div class="qr">${qrSvg(itemLink(env, it.id))}</div>
  <div class="text">
    <div class="owner">${esc(clubCall)} property</div>
    <div class="name">${esc(it.name)}</div>
    ${makeModel ? `<div class="meta">${esc(makeModel)}</div>` : ''}
    ${it.serial_number ? `<div class="meta">S/N ${esc(it.serial_number)}</div>` : ''}
    <div class="id">Item #${it.id} · Found it? Scan me</div>
  </div>
</div>`;
}

function labelsPage(env, items, { ids, skip, clubCall }) {
  const cells = [
    ...Array(skip).fill('<div class="label"></div>'),
    ...items.map(it => labelHtml(env, it, clubCall)),
  ];
  const sheets = [];
  for (let i = 0; i < cells.length; i += PER_SHEET) {
    sheets.push(`<div class="sheet">${cells.slice(i, i + PER_SHEET).join('\n')}</div>`);
  }
  const count = items.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(clubCall)} Equipment Labels</title>
<style>
@page { size: letter; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #e9e9e9; }
.toolbar { max-width: 8.5in; margin: 20px auto; font-size: 10pt; color: #333; line-height: 1.6; }
.toolbar button { font-size: 11pt; padding: 8px 20px; cursor: pointer; background: #1a4fa8; color: #fff; border: none; border-radius: 4px; }
.toolbar form { display: inline-flex; align-items: center; gap: 6px; margin-left: 16px; }
.toolbar input { width: 4em; padding: 4px; font-size: 10pt; }
.toolbar form button { background: #555; padding: 4px 12px; font-size: 10pt; }
.empty { max-width: 8.5in; margin: 0 auto; background: #fff; padding: 32px; border-radius: 6px; }
/* Avery 5160: 0.5in top margin, 3/16in side margin, 2-5/8in x 1in labels, 1/8in column gap */
.sheet {
  width: 8.5in; height: 11in; margin: 0 auto 20px; background: #fff;
  padding: 0.5in 0.1875in 0;
  display: grid; grid-template-columns: repeat(3, 2.625in); grid-auto-rows: 1in; column-gap: 0.125in;
  page-break-after: always; break-after: page; overflow: hidden;
}
.label { display: flex; align-items: center; gap: 0.08in; padding: 0.06in 0.12in 0.06in 0.08in; overflow: hidden; }
.qr { flex: 0 0 0.86in; height: 0.86in; }
.qr svg { width: 100%; height: 100%; display: block; }
.text { min-width: 0; line-height: 1.2; }
.owner { font-size: 6.5pt; font-weight: bold; text-transform: uppercase; letter-spacing: .05em; }
.name { font-size: 9pt; font-weight: bold; margin: 1px 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.id { font-size: 7pt; color: #444; margin-top: 1px; }
@media print {
  body { background: #fff; }
  .toolbar, .empty { display: none; }
  .sheet { margin: 0; }
}
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">Print</button>
  <form method="get">
    ${ids != null ? `<input type="hidden" name="ids" value="${esc(ids)}">` : ''}
    <label>Skip the first <input type="number" name="skip" min="0" max="${PER_SHEET - 1}" value="${skip}"> labels on the sheet</label>
    <button type="submit">Apply</button>
  </form>
  <p>${count} label${count !== 1 ? 's' : ''}. For Avery 5160 or 8160 sheets (30 per page). Print at 100% or "Actual size", not "Fit to page". Scanned by a signed-in officer, a code opens the item in the inventory; anyone else sees who owns it and how to contact the club.</p>
</div>
${count ? sheets.join('\n') : '<div class="empty">No items to label.</div>'}
</body>
</html>`;
}

// ── GET /i/:id ───────────────────────────────────────────────────────────────

export async function handleItemLink(request, env, serveApp) {
  const url = new URL(request.url);
  const rawId = url.pathname.slice('/i/'.length);
  const id = /^[1-9]\d{0,9}$/.test(rawId) ? Number(rawId) : null;
  const auth = await requireAuth(request, env);
  if ((auth.ok && isBoardOrAbove(auth.user)) || url.searchParams.has('signin')) {
    return serveApp(); // the app opens the item, after sign-in if needed
  }

  // Only the name, which is printed on the label anyway: never where it is kept or who has it
  const item = id
    ? await env.DB.prepare(`SELECT id, name FROM inventory_items WHERE id = ?`).bind(id).first()
    : null;

  return new Response(foundPage(env, item, id), {
    status: item ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

function foundPage(env, item, id) {
  const club     = env.CLUB_NAME || 'Kingsport Amateur Radio Club';
  const clubCall = env.CLUB_CALLSIGN || 'W4TRC';
  const email    = env.CONTACT_EMAIL || env.FROM_EMAIL || 'membership@w4trc.org';
  const subject  = item ? `Found equipment: ${item.name} (item #${item.id})` : id ? `Found equipment (item #${id})` : 'Found equipment';
  const mailto   = `mailto:${email}?subject=${encodeURIComponent(subject)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(clubCall)} Equipment</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #0f1117; color: #e8eaf0;
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; line-height: 1.5; }
.card { background: #181c27; border: 1px solid #2a3050; border-radius: 12px; padding: 28px 24px; max-width: 440px; width: 100%; text-align: center; }
.card img { height: 72px; margin-bottom: 12px; }
h1 { font-size: 20px; margin-bottom: 6px; }
.item { background: #1f2438; border-radius: 8px; padding: 12px; margin: 18px 0; }
.item .name { font-size: 17px; font-weight: 600; }
.item .num { font-size: 13px; color: #8b92a8; }
p { font-size: 15px; color: #c5cad8; }
.btn { display: block; background: #3b7dd8; color: #fff; text-decoration: none; font-weight: 600; padding: 12px; border-radius: 8px; margin: 18px 0 8px; }
.email { font-size: 14px; color: #8b92a8; word-break: break-all; }
.email a { color: #5594f0; }
.signin { margin-top: 24px; font-size: 13px; }
.signin a { color: #8b92a8; }
</style>
</head>
<body>
<div class="card">
  <img src="/logo.png" alt="${esc(club)}">
  <h1>${esc(club)}</h1>
  <p>This equipment belongs to the ${esc(club)} (${esc(clubCall)}).</p>
  ${item ? `<div class="item"><div class="name">${esc(item.name)}</div><div class="num">Item #${item.id}</div></div>` : '<div class="item"><div class="num">Equipment label</div></div>'}
  <p>If you found it, please let us know so we can get it back. Thank you!</p>
  <a class="btn" href="${esc(mailto)}">Email the club</a>
  <div class="email"><a href="${esc(mailto)}">${esc(email)}</a></div>
  ${id ? `<div class="signin"><a href="/i/${id}?signin">Club officer? Sign in to view this item</a></div>` : ''}
</div>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
