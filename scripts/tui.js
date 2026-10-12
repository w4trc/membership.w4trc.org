#!/usr/bin/env node
/**
 * KARC terminal UI — search members, equipment inventory and meeting attendance
 * from a terminal, record a new meeting's attendance, and move, check out or
 * annotate an inventory item.
 *
 * Usage:
 *   npm run tui                      production (https://members.w4trc.org)
 *   npm run tui -- --local           wrangler dev (http://localhost:8787)
 *   npm run tui -- --url <base url>  anywhere else (or set KARC_URL)
 *   npm run tui -- --logout          sign out and forget the saved session
 *
 * Signs in with your normal admin/board account and talks to the same API as
 * the web UI. The session id is kept in ~/.karc-tui.json so you stay signed in.
 * It writes only a new meeting, an inventory move and an inventory note;
 * everything else is read-only.
 *
 * No dependencies. Needs Node 18.14+ (built-in fetch). Works in Windows
 * Terminal, PowerShell, and macOS/Linux terminals.
 */

const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const urlArg = args.indexOf('--url');
const BASE   = (
  (urlArg >= 0 && args[urlArg + 1]) ||
  (args.includes('--local') ? 'http://localhost:8787' : process.env.KARC_URL || 'https://members.w4trc.org')
).replace(/\/+$/, '');

const SESSION_FILE = path.join(os.homedir(), '.karc-tui.json');

// Saved sessions are keyed by base URL, so --local and production don't collide
function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')) || {}; } catch { return {}; }
}

function saveSession(session) {
  const all = readSessions();
  if (session) all[BASE] = session; else delete all[BASE];
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
  } catch {
    // Not being able to save only means signing in again next time
  }
}

// ── API ──────────────────────────────────────────────────────────────────────

const state = {
  view:    'login',   // login | list | detail | form | action
  tab:     'members', // members | inventory | meetings
  session: readSessions()[BASE] || null,
  user:    null,
  login:   { email: '', password: '', field: 'email', error: '', busy: false },
  detail:  null,      // { kind, data, error, scroll }
  form:    null,      // the new-meeting form, see openMeetingForm()
  action:  null,      // an inventory move or note in progress, see openItemAction()
  flash:   null,      // { text, ok } one-line result of the last action, cleared by the next key
};

async function api(apiPath, { method = 'GET', body } = {}) {
  const headers = {};
  if (state.session) headers.Cookie = `karc_session=${state.session}`;
  if (body)          headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}/api${apiPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new Error(`Can't reach ${BASE} (${err.cause?.code || err.message})`);
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const error = new Error(data?.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return { data, res };
}

async function signIn() {
  const l = state.login;
  if (l.busy) return;
  if (!l.email.trim() || !l.password) { l.error = 'Email and password required'; return render(); }

  l.busy = true; l.error = ''; render();
  try {
    const { data, res } = await api('/auth/login', { method: 'POST', body: { email: l.email.trim(), password: l.password } });
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie().join('; ') : res.headers.get('set-cookie') || '';
    const match   = cookies.match(/karc_session=([a-f0-9]{64})/);
    if (!match) throw new Error('Signed in, but the server sent no session');

    state.session = match[1];
    state.user    = data.user;
    saveSession(state.session);
    l.password = '';
    enterList();
  } catch (err) {
    l.error = err.status === 429 ? 'Too many attempts — wait 15 minutes and try again' : err.message;
  } finally {
    l.busy = false;
    render();
  }
}

// The saved session stopped working: forget it and ask for the password again
function sessionExpired() {
  state.session = null;
  state.user    = null;
  saveSession(null);
  state.view = 'login';
  state.login.field = state.login.email ? 'password' : 'email';
  state.login.error = 'Session expired — sign in again';
  render();
}

// ── Lists ────────────────────────────────────────────────────────────────────

const MEETING_TYPES = [
  ['monthly', 'Monthly'], ['board', 'Board'], ['ve_session', 'VE Session'],
  ['field_day', 'Field Day'], ['special', 'Special'], ['other', 'Other'],
];

const FILTERS = {
  members:   [['all', 'All'], ['active', 'Active'], ['unpaid', 'Unpaid this year'], ['inactive', 'Inactive'], ['silent_key', 'Silent Key']],
  inventory: [['', 'All'], ['out', 'Checked out']],
  meetings:  [['', 'All'], ...MEETING_TYPES],
};

const newTab = label => ({
  label, query: '', filter: 0, rows: [], total: 0, sel: 0, top: 0,
  page: 0, pages: 0, loaded: false, loading: false, error: '', seq: 0,
});
const tabs = { members: newTab('Members'), inventory: newTab('Inventory'), meetings: newTab('Meetings') };
const cur  = () => tabs[state.tab];

// Every page of a member search, for the views that need the whole list
async function allMembers(query, status) {
  const rows = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const params = new URLSearchParams({ status, page });
    if (query) params.set('q', query);
    const { data } = await api(`/members?${params}`);
    rows.push(...data.members);
    pages = data.pagination.pages;
  }
  return rows;
}

// Same rule as the annual membership cutoff in src/routes/admin.js: an active
// member with no paid or exempt dues record for the current year
const isUnpaid = m =>
  m.is_active && !m.is_silent_key && m.membership_type !== 'lifetime_honorary' &&
  !(m.current_year_paid != null || m.current_year_covered_by ||
    m.current_year_status === 'honorary' || m.current_year_status === 'waived' ||
    m.current_year_payment_method === 'eastman');

