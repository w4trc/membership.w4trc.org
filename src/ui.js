/**
 * Serves the admin SPA directly from the Worker
 * No separate hosting needed
 */

export function serveUI(request, env) {
  const html = getHTML();
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    },
  });
}

function getHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>W4TRC Member System – Kingsport Amateur Radio Club</title>
<style>
/* ── Reset & Tokens ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:        #0f1117;
  --surface:   #181c27;
  --surface2:  #1f2438;
  --border:    #2a3050;
  --accent:    #3b7dd8;
  --accent-h:  #5594f0;
  --success:   #2ecc71;
  --warn:      #f39c12;
  --danger:    #e74c3c;
  --text:      #e8eaf0;
  --text-muted:#8892aa;
  --mono:      'Courier New', monospace;
  --radius:    6px;
  --shadow:    0 4px 24px rgba(0,0,0,.4);
}

body {
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  font-size: 14px;
  line-height: 1.6;
}

/* ── Layout ─────────────────────────────────────────────────────────── */
#app { display: flex; flex-direction: column; min-height: 100vh; }

/* Login */
#login-screen {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; background: var(--bg);
}
.login-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 48px; width: 100%; max-width: 420px;
  box-shadow: var(--shadow);
}
.login-card .logo { text-align: center; margin-bottom: 32px; }
.login-card .logo h1 { font-size: 22px; font-weight: 700; letter-spacing: .02em; }
.login-card .logo .call {
  font-family: var(--mono); font-size: 28px; color: var(--accent);
  font-weight: bold; letter-spacing: .1em;
}
.login-card .logo p { color: var(--text-muted); font-size: 12px; margin-top: 4px; }

/* Main shell */
#main-shell { display: flex; flex: 1; }

#sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 0;
}
.sidebar-header {
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}
.sidebar-header .call {
  font-family: var(--mono); font-size: 20px; color: var(--accent);
  font-weight: bold; letter-spacing: .08em;
}
.sidebar-header .club-name {
  font-size: 10px; color: var(--text-muted); text-transform: uppercase;
  letter-spacing: .05em; margin-top: 2px;
}

nav { flex: 1; padding: 12px 0; }
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; color: var(--text-muted); cursor: pointer;
  text-decoration: none; font-size: 13px; transition: all .15s;
  border-left: 3px solid transparent;
}
.nav-item:hover { color: var(--text); background: var(--surface2); }
.nav-item.active {
  color: var(--accent); background: rgba(59,125,216,.12);
  border-left-color: var(--accent);
}
.nav-item .icon { font-size: 16px; width: 20px; text-align: center; }
.nav-section {
  padding: 16px 16px 4px; font-size: 10px; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .08em;
}

.sidebar-footer {
  padding: 12px 16px; border-top: 1px solid var(--border);
}
.user-pill {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  color: var(--text-muted);
}
.user-pill .avatar {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--accent); color: white;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: bold; flex-shrink: 0;
}

#content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
#topbar {
  height: 52px; background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 24px; gap: 12px;
  flex-shrink: 0;
}
#topbar h2 { font-size: 16px; font-weight: 600; }
#topbar .spacer { flex: 1; }

#page { flex: 1; overflow-y: auto; padding: 24px; }

/* ── Components ──────────────────────────────────────────────────────── */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 20px; margin-bottom: 16px;
}
.card-title { font-size: 13px; font-weight: 600; color: var(--text-muted); margin-bottom: 16px; text-transform: uppercase; letter-spacing: .05em; }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.stat-card {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px;
}
.stat-val { font-size: 28px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-top: 4px; }

/* Table */
.tbl-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th {
  text-align: left; padding: 8px 12px; font-size: 11px;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em;
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
td { padding: 10px 12px; border-bottom: 1px solid rgba(42,48,80,.5); font-size: 13px; }
tr:hover td { background: var(--surface2); }
tr:last-child td { border-bottom: none; }

/* Badges */
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 20px;
  font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
}
.badge-green  { background: rgba(46,204,113,.15); color: var(--success); }
.badge-yellow { background: rgba(243,156,18,.15);  color: var(--warn); }
.badge-red    { background: rgba(231,76,60,.15);   color: var(--danger); }
.badge-blue   { background: rgba(59,125,216,.15);  color: var(--accent); }
.badge-gray   { background: rgba(136,146,170,.15); color: var(--text-muted); }
.badge-purple { background: rgba(130,80,180,.15);  color: #7c3fbe; }

/* Callsign */
.callsign {
  font-family: var(--mono); font-weight: bold; color: var(--accent);
  font-size: 13px; letter-spacing: .05em;
}

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; border-radius: var(--radius); font-size: 13px;
  font-weight: 500; border: none; cursor: pointer; transition: all .15s;
  text-decoration: none;
}
.btn-primary   { background: var(--accent);  color: white; }
.btn-primary:hover { background: var(--accent-h); }
.btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
.btn-danger    { background: rgba(231,76,60,.15); color: var(--danger); border: 1px solid rgba(231,76,60,.3); }
.btn-danger:hover { background: var(--danger); color: white; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Forms */
.form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.form-row  { display: flex; gap: 16px; flex-wrap: wrap; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group.full { grid-column: 1 / -1; }
label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
input, select, textarea {
  background: var(--bg); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius); padding: 8px 12px; font-size: 13px; width: 100%;
  outline: none; transition: border-color .15s;
  font-family: inherit;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
textarea { resize: vertical; min-height: 80px; }
.form-hint { font-size: 11px; color: var(--text-muted); }

/* Search bar */
.search-bar {
  display: flex; gap: 8px; align-items: center; margin-bottom: 16px;
}
.search-bar input { max-width: 320px; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; width: 90%; max-width: 680px; max-height: 90vh;
  display: flex; flex-direction: column; box-shadow: var(--shadow);
}
.modal-header {
  padding: 20px 24px 16px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
}
.modal-header h3 { font-size: 16px; font-weight: 600; }
.modal-body { padding: 24px; overflow-y: auto; flex: 1; }
.modal-footer {
  padding: 16px 24px; border-top: 1px solid var(--border);
  display: flex; gap: 8px; justify-content: flex-end; flex-shrink: 0;
}

/* Detail panel */
.detail-section { margin-bottom: 24px; }
.detail-section h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--text-muted); margin-bottom: 12px; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.detail-field label { font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px; }
.detail-field .val { font-size: 13px; }

/* Note */
.note-item {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 12px; margin-bottom: 8px;
}
.note-meta { font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
.note-text { font-size: 13px; white-space: pre-wrap; }

/* Toast */
#toast-container {
  position: fixed; bottom: 24px; right: 24px; z-index: 999;
  display: flex; flex-direction: column; gap: 8px;
}
.toast {
  background: var(--surface2); border: 1px solid var(--border);
  padding: 12px 16px; border-radius: var(--radius); font-size: 13px;
  box-shadow: var(--shadow); max-width: 320px;
  animation: slideIn .2s ease;
}
.toast.success { border-left: 3px solid var(--success); }
.toast.error   { border-left: 3px solid var(--danger); }
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } }

/* Misc */
.hidden  { display: none !important; }
.text-muted { color: var(--text-muted); }
.mt-8  { margin-top: 8px; }
.mt-16 { margin-top: 16px; }
.flex   { display: flex; }
.gap-8  { gap: 8px; }
.gap-16 { gap: 16px; }
.align-center { align-items: center; }
.spacer { flex: 1; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* Loading */
.spinner {
  width: 32px; height: 32px; border: 3px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 1s linear infinite; margin: 40px auto;
}
@keyframes spin { to { transform: rotate(360deg); } }
.loading-msg { text-align: center; color: var(--text-muted); font-size: 13px; }

/* Tabs */
.tabs { display: flex; gap: 2px; margin-bottom: 20px; border-bottom: 1px solid var(--border); }
.tab {
  padding: 8px 16px; font-size: 13px; color: var(--text-muted);
  cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: all .15s;
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* Membership year pills */
.year-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.year-pill {
  padding: 4px 12px; border-radius: 20px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--border); color: var(--text-muted); transition: all .15s;
}
.year-pill:hover { border-color: var(--accent); color: var(--accent); }
.year-pill.active { background: var(--accent); color: white; border-color: var(--accent); }

/* ── Mobile ──────────────────────────────────────────────────────────── */
#menu-toggle { display: none; }

@media (max-width: 768px) {
  #menu-toggle {
    display: flex; align-items: center; justify-content: center;
    background: none; border: none; color: var(--text); cursor: pointer;
    font-size: 20px; padding: 4px 8px; margin-right: 8px; flex-shrink: 0;
  }
  #sidebar {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 200;
    width: 260px; transform: translateX(-100%);
    transition: transform .25s ease;
  }
  #sidebar.open {
    transform: translateX(0);
    box-shadow: 4px 0 40px rgba(0,0,0,.7);
  }
  #nav-backdrop {
    display: none; position: fixed; inset: 0; z-index: 199;
    background: rgba(0,0,0,.5);
  }
  #nav-backdrop.open { display: block; }
  #page { padding: 16px; }
  #topbar { padding: 0 12px; }
  .modal { width: 96%; max-height: 94vh; margin: 0 auto; }
  .modal-body { padding: 16px; }
  .modal-footer { padding: 12px 16px; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .form-grid { grid-template-columns: 1fr; }
  .search-bar input { max-width: 100%; }
  #toast-container { bottom: 16px; right: 12px; left: 12px; }
  .toast { max-width: 100%; }
}
</style>
</head>
<body>

