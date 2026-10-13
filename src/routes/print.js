/**
 * Print-friendly pages — standalone HTML, no SPA chrome
 * GET /print                      — member directory
 * GET /print/treasurer?year=YYYY  — treasurer report (board and admin)
 */

import { requireAuth, isBoardOrAbove } from '../lib/auth.js';
import { treasurerReport, parseReportYear, EASTMAN_PER_MEMBER } from '../lib/treasurerReport.js';

const CLASS_ORDER = ['Amateur Extra', 'Advanced', 'General', 'Technician Plus', 'Technician', 'Novice'];

export async function handlePrint(request, env) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }

  const year = new Date().getFullYear();

  const { results: members } = await env.DB.prepare(`
    SELECT m.callsign, m.first_name, m.last_name, m.license_class, m.phone, m.email, m.city, m.state,
           (SELECT ms.status FROM memberships ms
            WHERE ms.member_id = m.id AND ms.year = ?
            LIMIT 1) AS dues_status
    FROM members m
    WHERE m.is_active = 1 AND m.is_silent_key = 0
    ORDER BY m.last_name ASC, m.first_name ASC
  `).bind(year).all();

  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const paid  = members.filter(m => ['active','honorary','waived'].includes(m.dues_status)).length;

  const rows = members.map(m => {
    const name     = `${m.last_name}, ${m.first_name}`;
    const callsign = m.callsign || '—';
    const cls      = m.license_class || '—';
    const phone    = m.phone || '—';
    const email    = m.email || '—';
    const location = [m.city, m.state].filter(Boolean).join(', ') || '—';
    const paid     = ['active','honorary','waived'].includes(m.dues_status);
    return `
      <tr>
        <td class="callsign">${esc(callsign)}</td>
        <td>${esc(name)}</td>
        <td>${esc(cls)}</td>
        <td>${esc(phone)}</td>
        <td>${esc(email)}</td>
        <td>${esc(location)}</td>
        <td class="dues ${paid ? 'paid' : 'unpaid'}">${paid ? '✓' : '—'}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KARC Member Directory — ${year}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Georgia', serif; font-size: 11pt; color: #111; background: #fff; padding: 0.5in; }
header { margin-bottom: 18px; }
h1 { font-size: 18pt; font-weight: bold; }
.subtitle { font-size: 10pt; color: #555; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 9.5pt; }
thead th { border-bottom: 2px solid #111; padding: 5px 6px; text-align: left; font-family: 'Arial', sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
tbody td { border-bottom: 1px solid #ddd; padding: 5px 6px; vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
.callsign { font-family: 'Courier New', monospace; font-weight: bold; white-space: nowrap; }
.dues { text-align: center; }
.dues.paid { color: #1a7a3a; font-weight: bold; }
.dues.unpaid { color: #aaa; }
.no-print { margin-top: 20px; }
.no-print button { font-family: sans-serif; font-size: 11pt; padding: 8px 20px; cursor: pointer; background: #1a4fa8; color: #fff; border: none; border-radius: 4px; }
@media print {
  .no-print { display: none; }
  body { padding: 0; }
  a { text-decoration: none; color: inherit; }
}
</style>
</head>
<body>
<header>
  <img src="/logo.png" alt="KARC" style="height:52px;margin-bottom:8px;display:block">
  <h1>Kingsport Amateur Radio Club (KARC)</h1>
  <div class="subtitle">Active Member Directory &nbsp;·&nbsp; ${esc(date)} &nbsp;·&nbsp; ${members.length} members &nbsp;·&nbsp; ${paid} paid ${year}</div>
</header>
<table>
  <thead>
    <tr>
      <th>Callsign</th>
      <th>Name</th>
      <th>License Class</th>
      <th>Phone</th>
      <th>Email</th>
      <th>City / State</th>
      <th>${year} Dues</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export async function handlePrintTreasurer(request, env) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok || !isBoardOrAbove(authResult.user)) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }

  const year = parseReportYear(new URL(request.url).searchParams.get('year'));
  if (!year) return new Response('Invalid year', { status: 400 });
  const r = await treasurerReport(env, year);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const methodRows = r.by_method.map(m => `
      <tr>
        <td>${esc(title(m.method))}</td>
        <td class="num">${m.dues_count || ''}</td><td class="num">${m.dues_count ? money(m.dues) : ''}</td>
        <td class="num">${m.donation_count || ''}</td><td class="num">${m.donation_count ? money(m.donations) : ''}</td>
        <td class="num">${money(m.total)}</td>
      </tr>`).join('');

  const duesYearRows = r.dues_by_year.map(d => `
      <tr><td>${d.dues_year} dues${d.dues_year > year ? ' (paid in advance)' : d.dues_year < year ? ' (paid late)' : ''}</td><td class="num">${d.count}</td><td class="num">${money(d.amount)}</td></tr>`).join('');

  const ledgerRows = r.ledger.map(l => `
      <tr>
        <td>${esc(l.date || '—')}</td>
        <td>${esc(l.detail)}</td>
        <td>${esc(l.name)}${l.callsign ? ` <span class="callsign">${esc(l.callsign)}</span>` : ''}</td>
        <td>${esc(title(l.method))}${l.check_number && l.method !== 'stripe' ? ` #${esc(l.check_number)}` : ''}</td>
        <td class="num">${money(l.amount)}</td>
      </tr>`).join('');

  const itemRows = r.items.map(i => `
      <tr>
        <td>${esc(i.date)}</td>
        <td>${esc(i.description || 'Item')}</td>
        <td>${esc(i.name)}${i.callsign ? ` <span class="callsign">${esc(i.callsign)}</span>` : ''}</td>
        <td class="num">${i.estimated_value != null ? money(i.estimated_value) : '—'}</td>
      </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KARC Treasurer Report — ${year}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Georgia', serif; font-size: 11pt; color: #111; background: #fff; padding: 0.5in; }
h1 { font-size: 18pt; font-weight: bold; }
h2 { font-family: 'Arial', sans-serif; font-size: 10pt; text-transform: uppercase; letter-spacing: .04em; margin-top: 22px; }
.subtitle { font-size: 10pt; color: #555; margin-top: 4px; }
.totals { display: flex; gap: 28px; margin-top: 16px; }
.totals div { font-family: 'Arial', sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; color: #555; }
.totals strong { display: block; font-family: 'Georgia', serif; font-size: 15pt; color: #111; letter-spacing: 0; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
thead th { border-bottom: 2px solid #111; padding: 5px 6px; text-align: left; font-family: 'Arial', sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
tbody td { border-bottom: 1px solid #ddd; padding: 5px 6px; vertical-align: top; }
tfoot td { border-top: 2px solid #111; padding: 5px 6px; font-weight: bold; }
.num, thead th.num { text-align: right; white-space: nowrap; }
.callsign { font-family: 'Courier New', monospace; font-weight: bold; white-space: nowrap; }
.note { font-size: 9pt; color: #555; margin-top: 8px; }
.no-print { margin-top: 20px; }
.no-print button { font-family: sans-serif; font-size: 11pt; padding: 8px 20px; cursor: pointer; background: #1a4fa8; color: #fff; border: none; border-radius: 4px; }
@media print {
  .no-print { display: none; }
  body { padding: 0; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}
</style>
</head>
<body>
<header>
  <img src="/logo.png" alt="KARC" style="height:52px;margin-bottom:8px;display:block">
  <h1>Kingsport Amateur Radio Club (KARC)</h1>
  <div class="subtitle">Treasurer Report &nbsp;·&nbsp; Money received in ${year} &nbsp;·&nbsp; Printed ${esc(date)}</div>
</header>
<div class="totals">
  <div><strong>${money(r.totals.received)}</strong>Total received</div>
  <div><strong>${money(r.totals.dues)}</strong>Dues</div>
  <div><strong>${money(r.totals.donations)}</strong>Donations</div>
  <div><strong>${r.totals.payments}</strong>Payments</div>
</div>
${r.ledger.length ? `
<h2>By payment method</h2>
<table>
  <thead><tr><th>Method</th><th class="num">Dues</th><th class="num">Amount</th><th class="num">Donations</th><th class="num">Amount</th><th class="num">Total</th></tr></thead>
  <tbody>${methodRows}</tbody>
  <tfoot><tr><td>Total</td><td></td><td class="num">${money(r.totals.dues)}</td><td></td><td class="num">${money(r.totals.donations)}</td><td class="num">${money(r.totals.received)}</td></tr></tfoot>
</table>
${r.dues_by_year.length ? `
<h2>Dues by membership year</h2>
<table>
  <thead><tr><th>For</th><th class="num">Payments</th><th class="num">Amount</th></tr></thead>
  <tbody>${duesYearRows}</tbody>
</table>` : ''}
<h2>Payments</h2>
<table>
  <thead><tr><th>Date</th><th>For</th><th>From</th><th>Method</th><th class="num">Amount</th></tr></thead>
  <tbody>${ledgerRows}</tbody>
  <tfoot><tr><td colspan="4">Total</td><td class="num">${money(r.totals.received)}</td></tr></tfoot>
</table>` : `<p class="note" style="margin-top:20px">No payments recorded for ${year}.</p>`}
${r.undated ? `<p class="note">${r.undated} dues payment${r.undated !== 1 ? 's have' : ' has'} no paid date and ${r.undated !== 1 ? 'are' : 'is'} counted in the year the dues are for.</p>` : ''}
${r.eastman.members ? `<p class="note">Not included above: Eastman sponsors ${r.eastman.members} member${r.eastman.members !== 1 ? 's' : ''} for ${year} at ${money(EASTMAN_PER_MEMBER)} each, ${money(r.eastman.amount)} in all.</p>` : ''}
${r.items.length ? `
<h2>Item donations (not money)</h2>
<table>
  <thead><tr><th>Date</th><th>Item</th><th>From</th><th class="num">Estimated value</th></tr></thead>
  <tbody>${itemRows}</tbody>
  <tfoot><tr><td colspan="3">Total estimated value</td><td class="num">${money(r.items_value)}</td></tr></tfoot>
</table>` : ''}
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