// Each load takes a sequence number so a slow response to an old search
// can't overwrite the results of a newer one. `keep` holds the selection in
// place when reloading after a change.
async function load(name, { append = false, keep = false } = {}) {
  const t   = tabs[name];
  const seq = ++t.seq;
  t.loading = true; t.error = '';
  render();

  try {
    const params = new URLSearchParams();
    const filter = FILTERS[name][t.filter][0];
    const query  = t.query.trim();

    let rows, total, page = 1, pages = 1;
    if (name === 'members' && filter === 'unpaid') {
      // The API can't filter on dues, so fetch every active member and filter here
      rows = (await allMembers(query, 'active')).filter(isUnpaid);
      total = rows.length;
    } else if (name === 'members') {
      page = append ? t.page + 1 : 1;
      if (query) params.set('q', query);
      params.set('status', filter);
      params.set('page', page);
      const { data } = await api(`/members?${params}`);
      rows = data.members; total = data.pagination.total; pages = data.pagination.pages;
    } else if (name === 'inventory') {
      if (query)  params.set('q', query);
      if (filter) params.set('location', filter);
      const { data } = await api(`/inventory?${params}`);
      rows = data.items; total = rows.length;
    } else {
      // The meetings API has no search, and the list is short: filter it here
      const { data } = await api('/meetings');
      const q = query.toLowerCase();
      rows = data.meetings.filter(mt =>
        (!filter || mt.meeting_type === filter) &&
        (!q || `${mt.meeting_date} ${typeLabel(mt.meeting_type)} ${mt.title || ''} ${mt.notes || ''}`.toLowerCase().includes(q)));
      total = rows.length;
    }
    if (seq !== t.seq) return;

    t.rows = append ? t.rows.concat(rows) : rows;
    if (!append && !keep) { t.sel = 0; t.top = 0; }
    t.sel = Math.max(0, Math.min(t.sel, t.rows.length - 1));
    Object.assign(t, { total, page, pages, loaded: true });
  } catch (err) {
    if (seq !== t.seq) return;
    if (err.status === 401) return sessionExpired();
    t.error = err.status === 403 ? 'Your account does not have access to this' : err.message;
    if (!append) { t.rows = []; t.total = 0; }
  } finally {
    if (seq === t.seq) { t.loading = false; render(); }
  }
}

function enterList() {
  // Signing in again after a session expired mid-form goes back to the form
  state.view = state.form ? 'form' : 'list';
  for (const t of Object.values(tabs)) t.loaded = false;
  load(state.tab);
}

let searchTimer = null;
function searchSoon() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => load(state.tab), 200);
  render();
}

function moveSelection(delta) {
  const t = cur();
  t.sel = Math.max(0, Math.min(t.rows.length - 1, t.sel + delta));
  // Members come 50 to a page; fetch the next page as the selection nears the end
  if (state.tab === 'members' && t.sel >= t.rows.length - 5 && t.page < t.pages && !t.loading) {
    load('members', { append: true });
  }
  render();
}

async function openDetail() {
  const row = cur().rows[cur().sel];
  if (!row) return;

  const detail = { kind: state.tab, data: null, error: '', scroll: 0 };
  state.detail = detail;
  state.view   = 'detail';
  render();

  try {
    const { data } = await api(`/${state.tab}/${row.id}`);
    detail.data = data;
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    detail.error = err.message;
  }
  if (state.detail === detail) render();
}

// ── New meeting ──────────────────────────────────────────────────────────────

const FORM_FIELDS = ['date', 'type', 'title', 'notes', 'callsigns', 'guests'];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Starts on the callsigns field: today's monthly meeting is the usual case
function openMeetingForm() {
  state.tab  = 'meetings';
  state.form = {
    field: 'callsigns', date: today(), type: 0, title: '', notes: '', callsigns: '', guests: '',
    resolved: new Map(), // callsign → lookup result, or null while it is being looked up
    error: '', busy: false, confirmDiscard: false,
  };
  state.view = 'form';
  render();
}

// Same rules as parseCallsigns() in src/routes/meetings.js
function parseCallsigns(input) {
  const seen = new Set();
  const out  = [];
  for (const tok of String(input || '').toUpperCase().split(/[\s,;]+/)) {
    const base = tok.split('/').reduce((a, b) => (b.length > a.length ? b : a), '');
    const call = base.replace(/[^A-Z0-9]/g, '');
    if (call.length < 3 || call.length > 7 || !/\d/.test(call) || seen.has(call)) continue;
    seen.add(call);
    out.push(call);
  }
  return out;
}

// The callsigns entered so far, leaving out one that is still being typed
function formCallsigns(f) {
  const typing = f.field === 'callsigns' && !/[\s,;]$/.test(f.callsigns);
  return parseCallsigns(typing ? f.callsigns.replace(/[^\s,;]*$/, '') : f.callsigns);
}

const formGuests = f => f.guests.split(',').map(n => n.trim().replace(/\s+/g, ' ')).filter(Boolean);

// Look up each newly entered callsign once, so the form can show who it is
let lookupTimer = null;
function lookupSoon() {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(lookupCallsigns, 300);
}

async function lookupCallsigns() {
  const f = state.form;
  if (!f) return;
  const callsigns = formCallsigns(f).filter(c => !f.resolved.has(c));
  if (!callsigns.length) return;

  for (const c of callsigns) f.resolved.set(c, null);
  render();
  try {
    const { data } = await api('/meetings/resolve', { method: 'POST', body: { callsigns } });
    for (const a of data.attendees) f.resolved.set(a.callsign, a);
  } catch (err) {
    for (const c of callsigns) f.resolved.delete(c);
    if (err.status === 401) return sessionExpired();
    f.error = `Lookup failed: ${err.message}`;
  }
  if (state.form === f) render();
}

async function saveMeeting() {
  const f = state.form;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(f.date))) {
    f.field = 'date';
    f.error = 'Date must be YYYY-MM-DD';
    return render();
  }

  f.busy = true; f.error = '';
  render();
  try {
    const body = {
      meeting_date: f.date, meeting_type: MEETING_TYPES[f.type][0],
      title: f.title, notes: f.notes, callsigns: f.callsigns, guests: formGuests(f),
    };
    const { data } = await api('/meetings', { method: 'POST', body });
    state.form   = null;
    state.detail = { kind: 'meetings', data, error: '', scroll: 0 };
    state.view   = 'detail';
    state.flash  = { text: 'Meeting saved', ok: true };
    load('meetings');
  } catch (err) {
    f.busy = false;
    if (err.status === 401) return sessionExpired();
    f.error = err.status === 403 ? 'Your account cannot record meetings' : err.message;
    render();
  }
}