<div id="app">
  <!-- Login screen -->
  <div id="login-screen">
    <div class="login-card">
      <div class="logo">
        <div class="call">W4TRC</div>
        <h1>Member System</h1>
        <p>Kingsport Amateur Radio Club</p>
      </div>
      <div class="form-group">
        <label>Email Address</label>
        <input type="email" id="login-email" placeholder="admin@w4trc.org" autocomplete="email">
      </div>
      <div class="form-group mt-8">
        <label>Password</label>
        <input type="password" id="login-pass" placeholder="••••••••••" autocomplete="current-password">
      </div>
      <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" onclick="doLogin()">Sign In</button>
      <div id="login-err" class="hidden mt-8" style="color:var(--danger);font-size:13px;text-align:center"></div>
    </div>
  </div>

  <!-- Main app shell (hidden until logged in) -->
  <div id="main-shell" class="hidden">
    <aside id="sidebar">
      <div class="sidebar-header">
        <div class="call">W4TRC</div>
        <div class="club-name">Kingsport Amateur Radio Club</div>
      </div>
      <nav>
        <div class="nav-section">Main</div>
        <a class="nav-item active" onclick="nav('dashboard');closeNav()" data-page="dashboard">
          <span class="icon">📊</span> Dashboard
        </a>
        <a class="nav-item" onclick="nav('members');closeNav()" data-page="members">
          <span class="icon">👥</span> Members
        </a>
        <a class="nav-item" onclick="nav('memberships');closeNav()" data-page="memberships">
          <span class="icon">💳</span> Dues & Memberships
        </a>
        <div class="nav-section" id="nav-section-admin">Admin</div>
        <a class="nav-item" onclick="nav('users');closeNav()" data-page="users">
          <span class="icon">🔐</span> User Accounts
        </a>
        <a class="nav-item" onclick="nav('audit');closeNav()" data-page="audit">
          <span class="icon">📋</span> Audit Log
        </a>
        <a class="nav-item hidden" id="nav-cutoff" onclick="nav('cutoff');closeNav()" data-page="cutoff">
          <span class="icon">⚡</span> Membership Cutoff
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="user-pill">
          <div class="avatar" id="user-avatar">?</div>
          <div>
            <div id="user-email" style="font-size:12px;color:var(--text)"></div>
            <div id="user-role"  style="font-size:10px;color:var(--text-muted);text-transform:uppercase"></div>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-secondary" onclick="openChangePassword()" style="flex:1;justify-content:center">🔑 Password</button>
          <button class="btn btn-sm btn-secondary" onclick="doLogout()" style="flex:1;justify-content:center">⏏ Sign Out</button>
        </div>
      </div>
    </aside>

    <div id="nav-backdrop" onclick="closeNav()"></div>
    <div id="content">
      <div id="topbar">
        <button id="menu-toggle" onclick="toggleNav()" aria-label="Menu">&#9776;</button>
        <h2 id="page-title">Dashboard</h2>
        <div class="spacer"></div>
        <div id="topbar-actions"></div>
      </div>
      <div id="page">
        <div class="spinner"></div>
      </div>
    </div>
  </div>
</div>

<!-- Toast container -->
<div id="toast-container"></div>

<!-- Modal container -->
<div id="modal-root"></div>

