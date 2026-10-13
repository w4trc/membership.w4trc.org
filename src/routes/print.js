/**
 * Print-friendly pages — standalone HTML, no SPA chrome
 * GET /print                      — member directory
 * GET /print/treasurer?year=YYYY  — treasurer report (board and admin)
 * GET /print/certificate?member_id=N&year=YYYY — membership certificate (board and admin)
 * GET /print/card?member_id=N&year=YYYY        — membership card (board and admin)
 */

import { requireAuth, isBoardOrAbove } from '../lib/auth.js';
import { memberCredential } from '../lib/standing.js';
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

// ── Membership certificate and card ──────────────────────────────────────────

const CREDENTIAL_STYLE = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Georgia', serif; color: #111; background: #e9e9e9; padding: 24px; }
.callsign { font-family: 'Courier New', monospace; font-weight: bold; letter-spacing: .06em; }
.no-print { text-align: center; margin: 20px auto 0; font-family: sans-serif; font-size: 10pt; color: #555; }
.no-print button { font-family: sans-serif; font-size: 11pt; padding: 8px 20px; cursor: pointer; background: #1a4fa8; color: #fff; border: none; border-radius: 4px; margin-bottom: 8px; }
.message { max-width: 480px; margin: 80px auto; background: #fff; padding: 32px; border-radius: 6px; font-family: sans-serif; font-size: 11pt; line-height: 1.5; }
.message h1 { font-size: 14pt; margin-bottom: 8px; }
@media print {
  body { background: #fff; padding: 0; }
  .no-print { display: none; }
}
`;

function credentialPage(title, style, body) {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${CREDENTIAL_STYLE}${style}</style>
</head>
<body>
${body}
</body>
</html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function credentialMessage(heading, text, status) {
  const page = credentialPage(heading, '', `<div class="message"><h1>${esc(heading)}</h1><p>${esc(text)}</p></div>`);
  return new Response(page.body, { status, headers: page.headers });
}

/**
 * GET /print/certificate and /print/card, for the member in ?member_id=.
 * Board and admin only for now. Only for a year the member is in good standing.
 */
export async function handlePrintCredential(request, env, kind) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok || !isBoardOrAbove(authResult.user)) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }
  const params = new URL(request.url).searchParams;

  const year = parseReportYear(params.get('year'));
  if (!year) return credentialMessage('Not available', 'That is not a valid year.', 400);

  const memberId = Number(params.get('member_id'));
  if (!Number.isInteger(memberId) || memberId < 1) {
    return credentialMessage('Not available', 'Open the certificate or card from the member detail view.', 404);
  }

  const c = await memberCredential(env, memberId, year);
  if (!c) {
    return credentialMessage('Not available yet',
      `There is no ${year} membership on record for this member. The certificate and card are available once ${year} dues are paid.`, 404);
  }

  const club = env.CLUB_NAME || 'Kingsport Amateur Radio Club';
  const clubCall = env.CLUB_CALLSIGN || 'W4TRC';
  return kind === 'card' ? cardPage(c, club, clubCall) : certificatePage(c, club, clubCall);
}

function certificatePage(c, club, clubCall) {
  const lifetime = c.standing === 'Lifetime Honorary Member';
  const article  = c.standing === 'Honorary Member' ? 'an' : 'a';
  const signature = (officer, role) => `
      <div class="sig">
        <div class="line"></div>
        <div class="who">${officer ? `${esc(officer.name)}${officer.callsign ? `, <span class="callsign">${esc(officer.callsign)}</span>` : ''}` : '&nbsp;'}</div>
        <div class="role">${role}</div>
      </div>`;

  return credentialPage(`${club} Membership Certificate ${c.year}`, `
@page { size: letter landscape; margin: 0.4in; }
.sheet { width: 10.2in; height: 7.7in; margin: 0 auto; background: #fff; padding: 0.18in; }
.frame { height: 100%; border: 3px solid #1a3a6b; outline: 1px solid #b08d3c; outline-offset: -9px; padding: 0.45in 0.7in 0.4in; text-align: center; display: flex; flex-direction: column; align-items: center; }
.frame img { height: 0.95in; }
.club { font-size: 17pt; letter-spacing: .04em; margin-top: 8px; }
.clubcall { font-size: 12pt; color: #1a3a6b; margin-top: 2px; }
h1 { font-size: 30pt; font-weight: normal; font-style: italic; color: #1a3a6b; margin-top: 0.22in; }
.lead { font-size: 12pt; color: #444; margin-top: 0.2in; }
.name { font-size: 30pt; margin-top: 0.1in; border-bottom: 1px solid #b08d3c; padding: 0 0.5in 4px; }
.membercall { font-size: 17pt; color: #1a3a6b; margin-top: 8px; }
.text { font-size: 13pt; line-height: 1.5; margin-top: 0.16in; max-width: 7.6in; text-wrap: balance; }
.since { font-size: 10.5pt; color: #555; margin-top: 6px; }
.sigs { display: flex; justify-content: space-between; width: 100%; margin-top: auto; }
.sig { width: 3in; }
.sig .line { border-bottom: 1px solid #111; height: 0.4in; }
.sig .who { font-size: 10.5pt; margin-top: 4px; min-height: 14pt; }
.sig .role { font-family: 'Arial', sans-serif; font-size: 8pt; text-transform: uppercase; letter-spacing: .08em; color: #555; margin-top: 2px; }
`, `
<div class="sheet">
  <div class="frame">
    <img src="/logo.png" alt="">
    <div class="club">${esc(club)}</div>
    <div class="clubcall callsign">${esc(clubCall)}</div>
    <h1>Certificate of Membership</h1>
    <div class="lead">This certifies that</div>
    <div class="name">${esc(c.name)}</div>
    ${c.callsign ? `<div class="membercall callsign">${esc(c.callsign)}</div>` : ''}
    <div class="text">is ${article} <strong>${esc(c.standing)}</strong> in good standing of the ${esc(club)}${lifetime ? '' : ` for the year <strong>${c.year}</strong>`}.</div>
    ${c.member_since ? `<div class="since">Member since ${c.member_since}</div>` : ''}
    <div class="sigs">${signature(c.president, 'President')}${signature(c.secretary, 'Secretary')}</div>
  </div>
</div>
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
  <div>Prints on one landscape letter page. Turn off headers and footers in the print dialog.</div>
</div>`);
}

function cardPage(c, club, clubCall) {
  return credentialPage(`${club} Membership Card ${c.year}`, `
@page { size: letter portrait; margin: 0.5in; }
.card { width: 3.375in; height: 2.125in; margin: 0 auto; background: #fff; border: 1px dashed #888; border-radius: 0.12in; overflow: hidden; display: flex; flex-direction: column; }
.top { background: #1a3a6b; color: #fff; display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.top img { height: 0.42in; background: #fff; border-radius: 3px; padding: 2px; }
.top .club { font-size: 9pt; line-height: 1.2; flex: 1; }
.top .club .callsign { font-size: 8pt; color: #d9c48a; }
.top .year { font-family: 'Arial', sans-serif; font-size: 17pt; font-weight: bold; }
.mid { flex: 1; padding: 6px 12px 0; display: flex; flex-direction: column; justify-content: center; }
.mid .membercall { font-size: 19pt; color: #1a3a6b; line-height: 1.1; }
.mid .name { font-size: 12.5pt; margin-top: 2px; }
.mid .standing { font-family: 'Arial', sans-serif; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: #555; margin-top: 4px; }
.bottom { font-family: 'Arial', sans-serif; font-size: 6.8pt; color: #555; display: flex; justify-content: space-between; padding: 4px 12px 7px; }
`, `
<div class="card">
  <div class="top">
    <img src="/logo.png" alt="">
    <div class="club">${esc(club)}<br><span class="callsign">${esc(clubCall)}</span></div>
    <div class="year">${c.year}</div>
  </div>
  <div class="mid">
    ${c.callsign ? `<div class="membercall callsign">${esc(c.callsign)}</div>` : ''}
    <div class="name">${esc(c.name)}</div>
    <div class="standing">${esc(c.standing)}${c.license_class ? ` · ${esc(c.license_class)}` : ''}</div>
  </div>
  <div class="bottom">
    <span>${c.member_since ? `Member since ${c.member_since}` : ''}</span>
    <span>${c.standing === 'Lifetime Honorary Member' ? 'Lifetime membership' : `Valid through December 31, ${c.year}`}</span>
  </div>
</div>
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
  <div>Print at 100% scale (not "fit to page") and cut along the dashed line. It is the size of a credit card.</div>
</div>`);
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