// ── Inventory actions ────────────────────────────────────────────────────────
// Move or check out an item, or add a note to it, from its detail screen.

const ACTION_FIELDS = { move: ['dest', 'date', 'note'], note: ['date', 'note'] };
let destinations = null; // every location and active member, fetched once

async function openItemAction(kind) {
  const action = {
    kind, item: state.detail.data.item, field: kind === 'move' ? 'dest' : 'note',
    query: '', sel: 0, date: today(), note: '', error: '', busy: false,
  };
  state.action = action;
  state.view   = 'action';
  render();
  if (kind !== 'move' || destinations) return;

  try {
    const { data } = await api('/inventory/meta');
    destinations = [
      ...data.locations.map(l => ({ location_id: l.id, label: plain(l.name), tag: 'location' })),
      ...data.members.map(m => ({ member_id: m.id, label: `${plain(m.callsign || '')} ${fullName(m)}`.trim(), tag: 'member' })),
    ];
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    action.error = err.message;
  }
  if (state.action === action) render();
}

// Destinations matching what has been typed, leaving out where the item already is
function actionMatches(a) {
  const q = a.query.trim().toLowerCase();
  return (destinations || []).filter(d =>
    !(d.location_id && d.location_id === a.item.location_id) &&
    !(d.member_id && d.member_id === a.item.assigned_member_id) &&
    (!q || d.label.toLowerCase().includes(q)));
}

async function saveItemAction() {
  const a = state.action;
  const fail = (fieldName, message) => { a.field = fieldName; a.error = message; render(); };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || Number.isNaN(Date.parse(a.date))) return fail('date', 'Date must be YYYY-MM-DD');

  const body = { event_date: a.date, note: a.note };
  const dest = a.kind === 'move' ? actionMatches(a)[a.sel] : null;
  if (a.kind === 'move') {
    if (!dest) return fail('dest', 'Choose where it is going');
    body.location_id = dest.location_id;
    body.member_id   = dest.member_id;
  } else if (!a.note.trim()) {
    return fail('note', 'Type a note');
  }

  a.busy = true; a.error = '';
  render();
  try {
    const { data } = await api(`/inventory/${a.item.id}/${a.kind === 'move' ? 'move' : 'notes'}`, { method: 'POST', body });
    state.action = null;
    state.detail = { kind: 'inventory', data, error: '', scroll: 0 };
    state.view   = 'detail';
    state.flash  = { ok: true, text: !dest ? 'Note added' : `${dest.member_id ? 'Checked out to' : 'Moved to'} ${dest.label}` };
    load('inventory', { keep: true });
  } catch (err) {
    a.busy = false;
    if (err.status === 401) return sessionExpired();
    a.error = err.message;
    render();
  }
}

// ── Clipboard ────────────────────────────────────────────────────────────────

function flash(text, ok = true) {
  state.flash = { text, ok };
  render();
}

function copyToClipboard(text) {
  // clip.exe mangles UTF-8; it takes UTF-16, and a byte-order mark would be copied too
  const tools = process.platform === 'win32'  ? [['clip', [], Buffer.from(text, 'utf16le')]]
              : process.platform === 'darwin' ? [['pbcopy', [], text]]
              : [['wl-copy', [], text], ['xclip', ['-selection', 'clipboard'], text]];
  for (const [command, commandArgs, input] of tools) {
    const result = spawnSync(command, commandArgs, { input, stdio: ['pipe', 'ignore', 'ignore'] });
    if (!result.error && result.status === 0) return;
  }
  // No clipboard tool: ask the terminal itself (OSC 52), which most modern ones honour
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
}

function copy(value, label) {
  const text = plain(value).trim();
  if (!text) return flash(`No ${label} on this record`, false);
  copyToClipboard(text);
  flash(`Copied ${label}: ${text}`);
}

// Copy one column for everyone in the current member list, not just the page on screen
async function copyMemberColumn(column, word) {
  if (state.tab !== 'members') return flash(`Switch to Members to copy ${word}s`, false);
  const t = cur();
  flash(`Collecting ${word}s…`);
  try {
    const rows = t.page >= t.pages ? t.rows : await allMembers(t.query.trim(), FILTERS.members[t.filter][0]);
    const values = [...new Set(rows.map(m => plain(m[column]).trim()).filter(Boolean))];
    if (!values.length) return flash(`No ${word}s in this list`, false);
    copyToClipboard(values.join(', '));
    flash(`Copied ${plural(values.length, word)}`);
  } catch (err) {
    if (err.status === 401) return sessionExpired();
    flash(err.message, false);
  }
}

// ── Text helpers ─────────────────────────────────────────────────────────────

const useColor = !process.env.NO_COLOR;
const style = code => s => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = style(1), dim = style(2), inverse = style(7);
const red = style(31), green = style(32), yellow = style(33), blue = style(34), magenta = style(35), cyan = style(36);

// Control characters in a record must never reach the terminal as escape codes
const plain = v => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');

// Pad or truncate to exactly `width` columns, the last one always blank so
// neighbouring columns never touch
function fit(value, width) {
  if (width <= 0) return '';
  const s = plain(value);
  return (s.length > width - 1 ? s.slice(0, Math.max(0, width - 2)) + '…' : s).padEnd(width);
}

// Truncate a line that may contain color codes to `width` visible columns
function clip(line, width) {
  let out = '', visible = 0;
  for (let i = 0; i < line.length;) {
    if (line[i] === '\x1b') {
      const match = /^\x1b\[[0-9;]*m/.exec(line.slice(i, i + 16));
      if (match) { out += match[0]; i += match[0].length; continue; }
    }
    if (visible < width) { out += line[i]; visible++; }
    i++;
  }
  return out;
}

function wrap(text, width) {
  const lines = [];
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of plain(paragraph).split(' ').filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) { lines.push(line); line = ''; }
      line = line ? `${line} ${word}` : word;
      while (line.length > width) { lines.push(line.slice(0, width)); line = line.slice(width); }
    }
    lines.push(line);
  }
  return lines;
}

