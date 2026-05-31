/**
 * Print-friendly member directory
 * GET /print  — returns standalone HTML, no SPA chrome
 */

import { requireAuth } from '../lib/auth.js';

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

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