<script>
/* ═══════════════════════════════════════════════════════════════
   KARC ADMIN SPA
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────
const state = {
  user: null,
  currentPage: 'dashboard',
  memberSearch: '',
  memberPage: 1,
  memberYear: new Date().getFullYear(),
};

// ── API ───────────────────────────────────────────────────────────────
function toggleNav() {
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('nav-backdrop').classList.toggle('open', open);
}
function closeNav() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('nav-backdrop').classList.remove('open');
}

async function api(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch('/api' + path, opts);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(data.error || 'API error'), { status: resp.status, data });
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Auth ──────────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const err   = document.getElementById('login-err');
  err.classList.add('hidden');
  try {
    const data = await api('POST', '/auth/login', { email, password: pass });
    state.user = data.user;
    showApp();
  } catch (e) {
    err.textContent = e.data?.error || 'Login failed';
    err.classList.remove('hidden');
  }
}
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogout() {
  await api('POST', '/auth/logout').catch(() => {});
  state.user = null;
  document.getElementById('main-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

async function checkSession() {
  try {
    const data = await api('GET', '/auth/me');
    state.user = data.user;
    showApp();
  } catch {
    // Not logged in — show login screen (already showing)
  }
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-shell').classList.remove('hidden');
  // Set user info in sidebar
  const u = state.user;
  document.getElementById('user-email').textContent = u.email;
  document.getElementById('user-role').textContent  = u.role;
  document.getElementById('user-avatar').textContent = u.email[0].toUpperCase();
  if (u.role === 'admin') document.getElementById('nav-cutoff')?.classList.remove('hidden');
  if (u.role !== 'admin') {
    document.getElementById('nav-section-admin')?.classList.add('hidden');
    document.querySelectorAll('[data-page="users"],[data-page="audit"]').forEach(el => el.classList.add('hidden'));
  }
  nav('dashboard');
}

// ── Navigation ────────────────────────────────────────────────────────
function nav(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = { dashboard: 'Dashboard', members: 'Members', memberships: 'Dues & Memberships', users: 'User Accounts', audit: 'Audit Log', cutoff: 'Membership Cutoff' };
  document.getElementById('page-title').textContent = titles[page] || page;
  document.getElementById('topbar-actions').innerHTML = '';

  const adminOnly = new Set(['users', 'audit', 'cutoff']);
  if (adminOnly.has(page) && state.user?.role !== 'admin') {
    setPage('<p class="text-muted" style="padding:24px">Access restricted to administrators.</p>');
    return;
  }

  const pages = { dashboard, members, memberships, users, audit, cutoff };
  (pages[page] || (() => setPage('<p>Coming soon</p>') ))();
}

function setPage(html) { document.getElementById('page').innerHTML = html; }

// ── DASHBOARD ─────────────────────────────────────────────────────────
async function dashboard() {
  setPage('<div class="spinner"></div>');
  try {
    const [stats, msStats] = await Promise.all([
      api('GET', '/admin/stats'),
      api('GET', '/memberships/stats?year=' + new Date().getFullYear()),
    ]);

    const yr = new Date().getFullYear();
    const notRenewed = stats.not_renewed || [];
    const month = new Date().getMonth() + 1; // 1-based
    const inGrace = month >= 1 && month <= 3;

    setPage(\`
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val">\${stats.members?.active ?? '—'}</div>
          <div class="stat-label">Active Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${stats.members?.total ?? '—'}</div>
          <div class="stat-label">Total Records</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${msStats.stats?.active_count ?? '—'}</div>
          <div class="stat-label">\${yr} Paid Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${msStats.stats?.total_collected ? '$' + Number(msStats.stats.total_collected).toFixed(2) : '—'}</div>
          <div class="stat-label">\${yr} Revenue Collected</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${msStats.stats?.individual_count ?? '—'}</div>
          <div class="stat-label">Individual Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${msStats.stats?.family_count ?? '—'}</div>
          <div class="stat-label">Family Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${stats.members?.arrl_count ?? '—'}</div>
          <div class="stat-label">ARRL Members</div>
        </div>
      </div>
      \${notRenewed.length > 0 ? \`
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Not Yet Renewed — \${yr}
          <span style="background:var(--warn);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">\${notRenewed.length}</span>
        </div>
        <p style="color:var(--text-muted);margin:0 0 12px">\${inGrace
          ? \`Active in \${yr - 1} — still in grace period through March 31. Send renewal reminders now.\`
          : \`Active in \${yr - 1} but have not renewed for \${yr}. Grace period ended April 1.\`
        }</p>
        <table>
          <thead><tr><th>Callsign</th><th>Name</th><th>Email</th><th></th></tr></thead>
          <tbody>
            \${notRenewed.map(m => \`
              <tr>
                <td><strong>\${escHtml(m.callsign || '—')}</strong></td>
                <td>\${escHtml(m.first_name + ' ' + m.last_name)}</td>
                <td style="color:var(--text-muted)">\${escHtml(m.email || '—')}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewMember(\${m.id})">View</button></td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
      \` : ''}
      <div class="card">
        <div class="card-title">Recent Activity</div>
        <table>
          <thead><tr><th>Action</th><th>User</th><th>Time</th></tr></thead>
          <tbody>
            \${(stats.recent_activity || []).map(r => \`
              <tr>
                <td><code style="font-size:12px;color:var(--accent)">\${escHtml(r.action)}</code></td>
                <td>\${escHtml(r.email || '—')}</td>
                <td style="color:var(--text-muted)">\${fmtDate(r.created_at)}</td>
              </tr>
            \`).join('')}
          </tbody>
        </table>
      </div>
    \`);
  } catch(e) { setPage('<p class="text-muted">Error loading dashboard: ' + escHtml(e.message) + '</p>'); }
}

// ── MEMBERS ───────────────────────────────────────────────────────────
async function members() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-primary" onclick="openAddMember()">+ Add Member</button>';

  setPage(\`
    <div class="search-bar">
      <input type="text" id="member-search" placeholder="Search callsign, name, email…"
        value="\${escHtml(state.memberSearch)}"
        oninput="state.memberSearch=this.value; state.memberPage=1; loadMembersTable()">
      <select id="status-filter" onchange="loadMembersTable()" style="width:140px">
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="silent_key">Silent Key</option>
      </select>
      <select id="arrl-filter" onchange="loadMembersTable()" style="width:140px">
        <option value="all">All Members</option>
        <option value="arrl">ARRL Only</option>
        <option value="nonarrl">Non-ARRL</option>
      </select>
    </div>
    <div class="card" style="padding:0">
      <div id="members-table"><div class="spinner"></div></div>
      <div id="members-pagination" style="padding:12px 16px;display:flex;gap:8px;align-items:center"></div>
    </div>
  \`);
  loadMembersTable();
}

async function loadMembersTable() {
  const search = document.getElementById('member-search')?.value || '';
  const status = document.getElementById('status-filter')?.value || 'all';
  const arrl   = document.getElementById('arrl-filter')?.value   || 'all';
  const tbl = document.getElementById('members-table');
  if (!tbl) return;
  tbl.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api('GET', \`/members?q=\${encodeURIComponent(search)}&status=\${status}&arrl=\${arrl}&page=\${state.memberPage}\`);
    const { members: list, pagination: pg } = data;

    if (!list.length) {
      tbl.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">No members found.</p>';
      return;
    }

    tbl.innerHTML = \`
      <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Callsign</th><th>Name</th><th>Email</th>
            <th>Class</th><th>Type</th><th>Status</th><th>\${new Date().getFullYear()} Dues</th><th></th>
          </tr>
        </thead>
        <tbody>
          \${list.map(m => \`
            <tr>
              <td><span class="callsign">\${escHtml(m.callsign || '—')}</span>\${m.callsign_mismatch ? ' <span class="badge badge-yellow" title="Callsign may have changed hands — open record to review">⚠</span>' : ''}</td>
              <td>\${escHtml(m.first_name)} \${escHtml(m.last_name)}</td>
              <td style="color:var(--text-muted)">\${escHtml(m.email || '—')}</td>
              <td>\${licenseBadge(m.license_class)}</td>
              <td>\${m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : '<span class="badge badge-gray">Individual</span>'} \${m.is_arrl_member ? '<span class="badge badge-green">ARRL</span>' : ''}</td>
              <td>\${memberStatusBadge(m.is_active, m.is_silent_key)}</td>
              <td>\${duesBadge(m.current_year_status, m.current_year_paid, m.current_year_covered_by)}</td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="viewMember(\${m.id})">View</button>
              </td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
      </div>
    \`;

    // Pagination
    const pagEl = document.getElementById('members-pagination');
    if (pg && pg.pages > 1) {
      pagEl.innerHTML = \`
        <button class="btn btn-sm btn-secondary" \${pg.page<=1?'disabled':''} onclick="state.memberPage--; loadMembersTable()">‹ Prev</button>
        <span style="font-size:12px;color:var(--text-muted)">Page \${pg.page} of \${pg.pages} (\${pg.total} total)</span>
        <button class="btn btn-sm btn-secondary" \${pg.page>=pg.pages?'disabled':''} onclick="state.memberPage++; loadMembersTable()">Next ›</button>
      \`;
    } else {
      pagEl.innerHTML = \`<span style="font-size:12px;color:var(--text-muted)">\${pg?.total || 0} members</span>\`;
    }
  } catch(e) { tbl.innerHTML = '<p class="text-muted" style="padding:24px">Error: ' + escHtml(e.message) + '</p>'; }
}

async function viewMember(id) {
  showModal('<div class="spinner"></div>', 'Member Detail', []);
  try {
    const m = await api('GET', '/members/' + id);
    const currentYear = new Date().getFullYear();
    const curMs = (m.memberships || []).find(ms => ms.year === currentYear);

    document.querySelector('.modal-body').innerHTML = \`
      \${m.callsign_mismatch ? mismatchWarning(m) : ''}
      <div class="flex gap-16 align-center" style="margin-bottom:20px">
        <div>
          <div class="callsign" style="font-size:24px">\${escHtml(m.callsign || '—')}</div>
          <div style="font-size:18px;font-weight:600">\${escHtml(m.first_name)} \${escHtml(m.last_name)}</div>
        </div>
        <div class="spacer"></div>
        <div>
          \${memberStatusBadge(m.is_active, m.is_silent_key)}
          \${licenseBadge(m.license_class)}
        </div>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="switchTab(this,'tab-info')">Info</div>
        <div class="tab" onclick="switchTab(this,'tab-dues')">Dues History</div>
        <div class="tab" onclick="switchTab(this,'tab-notes')">Notes</div>
      </div>

      <!-- Info tab -->
      <div id="tab-info">
        <div class="detail-section">
          <h4>Contact</h4>
          <div class="detail-grid">
            \${dfield('Email', m.email)} \${dfield('Phone', m.phone)}
            \${dfield('Address', m.address)} \${dfield('City', m.city)}
            \${dfield('State', m.state)} \${dfield('ZIP', m.zip)}
          </div>
        </div>
        <div class="detail-section">
          <h4>License</h4>
          <div class="detail-grid">
            \${dfield('Class', m.license_class)} \${dfield('Expiry', m.license_expiry)}
            \${dfield('Status', m.license_status === 'A' ? 'Active' : m.license_status || '—')}
            \${dfield('Last Synced', m.hamdb_synced_at ? fmtDate(m.hamdb_synced_at) : 'Never')}
          </div>
        </div>
        <div class="detail-section">
          <h4>Membership</h4>
          <div class="detail-grid">
            \${dfield('Type', m.membership_type)}
            \${dfield('Joined', m.joined_date)}
            \${dfield('ARRL Member', m.is_arrl_member ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>')}
            \${dfield(currentYear + ' Dues', curMs ? duesBadge(curMs.status, curMs.amount_paid, curMs.covered_by_member_id) : '<span class="badge badge-yellow">No Record</span>')}
          </div>
        </div>
        \${m.emergency_name ? \`<div class="detail-section"><h4>Emergency Contact</h4><div class="detail-grid">\${dfield('Name', m.emergency_name)}\${dfield('Phone', m.emergency_phone)}</div></div>\` : ''}
        \${m.bio ? \`<div class="detail-section"><h4>Bio</h4><p style="font-size:13px">\${escHtml(m.bio)}</p></div>\` : ''}
      </div>

      <!-- Dues tab (hidden) -->
      <div id="tab-dues" class="hidden">
        <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openAddDues(\${m.id}, '\${escHtml(m.first_name)} \${escHtml(m.last_name)}')">+ Record Payment</button>
        \${(m.memberships || []).length === 0 ? '<p class="text-muted">No membership records yet.</p>' :
          m.memberships.map(ms => \`
            <div class="card" style="margin-bottom:8px;padding:12px">
              <div class="flex align-center gap-8">
                <strong>\${ms.year}</strong>
                \${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id)}
                \${ms.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : ''}
                <div class="spacer"></div>
                <span style="font-size:12px;color:var(--text-muted)">\${ms.payment_method || ''} \${ms.check_number ? '#'+ms.check_number : ''}</span>
                \${ms.paid_date ? \`<span style="font-size:12px;color:var(--text-muted)">\${ms.paid_date}</span>\` : ''}
                <button class="btn btn-sm btn-secondary" onclick="openEditDues(\${ms.id}, \${m.id})">Edit</button>
              </div>
              \${ms.covered_by_first_name ? \`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Covered under: \${ms.covered_by_callsign ? '<span class="callsign" style="font-size:12px">' + escHtml(ms.covered_by_callsign) + '</span> ' : ''}\${escHtml(ms.covered_by_first_name)} \${escHtml(ms.covered_by_last_name)}</div>\` : ''}
              \${ms.notes ? \`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">\${escHtml(ms.notes)}</div>\` : ''}
            </div>
          \`).join('')
        }
      </div>

      <!-- Notes tab (hidden) -->
      <div id="tab-notes" class="hidden">
        <div class="form-group" style="margin-bottom:12px">
          <textarea id="new-note" placeholder="Add a note about this member…"></textarea>
        </div>
        <button class="btn btn-sm btn-primary" onclick="addNote(\${m.id})">Add Note</button>
        <div class="divider"></div>
        <div id="notes-list">
          \${(m.notes || []).length === 0 ? '<p class="text-muted">No notes yet.</p>' :
            m.notes.map(n => \`
              <div class="note-item">
                <div class="note-meta">\${escHtml(n.author_email || 'Unknown')} · \${fmtDate(n.created_at)} \${n.is_private ? '🔒' : ''}</div>
                <div class="note-text">\${escHtml(n.note_text)}</div>
              </div>
            \`).join('')
          }
        </div>
      </div>
    \`;

    document.querySelector('.modal-footer').innerHTML = \`
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      <button class="btn btn-secondary" onclick="lookupCallsign('\${escHtml(m.callsign||'')}', \${m.id})" \${m.callsign?'':'disabled'}>↻ Sync License</button>
      <button class="btn btn-primary" onclick="openEditMember(\${m.id})">Edit Member</button>
    \`;
  } catch(e) {
    document.querySelector('.modal-body').innerHTML = '<p class="text-muted">Error: ' + escHtml(e.message) + '</p>';
  }
}

function switchTab(el, tabId) {
  el.closest('.modal-body, #page').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  el.closest('.modal-body, #page').querySelectorAll('[id^="tab-"]').forEach(t => t.classList.add('hidden'));
  document.getElementById(tabId)?.classList.remove('hidden');
}

async function addNote(memberId) {
  const text = document.getElementById('new-note')?.value.trim();
  if (!text) return toast('Note text is required', 'error');
  try {
    await api('POST', '/notes', { member_id: memberId, note_text: text });
    toast('Note added');
    viewMember(memberId);
  } catch(e) { toast(e.message, 'error'); }
}

function openAddMember() {
  showModal(\`
    <div class="form-group" style="margin-bottom:16px">
      <label>Callsign (auto-fill from HamDB)</label>
      <div class="flex gap-8">
        <input type="text" id="f-callsign" placeholder="N4JHC" style="text-transform:uppercase;flex:1"
          oninput="this.value=this.value.toUpperCase()">
        <button class="btn btn-secondary" onclick="lookupAndFill()">Lookup</button>
      </div>
      <div class="form-hint">Enter callsign and click Lookup to auto-fill name, address, license info</div>
    </div>
    <div class="divider"></div>
    <div class="form-grid">
      \${fi('First Name','f-first_name','','text','',true)}
      \${fi('Last Name','f-last_name','','text','',true)}
      \${fi('Email','f-email','','email')}
      \${fi('Phone','f-phone','')}
      \${fi('Address','f-address','')}
      \${fi('City','f-city','')}
      \${fi('State','f-state','','text','2-letter state code')}
      \${fi('ZIP','f-zip','')}
      \${fi('License Class','f-license_class','','select')}
      \${fi('License Expiry','f-license_expiry','','date')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="f-membership_type" onchange="updateAmtDue()">
          <option value="individual">Individual ($20/yr)</option>
          <option value="family">Family ($30/yr)</option>
        </select>
      </div>
      \${fi('Joined Date','f-joined_date',new Date().toISOString().slice(0,10),'date')}
    </div>
    <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer;margin-top:12px">
      <input type="checkbox" id="f-is_arrl_member" style="width:auto">
      <span>ARRL Member</span>
    </label>
    <div class="card" style="margin-top:16px">
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="f-create_ms" checked onchange="toggleMsFields()" style="width:auto">
        <span>Create \${new Date().getFullYear()} membership record and mark paid</span>
      </label>
      <div id="f-ms-fields" style="margin-top:12px">
        <div class="form-grid">
          \${fi('Amount Paid','f-amount_paid','20.00','number')}
          \${fi('Payment Date','f-paid_date',new Date().toISOString().slice(0,10),'date')}
          <div class="form-group">
            <label>Payment Method</label>
            <select id="f-payment_method">
              <option value="">— Select —</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="paypal">PayPal</option>
              <option value="other">Other</option>
            </select>
          </div>
          \${fi('Check Number','f-check_number','')}
        </div>
      </div>
    </div>
    \${fi('Notes (optional)','f-bio','','textarea')}
  \`, 'Add New Member', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save Member', cls: 'btn-primary', fn: 'saveMember()' },
  ]);

  // Inject license class options
  const sel = document.getElementById('f-license_class');
  if (sel) {
    ['','Technician','General','Amateur Extra','Novice','Advanced'].forEach(c => {
      const o = document.createElement('option'); o.value = c; o.textContent = c || '— Unknown —'; sel.appendChild(o);
    });
  }
}

function updateAmtDue() {
  const type = document.getElementById('f-membership_type')?.value;
  const amtEl = document.getElementById('f-amount_paid');
  if (amtEl) amtEl.value = type === 'family' ? '30.00' : '20.00';
}

function toggleMsFields() {
  const checked = document.getElementById('f-create_ms')?.checked;
  const fields = document.getElementById('f-ms-fields');
  if (fields) fields.hidden = !checked;
}

async function lookupAndFill() {
  const call = document.getElementById('f-callsign')?.value.trim().toUpperCase();
  if (!call) return toast('Enter a callsign first', 'error');
  try {
    const data = await api('GET', '/lookup/' + call);
    if (!data.found) { toast('Callsign not found in HamDB', 'error'); return; }
    setIfEmpty('f-first_name', data.first_name);
    setIfEmpty('f-last_name',  data.last_name);
    setIfEmpty('f-address',    data.address);
    setIfEmpty('f-city',       data.city);
    setIfEmpty('f-state',      data.state);
    setIfEmpty('f-zip',        data.zip);
    if (data.license_class) {
      const sel = document.getElementById('f-license_class');
      if (sel) sel.value = data.license_class;
    }
    setIfEmpty('f-license_expiry', data.license_expiry);
    toast('Auto-filled from HamDB ✓');
  } catch(e) { toast('Lookup failed: ' + e.message, 'error'); }
}

function setIfEmpty(id, val) {
  const el = document.getElementById(id);
  if (el && !el.value && val) el.value = val;
}

async function saveMember() {
  const body = {
    callsign:        gv('f-callsign')?.toUpperCase() || null,
    first_name:      gv('f-first_name'),
    last_name:       gv('f-last_name'),
    email:           gv('f-email'),
    phone:           gv('f-phone'),
    address:         gv('f-address'),
    city:            gv('f-city'),
    state:           gv('f-state'),
    zip:             gv('f-zip'),
    license_class:   gv('f-license_class'),
    license_expiry:  gv('f-license_expiry'),
    membership_type: gv('f-membership_type') || 'individual',
    joined_date:     gv('f-joined_date'),
    bio:             gv('f-bio'),
    is_active:       true,
    is_arrl_member:  document.getElementById('f-is_arrl_member')?.checked || false,
    create_membership:  document.getElementById('f-create_ms')?.checked,
    ms_amount_paid:     gv('f-amount_paid') ? parseFloat(gv('f-amount_paid')) : null,
    ms_paid_date:       gv('f-paid_date') || null,
    ms_payment_method:  gv('f-payment_method') || null,
    ms_check_number:    gv('f-check_number') || null,
  };
  if (!body.first_name || !body.last_name) return toast('First and last name are required', 'error');
  try {
    await api('POST', '/members', body);
    toast('Member added successfully ✓');
    closeModal();
    loadMembersTable();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function openEditMember(id) {
  const m = await api('GET', '/members/' + id).catch(() => null);
  if (!m) return;
  showModal(\`
    <div class="form-grid">
      \${fi('Callsign','e-callsign',m.callsign||'')}
      <div></div>
      \${fi('First Name','e-first_name',m.first_name||'')}
      \${fi('Last Name','e-last_name',m.last_name||'')}
      \${fi('Email','e-email',m.email||'')}
      \${fi('Phone','e-phone',m.phone||'')}
      \${fi('Address','e-address',m.address||'')}
      \${fi('City','e-city',m.city||'')}
      \${fi('State','e-state',m.state||'')}
      \${fi('ZIP','e-zip',m.zip||'')}
      \${fi('License Class','e-license_class',m.license_class||'','select')}
      \${fi('License Expiry','e-license_expiry',m.license_expiry||'','date')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="e-membership_type">
          <option value="individual" \${m.membership_type==='individual'?'selected':''}>Individual ($20/yr)</option>
          <option value="family"     \${m.membership_type==='family'?'selected':''}>Family ($30/yr)</option>
        </select>
      </div>
      \${fi('Joined Date','e-joined_date',m.joined_date||'','date')}
      <div class="form-group">
        <label>Status</label>
        <select id="e-member_status">
          <option value="active"     \${m.is_active && !m.is_silent_key ? 'selected' : ''}>Active</option>
          <option value="inactive"   \${!m.is_active && !m.is_silent_key ? 'selected' : ''}>Inactive</option>
          <option value="silent_key" \${m.is_silent_key ? 'selected' : ''}>Silent Key (SK)</option>
        </select>
      </div>
      \${fi('Emergency Contact Name','e-emergency_name',m.emergency_name||'')}
      \${fi('Emergency Phone','e-emergency_phone',m.emergency_phone||'')}
    </div>
    <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer;margin-top:12px">
      <input type="checkbox" id="e-is_arrl_member" style="width:auto" \${m.is_arrl_member ? 'checked' : ''}>
      <span>ARRL Member</span>
    </label>
    <div class="form-group mt-16">
      <label>Bio / Notes</label>
      <textarea id="e-bio">\${escHtml(m.bio||'')}</textarea>
    </div>
    <div class="form-group mt-8">
      <label>Interests</label>
      <input type="text" id="e-interests" value="\${escHtml(m.interests||'')}" placeholder="DX, CW, VHF contesting…">
    </div>
  \`, 'Edit: ' + m.first_name + ' ' + m.last_name + (m.callsign ? ' (' + m.callsign + ')' : ''), [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save Changes', cls: 'btn-primary', fn: 'updateMember(' + id + ')' },
  ]);

  const sel = document.getElementById('e-license_class');
  if (sel) {
    ['','Technician','General','Amateur Extra','Novice','Advanced'].forEach(c => {
      const o = document.createElement('option'); o.value = c; o.textContent = c || '— Unknown —';
      if (c === m.license_class) o.selected = true;
      sel.appendChild(o);
    });
  }
}

async function updateMember(id) {
  const body = {
    callsign:        gv('e-callsign')?.toUpperCase() || null,
    first_name:      gv('e-first_name'),
    last_name:       gv('e-last_name'),
    email:           gv('e-email'),
    phone:           gv('e-phone'),
    address:         gv('e-address'),
    city:            gv('e-city'),
    state:           gv('e-state'),
    zip:             gv('e-zip'),
    license_class:   gv('e-license_class'),
    license_expiry:  gv('e-license_expiry'),
    membership_type: gv('e-membership_type'),
    joined_date:     gv('e-joined_date'),
    is_active:       gv('e-member_status') === 'active',
    is_silent_key:   gv('e-member_status') === 'silent_key',
    is_arrl_member:  document.getElementById('e-is_arrl_member')?.checked || false,
    bio:             gv('e-bio'),
    interests:       gv('e-interests'),
    emergency_name:  gv('e-emergency_name'),
    emergency_phone: gv('e-emergency_phone'),
  };
  try {
    await api('PUT', '/members/' + id, body);
    toast('Member updated ✓');
    closeModal();
    viewMember(id);
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function lookupCallsign(callsign, memberId) {
  if (!callsign) return;
  try {
    const data = await api('GET', '/lookup/' + callsign + '?force=1');
    if (data.found) {
      toast('License data synced from HamDB ✓');
      viewMember(memberId);
    } else {
      toast('Callsign not found in HamDB', 'error');
    }
  } catch(e) { toast('Lookup failed', 'error'); }
}

// ── MEMBERSHIPS page ──────────────────────────────────────────────────
async function memberships() {
  setPage('<div class="spinner"></div>');
  const yr = new Date().getFullYear();
  const years = [yr, yr-1, yr-2, yr-3];

  setPage(\`
    <div class="year-row">
      \${years.map(y => \`<div class="year-pill \${y===state.memberYear?'active':''}" onclick="state.memberYear=\${y};loadDuesTable()">\${y}</div>\`).join('')}
    </div>
    <div id="dues-stats" class="stat-grid"></div>
    <div class="flex gap-8 align-center" style="margin-bottom:16px">
      <span style="font-size:13px;color:var(--text-muted)" id="dues-count"></span>
      <div class="spacer"></div>
    </div>
    <div class="card" style="padding:0">
      <div id="dues-table"><div class="spinner"></div></div>
    </div>
  \`);
  loadDuesTable();
}

async function loadDuesTable() {
  const yr = state.memberYear;
  document.querySelectorAll('.year-pill').forEach(p => p.classList.toggle('active', p.textContent == yr));

  let duesData, statsData;
  try {
    [duesData, statsData] = await Promise.all([
      api('GET', '/memberships?year=' + yr),
      api('GET', '/memberships/stats?year=' + yr),
    ]);
  } catch(e) {
    const el = document.getElementById('dues-table');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Failed to load dues data.</p>';
    toast(e.data?.error || e.message || 'Failed to load dues', 'error');
    return;
  }

  const st = statsData?.stats || {};
  document.getElementById('dues-stats').innerHTML = \`
    <div class="stat-card"><div class="stat-val">\${st.active_count||0}</div><div class="stat-label">Paid Members</div></div>
    <div class="stat-card"><div class="stat-val">\${st.honorary_count||0}</div><div class="stat-label">Honorary</div></div>
    <div class="stat-card"><div class="stat-val">$\${Number(st.total_collected||0).toFixed(2)}</div><div class="stat-label">Collected</div></div>
    <div class="stat-card"><div class="stat-val">\${st.individual_count||0}</div><div class="stat-label">Individual</div></div>
    <div class="stat-card"><div class="stat-val">\${st.family_count||0}</div><div class="stat-label">Family</div></div>
  \`;

  const list = duesData.memberships || [];
  document.getElementById('dues-count').textContent = list.length + ' records for ' + yr;

  document.getElementById('dues-table').innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No membership records for ' + yr + '.</p>'
    : \`<div class="tbl-wrap"><table>
        <thead><tr><th>Callsign</th><th>Name</th><th>Type</th><th>Status</th><th>Due</th><th>Paid</th><th>Method</th><th>Check #</th><th>Date</th><th></th></tr></thead>
        <tbody>
          \${list.map(ms => \`<tr>
            <td><span class="callsign">\${escHtml(ms.callsign||'—')}</span></td>
            <td>
              \${escHtml(ms.first_name)} \${escHtml(ms.last_name)}
              \${ms.covered_by_first_name ? \`<div style="font-size:11px;color:var(--text-muted)">Covered under: \${ms.covered_by_callsign ? escHtml(ms.covered_by_callsign) + ' ' : ''}\${escHtml(ms.covered_by_first_name)} \${escHtml(ms.covered_by_last_name)}</div>\` : ''}
            </td>
            <td>\${ms.membership_type==='family'?'<span class="badge badge-blue">Family</span>':'<span class="badge badge-gray">Individual</span>'}</td>
            <td>\${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id)}</td>
            <td>$\${ms.covered_by_member_id ? '0.00' : Number(ms.amount_due||0).toFixed(2)}</td>
            <td>\${ms.amount_paid != null ? '$' + Number(ms.amount_paid).toFixed(2) : '<span class="text-muted">—</span>'}</td>
            <td>\${escHtml(ms.payment_method||'—')}</td>
            <td>\${escHtml(ms.check_number||'—')}</td>
            <td style="color:var(--text-muted)">\${ms.paid_date||'—'}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="openEditDues(\${ms.id})">Edit</button></td>
          </tr>\`).join('')}
        </tbody>
      </table></div>\`;
}

async function openAddDues(memberId, memberName) {
  const yr = new Date().getFullYear();
  let memberOpts = '<option value="">— None (primary payer) —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .filter(x => x.id !== memberId)
      .map(x => \`<option value="\${x.id}">\${x.callsign ? escHtml(x.callsign) + ' — ' : ''}\${escHtml(x.first_name)} \${escHtml(x.last_name)}</option>\`)
      .join('');
  } catch {}
  showModal(\`
    <div class="form-grid">
      <div class="form-group"><label>Member</label><input type="text" value="\${escHtml(memberName)}" disabled></div>
      \${fi('Year','d-year',yr,'number')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="d-membership_type" onchange="updateDueAmt()">
          <option value="individual">Individual ($20.00)</option>
          <option value="family">Family ($30.00)</option>
        </select>
      </div>
      <div class="form-group" id="d-covered-by-wrap" hidden>
        <label>Covered under (optional)</label>
        <select id="d-covered_by_member_id" onchange="onCoveredByChange()">\${memberOpts}</select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="d-status">
          <option value="active">Active</option>
          <option value="honorary">Honorary</option>
          <option value="waived">Waived</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      \${fi('Amount Due','d-amount_due','20.00','number')}
      \${fi('Amount Paid','d-amount_paid','','number')}
      \${fi('Payment Date','d-paid_date','','date')}
      <div class="form-group">
        <label>Payment Method</label>
        <select id="d-payment_method">
          <option value="">— Select —</option>
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="paypal">PayPal</option>
          <option value="other">Other</option>
        </select>
      </div>
      \${fi('Check Number','d-check_number','')}
    </div>
    \${fi('Notes','d-notes','','textarea')}
  \`, 'Record Membership Payment', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save', cls: 'btn-primary', fn: 'saveDues(' + memberId + ')' },
  ]);
}

function updateDueAmt() {
  const type = document.getElementById('d-membership_type')?.value;
  const coverWrap = document.getElementById('d-covered-by-wrap');
  if (coverWrap) coverWrap.hidden = (type !== 'family');
  if (type !== 'family') {
    const el = document.getElementById('d-covered_by_member_id');
    if (el) el.value = '';
  }
  onCoveredByChange();
}

function onCoveredByChange() {
  const coveredBy = document.getElementById('d-covered_by_member_id')?.value;
  const type = document.getElementById('d-membership_type')?.value;
  const amtEl = document.getElementById('d-amount_due');
  if (amtEl) amtEl.value = coveredBy ? '0.00' : (type === 'family' ? '30.00' : '20.00');
}

async function saveDues(memberId) {
  const body = {
    member_id:            memberId,
    year:                 parseInt(gv('d-year'), 10),
    status:               gv('d-status'),
    membership_type:      gv('d-membership_type'),
    amount_due:           parseFloat(gv('d-amount_due')) || null,
    amount_paid:          gv('d-amount_paid') ? parseFloat(gv('d-amount_paid')) : null,
    paid_date:            gv('d-paid_date') || null,
    payment_method:       gv('d-payment_method') || null,
    check_number:         gv('d-check_number') || null,
    notes:                gv('d-notes') || null,
    covered_by_member_id: parseInt(gv('d-covered_by_member_id')) || null,
  };
  try {
    await api('POST', '/memberships', body);
    toast('Payment recorded ✓');
    closeModal();
    viewMember(memberId);
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function openEditDues(id, memberId) {
  const ms = await api('GET', '/memberships/' + id).catch(() => null);
  if (!ms) return;
  let memberOpts = '<option value="">— None (primary payer) —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .filter(x => x.id !== ms.member_id)
      .map(x => \`<option value="\${x.id}" \${ms.covered_by_member_id===x.id?'selected':''}>\${x.callsign ? escHtml(x.callsign) + ' — ' : ''}\${escHtml(x.first_name)} \${escHtml(x.last_name)}</option>\`)
      .join('');
  } catch {}
  showModal(\`
    <div class="form-grid">
      <div class="form-group">
        <label>Status</label>
        <select id="ed-status">
          \${['active','expired','honorary','pending','waived'].map(s => \`<option value="\${s}" \${ms.status===s?'selected':''}>\${s.charAt(0).toUpperCase()+s.slice(1)}</option>\`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Membership Type</label>
        <select id="ed-membership_type" onchange="updateEditDueAmt()">
          <option value="individual" \${ms.membership_type==='individual'?'selected':''}>Individual ($20.00)</option>
          <option value="family"     \${ms.membership_type==='family'?'selected':''}>Family ($30.00)</option>
        </select>
      </div>
      <div class="form-group" id="ed-covered-by-wrap" \${ms.membership_type==='family'?'':'hidden'}>
        <label>Covered under (optional)</label>
        <select id="ed-covered_by_member_id" onchange="onEditCoveredByChange()">\${memberOpts}</select>
      </div>
      \${fi('Amount Due','ed-amount_due',ms.amount_due||'','number')}
      \${fi('Amount Paid','ed-amount_paid',ms.amount_paid||'','number')}
      \${fi('Payment Date','ed-paid_date',ms.paid_date||'','date')}
      <div class="form-group">
        <label>Payment Method</label>
        <select id="ed-payment_method">
          <option value="">— Select —</option>
          \${['cash','check','paypal','other'].map(m => \`<option value="\${m}" \${ms.payment_method===m?'selected':''}>\${m.charAt(0).toUpperCase()+m.slice(1)}</option>\`).join('')}
        </select>
      </div>
      \${fi('Check Number','ed-check_number',ms.check_number||'')}
    </div>
    \${fi('Notes','ed-notes',ms.notes||'','textarea')}
  \`, 'Edit Membership Record – ' + ms.year, [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save', cls: 'btn-primary', fn: 'updateDues(' + id + ',' + (memberId || 'null') + ')' },
  ]);
}

function updateEditDueAmt() {
  const type = document.getElementById('ed-membership_type')?.value;
  const coverWrap = document.getElementById('ed-covered-by-wrap');
  if (coverWrap) coverWrap.hidden = (type !== 'family');
  if (type !== 'family') {
    const el = document.getElementById('ed-covered_by_member_id');
    if (el) el.value = '';
  }
  onEditCoveredByChange();
}

function onEditCoveredByChange() {
  const coveredBy = document.getElementById('ed-covered_by_member_id')?.value;
  const amtEl = document.getElementById('ed-amount_due');
  if (amtEl && coveredBy) amtEl.value = '0.00';
}

async function updateDues(id, memberId) {
  const body = {
    status:               gv('ed-status'),
    membership_type:      gv('ed-membership_type'),
    amount_due:           parseFloat(gv('ed-amount_due')) || null,
    amount_paid:          gv('ed-amount_paid') ? parseFloat(gv('ed-amount_paid')) : null,
    paid_date:            gv('ed-paid_date') || null,
    payment_method:       gv('ed-payment_method') || null,
    check_number:         gv('ed-check_number') || null,
    notes:                gv('ed-notes') || null,
    covered_by_member_id: parseInt(gv('ed-covered_by_member_id')) || null,
  };
  try {
    await api('PUT', '/memberships/' + id, body);
    toast('Updated ✓');
    closeModal();
    if (memberId) viewMember(memberId);
    else loadDuesTable();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── MEMBERSHIP CUTOFF ─────────────────────────────────────────────────
async function cutoff() {
  const yr = new Date().getFullYear();
  setPage(\`
    <div class="card" style="background:rgba(231,76,60,.05);border-color:rgba(231,76,60,.3);margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px;color:var(--danger)">⚠ Membership Cutoff Tool</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0">
        Sets all active members with no paid, honorary, waived, or family-covered record for the
        selected year to <strong style="color:var(--text)">Inactive</strong>.
        Silent Key members are never affected. Always run Preview before executing.
      </p>
    </div>
    <div class="card">
      <div class="flex gap-16 align-center">
        <div class="form-group" style="width:200px;margin:0">
          <label>Cutoff Year</label>
          <select id="cutoff-year">
            \${[yr - 1, yr, yr + 1].map(y => \`<option value="\${y}" \${y === yr ? 'selected' : ''}>\${y}</option>\`).join('')}
          </select>
        </div>
        <div style="padding-top:20px">
          <button class="btn btn-secondary" onclick="previewCutoff()">Preview</button>
        </div>
      </div>
    </div>
    <div id="cutoff-results"></div>
  \`);
}

async function previewCutoff() {
  const year = parseInt(document.getElementById('cutoff-year')?.value, 10);
  const res  = document.getElementById('cutoff-results');
  if (!res) return;
  res.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api('POST', '/admin/cutoff', { year, dry_run: true });
    const list = data.members || [];
    res.innerHTML = \`
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Preview — \${year} Cutoff
          <span style="background:\${list.length ? 'var(--danger)' : 'var(--success)'};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">\${list.length}</span>
        </div>
        \${list.length === 0
          ? \`<p style="color:var(--success)">✓ All active members have a paid or exempt record for \${year}. No cutoff needed.</p>\`
          : \`<p style="color:var(--text-muted);margin-bottom:16px;font-size:13px">
              \${list.length} member\${list.length !== 1 ? 's' : ''} would be set to Inactive.
              Review the list below, then click Run Cutoff to proceed.
            </p>
            <div class="tbl-wrap">
            <table>
              <thead><tr><th>Callsign</th><th>Name</th><th>Email</th></tr></thead>
              <tbody>
                \${list.map(m => \`<tr>
                  <td><span class="callsign">\${escHtml(m.callsign || '—')}</span></td>
                  <td>\${escHtml(m.first_name)} \${escHtml(m.last_name)}</td>
                  <td style="color:var(--text-muted)">\${escHtml(m.email || '—')}</td>
                </tr>\`).join('')}
              </tbody>
            </table>
            </div>
            <div class="divider"></div>
            <button class="btn btn-danger" onclick="executeCutoff(\${year}, \${list.length})">
              ⚡ Run Cutoff for \${year} (\${list.length} member\${list.length !== 1 ? 's' : ''})
            </button>\`
        }
      </div>
    \`;
  } catch(e) { res.innerHTML = '<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'; }
}

async function executeCutoff(year, count) {
  if (!confirm(\`Set \${count} member\${count !== 1 ? 's' : ''} to Inactive for \${year}?\\n\\nThis cannot be undone.\`)) return;
  const res = document.getElementById('cutoff-results');
  try {
    const data = await api('POST', '/admin/cutoff', { year, dry_run: false });
    const n = data.deactivated_count;
    toast(\`Cutoff complete — \${n} member\${n !== 1 ? 's' : ''} set to Inactive ✓\`);
    res.innerHTML = \`
      <div class="card" style="border-color:var(--success)">
        <div style="color:var(--success);font-weight:600;margin-bottom:8px">✓ Cutoff Complete</div>
        <p style="font-size:13px;color:var(--text-muted)">\${n} member\${n !== 1 ? 's' : ''} set to Inactive for \${year}. Audit log entry recorded.</p>
      </div>
    \`;
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── USERS ─────────────────────────────────────────────────────────────
async function users() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-primary" onclick="openAddUser()">+ Add User Account</button>';

  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/users');
    setPage(\`
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>Email</th><th>Callsign</th><th>Name</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr></thead>
          <tbody>
            \${data.users.map(u => \`<tr>
              <td>\${escHtml(u.email)}</td>
              <td><span class="callsign">\${escHtml(u.callsign||'—')}</span></td>
              <td>\${escHtml(u.first_name||'')} \${escHtml(u.last_name||'')}</td>
              <td>\${roleBadge(u.role)}</td>
              <td>\${u.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Disabled</span>'}</td>
              <td style="color:var(--text-muted)">\${u.last_login ? fmtDate(u.last_login) : 'Never'}</td>
              <td>
                \${u.id !== state.user?.id ? \`<button class="btn btn-sm btn-secondary" onclick="editUser(\${u.id})">Edit</button>\` : '<span class="text-muted" style="font-size:12px">You</span>'}
              </td>
            </tr>\`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">Change My Password</div>
        <div class="form-grid">
          \${fi('Current Password','cp-current','','password')}
          \${fi('New Password (10+ chars)','cp-new','','password')}
          \${fi('Confirm New Password','cp-confirm','','password')}
        </div>
        <button class="btn btn-primary mt-16" onclick="changeMyPassword()">Update Password</button>
      </div>
    \`);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

function openAddUser() {
  showModal(\`
    \${fi('Email','nu-email','','email','')}
    \${fi('Password (10+ chars)','nu-pass','','password')}
    <div class="form-group mt-8">
      <label>Role</label>
      <select id="nu-role">
        <option value="board">Board Member</option>
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
    </div>
  \`, 'Add User Account', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Create', cls: 'btn-primary', fn: 'saveNewUser()' },
  ]);
}

async function saveNewUser() {
  const body = { email: gv('nu-email'), password: gv('nu-pass'), role: gv('nu-role') };
  if (!body.email || !body.password) return toast('Email and password required', 'error');
  try {
    await api('POST', '/admin/users', body);
    toast('User account created ✓');
    closeModal();
    users();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function editUser(id) {
  const data = await api('GET', '/admin/users').catch(() => ({ users: [] }));
  const u    = data.users.find(x => x.id === id);
  if (!u) return;
  showModal(\`
    <div class="form-group">
      <label>Email</label>
      <input type="text" value="\${escHtml(u.email)}" disabled>
    </div>
    <div class="form-group mt-8">
      <label>Role</label>
      <select id="eu-role">
        \${['admin','board','member'].map(r => \`<option value="\${r}" \${u.role===r?'selected':''}>\${r.charAt(0).toUpperCase()+r.slice(1)}</option>\`).join('')}
      </select>
    </div>
    <div class="form-group mt-8">
      <label>Status</label>
      <select id="eu-active">
        <option value="1" \${u.is_active?'selected':''}>Active</option>
        <option value="0" \${!u.is_active?'selected':''}>Disabled</option>
      </select>
    </div>
  \`, 'Edit User: ' + u.email, [
    { label: 'Cancel',  cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Delete',  cls: 'btn-danger',    fn: 'deleteUser(' + id + ')' },
    { label: 'Save',    cls: 'btn-primary',   fn: 'saveEditUser(' + id + ')' },
  ]);
}

async function saveEditUser(id) {
  try {
    await api('PUT', '/admin/users/' + id, { role: gv('eu-role'), is_active: gv('eu-active') === '1' });
    toast('User updated ✓');
    closeModal();
    users();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user account? This cannot be undone.')) return;
  try {
    await api('DELETE', '/admin/users/' + id);
    toast('User deleted ✓');
    closeModal();
    users();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

function openChangePassword() {
  showModal(\`
    <div class="form-grid">
      \${fi('Current Password','cp-current','','password')}
      \${fi('New Password (10+ chars)','cp-new','','password')}
      \${fi('Confirm New Password','cp-confirm','','password')}
    </div>
  \`, 'Change My Password', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Update Password', cls: 'btn-primary', fn: 'changeMyPassword()' },
  ]);
}

async function changeMyPassword() {
  const cur  = gv('cp-current');
  const nw   = gv('cp-new');
  const conf = gv('cp-confirm');
  if (!cur || !nw) return toast('All fields required', 'error');
  if (nw !== conf) return toast('Passwords do not match', 'error');
  if (nw.length < 10) return toast('Password must be at least 10 characters', 'error');
  try {
    await api('POST', '/admin/password', { current_password: cur, new_password: nw });
    toast('Password changed ✓');
    closeModal();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── AUDIT LOG ─────────────────────────────────────────────────────────
async function audit() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/audit');
    setPage(\`
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            \${data.log.map(r => {
              const _t = auditTarget(r), _d = auditDetail(r);
              return \`<tr>
              <td style="color:var(--text-muted);white-space:nowrap">\${fmtDate(r.created_at)}</td>
              <td style="font-size:12px">\${escHtml(r.user_email||'—')}</td>
              <td><code style="font-size:11px;color:var(--accent)">\${escHtml(r.action)}</code></td>
              <td style="font-size:12px">\${escHtml(_t)}</td>
              <td style="font-size:12px;color:var(--text-muted)">\${escHtml(_d)}</td>
            </tr>\`;
            }).join('')}
          </tbody>
        </table>
      </div>
    \`);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function auditTarget(r) {
  const d = tryParseJson(r.detail);
  if (r.target_type === 'member') {
    const name = r.target_name || d?.name || '';
    const call = r.target_callsign || d?.callsign || '';
    if (name && call) return \`\${name} (\${call})\`;
    if (name) return name;
    if (call) return call;
    return \`member #\${r.target_id}\`;
  }
  if (r.target_type === 'membership') {
    const name = r.target_name || '';
    const call = r.target_callsign ? \` (\${r.target_callsign})\` : '';
    const year = r.target_year || d?.year || '';
    if (name) return \`\${year ? year + ' dues — ' : ''}\${name}\${call}\`;
    return \`membership #\${r.target_id}\`;
  }
  if (r.target_type === 'user') return d?.email || \`user #\${r.target_id}\`;
  if (r.target_type === 'note') return d?.member_id ? \`note for member #\${d.member_id}\` : \`note #\${r.target_id}\`;
  return '—';
}

function auditDetail(r) {
  const d = tryParseJson(r.detail);
  if (!d) return '';
  switch (r.action) {
    case 'member.update': {
      if (!d.before || !d.changes) return '';
      const skip = new Set(['updated_at', 'created_at', 'id']);
      const changed = Object.keys(d.changes)
        .filter(k => !skip.has(k) && String(d.changes[k] ?? '') !== String(d.before[k] ?? ''))
        .map(k => k.replace(/_/g, ' '));
      return changed.length ? \`Changed: \${changed.join(', ')}\` : '';
    }
    case 'membership.update': {
      const c = d.changes || {};
      const parts = [];
      if (c.amount_paid != null) parts.push('paid $' + c.amount_paid);
      if (c.payment_method)      parts.push(c.payment_method);
      if (c.status)              parts.push('status: ' + c.status);
      return parts.join(', ');
    }
    case 'membership.create':  return d.year ? 'Year ' + d.year : '';
    case 'member.cutoff':      return d?.deactivated_count != null ? d.deactivated_count + ' member' + (d.deactivated_count !== 1 ? 's' : '') + ' set inactive for ' + d.year : '';
    case 'login.failed':       return [d.email, d.reason?.replace(/_/g, ' ')].filter(Boolean).join(' — ');
    case 'user.create':        return [d.email, d.role ? 'role: ' + d.role : ''].filter(Boolean).join(', ');
    case 'user.update': {
      const skip = new Set(['password_hash', 'updated_at', 'created_at', 'id']);
      const keys = Object.keys(d).filter(k => !skip.has(k)).map(k => k.replace(/_/g, ' '));
      return keys.length ? \`Changed: \${keys.join(', ')}\` : '';
    }
    default: return '';
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────
function showModal(bodyHtml, title, buttons) {
  const btns = buttons.map(b => \`<button class="btn \${b.cls}" onclick="\${b.fn}">\${b.label}</button>\`).join('');
  document.getElementById('modal-root').innerHTML = \`
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <div class="modal-header">
          <h3>\${escHtml(title)}</h3>
          <button class="btn btn-sm btn-secondary" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">\${bodyHtml}</div>
        <div class="modal-footer">\${btns}</div>
      </div>
    </div>
  \`;
}

function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// ── Form helpers ──────────────────────────────────────────────────────
function fi(label, id, val='', type='text', placeholder='', required=false) {
  if (type === 'textarea') {
    return \`<div class="form-group full"><label>\${escHtml(label)}\${required?' *':''}</label><textarea id="\${id}">\${escHtml(String(val))}</textarea></div>\`;
  }
  if (type === 'select') {
    return \`<div class="form-group"><label>\${escHtml(label)}\${required?' *':''}</label><select id="\${id}"></select></div>\`;
  }
  return \`<div class="form-group"><label>\${escHtml(label)}\${required?' *':''}</label><input type="\${type}" id="\${id}" value="\${escHtml(String(val))}" placeholder="\${escHtml(placeholder)}"></div>\`;
}

function dfield(label, val) {
  return \`<div class="detail-field"><label>\${escHtml(label)}</label><div class="val">\${val||'<span class="text-muted">—</span>'}</div></div>\`;
}

function gv(id) { return document.getElementById(id)?.value || ''; }

// ── Badge helpers ─────────────────────────────────────────────────────
function licenseBadge(cls) {
  if (!cls) return '<span class="badge badge-gray">Unknown</span>';
  const map = { 'Amateur Extra': 'badge-blue', 'General': 'badge-green', 'Technician': 'badge-yellow' };
  return \`<span class="badge \${map[cls]||'badge-gray'}">\${escHtml(cls)}</span>\`;
}

function mismatchWarning(m) {
  let hamData = {};
  try { hamData = JSON.parse(m.hamdb_mismatch_data || '{}'); } catch {}
  const hamName = [hamData.first_name, hamData.last_name].filter(Boolean).join(' ') || '(unknown)';
  const ourName = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return \`
    <div style="background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.4);border-radius:var(--radius);padding:14px 16px;margin-bottom:20px">
      <div style="font-weight:600;color:var(--warn);margin-bottom:6px">⚠ Callsign may have changed hands</div>
      <div style="font-size:13px;margin-bottom:10px">
        HamDB now shows <strong>\${escHtml(hamName)}</strong> for <span class="callsign" style="font-size:13px">\${escHtml(m.callsign)}</span>,
        but our record has <strong>\${escHtml(ourName)}</strong>.
        The callsign may have been reassigned by the FCC.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-secondary" onclick="resolveCallsign(\${m.id},'keep')">Keep Our Record</button>
        <button class="btn btn-sm btn-danger"    onclick="resolveCallsign(\${m.id},'update')">Update from HamDB</button>
      </div>
    </div>
  \`;
}

async function resolveCallsign(memberId, action) {
  try {
    await api('POST', \`/members/\${memberId}/resolve-callsign\`, { action });
    toast(action === 'keep' ? 'Record kept — flag cleared ✓' : 'Record updated from HamDB ✓');
    viewMember(memberId);
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

function memberStatusBadge(isActive, isSilentKey) {
  if (isSilentKey) return '<span class="badge badge-purple">Silent Key</span>';
  if (isActive)    return '<span class="badge badge-green">Active</span>';
  return '<span class="badge badge-red">Inactive</span>';
}

function duesBadge(status, paid, coveredBy) {
  if (status === 'honorary') return '<span class="badge badge-blue">Honorary</span>';
  if (status === 'waived')   return '<span class="badge badge-gray">Waived</span>';
  if (coveredBy)             return '<span class="badge badge-green">Covered</span>';
  if (paid != null)          return '<span class="badge badge-green">Paid</span>';
  if (status === 'active')   return '<span class="badge badge-yellow">Unpaid</span>';
  if (status === 'expired')  return '<span class="badge badge-red">Expired</span>';
  return '<span class="badge badge-gray">—</span>';
}

function roleBadge(role) {
  const map = { admin: 'badge-red', board: 'badge-blue', member: 'badge-gray' };
  return \`<span class="badge \${map[role]||'badge-gray'}">\${escHtml(role)}</span>\`;
}

// ── Utilities ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

// ── Boot ──────────────────────────────────────────────────────────────
checkSession();
</script>
</body>
</html>`;
}