const money    = v => (v == null || v === '' ? '' : `$${Number(v).toFixed(2)}`);
const fullName = m => plain(`${m.first_name || ''} ${m.last_name || ''}`).trim();
const titleCase = s => plain(s).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
const typeLabel = type => (MEETING_TYPES.find(t => t[0] === type) || [type, titleCase(type)])[1];
const plural    = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CLASS_SHORT = { Technician: 'Tech', General: 'Gen', 'Amateur Extra': 'Extra', Novice: 'Nov', Advanced: 'Adv' };

// Same rules as duesBadge() in the web UI
function duesLabel(status, paid, coveredBy, paymentMethod) {
  if (paymentMethod === 'eastman') return ['Eastman', blue];
  if (status === 'honorary')       return ['Honorary', blue];
  if (status === 'waived')         return ['Waived', dim];
  if (coveredBy)                   return ['Covered', green];
  if (paid != null)                return ['Paid', green];
  if (status === 'active')         return ['Unpaid', yellow];
  if (status === 'expired')        return ['Expired', red];
  return ['—', dim];
}

function memberStatus(m) {
  if (m.is_silent_key) return ['Silent Key', magenta];
  if (m.is_active)     return ['Active', green];
  return ['Inactive', red];
}

// Where an inventory item (or one end of a move) is: a location or a member
const place = (location, callsign, name) =>
  plain(location || [callsign, name].filter(Boolean).join(' ') || '');

// ── Screens ──────────────────────────────────────────────────────────────────

const CURSOR = useColor ? inverse(' ') : '_';

function loginScreen() {
  const l = state.login;
  const field = (name, label, shown) =>
    `  ${bold(label.padEnd(10))}${shown}${l.field === name && !l.busy ? CURSOR : ''}`;
  return [
    '',
    `  ${bold('W4TRC Membership')}`,
    `  ${dim(BASE)}`,
    '',
    field('email', 'Email', plain(l.email)),
    field('password', 'Password', '•'.repeat(l.password.length)),
    '',
    l.busy ? `  ${dim('Signing in…')}` : `  ${red(l.error)}`,
    '',
    `  ${dim('Enter sign in · Tab switch field · Ctrl+C quit')}`,
  ];
}

function memberColumns(cols) {
  const showPhone = cols >= 90, showEmail = cols >= 64;
  const flex = cols - 2 - 10 - 7 - 11 - (showPhone ? 16 : 0);
  const name = showEmail ? Math.floor(flex * 0.45) : flex;
  return { name, email: showEmail ? flex - name : 0, phone: showPhone ? 16 : 0 };
}

function memberHeader(cols) {
  const w = memberColumns(cols);
  return ' ' + fit('Callsign', 10) + fit('Name', w.name) + fit('Class', 7) + fit('Dues', 11) + fit('Email', w.email) + fit('Phone', w.phone);
}

function memberRow(m, cols, selected) {
  const w = memberColumns(cols);
  const [label, color] = m.is_silent_key || !m.is_active
    ? memberStatus(m)
    : duesLabel(m.current_year_status, m.current_year_paid, m.current_year_covered_by, m.current_year_payment_method);
  const cells = [
    [fit(m.callsign || '—', 10), bold],
    [fit(fullName(m), w.name)],
    [fit(CLASS_SHORT[m.license_class] || '', 7)],
    [fit(label, 11), color],
    [fit(m.email, w.email), dim],
    [fit(m.phone, w.phone), dim],
  ];
  if (selected) return inverse(' ' + cells.map(c => c[0]).join('') + ' ');
  return ' ' + cells.map(([text, color]) => (color ? color(text) : text)).join('');
}

function inventoryColumns(cols) {
  const showSerial = cols >= 80;
  const flex = cols - 2 - 11 - (showSerial ? 18 : 0);
  const name = Math.floor(flex * 0.36), model = Math.floor(flex * 0.30);
  return { name, model, serial: showSerial ? 18 : 0, where: flex - name - model };
}

function inventoryHeader(cols) {
  const w = inventoryColumns(cols);
  return ' ' + fit('Item', w.name) + fit('Make / Model', w.model) + fit('Serial', w.serial) + fit('Where', w.where) + fit('Since', 11);
}

function inventoryRow(item, cols, selected) {
  const w = inventoryColumns(cols);
  const out = !!item.assigned_member_id;
  const cells = [
    [fit(item.name, w.name), bold],
    [fit([item.manufacturer, item.model].filter(Boolean).join(' '), w.model)],
    [fit(item.serial_number, w.serial), dim],
    [fit((out ? '→ ' : '') + place(item.location_name, item.member_callsign, item.member_name), w.where), out ? yellow : null],
    [fit(item.location_since, 11), dim],
  ];
  if (selected) return inverse(' ' + cells.map(c => c[0]).join('') + ' ');
  return ' ' + cells.map(([text, color]) => (color ? color(text) : text)).join('');
}

function meetingColumns(cols) {
  const showSplit = cols >= 80;
  return { title: cols - 2 - 11 - 12 - 10 - (showSplit ? 27 : 0), split: showSplit };
}

function meetingHeader(cols) {
  const w = meetingColumns(cols);
  return ' ' + fit('Date', 11) + fit('Type', 12) + fit('Title', w.title) + fit('Attended', 10) +
         (w.split ? fit('Members', 9) + fit('Visitors', 10) + fit('Guests', 8) : '');
}

function meetingRow(mt, cols, selected) {
  const w = meetingColumns(cols);
  const cells = [
    [fit(mt.meeting_date, 11), bold],
    [fit(typeLabel(mt.meeting_type), 12)],
    [fit(mt.title, w.title)],
    [fit(mt.total_count || 0, 10), green],
  ];
  if (w.split) {
    cells.push([fit(mt.member_count || 0, 9), dim], [fit(mt.visitor_count || 0, 10), dim], [fit(mt.guest_count || 0, 8), dim]);
  }
  if (selected) return inverse(' ' + cells.map(c => c[0]).join('') + ' ');
  return ' ' + cells.map(([text, color]) => (color ? color(text) : text)).join('');
}

