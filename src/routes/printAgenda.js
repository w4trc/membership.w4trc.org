/**
 * Printed meeting agenda — standalone HTML laid out like the club's paper
 * agenda and checklist. Whatever officers have filled in is printed; anything
 * still empty prints as a blank line to write on.
 * GET /print/agenda?id=N  (board and admin)
 */

import { requireAuth, isBoardOrAbove } from '../lib/auth.js';
import { agendaData } from './agendas.js';

const MEETING_TYPE_LABELS = {
  monthly: 'Monthly Meeting', board: 'Board Meeting', ve_session: 'VE Session',
  field_day: 'Field Day', special: 'Special Event', other: 'Meeting',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Text with its line breaks kept
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

/** "19:05" → "7:05 PM" */
export function clock(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function formatDate(ymd, opts) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
const longDate  = (ymd) => formatDate(ymd, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (ymd) => formatDate(ymd, { month: 'short', day: 'numeric' });

export async function handlePrintAgenda(request, env) {
  const authResult = await requireAuth(request, env);
  if (!authResult.ok || !isBoardOrAbove(authResult.user)) {
    return new Response(null, { status: 302, headers: { Location: '/' } });
  }

  const id = parseInt(new URL(request.url).searchParams.get('id'), 10);
  const data = id ? await agendaData(env, id) : null;
  if (!data) return new Response('Agenda not found', { status: 404 });

  return new Response(agendaHtml(data), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function agendaHtml(data) {
  const { agenda: a, template, report_slots, income } = data;
  const checked = new Set(data.checks.map(c => c.step));
  const reports = new Map(data.reports.map(r => [r.report_key, r]));
  const items   = (section) => data.items.filter(i => i.section === section);

  const box    = (on) => `<span class="box${on ? ' on' : ''}">${on ? '&#10003;' : ''}</span>`;
  const blank  = (n) => '<div class="line"></div>'.repeat(n);
  const textOr = (value, n) => (value ? `<div class="filled">${multiline(value)}</div>` : blank(n));
  const fill   = (cells) => `<div class="fill">${cells.map(([label, value, w]) => `
      <div style="flex:${w || 1}"><div class="val">${value ? esc(value) : '&nbsp;'}</div><div class="lbl">${label}</div></div>`).join('')}
    </div>`;

  const stepRow = (st) => {
    const extra = st.field ? `<span class="right"><span class="muted">${esc(st.fieldLabel)}:</span> ${esc(a[st.field] || '')}</span>`
      : st.time ? `<span class="right"><span class="muted">Time:</span> ${esc(clock(a[st.time]))}</span>` : '';
    return `<div class="row">${box(checked.has(st.key))}<div class="txt"><b>${esc(st.label)}</b>${st.hint ? ` <span class="muted">${esc(st.hint)}</span>` : ''}</div>${extra}</div>`;
  };

  // Business items, then `spare` blank rows for items raised at the meeting
  const itemRows = (list, spare) => list.map(i => `
      <div class="row">${box(i.status !== 'open')}<div class="txt">
        <b>${esc(i.title)}</b>${i.status !== 'open' ? ` <span class="tag">${esc(i.status)}</span>` : ''}${i.owner ? ` <span class="muted">— ${esc(i.owner)}</span>` : ''}${i.carried_from_date ? ` <span class="muted">(from ${esc(shortDate(i.carried_from_date))})</span>` : ''}
        ${i.details ? `<div class="detail">${multiline(i.details)}</div>` : ''}
      </div></div>`).join('')
    + `<div class="row">${box(false)}<div class="txt"><span class="muted">Item:</span><span class="line inline"></span></div></div>`.repeat(spare);

  const blocks = {
    reports: () => report_slots.map(slot => {
      const r = reports.get(slot.key);
      const who = slot.officers.map(o => [o.name, o.callsign].filter(Boolean).join(' ')).join(', ');
      const treasurer = slot.key !== 'treasurer' ? '' : `
        ${fill([['BEGINNING BALANCE', a.treasurer_begin], ['ENDING BALANCE', a.treasurer_end]])}
        <div class="income">Received ${income.since_last_meeting ? 'since the last meeting' : 'since'} (${esc(shortDate(income.since))}):
          dues ${money(income.dues.total)} (${income.dues.count}), donations ${money(income.donations.total)} (${income.donations.count}),
          <b>total ${money(income.total)}</b></div>`;
      return `<div class="report">
        <div class="row">${box(!!r?.given)}<div class="txt"><b>${esc(slot.label)}</b>${who ? ` <span class="muted">${esc(who)}</span>` : ''}</div></div>
        <div class="indent">${treasurer}${textOr(r?.body, slot.key === 'committee' ? 1 : 2)}</div>
      </div>`;
    }).join(''),
    old: () => itemRows(items('old'), items('old').length ? 1 : 3),
    new: () => itemRows(items('new'), 2),
    motions: () => {
      const rows = data.motions.map((m, i) => `<tr>
        <td class="muted">${i + 1}</td><td>${multiline(m.motion)}</td><td>${esc(m.moved_by || '')}</td><td>${esc(m.seconded_by || '')}</td>
        <td class="num">${m.votes_yes ?? ''}</td><td class="num">${m.votes_no ?? ''}</td><td class="num">${m.votes_abstain ?? ''}</td><td>${esc(m.result || '')}</td>
      </tr>`).join('');
      const spare = Array.from({ length: Math.max(3 - data.motions.length, 1) }, (_, i) =>
        `<tr class="blank"><td class="muted">${data.motions.length + i + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
      return `<table class="motions">
        <thead><tr><th>#</th><th>Motion</th><th>Moved by</th><th>Seconded</th><th>Yes</th><th>No</th><th>Abs</th><th>Result</th></tr></thead>
        <tbody>${rows}${spare}</tbody>
      </table>
      <div class="lbl" style="margin-top:6px">DISCUSSION NOTES</div>${textOr(a.discussion_notes, 2)}`;
    },
    announcement: () => {
      const list = items('announcement');
      const rows = list.map(i => `<div class="ann">&bull; <b>${esc(i.title)}</b>${i.owner ? ` <span class="muted">— ${esc(i.owner)}</span>` : ''}${i.details ? ` — ${multiline(i.details)}` : ''}</div>`).join('');
      return `<div class="indent">${rows}${blank(list.length ? 1 : 2)}</div>`;
    },
    presentation: () => `
      ${fill([['PRESENTATION TITLE', a.presentation_title], ['PRESENTER NAME', a.presenter_name]])}
      ${fill([['CALLSIGN / TITLE / AFFILIATION', a.presenter_affiliation], ['PHONE / EMAIL', a.presenter_contact], ['EST. LENGTH', a.presentation_length]])}
      <div class="lbl" style="margin-top:6px">INTRODUCTION — presenter bio, topic overview, why it matters to the club</div>
      ${textOr(a.presentation_intro, 4)}`,
    next: () => `<div class="indent">${fill([['NEXT MEETING DATE', longDate(a.next_meeting_date)], ['TIME / LOCATION', a.next_meeting_place], ['NEXT PRESENTER / TOPIC', a.next_presenter]])}</div>`,
  };

  const sections = template.sections.map(sec => {
    const list = sec.list ? blocks[sec.list]() : '';
    const steps = sec.steps.map(st => stepRow(st) + (sec.listAfter === st.key ? list : '')).join('');
    const after = sec.list === 'presentation'
      ? `<div class="lbl" style="margin-top:6px">PRESENTATION NOTES / FOLLOW-UP</div>${textOr(a.presentation_notes, 2)}` : '';
    return `<section>
      <div class="bar">${sec.number}.&nbsp; ${esc(sec.title)}</div>
      ${sec.note ? `<div class="note">${esc(sec.note)}</div>` : ''}
      ${sec.listAfter ? steps : list + steps}${after}
    </section>`;
  }).join('');

  const type   = MEETING_TYPE_LABELS[a.meeting_type] || 'Meeting';
  const quorum = a.quorum === 1 ? 'Quorum: Yes' : a.quorum === 0 ? 'Quorum: No' : '';
  const count  = data.attendance.total ? `${data.attendance.total} present` : '';
  const called = clock(a.called_to_order) || (a.start_time ? `(planned ${clock(a.start_time)})` : '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>KARC ${esc(type)} Agenda — ${esc(a.meeting_date)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 9.5pt; line-height: 1.35; color: #111; background: #fff; padding: 0.55in 0.65in; }
header { text-align: center; }
h1 { font-size: 20pt; color: #1F3A5F; }
.subtitle { font-size: 10pt; color: #666; margin-top: 2px; }
.meeting { font-size: 11pt; font-weight: bold; margin-top: 4px; }
.fill { display: flex; gap: 12px; margin-top: 8px; }
.fill .val { border-bottom: 0.6pt solid #9AA5B1; min-height: 18px; padding: 0 4px; }
.lbl { font-size: 7.5pt; font-weight: bold; color: #666; letter-spacing: .03em; padding: 1px 4px 0; }
section { margin-top: 10px; }
.bar { background: #1F3A5F; color: #fff; font-weight: bold; font-size: 11pt; padding: 3px 8px 4px; break-after: avoid; }
.note { font-style: italic; color: #666; font-size: 8.5pt; margin: 3px 0 2px; }
.row { display: flex; align-items: flex-start; gap: 8px; padding: 3px 6px; break-inside: avoid; }
.row .txt { flex: 1; }
.row .right { width: 2.4in; border-bottom: 0.6pt solid #9AA5B1; font-size: 9pt; }
.box { flex: none; width: 10px; height: 10px; border: 1pt solid #1F3A5F; margin-top: 2px; font-size: 8pt; line-height: 9px; text-align: center; color: #1F3A5F; font-weight: bold; }
.muted { color: #666; font-weight: normal; }
.tag { font-size: 7.5pt; text-transform: uppercase; border: 0.6pt solid #9AA5B1; border-radius: 3px; padding: 0 3px; color: #1F3A5F; }
.detail { color: #333; margin-top: 1px; }
.indent { padding-left: 30px; padding-right: 6px; }
.line { border-bottom: 0.6pt solid #9AA5B1; height: 17px; }
.line.inline { display: inline-block; width: 85%; height: 12px; vertical-align: bottom; margin-left: 4px; }
.filled { padding: 2px 0; border-bottom: 0.6pt solid #9AA5B1; }
.report { break-inside: avoid; margin-top: 2px; }
.income { font-size: 8.5pt; margin-top: 4px; color: #333; }
.ann { padding: 1px 0; }
table.motions { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 9pt; }
.motions th { background: #E8EEF5; color: #1F3A5F; text-align: left; font-size: 8.5pt; padding: 2px 4px; border: 0.6pt solid #9AA5B1; }
.motions td { border: 0.6pt solid #9AA5B1; padding: 3px 4px; vertical-align: top; }
.motions tr.blank td { height: 30px; }
.motions th:nth-child(1) { width: 0.28in; }
.motions th:nth-child(2) { width: 2.55in; }
.motions th:nth-child(5), .motions th:nth-child(6), .motions th:nth-child(7) { width: 0.4in; }
.num { text-align: right; }
footer { margin-top: 16px; border-top: 0.6pt solid #9AA5B1; padding-top: 4px; font-size: 8pt; color: #666; display: flex; justify-content: space-between; }
.no-print { margin-top: 20px; }
.no-print button { font-size: 11pt; padding: 8px 20px; cursor: pointer; background: #1F3A5F; color: #fff; border: none; border-radius: 4px; }
@media print {
  .no-print { display: none; }
  body { padding: 0; }
  @page { size: letter; margin: 0.55in 0.65in 0.7in; }
  .bar, .motions th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<header>
  <h1>Kingsport Amateur Radio Club</h1>
  <div class="subtitle">W4TRC &nbsp;&bull;&nbsp; Meeting Agenda &amp; Checklist &nbsp;&bull;&nbsp; Robert's Rules of Order</div>
  <div class="meeting">${esc(type)}${a.title ? ' — ' + esc(a.title) : ''}</div>
</header>
${fill([['DATE', longDate(a.meeting_date), 1.4], ['LOCATION', a.location, 1.2], ['TIME CALLED TO ORDER', called], ['TIME ADJOURNED', clock(a.adjourned_at)]])}
${fill([['PRESIDING', a.presiding], ['SECRETARY (RECORDING)', a.secretary], ['ATTENDANCE COUNT / QUORUM Y / N', [count, quorum].filter(Boolean).join(' · ')]])}
${sections}
<footer><span>KARC / W4TRC &nbsp;|&nbsp; Meeting Agenda &amp; Checklist</span><span>Printed ${esc(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}</span></footer>
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
</body>
</html>`;
}