const LIST_VIEWS = {
  members:   { header: memberHeader,    row: memberRow },
  inventory: { header: inventoryHeader, row: inventoryRow },
  meetings:  { header: meetingHeader,   row: meetingRow },
};

const LIST_KEYS = {
  members:   'Enter open · Tab switch · ^F filter · ^E/^L copy emails/callsigns',
  inventory: 'Enter open · Tab switch · ^F filter · ^N new meeting · ^C quit',
  meetings:  'Enter open · Tab switch · ^F filter · ^N new meeting · ^C quit',
};

const flashText = () => (state.flash.ok ? green : red)(plain(state.flash.text));

function listScreen(cols, rows) {
  const t = cur();
  const view = LIST_VIEWS[state.tab];

  const tabBar = Object.entries(tabs)
    .map(([name, tab]) => (name === state.tab ? inverse(` ${tab.label} `) : ` ${tab.label} `))
    .join(' ');
  const who = state.user ? plain(`${state.user.email} (${state.user.role})`) : '';
  const titleWidth = 7 + Object.values(tabs).reduce((n, tab) => n + tab.label.length + 3, 0);
  const lines = [
    ` ${bold('W4TRC')}  ${tabBar}${dim(who.padStart(Math.max(0, cols - titleWidth - 1)))}`,
    ` ${bold('Search')} ${plain(t.query)}${CURSOR}   ${dim(`Filter: ${FILTERS[state.tab][t.filter][1]}`)}`,
    dim(view.header(cols)),
  ];

  // Keep the selection inside the visible window
  const height = Math.max(1, rows - lines.length - 1);
  if (t.sel < t.top)            t.top = t.sel;
  if (t.sel >= t.top + height)  t.top = t.sel - height + 1;

  for (let i = t.top; i < t.top + height; i++) {
    const row = t.rows[i];
    if (!row) { lines.push(''); continue; }
    lines.push(view.row(row, cols, i === t.sel));
  }
  if (!t.rows.length && t.loaded && !t.loading && !t.error) lines[3] = dim('  Nothing found');

  let status;
  if (t.error)          status = red(plain(t.error));
  else if (state.flash) status = flashText();
  else if (t.loading)   status = dim('Loading…');
  else                status = dim(t.rows.length ? `${t.sel + 1} of ${t.total}` : '0 results');
  lines.push(` ${status}   ${dim(LIST_KEYS[state.tab])}`);
  return lines;
}

// A labelled line in a detail screen; empty values are left out entirely
function field(lines, label, value, width) {
  if (value == null || value === '') return;
  wrap(value, Math.max(10, width - 15)).forEach((text, i) => {
    lines.push(`  ${dim((i ? '' : label).padEnd(12))} ${text}`);
  });
}

const section = (lines, title) => lines.push('', `  ${bold(cyan(title))}`);

function memberDetail(m, width) {
  const [status, statusColor] = memberStatus(m);
  const lines = [
    `  ${bold(plain(m.callsign || '—'))}  ${bold(fullName(m))}   ${statusColor(status)} ${dim('· ' + titleCase(m.membership_type))}`,
    '',
  ];

  const cityLine = [m.city, [m.state, m.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const license  = [
    m.license_class,
    m.license_expiry && `expires ${m.license_expiry}`,
    m.license_status && (m.license_status === 'A' ? 'active' : `status ${m.license_status}`),
  ].filter(Boolean).join(' · ');
  const flags = [
    m.is_arrl_member && 'ARRL member',
    m.is_eastman_member && 'Eastman member',
    m.callsign_mismatch && 'Callsign mismatch',
  ].filter(Boolean).join(' · ');

  field(lines, 'Email', m.email, width);
  field(lines, 'Phone', m.phone, width);
  field(lines, 'Address', [m.address, cityLine].filter(Boolean).join(', '), width);
  field(lines, 'License', license, width);
  field(lines, 'Joined', m.joined_date, width);
  field(lines, 'Flags', flags, width);
  field(lines, 'Emergency', [m.emergency_name, m.emergency_phone].filter(Boolean).join(' · '), width);
  field(lines, 'Interests', m.interests, width);
  field(lines, 'Bio', m.bio, width);

  const memberships = [...(m.memberships || [])].sort((a, b) => b.year - a.year);
  if (memberships.length) {
    section(lines, 'Dues');
    for (const ms of memberships) {
      const [label, color] = duesLabel(ms.status, ms.amount_paid, ms.covered_by_member_id, ms.payment_method);
      const extra = [
        money(ms.amount_paid),
        ms.payment_method && plain(ms.payment_method) + (ms.check_number ? ` #${plain(ms.check_number)}` : ''),
        ms.paid_date,
        ms.covered_by_member_id && `covered by ${place(null, ms.covered_by_callsign, `${ms.covered_by_first_name || ''} ${ms.covered_by_last_name || ''}`.trim())}`,
        ms.notes,
      ].filter(Boolean).map(plain).join(' · ');
      lines.push(`  ${ms.year}  ${color(label.padEnd(9))} ${dim(extra)}`);
    }
  }

  const notes = [...(m.notes || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (notes.length) {
    section(lines, 'Notes');
    for (const n of notes) {
      lines.push(`  ${dim(plain(`${String(n.created_at).slice(0, 10)} · ${n.author_email || 'unknown'}${n.is_private ? ' · private' : ''}`))}`);
      for (const text of wrap(n.note_text, width - 6)) lines.push(`    ${text}`);
    }
  }

  const donations = [...(m.donations || [])].sort((a, b) => String(b.donation_date).localeCompare(String(a.donation_date)));
  if (donations.length) {
    section(lines, 'Donations');
    for (const d of donations) {
      const what = d.donation_kind === 'item'
        ? [d.item_description, d.estimated_value != null && `est. ${money(d.estimated_value)}`]
        : [money(d.amount), d.payment_method];
      lines.push(`  ${plain(d.donation_date || '')}  ${plain([...what, d.notes].filter(Boolean).join(' · '))}`);
    }
  }
  return lines;
}

function inventoryDetail({ item, events }, width) {
  const lines = [`  ${bold(plain(item.name))}`, ''];
  const where = place(item.location_name, item.member_callsign, item.member_name);
  const acquired = [
    item.is_donated ? 'Donated' : (item.purchase_date || item.purchase_price != null || item.purchased_from) && 'Purchased',
    item.purchase_date,
    money(item.purchase_price) && (item.is_donated ? `est. ${money(item.purchase_price)}` : money(item.purchase_price)),
    item.purchased_from && `${item.is_donated ? 'by' : 'from'} ${item.purchased_from}`,
  ].filter(Boolean).join(' · ');

  field(lines, 'Manufacturer', item.manufacturer, width);
  field(lines, 'Model', item.model, width);
  field(lines, 'Serial', item.serial_number, width);
  field(lines, item.assigned_member_id ? 'Checked out' : 'Location',
        where + (item.location_since ? ` (since ${item.location_since})` : ''), width);
  field(lines, 'Acquired', acquired, width);
  field(lines, 'Photo', item.photo_updated_at && 'Yes — view it in the web UI', width);

  if (events.length) {
    section(lines, 'History');
    for (const e of events) {
      const from = place(e.from_location, e.from_callsign, e.from_member);
      const to   = place(e.to_location, e.to_callsign, e.to_member);
      const what = {
        added:       `Added at ${to}`,
        moved:       `Moved ${from} → ${to}`,
        checked_out: `Checked out to ${to}${from ? ` (from ${from})` : ''}`,
        note:        'Note',
      }[e.event_type] || plain(e.event_type);
      lines.push(`  ${plain(e.event_date)}  ${what}${e.user_email ? dim(` · ${plain(e.user_email)}`) : ''}`);
      if (e.note) for (const text of wrap(e.note, width - 16)) lines.push(`              ${text}`);
    }
  }
  return lines;
}

function meetingDetail({ meeting, attendees }, width) {
  const lines = [
    `  ${bold(plain(meeting.meeting_date))}  ${bold(typeLabel(meeting.meeting_type))}${meeting.title ? `  ${plain(meeting.title)}` : ''}`,
    '',
  ];
  field(lines, 'Notes', meeting.notes, width);

  const groups = [
    ['Members',       attendees.filter(a => a.member_id)],
    ['Visiting hams', attendees.filter(a => !a.member_id && a.callsign)],
    ['Guests',        attendees.filter(a => !a.callsign)],
  ];
  lines.push(`  ${plural(attendees.length, 'attendee')}`);
  for (const [title, list] of groups) {
    if (!list.length) continue;
    section(lines, `${title} (${list.length})`);
    for (const a of list) {
      const inactive = a.member_id && a.is_active === 0 ? dim(' · inactive') : '';
      lines.push(a.callsign
        ? `  ${bold(plain(a.callsign).padEnd(8))} ${plain(a.name || '')}${inactive}`
        : `  ${plain(a.name)}`);
    }
  }
  return lines;
}

const DETAIL_VIEWS = { members: memberDetail, inventory: inventoryDetail, meetings: meetingDetail };

const FIELD_HINTS = {
  date:      'YYYY-MM-DD',
  type:      '← → to change',
  title:     'Optional',
  notes:     'Optional',
  callsigns: 'Separate with spaces — each one is looked up as you go',
  guests:    'Visitors without a callsign — separate names with commas',
};
const SOURCE_LABELS = { member: 'member', local_ham: 'local ham', hamdb: 'HamDB' };

// One line of a form `f`. A long value keeps its end, where the typing is, in view.
const formLabel = (f, name, text) => (f.field === name ? bold : dim)(text.padEnd(11));
const formInput = (f, cols, name, text, value) =>
  `  ${formLabel(f, name, text)}${plain(value).slice(-Math.max(10, cols - 16))}${f.field === name && !f.busy ? CURSOR : ''}`;

function formStatus(f) {
  if (f.busy)           return dim('Saving…');
  if (f.confirmDiscard) return yellow('Press Esc again to discard this meeting');
  return f.error ? red(plain(f.error)) : '';
}

function formScreen(cols, rows) {
  const f = state.form;
  const label = (name, text) => formLabel(f, name, text);
  const input = (name, text, value) => formInput(f, cols, name, text, value);

  const typeName = MEETING_TYPES[f.type][1];
  const lines = [
    '',
    `  ${bold('New meeting')}`,
    '',
    input('date', 'Date', f.date),
    `  ${label('type', 'Type')}${f.field === 'type' ? `‹ ${typeName} ›` : typeName}`,
    input('title', 'Title', f.title),
    input('notes', 'Notes', f.notes),
    input('callsigns', 'Callsigns', f.callsigns),
    input('guests', 'Guests', f.guests),
    '',
    `  ${dim(FIELD_HINTS[f.field])}`,
    '',
  ];

  // Newest first, so the callsign just typed is always on screen
  const callsigns = formCallsigns(f), guests = formGuests(f);
  const entries = [
    ...callsigns.map(c => {
      const a = f.resolved.get(c);
      const who = a === undefined ? '' // not looked up yet, or the lookup failed
        : a === null ? dim('looking up…')
        : a.source === 'not_found' ? red('not found — saved as a callsign only')
        : `${plain(a.name || '')} ${dim('· ' + SOURCE_LABELS[a.source])}`;
      return `  ${bold(c.padEnd(8))} ${who}`;
    }).reverse(),
    ...guests.map(n => `  ${dim('guest'.padEnd(8))} ${plain(n)}`).reverse(),
  ];
  lines.push(`  ${bold(cyan('Attendees'))}  ${dim(`${plural(callsigns.length, 'ham')} · ${plural(guests.length, 'guest')}`)}`);
  const room = Math.max(1, rows - lines.length - 2);
  if (entries.length > room) {
    lines.push(...entries.slice(0, room - 1), dim(`  … and ${entries.length - room + 1} more`));
  } else {
    lines.push(...entries);
  }
  while (lines.length < rows - 2) lines.push('');
  lines.length = rows - 2;

  lines.push(`  ${formStatus(f)}`, ` ${dim('↑↓ field · Ctrl+S save · Esc cancel · Ctrl+C quit')}`);
  return lines;
}

function actionScreen(cols, rows) {
  const a = state.action;
  const move = a.kind === 'move';
  const lines = [
    '',
    `  ${bold(move ? 'Move or check out' : 'Add a note')}  ${plain(a.item.name)}`,
    `  ${dim(`Currently: ${place(a.item.location_name, a.item.member_callsign, a.item.member_name)}`)}`,
    '',
  ];
  if (move) lines.push(formInput(a, cols, 'dest', 'Move to', a.query));
  lines.push(formInput(a, cols, 'date', 'Date', a.date), formInput(a, cols, 'note', 'Note', a.note), '');

  if (move) {
    const matches = actionMatches(a);
    if (!destinations) {
      if (!a.error) lines.push(dim('  Loading locations and members…'));
    } else if (!matches.length) {
      lines.push(dim('  No location or member matches'));
    } else {
      // Scroll the choices so the highlighted one stays in view
      const room  = Math.max(1, rows - lines.length - 2);
      const width = Math.max(12, Math.min(40, cols - 16));
      a.sel = Math.max(0, Math.min(matches.length - 1, a.sel));
      const top = Math.max(0, Math.min(a.sel - Math.floor(room / 2), matches.length - room));
      matches.slice(top, top + room).forEach((d, i) => {
        lines.push(top + i === a.sel
          ? (useColor ? `  ${inverse(` ${fit(d.label, width)}${d.tag} `)}` : ` > ${fit(d.label, width)}${d.tag}`)
          : `   ${fit(d.label, width)}${dim(d.tag)}`);
      });
    }
  }
  while (lines.length < rows - 2) lines.push('');
  lines.length = rows - 2;

  const keys = move ? 'Type to filter · ↑↓ choose · Tab next field · Ctrl+S save · Esc cancel'
                    : '↑↓ field · Ctrl+S save · Esc cancel';
  lines.push(`  ${formStatus(a)}`, ` ${dim(keys)}`);
  return lines;
}

const DETAIL_KEYS = {
  members:   'e/c/p copy email/callsign/phone',
  inventory: 'm move or check out · n add note · c copy serial',
  meetings:  'c copy callsigns',
};

function detailScreen(cols, rows) {
  const d = state.detail;
  let body;
  if (d.error)      body = [`  ${red(plain(d.error))}`];
  else if (!d.data) body = [`  ${dim('Loading…')}`];
  else              body = DETAIL_VIEWS[d.kind](d.data, cols);

  const height = Math.max(1, rows - 3);
  d.maxScroll  = Math.max(0, body.length - height);
  d.scroll     = Math.max(0, Math.min(d.maxScroll, d.scroll));
  d.pageSize   = height;

  const more = d.maxScroll ? `${d.scroll + 1}–${Math.min(body.length, d.scroll + height)} of ${body.length} lines · ` : '';
  const lines = [state.flash ? `  ${flashText()}` : '', ...body.slice(d.scroll, d.scroll + height)];
  while (lines.length < rows - 1) lines.push('');
  lines.push(` ${dim(`${more}↑↓ scroll · ${d.data ? DETAIL_KEYS[d.kind] + ' · ' : ''}Esc back`)}`);
  return lines;
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const lines =
    state.view === 'login'  ? loginScreen() :
    state.view === 'detail' ? detailScreen(cols, rows) :
    state.view === 'form'   ? formScreen(cols, rows) :
    state.view === 'action' ? actionScreen(cols, rows) :
                              listScreen(cols, rows);

  const out = [];
  for (let i = 0; i < rows; i++) out.push(clip(lines[i] || '', cols) + '\x1b[0m\x1b[K');
  process.stdout.write('\x1b[H' + out.join('\r\n'));
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

const isText = (str, key) => !!str && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(str);

function loginKey(str, key) {
  const l = state.login;
  if (l.busy) return;
  if (key.name === 'tab' || key.name === 'up' || key.name === 'down') {
    l.field = l.field === 'email' ? 'password' : 'email';
  } else if (key.name === 'return') {
    if (l.field === 'email' && !l.password) l.field = 'password';
    else return signIn();
  } else if (key.name === 'backspace') {
    l[l.field] = l[l.field].slice(0, -1);
  } else if (key.ctrl && key.name === 'u') {
    l[l.field] = '';
  } else if (isText(str, key)) {
    l[l.field] += str;
    l.error = '';
  }
  render();
}

function listKey(str, key) {
  const t = cur();
  const page = Math.max(1, (process.stdout.rows || 24) - 5);

  if (key.name === 'up')            return moveSelection(-1);
  if (key.name === 'down')          return moveSelection(1);
  if (key.name === 'pageup')        return moveSelection(-page);
  if (key.name === 'pagedown')      return moveSelection(page);
  if (key.name === 'home')          return moveSelection(-t.rows.length);
  if (key.name === 'end')           return moveSelection(t.rows.length);
  if (key.name === 'return')        return openDetail();

  if (key.name === 'tab') {
    const names = Object.keys(tabs);
    state.tab = names[(names.indexOf(state.tab) + (key.shift ? names.length - 1 : 1)) % names.length];
    return cur().loaded ? render() : load(state.tab);
  }
  if (key.ctrl && key.name === 'n') return openMeetingForm();
  if (key.ctrl && key.name === 'e') return copyMemberColumn('email', 'email');
  if (key.ctrl && key.name === 'l') return copyMemberColumn('callsign', 'callsign');
  if (key.ctrl && key.name === 'f') {
    t.filter = (t.filter + 1) % FILTERS[state.tab].length;
    return load(state.tab);
  }
  if (key.ctrl && key.name === 'r') return load(state.tab);

  if (key.name === 'escape' || (key.ctrl && key.name === 'u')) {
    if (!t.query) return;
    t.query = '';
  } else if (key.name === 'backspace') {
    if (!t.query) return;
    t.query = t.query.slice(0, -1);
  } else if (isText(str, key)) {
    t.query += str;
  } else {
    return;
  }
  searchSoon();
}

function formKey(str, key) {
  const f = state.form;
  if (f.busy) return;
  const i = FORM_FIELDS.indexOf(f.field);
  const n = MEETING_TYPES.length;

  if (key.name === 'escape') {
    const dirty = f.title || f.notes || f.callsigns || f.guests;
    if (dirty && !f.confirmDiscard) { f.confirmDiscard = true; return render(); }
    state.form = null;
    state.view = 'list';
    return cur().loaded ? render() : load(state.tab);
  }
  f.confirmDiscard = false;

  if (key.ctrl && key.name === 's') return saveMeeting();
  if (key.name === 'up' || (key.name === 'tab' && key.shift)) {
    f.field = FORM_FIELDS[Math.max(0, i - 1)];
  } else if (key.name === 'down' || key.name === 'return' || key.name === 'tab') {
    f.field = FORM_FIELDS[Math.min(FORM_FIELDS.length - 1, i + 1)];
  } else if (f.field === 'type') {
    if (key.name === 'left')                      f.type = (f.type + n - 1) % n;
    else if (key.name === 'right' || str === ' ') f.type = (f.type + 1) % n;
  } else if (key.name === 'backspace') {
    f[f.field] = f[f.field].slice(0, -1);
  } else if (key.ctrl && key.name === 'u') {
    f[f.field] = '';
  } else if (isText(str, key)) {
    f[f.field] += str;
    f.error = '';
  }
  lookupSoon();
  render();
}

function actionKey(str, key) {
  const a = state.action;
  if (a.busy) return;
  const fields = ACTION_FIELDS[a.kind];
  const i = fields.indexOf(a.field);
  const text = a.field === 'dest' ? 'query' : a.field; // the property being typed into

  if (key.name === 'escape') {
    state.action = null;
    state.view   = 'detail';
  } else if (key.ctrl && key.name === 's') {
    return saveItemAction();
  } else if (a.field === 'dest' && (key.name === 'up' || key.name === 'down')) {
    a.sel += key.name === 'up' ? -1 : 1;
  } else if (key.name === 'up' || (key.name === 'tab' && key.shift)) {
    a.field = fields[Math.max(0, i - 1)];
  } else if (key.name === 'down' || key.name === 'return' || key.name === 'tab') {
    a.field = fields[Math.min(fields.length - 1, i + 1)];
  } else if (key.name === 'backspace' || (key.ctrl && key.name === 'u') || isText(str, key)) {
    a[text] = key.name === 'backspace' ? a[text].slice(0, -1) : key.ctrl ? '' : a[text] + str;
    a.error = '';
    if (a.field === 'dest') a.sel = 0;
  }
  render();
}

// Single-key actions in a detail screen, by the kind of record on show
const DETAIL_ACTIONS = {
  members: {
    e: m => copy(m.email, 'email'),
    c: m => copy(m.callsign, 'callsign'),
    p: m => copy(m.phone, 'phone'),
  },
  inventory: {
    m: () => openItemAction('move'),
    n: () => openItemAction('note'),
    c: ({ item }) => copy(item.serial_number, 'serial number'),
  },
  meetings: {
    c: ({ attendees }) => copy(attendees.filter(a => a.callsign).map(a => a.callsign).join(', '), 'callsigns'),
  },
};

function detailKey(str, key) {
  const d = state.detail;
  const action = d.data && !key.ctrl && !key.meta && DETAIL_ACTIONS[d.kind][str];
  if (action) return action(d.data);

  if (key.name === 'escape' || key.name === 'backspace' || key.name === 'left' || str === 'q') {
    state.view = 'list';
  }
  else if (key.name === 'up' || str === 'k')            d.scroll -= 1;
  else if (key.name === 'down' || str === 'j')          d.scroll += 1;
  else if (key.name === 'pageup')                       d.scroll -= d.pageSize || 10;
  else if (key.name === 'pagedown' || str === ' ')      d.scroll += d.pageSize || 10;
  else if (key.name === 'home')                         d.scroll = 0;
  else if (key.name === 'end')                          d.scroll = d.maxScroll || 0;
  render();
}

function onKey(str, key = {}) {
  if (key.ctrl && key.name === 'c') return quit();
  state.flash = null;
  if (state.view === 'login')  return loginKey(str, key);
  if (state.view === 'action') return actionKey(str, key);
  if (state.view === 'detail') return detailKey(str, key);
  if (state.view === 'form')   return formKey(str, key);
  return listKey(str, key);
}

// ── Startup & shutdown ───────────────────────────────────────────────────────

let screenOpen = false;

function closeScreen() {
  if (!screenOpen) return;
  screenOpen = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l'); // show cursor, leave the alternate screen
}

function quit(message) {
  closeScreen();
  if (message) console.error(message);
  process.exit(message ? 1 : 0);
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log([
      'Usage: npm run tui [-- options]',
      '',
      '  --local        use wrangler dev at http://localhost:8787',
      '  --url <url>    use another base URL (or set KARC_URL)',
      '  --logout       sign out and forget the saved session',
      '',
      `Server:  ${BASE}`,
      `Session: ${SESSION_FILE}`,
    ].join('\n'));
    return;
  }
  if (typeof fetch !== 'function') return quit('This needs Node 18.14 or newer.');

  if (args.includes('--logout')) {
    if (state.session) await api('/auth/logout', { method: 'POST' }).catch(() => {});
    saveSession(null);
    console.log(`Signed out of ${BASE}`);
    return;
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l'); // alternate screen, hide cursor
  screenOpen = true;
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.on('keypress', onKey);
  process.stdin.on('end', () => quit());
  process.stdin.resume();
  process.stdout.on('resize', render);
  process.on('exit', closeScreen);
  process.on('uncaughtException', err => quit(err.stack || String(err)));
  process.on('unhandledRejection', err => quit(err?.stack || String(err)));

  render();
  if (state.session) {
    try {
      const { data } = await api('/auth/me');
      state.user = data.user;
      state.login.email = data.user.email;
      enterList();
    } catch (err) {
      if (err.status === 401) sessionExpired();
      else { state.login.error = err.message; render(); }
    }
  }
}

main();
