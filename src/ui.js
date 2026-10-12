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

html.light {
  --bg:        #f4f6fb;
  --surface:   #ffffff;
  --surface2:  #edf0f7;
  --border:    #cdd3e8;
  --accent:    #3b7dd8;
  --accent-h:  #2563b8;
  --success:   #1a9956;
  --warn:      #c47d10;
  --danger:    #cc3929;
  --text:      #1c2235;
  --text-muted:#5a6480;
  --shadow:    0 4px 24px rgba(0,0,0,.10);
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
#app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }

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
#main-shell { display: flex; flex: 1; min-height: 0; }

#sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 0;
  min-height: 0; overflow-y: auto;
}
.sidebar-header, .sidebar-footer { flex-shrink: 0; }
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

#page { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; }

/* Members/Dues/Donations list pages: the table card fills whatever
   vertical space is left under the search bar exactly (via flexbox)
   instead of guessing a pixel offset like .tbl-wrap's max-height does. */
.card:has(> #members-table), .card:has(> #dues-table), .card:has(> #don-table), .card:has(> #inv-table), .card:has(> #prospects-results) {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
#members-table, #dues-table, #don-table, #inv-table, #prospects-results {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
#members-table .tbl-wrap, #dues-table .tbl-wrap, #don-table .tbl-wrap, #inv-table .tbl-wrap, #prospects-results .tbl-wrap {
  flex: 1; min-height: 0; max-height: none;
}

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
/* 100vh minus topbar (52px) + #page's own top/bottom padding (48px) + a
   buffer (~140px) for whatever sits above the table on a given page
   (search bar, stat cards, filters). Gets tables much closer to filling
   the remaining viewport than a flat vh guess did. */
.tbl-wrap { overflow: auto; max-height: calc(100vh - 240px); }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th {
  text-align: left; padding: 8px 12px; font-size: 11px;
  color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em;
  border-bottom: 1px solid var(--border); white-space: nowrap;
  position: sticky; top: 0; background: var(--surface); z-index: 1;
}
td { padding: 10px 12px; border-bottom: 1px solid rgba(42,48,80,.5); font-size: 13px; }
html.light td { border-bottom-color: var(--border); }
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
  .tbl-wrap { max-height: calc(100vh - 200px); }
  .modal { width: 96%; max-height: 94vh; margin: 0 auto; }
  .modal-body { padding: 16px; }
  .modal-footer { padding: 12px 16px; }
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .form-grid { grid-template-columns: 1fr; }
  .search-bar input { max-width: 100%; }
  #toast-container { bottom: 16px; right: 12px; left: 12px; }
  .toast { max-width: 100%; }
}
.charts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.chart-wrap { position: relative; height: 240px; }
@media (max-width: 700px) { .charts-grid { grid-template-columns: 1fr; } }

/* ── Member portal shell ─────────────────────────────────────────────── */
#portal-shell { display: flex; flex: 1; min-height: 0; }
#portal-sidebar {
  width: 220px; flex-shrink: 0;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 0;
  min-height: 0; overflow-y: auto;
}
#portal-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
#portal-topbar {
  height: 52px; background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 24px; gap: 12px; flex-shrink: 0;
}
#portal-topbar h2 { font-size: 16px; font-weight: 600; }
#portal-page { flex: 1; overflow-y: auto; padding: 24px; }
#portal-backdrop { display: none; position: fixed; inset: 0; z-index: 199; background: rgba(0,0,0,.5); }
#portal-backdrop.open { display: block; }

/* Toggle switch */
.toggle-wrap { display: flex; align-items: center; gap: 12px; margin: 4px 0; }
.toggle-label { font-size: 13px; }
.toggle { position: relative; width: 44px; height: 24px; display: inline-block; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: var(--border); border-radius: 12px; cursor: pointer; transition: background .2s; }
.toggle input:checked + .toggle-slider { background: var(--accent); }
.toggle-slider::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: transform .2s; }
.toggle input:checked + .toggle-slider::before { transform: translateX(20px); }

/* Dues status cards */
.dues-card { border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
.dues-card.paid   { background: rgba(46,204,113,.08); border: 1px solid rgba(46,204,113,.3); }
.dues-card.unpaid { background: rgba(243,156,18,.08);  border: 1px solid rgba(243,156,18,.3); }
.dues-card.unknown { background: var(--surface2); border: 1px solid var(--border); }
.dues-status-label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; margin-bottom: 6px; }
.dues-card.paid   .dues-status-label { color: var(--success); }
.dues-card.unpaid .dues-status-label { color: var(--warn); }
.dues-card.unknown .dues-status-label { color: var(--text-muted); }
.payment-box { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; font-size: 13px; line-height: 1.7; }
.payment-box h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); margin-bottom: 10px; }

@media (max-width: 640px) {
  #portal-sidebar {
    position: fixed; left: -240px; top: 0; bottom: 0; z-index: 200;
    transition: left .25s; width: 220px;
  }
  #portal-sidebar.open { left: 0; box-shadow: 4px 0 40px rgba(0,0,0,.7); }
  #portal-menu-toggle { display: block !important; }
  #portal-page { padding: 16px; }
  #portal-topbar { padding: 0 12px; }
}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>

<div id="app">
  <!-- Login screen -->
  <div id="login-screen">
    <div class="login-card">
      <div class="logo">
        <img src="/logo.png" alt="KARC" style="height:72px;margin-bottom:10px">
        <h1>Member System</h1>
        <p>Kingsport Amateur Radio Club</p>
      </div>
      <div class="form-group">
        <label>Email Address</label>
        <input type="email" id="login-email" placeholder="you@example.com" autocomplete="email">
      </div>
      <div class="form-group mt-8">
        <label>Password</label>
        <input type="password" id="login-pass" placeholder="••••••••••" autocomplete="current-password">
      </div>
      <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" onclick="doLogin()">Sign In</button>
      <div id="login-err" class="hidden mt-8" style="color:var(--danger);font-size:13px;text-align:center"></div>
      <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted)">
        <a href="#" onclick="showForgot();return false;" style="color:var(--text-muted)">Forgot password?</a>
      </p>
      <p style="text-align:center;margin-top:8px;font-size:13px;color:var(--text-muted)">
        New member? <a href="/register" style="color:var(--accent)">Register or claim your account →</a>
      </p>
    </div>
  </div>

  <!-- Forgot password screen -->
  <div id="forgot-screen" class="hidden" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg)">
    <div class="login-card">
      <div class="logo">
        <img src="/logo.png" alt="KARC" style="height:72px;margin-bottom:10px">
        <h1>Reset Password</h1>
        <p>Enter your email address to receive a reset link</p>
      </div>
      <div class="form-group">
        <label>Email Address</label>
        <input type="email" id="forgot-email" placeholder="you@example.com" autocomplete="email">
      </div>
      <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" onclick="doForgotPassword()">Send Reset Link</button>
      <div id="forgot-msg" class="hidden mt-8" style="font-size:13px;text-align:center"></div>
      <p style="text-align:center;margin-top:16px;font-size:13px;color:var(--text-muted)">
        <a href="#" onclick="showLogin();return false;" style="color:var(--text-muted)">← Back to sign in</a>
      </p>
    </div>
  </div>

  <!-- Reset password screen -->
  <div id="reset-screen" class="hidden" style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg)">
    <div class="login-card">
      <div class="logo">
        <img src="/logo.png" alt="KARC" style="height:72px;margin-bottom:10px">
        <h1>Set New Password</h1>
        <p>Choose a new password for your account</p>
      </div>
      <div class="form-group">
        <label>New Password (10+ characters)</label>
        <input type="password" id="reset-pass" placeholder="••••••••••" autocomplete="new-password">
      </div>
      <div class="form-group mt-8">
        <label>Confirm New Password</label>
        <input type="password" id="reset-confirm" placeholder="••••••••••" autocomplete="new-password">
      </div>
      <button class="btn btn-primary mt-16" style="width:100%;justify-content:center" onclick="doResetPassword()">Set Password</button>
      <div id="reset-msg" class="hidden mt-8" style="font-size:13px;text-align:center"></div>
    </div>
  </div>

  <!-- Main app shell (hidden until logged in) -->
  <div id="main-shell" class="hidden">
    <aside id="sidebar">
      <div class="sidebar-header">
        <img src="/logo.png" alt="KARC" style="height:40px;margin-bottom:6px;display:block">
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
        <a class="nav-item" onclick="nav('donations');closeNav()" data-page="donations">
          <span class="icon">🎁</span> Donations
        </a>
        <a class="nav-item hidden" id="nav-attendance" onclick="nav('attendance');closeNav()" data-page="attendance">
          <span class="icon">📝</span> Attendance
        </a>
        <a class="nav-item hidden" id="nav-inventory" onclick="nav('inventory');closeNav()" data-page="inventory">
          <span class="icon">📦</span> Inventory
        </a>
        <a class="nav-item hidden" id="nav-prospects" onclick="nav('prospects');closeNav()" data-page="prospects">
          <span class="icon">📡</span> Local Hams
        </a>
        <a class="nav-item hidden" id="nav-my-membership" onclick="closeNav();showPortal()">
          <span class="icon">🏠</span> My Membership
        </a>
        <div class="nav-section" id="nav-section-admin">Admin</div>
        <a class="nav-item" onclick="nav('users');closeNav()" data-page="users">
          <span class="icon">🔐</span> User Accounts
        </a>
        <a class="nav-item" onclick="nav('audit');closeNav()" data-page="audit">
          <span class="icon">📋</span> Audit Log
        </a>
        <a class="nav-item" onclick="nav('sessions');closeNav()" data-page="sessions">
          <span class="icon">🔑</span> Active Sessions
        </a>
        <a class="nav-item hidden" id="nav-cutoff" onclick="nav('cutoff');closeNav()" data-page="cutoff">
          <span class="icon">⚡</span> Membership Cutoff
        </a>
        <a class="nav-item hidden" id="nav-callsigns" onclick="nav('callsigns');closeNav()" data-page="callsigns">
          <span class="icon">📻</span> Callsign Report
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
        <button class="btn btn-sm btn-secondary theme-toggle-btn" onclick="toggleTheme()" style="width:100%;justify-content:center;margin-top:6px">☀ Light Mode</button>
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

  <!-- Member portal shell (members, and officers with a linked member record) -->
  <div id="portal-shell" class="hidden">
    <div id="portal-backdrop" onclick="closePortalNav()"></div>
    <aside id="portal-sidebar">
      <div class="sidebar-header">
        <img src="/logo.png" alt="KARC" style="height:40px;margin-bottom:6px;display:block">
        <div class="call">W4TRC</div>
        <div class="club-name">Member Portal</div>
      </div>
      <nav>
        <a class="nav-item active" onclick="pNav('portal-home');closePortalNav()" data-ppage="portal-home">
          <span class="icon">🏠</span> My Dashboard
        </a>
        <a class="nav-item" onclick="pNav('portal-profile');closePortalNav()" data-ppage="portal-profile">
          <span class="icon">👤</span> My Profile
        </a>
        <a class="nav-item" onclick="pNav('portal-history');closePortalNav()" data-ppage="portal-history">
          <span class="icon">📋</span> Membership History
        </a>
        <a class="nav-item" onclick="pNav('portal-donate');closePortalNav()" data-ppage="portal-donate">
          <span class="icon">🎁</span> Donate
        </a>
        <a class="nav-item" href="/directory" target="_blank">
          <span class="icon">📡</span> Public Directory ↗
        </a>
        <a class="nav-item hidden" id="portal-admin-link" onclick="closePortalNav();showAdmin()">
          <span class="icon">🔐</span> Admin Section
        </a>
      </nav>
      <div class="sidebar-footer">
        <div class="user-pill">
          <div class="avatar" id="portal-avatar">?</div>
          <div>
            <div id="portal-callsign" style="font-family:var(--mono);color:var(--accent);font-weight:bold;font-size:13px"></div>
            <div id="portal-name" style="font-size:11px;color:var(--text-muted)"></div>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-secondary" onclick="openChangePassword()" style="flex:1;justify-content:center">🔑 Password</button>
          <button class="btn btn-sm btn-secondary" onclick="doLogout()" style="flex:1;justify-content:center">⏏ Sign Out</button>
        </div>
        <button class="btn btn-sm btn-secondary theme-toggle-btn" onclick="toggleTheme()" style="width:100%;justify-content:center;margin-top:6px">☀ Light Mode</button>
      </div>
    </aside>
    <div id="portal-content">
      <div id="portal-topbar">
        <button id="portal-menu-toggle" onclick="togglePortalNav()" aria-label="Menu" style="display:none;background:none;border:none;color:var(--text);font-size:20px;cursor:pointer;padding:4px 8px">&#9776;</button>
        <h2 id="portal-page-title">My Dashboard</h2>
      </div>
      <div id="portal-page">
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

// ── Theme ─────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.classList.toggle('light', saved === 'light');
  updateThemeToggle();
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  updateThemeToggle();
}

function updateThemeToggle() {
  const isLight = document.documentElement.classList.contains('light');
  document.querySelectorAll('.theme-toggle-btn').forEach(el => {
    el.textContent = isLight ? '🌙 Dark Mode' : '☀ Light Mode';
  });
}

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
  sessionStorage.removeItem('view');
  document.getElementById('main-shell').classList.add('hidden');
  document.getElementById('portal-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showLogin() {
  document.getElementById('forgot-screen').classList.add('hidden');
  document.getElementById('reset-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showForgot() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('reset-screen').classList.add('hidden');
  document.getElementById('forgot-screen').classList.remove('hidden');
  document.getElementById('forgot-email').focus();
}

async function doForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  msg.classList.add('hidden');
  if (!email) { msg.textContent = 'Email required'; msg.style.color = 'var(--danger)'; msg.classList.remove('hidden'); return; }
  try {
    await api('POST', '/auth/forgot-password', { email });
    msg.textContent = 'If that email is on file, a reset link has been sent. Check your inbox.';
    msg.style.color = 'var(--success)';
    msg.classList.remove('hidden');
    document.getElementById('forgot-email').value = '';
  } catch (e) {
    msg.textContent = e.data?.error || 'Something went wrong';
    msg.style.color = 'var(--danger)';
    msg.classList.remove('hidden');
  }
}

async function doResetPassword() {
  const pass = document.getElementById('reset-pass').value;
  const confirm = document.getElementById('reset-confirm').value;
  const msg = document.getElementById('reset-msg');
  msg.classList.add('hidden');
  if (pass.length < 10) { msg.textContent = 'Password must be at least 10 characters'; msg.style.color = 'var(--danger)'; msg.classList.remove('hidden'); return; }
  if (pass !== confirm) { msg.textContent = 'Passwords do not match'; msg.style.color = 'var(--danger)'; msg.classList.remove('hidden'); return; }
  const token = new URLSearchParams(location.search).get('token');
  try {
    await api('POST', '/auth/reset-password', { token, password: pass });
    msg.textContent = 'Password updated! Redirecting to sign in…';
    msg.style.color = 'var(--success)';
    msg.classList.remove('hidden');
    setTimeout(() => { history.replaceState(null, '', '/'); showLogin(); }, 1800);
  } catch (e) {
    msg.textContent = e.data?.error || 'Something went wrong';
    msg.style.color = 'var(--danger)';
    msg.classList.remove('hidden');
  }
}

async function checkSession() {
  // Show reset screen if URL has a reset token
  if (new URLSearchParams(location.search).has('token') && location.pathname === '/reset-password') {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('reset-screen').classList.remove('hidden');
    return;
  }
  try {
    const data = await api('GET', '/auth/me');
    state.user = data.user;
    showApp();
  } catch {
    // Not logged in — show login screen (already showing)
  }
}

function showApp() {
  const u = state.user;
  const officer = ['board','admin'].includes(u.role);
  document.getElementById('portal-admin-link').classList.toggle('hidden', !officer);
  document.getElementById('nav-my-membership').classList.toggle('hidden', !u.memberId);

  // Officers with a member record land on the same portal as members, with a
  // button to the admin section. A reload keeps them in the admin section;
  // coming back from Stripe checkout always returns to the portal.
  const fromCheckout = new URLSearchParams(location.search).has('payment');
  const lastView = sessionStorage.getItem('view');
  if (!officer || (u.memberId && (fromCheckout || lastView !== 'admin'))) {
    showPortal();
    return;
  }
  showAdmin();
}

function showAdmin() {
  const u = state.user;
  sessionStorage.setItem('view', 'admin');
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('portal-shell').classList.add('hidden');
  document.getElementById('main-shell').classList.remove('hidden');
  // Set user info in sidebar
  document.getElementById('user-email').textContent = u.email;
  document.getElementById('user-role').textContent  = u.role;
  document.getElementById('user-avatar').textContent = u.email[0].toUpperCase();
  if (u.role === 'admin') document.getElementById('nav-cutoff')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-prospects')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-attendance')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-inventory')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-callsigns')?.classList.remove('hidden');
  if (u.role !== 'admin') {
    document.getElementById('nav-section-admin')?.classList.add('hidden');
    document.querySelectorAll('[data-page="users"],[data-page="audit"],[data-page="sessions"]').forEach(el => el.classList.add('hidden'));
  }
  nav('dashboard');
}

// ── Navigation ────────────────────────────────────────────────────────
function nav(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const titles = { dashboard: 'Dashboard', members: 'Members', memberships: 'Dues & Memberships', donations: 'Donations', attendance: 'Attendance', inventory: 'Inventory', prospects: 'Local Hams', users: 'User Accounts', audit: 'Audit Log', sessions: 'Active Sessions', cutoff: 'Membership Cutoff', callsigns: 'Callsign Report' };
  document.getElementById('page-title').textContent = titles[page] || page;
  document.getElementById('topbar-actions').innerHTML = '';

  const adminOnly = new Set(['users', 'audit', 'sessions', 'cutoff']);
  if (adminOnly.has(page) && state.user?.role !== 'admin') {
    setPage('<p class="text-muted" style="padding:24px">Access restricted to administrators.</p>');
    return;
  }

  const boardOnly = new Set(['prospects', 'callsigns', 'attendance', 'inventory']);
  if (boardOnly.has(page) && !['board','admin'].includes(state.user?.role)) {
    setPage('<p class="text-muted" style="padding:24px">Access restricted to board members and administrators.</p>');
    return;
  }

  const pages = { dashboard, members, memberships, donations, attendance, inventory, prospects, users, audit, sessions, cutoff, callsigns };
  (pages[page] || (() => setPage('<p>Coming soon</p>') ))();
}

function setPage(html) { document.getElementById('page').innerHTML = html; }

// ── DASHBOARD ─────────────────────────────────────────────────────────
async function dashboard() {
  setPage('<div class="spinner"></div>');
  try {
    const [stats, msStats, chartData] = await Promise.all([
      api('GET', '/admin/stats'),
      api('GET', '/memberships/stats?year=' + new Date().getFullYear()),
      api('GET', '/admin/charts'),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const expiring = stats.expiring_licenses || [];

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
        <div class="stat-card">
          <div class="stat-val">\${stats.members?.eastman_count ?? '—'}</div>
          <div class="stat-label">Eastman Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">\${stats.members?.eastman_count != null ? '$' + (stats.members.eastman_count * 3).toFixed(2) : '—'}</div>
          <div class="stat-label">\${yr} Eastman Revenue</div>
        </div>
      </div>
      <div class="charts-grid">
        <div class="card" style="margin-bottom:0">
          <div class="card-title">Memberships Per Year</div>
          <div class="chart-wrap"><canvas id="chart-trend"></canvas></div>
        </div>
        <div class="card" style="margin-bottom:0">
          <div class="card-title">License Class — Active Members</div>
          <div class="chart-wrap"><canvas id="chart-classes"></canvas></div>
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
      \${expiring.length > 0 ? \`
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Expiring FCC Licenses
          <span style="background:var(--danger);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">\${expiring.length}</span>
        </div>
        <p style="color:var(--text-muted);margin:0 0 12px">Active members whose license expired in the last 90 days or expires within the next year. FCC licenses renew online at wireless.fcc.gov.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Callsign</th><th>Name</th><th>Class</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            \${expiring.map(m => {
              const expired = m.license_expiry < today;
              const daysLeft = Math.ceil((new Date(m.license_expiry) - new Date(today)) / 86400000);
              const color = expired ? 'var(--danger)' : daysLeft <= 30 ? 'var(--warn)' : 'var(--text-muted)';
              const label = expired ? 'Expired' : \`\${daysLeft}d\`;
              return \`
              <tr>
                <td><strong>\${escHtml(m.callsign || '—')}</strong></td>
                <td>\${escHtml(m.first_name + ' ' + m.last_name)}</td>
                <td>\${licenseBadge(m.license_class)}</td>
                <td><span style="color:\${color};font-weight:600">\${escHtml(m.license_expiry)} (\${label})</span></td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewMember(\${m.id})">View</button></td>
              </tr>\`;
            }).join('')}
          </tbody>
        </table></div>
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
    renderDashboardCharts(chartData);
  } catch(e) { setPage('<p class="text-muted">Error loading dashboard: ' + escHtml(e.message) + '</p>'); }
}

function renderDashboardCharts(data) {
  if (typeof Chart === 'undefined') return;
  const isLight = document.documentElement.classList.contains('light');
  const gridColor = isLight ? '#cdd3e8' : '#2a3050';
  Chart.defaults.color = isLight ? '#5a6480' : '#8892aa';
  Chart.defaults.borderColor = gridColor;
  Chart.defaults.font = { family: "'Segoe UI', system-ui, sans-serif", size: 11 };

  const trendEl = document.getElementById('chart-trend');
  if (trendEl && data.trend?.length) {
    new Chart(trendEl, {
      type: 'bar',
      data: {
        labels: data.trend.map(r => r.year),
        datasets: [
          { label: 'Paid', data: data.trend.map(r => r.paid), backgroundColor: '#3b7dd8', stack: 's' },
          { label: 'Honorary / Waived', data: data.trend.map(r => r.exempt), backgroundColor: '#2ecc71', stack: 's' },
          { label: 'Eastman', data: data.trend.map(r => r.eastman || 0), backgroundColor: '#9b59b6', stack: 's' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } } },
        scales: {
          x: { grid: { color: gridColor } },
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { precision: 0 } },
        },
      },
    });
  }

  const classEl = document.getElementById('chart-classes');
  if (classEl && data.classes?.length) {
    const palette = { 'Amateur Extra': '#3b7dd8', 'General': '#2ecc71', 'Technician': '#f39c12', 'Advanced': '#e67e22', 'Novice': '#9b59b6', 'Unknown': '#8892aa' };
    const labels = data.classes.map(r => r.license_class);
    new Chart(classEl, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: data.classes.map(r => r.count), backgroundColor: labels.map(l => palette[l] || '#8892aa'), borderColor: isLight ? '#ffffff' : '#181c27', borderWidth: 2 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 12 } } },
      },
    });
  }
}

// ── MEMBERS ───────────────────────────────────────────────────────────
async function members() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-secondary btn-sm" onclick="exportMembersCSV()" style="margin-right:8px">⬇ Export CSV</button>' +
    '<a href="/print" target="_blank" class="btn btn-secondary btn-sm" style="margin-right:8px">⎙ Print Directory</a>' +
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
      <select id="eastman-filter" onchange="loadMembersTable()" style="width:150px">
        <option value="all">All Sponsors</option>
        <option value="eastman">Eastman Only</option>
        <option value="noneastman">Non-Eastman</option>
      </select>
      <select id="class-filter" onchange="loadMembersTable()" style="width:160px">
        <option value="all">All Classes</option>
        <option value="Amateur Extra">Amateur Extra</option>
        <option value="General">General</option>
        <option value="Technician">Technician</option>
        <option value="Advanced">Advanced</option>
        <option value="Novice">Novice</option>
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
  const search  = document.getElementById('member-search')?.value  || '';
  const status  = document.getElementById('status-filter')?.value  || 'all';
  const arrl    = document.getElementById('arrl-filter')?.value    || 'all';
  const eastman = document.getElementById('eastman-filter')?.value || 'all';
  const licClass = document.getElementById('class-filter')?.value  || 'all';
  const tbl = document.getElementById('members-table');
  if (!tbl) return;
  tbl.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api('GET', \`/members?q=\${encodeURIComponent(search)}&status=\${status}&arrl=\${arrl}&eastman=\${eastman}&class=\${encodeURIComponent(licClass)}&page=\${state.memberPage}\`);
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
              <td>\${m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : m.membership_type === 'lifetime_honorary' ? '<span class="badge badge-purple">Life Honorary</span>' : '<span class="badge badge-gray">Individual</span>'} \${m.is_arrl_member ? '<span class="badge badge-green">ARRL</span>' : ''} \${m.is_eastman_member ? '<span class="badge badge-blue">Eastman</span>' : ''}</td>
              <td>\${memberStatusBadge(m.is_active, m.is_silent_key)}</td>
              <td>\${duesBadge(m.current_year_status, m.current_year_paid, m.current_year_covered_by, m.current_year_payment_method)}</td>
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

async function exportMembersCSV() {
  const search  = document.getElementById('member-search')?.value  || '';
  const status  = document.getElementById('status-filter')?.value  || 'all';
  const arrl    = document.getElementById('arrl-filter')?.value    || 'all';
  const eastman = document.getElementById('eastman-filter')?.value || 'all';
  const licClass = document.getElementById('class-filter')?.value  || 'all';
  try {
    const params = new URLSearchParams({ q: search, status, arrl, eastman, class: licClass });
    const resp = await fetch('/api/members/export?' + params, { credentials: 'include' });
    if (!resp.ok) { toast('Export failed', 'error'); return; }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = \`w4trc-members-\${new Date().toISOString().slice(0,10)}.csv\`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast('Export failed: ' + e.message, 'error'); }
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
        <div class="tab" onclick="switchTab(this,'tab-donations')">Donations</div>
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
            \${dfield('Type', m.membership_type === 'lifetime_honorary' ? '<span class="badge badge-purple">Lifetime Honorary</span>' : m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : '<span class="badge badge-gray">Individual</span>')}
            \${dfield('Joined', m.joined_date)}
            \${dfield('ARRL Member', m.is_arrl_member ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>')}
            \${dfield('Eastman Member', m.is_eastman_member ? '<span class="badge badge-blue">Yes</span>' : '<span class="badge badge-gray">No</span>')}
            \${dfield(currentYear + ' Dues', curMs ? duesBadge(curMs.status, curMs.amount_paid, curMs.covered_by_member_id, curMs.payment_method) : '<span class="badge badge-yellow">No Record</span>')}
          </div>
        </div>
        \${m.emergency_name ? \`<div class="detail-section"><h4>Emergency Contact</h4><div class="detail-grid">\${dfield('Name', m.emergency_name)}\${dfield('Phone', m.emergency_phone)}</div></div>\` : ''}
        \${m.interests ? \`<div class="detail-section"><h4>Interests / Modes</h4><p style="font-size:13px">\${escHtml(m.interests)}</p></div>\` : ''}
        \${m.bio ? \`<div class="detail-section"><h4>Bio</h4><p style="font-size:13px">\${escHtml(m.bio)}</p></div>\` : ''}
      </div>

      <!-- Dues tab (hidden) -->
      <div id="tab-dues" class="hidden">
        <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openAddDues(\${m.id}, '\${escHtml(m.first_name)} \${escHtml(m.last_name)}', '\${m.membership_type}')">+ Record Payment</button>
        \${(m.memberships || []).length === 0 ? '<p class="text-muted">No membership records yet.</p>' :
          m.memberships.map(ms => \`
            <div class="card" style="margin-bottom:8px;padding:12px">
              <div class="flex align-center gap-8">
                <strong>\${ms.year}</strong>
                \${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id, ms.payment_method)}
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

      <!-- Donations tab (hidden) -->
      <div id="tab-donations" class="hidden">
        <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openAddDonation(\${m.id}, '\${escHtml(m.first_name)} \${escHtml(m.last_name)}')">+ Record Donation</button>
        \${(m.donations || []).length === 0 ? '<p class="text-muted">No donations recorded yet.</p>' :
          (m.donations || []).map(d => \`
            <div class="card" style="margin-bottom:8px;padding:12px">
              <div class="flex align-center gap-8">
                \${d.donation_kind === 'monetary'
                  ? \`<strong>$\${Number(d.amount||0).toFixed(2)}</strong><span class="badge badge-green">Monetary</span>\`
                  : \`<strong>\${escHtml(d.item_description||'Item')}</strong><span class="badge badge-blue">Item</span>\${d.estimated_value != null ? \`<span style="font-size:12px;color:var(--text-muted)">~$\${Number(d.estimated_value).toFixed(2)}</span>\` : ''}\`
                }
                <div class="spacer"></div>
                \${d.payment_method ? \`<span style="font-size:12px;color:var(--text-muted)">\${escHtml(d.payment_method)}\${d.check_number ? ' #'+escHtml(d.check_number) : ''}</span>\` : ''}
                \${d.donation_date ? \`<span style="font-size:12px;color:var(--text-muted)">\${escHtml(d.donation_date)}</span>\` : ''}
                <button class="btn btn-sm btn-secondary" onclick="openEditDonation(\${d.id}, \${m.id})">Edit</button>
              </div>
              \${d.notes ? \`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">\${escHtml(d.notes)}</div>\` : ''}
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
    loadMembersTable();
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
          <option value="lifetime_honorary">Lifetime Honorary (no dues)</option>
        </select>
      </div>
      \${fi('Joined Date','f-joined_date',new Date().toISOString().slice(0,10),'date')}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px">
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="f-is_arrl_member" style="width:auto">
        <span>ARRL Member</span>
      </label>
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="f-is_eastman_member" style="width:auto" onchange="onEastmanToggle()">
        <span>Eastman Member</span>
      </label>
    </div>
    <div id="f-eastman-note" style="display:none;margin-top:8px;font-size:12px;color:var(--accent)">
      Eastman members have $0 dues — a membership record will be created automatically.
    </div>
    <div class="card" style="margin-top:16px">
      <label style="display:flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="f-create_ms" onchange="toggleMsFields()" style="width:auto">
        <span>Create \${new Date().getFullYear()} membership record and mark paid</span>
      </label>
      <div id="f-ms-fields" style="margin-top:12px" hidden>
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
              <option value="stripe">Stripe (Online)</option>
              <option value="eastman">Eastman</option>
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
  const isEastman = document.getElementById('f-is_eastman_member')?.checked;
  if (isEastman) return; // Eastman always $0 — don't override
  const type = document.getElementById('f-membership_type')?.value;
  const amtEl = document.getElementById('f-amount_paid');
  const msFields = document.getElementById('f-ms-fields');
  const msCheck = document.getElementById('f-create_ms');
  if (type === 'lifetime_honorary') {
    if (msCheck) { msCheck.checked = false; msCheck.disabled = true; }
    if (msFields) msFields.hidden = true;
  } else {
    if (msCheck) { msCheck.disabled = false; }
    if (amtEl) amtEl.value = type === 'family' ? '30.00' : '20.00';
  }
}

function toggleMsFields() {
  const checked = document.getElementById('f-create_ms')?.checked;
  const fields = document.getElementById('f-ms-fields');
  if (fields) fields.hidden = !checked;
}

function onEastmanToggle() {
  const isEastman = document.getElementById('f-is_eastman_member')?.checked;
  const note    = document.getElementById('f-eastman-note');
  const createMs = document.getElementById('f-create_ms');
  const msCard  = createMs?.closest('.card');
  if (note) note.style.display = isEastman ? 'block' : 'none';
  if (msCard) msCard.style.display = isEastman ? 'none' : 'block';
  if (isEastman) {
    if (createMs) { createMs.checked = false; }
    const fields = document.getElementById('f-ms-fields');
    if (fields) fields.hidden = true;
  }
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
    is_active:          true,
    is_arrl_member:     document.getElementById('f-is_arrl_member')?.checked || false,
    is_eastman_member:  document.getElementById('f-is_eastman_member')?.checked || false,
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
          <option value="individual"        \${m.membership_type==='individual'?'selected':''}>Individual ($20/yr)</option>
          <option value="family"            \${m.membership_type==='family'?'selected':''}>Family ($30/yr)</option>
          <option value="lifetime_honorary" \${m.membership_type==='lifetime_honorary'?'selected':''}>Lifetime Honorary (no dues)</option>
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
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px">
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="e-is_arrl_member" style="width:auto" \${m.is_arrl_member ? 'checked' : ''}>
        <span>ARRL Member</span>
      </label>
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="e-is_eastman_member" style="width:auto" \${m.is_eastman_member ? 'checked' : ''}>
        <span>Eastman Member</span>
      </label>
    </div>
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
    is_active:          gv('e-member_status') === 'active',
    is_silent_key:      gv('e-member_status') === 'silent_key',
    is_arrl_member:     document.getElementById('e-is_arrl_member')?.checked || false,
    is_eastman_member:  document.getElementById('e-is_eastman_member')?.checked || false,
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
    loadMembersTable();
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
            <td>\${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id, ms.payment_method)}</td>
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

async function openAddDues(memberId, memberName, memberType) {
  const yr = new Date().getFullYear();
  const isLifetimeHonorary = memberType === 'lifetime_honorary';
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
          <option value="active" \${!isLifetimeHonorary?'selected':''}>Active</option>
          <option value="honorary" \${isLifetimeHonorary?'selected':''}>Honorary</option>
          <option value="waived">Waived</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      \${fi('Amount Due','d-amount_due',isLifetimeHonorary?'0.00':'20.00','number')}
      \${fi('Amount Paid','d-amount_paid','','number')}
      \${fi('Payment Date','d-paid_date','','date')}
      <div class="form-group">
        <label>Payment Method</label>
        <select id="d-payment_method">
          <option value="">— Select —</option>
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="paypal">PayPal</option>
          <option value="stripe">Stripe (Online)</option>
          <option value="eastman">Eastman</option>
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
    amount_due:           gv('d-amount_due') !== '' ? parseFloat(gv('d-amount_due')) : null,
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
    loadMembersTable();
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
          \${['cash','check','paypal','stripe','eastman','other'].map(m => \`<option value="\${m}" \${ms.payment_method===m?'selected':''}>\${m === 'stripe' ? 'Stripe (Online)' : m.charAt(0).toUpperCase()+m.slice(1)}</option>\`).join('')}
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
    amount_due:           gv('ed-amount_due') !== '' ? parseFloat(gv('ed-amount_due')) : null,
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

// ── DONATIONS page ────────────────────────────────────────────────────
async function donations() {
  setPage('<div class="spinner"></div>');
  const yr = new Date().getFullYear();

  setPage(\`
    <div class="flex gap-8 align-center" style="margin-bottom:16px">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="openAddDonation(null, null)">+ Record Donation</button>
    </div>
    <div id="don-stats" class="stat-grid" style="margin-bottom:16px"></div>
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <select id="don-filter-year" style="width:120px" onchange="loadDonationsTable()">
        <option value="">All Time</option>
        \${[yr, yr-1, yr-2, yr-3].map(y => \`<option value="\${y}" \${y===yr?'selected':''}>\${y}</option>\`).join('')}
      </select>
      <select id="don-filter-kind" style="width:140px" onchange="loadDonationsTable()">
        <option value="">All Types</option>
        <option value="monetary">Monetary</option>
        <option value="item">Item</option>
      </select>
      <span style="font-size:13px;color:var(--text-muted)" id="don-count"></span>
    </div>
    <div class="card" style="padding:0">
      <div id="don-table"><div class="spinner"></div></div>
    </div>
  \`);
  loadDonationsTable();
}

async function loadDonationsTable() {
  const year = document.getElementById('don-filter-year')?.value || '';
  const kind = document.getElementById('don-filter-kind')?.value || '';

  let qs = [];
  if (year) qs.push('year=' + year);
  if (kind) qs.push('kind=' + kind);
  const q = qs.length ? '?' + qs.join('&') : '';

  let donData, statsData;
  try {
    [donData, statsData] = await Promise.all([
      api('GET', '/donations' + q),
      api('GET', '/donations/stats' + (year ? '?year=' + year : '')),
    ]);
  } catch(e) {
    const el = document.getElementById('don-table');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Failed to load donations.</p>';
    toast(e.data?.error || e.message || 'Failed to load donations', 'error');
    return;
  }

  const st = statsData?.stats || {};
  const statsEl = document.getElementById('don-stats');
  if (statsEl) statsEl.innerHTML = \`
    <div class="stat-card"><div class="stat-val">\${st.total_count||0}</div><div class="stat-label">Total Donations</div></div>
    <div class="stat-card"><div class="stat-val">$\${Number(st.total_monetary||0).toFixed(2)}</div><div class="stat-label">Cash Collected</div></div>
    <div class="stat-card"><div class="stat-val">\${st.item_count||0}</div><div class="stat-label">Item Donations</div></div>
    <div class="stat-card"><div class="stat-val">\${st.member_donor_count||0}</div><div class="stat-label">Member Donors</div></div>
    <div class="stat-card"><div class="stat-val">\${st.org_donor_count||0}</div><div class="stat-label">Org Donors</div></div>
  \`;

  const list = donData.donations || [];
  const countEl = document.getElementById('don-count');
  if (countEl) countEl.textContent = list.length + ' record' + (list.length !== 1 ? 's' : '');

  document.getElementById('don-table').innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No donations recorded yet.</p>'
    : \`<div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Donor</th><th>Type</th><th>Kind</th><th>Amount / Item</th><th>Method</th><th>Check #</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          \${list.map(d => \`<tr>
            <td style="color:var(--text-muted)">\${escHtml(d.donation_date||'—')}</td>
            <td>\${donorLabel(d)}</td>
            <td>\${donorTypeBadge(d.donor_type)}</td>
            <td>\${donationKindBadge(d.donation_kind)}</td>
            <td>
              \${d.donation_kind === 'monetary'
                ? \`<strong>$\${Number(d.amount||0).toFixed(2)}</strong>\`
                : \`\${escHtml(d.item_description||'—')}\${d.estimated_value != null ? \` <span style="font-size:11px;color:var(--text-muted)">(~$\${Number(d.estimated_value).toFixed(2)})</span>\` : ''}\`
              }
            </td>
            <td>\${escHtml(d.payment_method||'—')}</td>
            <td>\${escHtml(d.check_number||'—')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">\${escHtml(d.notes||'')}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="openEditDonation(\${d.id}, null)">Edit</button></td>
          </tr>\`).join('')}
        </tbody>
      </table></div>\`;
}

function donorLabel(d) {
  if (d.donor_type === 'member') {
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || '—';
    return d.callsign
      ? \`<span class="callsign">\${escHtml(d.callsign)}</span> \${escHtml(name)}\`
      : escHtml(name);
  }
  if (d.donor_type === 'organization') return escHtml(d.organization_name || '—');
  return '<span class="text-muted">Anonymous</span>';
}

function donorTypeBadge(type) {
  if (type === 'member')       return '<span class="badge badge-green">Member</span>';
  if (type === 'organization') return '<span class="badge badge-blue">Organization</span>';
  return '<span class="badge badge-gray">Anonymous</span>';
}

function donationKindBadge(kind) {
  if (kind === 'monetary') return '<span class="badge badge-yellow">Monetary</span>';
  if (kind === 'item')     return '<span class="badge badge-purple">Item</span>';
  return '<span class="badge badge-gray">' + escHtml(kind||'—') + '</span>';
}

async function openAddDonation(memberId, memberName) {
  const today = new Date().toISOString().slice(0, 10);
  let memberOpts = '<option value="">— Select Member —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .map(x => \`<option value="\${x.id}" \${x.id===memberId?'selected':''}>\${x.callsign ? escHtml(x.callsign) + ' — ' : ''}\${escHtml(x.first_name)} \${escHtml(x.last_name)}</option>\`)
      .join('');
  } catch {}

  showModal(\`
    <div class="form-grid">
      <div class="form-group">
        <label>Donor Type</label>
        <select id="dn-donor_type" onchange="onDonorTypeChange()">
          <option value="member" \${memberId?'selected':''}>Member</option>
          <option value="organization" \${!memberId?'selected':''}>Organization</option>
          <option value="anonymous">Anonymous</option>
        </select>
      </div>
      <div class="form-group" id="dn-member-wrap" \${memberId?'':'hidden'}>
        <label>Member</label>
        <select id="dn-member_id">\${memberOpts}</select>
      </div>
      <div class="form-group" id="dn-org-wrap" hidden>
        <label>Organization Name</label>
        <input type="text" id="dn-organization_name" placeholder="e.g. ARRL Foundation">
      </div>
      <div class="form-group">
        <label>Donation Kind</label>
        <select id="dn-donation_kind" onchange="onDonationKindChange()">
          <option value="monetary">Monetary</option>
          <option value="item">Item</option>
        </select>
      </div>
      <div class="form-group" id="dn-amount-wrap">
        <label>Amount ($)</label>
        <input type="number" id="dn-amount" value="" step="0.01" min="0">
      </div>
      <div class="form-group" id="dn-item-wrap" hidden>
        <label>Item Description</label>
        <input type="text" id="dn-item_description" value="">
      </div>
      <div class="form-group" id="dn-estval-wrap" hidden>
        <label>Estimated Value ($)</label>
        <input type="number" id="dn-estimated_value" value="" step="0.01" min="0">
      </div>
      \${fi('Donation Date','dn-donation_date',today,'date')}
      <div class="form-group" id="dn-method-wrap">
        <label>Payment Method</label>
        <select id="dn-payment_method">
          <option value="">— Select —</option>
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="paypal">PayPal</option>
          <option value="stripe">Stripe (Online)</option>
          <option value="other">Other</option>
        </select>
      </div>
      \${fi('Check Number','dn-check_number','')}
    </div>
    \${fi('Notes','dn-notes','','textarea')}
  \`, 'Record Donation', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save', cls: 'btn-primary', fn: 'saveDonation(' + (memberId || 'null') + ')' },
  ]);
  onDonorTypeChange();
}

function onDonorTypeChange() {
  const type = document.getElementById('dn-donor_type')?.value;
  const memberWrap = document.getElementById('dn-member-wrap');
  const orgWrap    = document.getElementById('dn-org-wrap');
  const methodWrap = document.getElementById('dn-method-wrap');
  if (memberWrap) memberWrap.hidden = type !== 'member';
  if (orgWrap)    orgWrap.hidden    = type !== 'organization';
  if (methodWrap) methodWrap.hidden = document.getElementById('dn-donation_kind')?.value !== 'monetary';
}

function onDonationKindChange() {
  const kind = document.getElementById('dn-donation_kind')?.value;
  const amtWrap  = document.getElementById('dn-amount-wrap');
  const itemWrap = document.getElementById('dn-item-wrap');
  const estWrap  = document.getElementById('dn-estval-wrap');
  const methodWrap = document.getElementById('dn-method-wrap');
  if (amtWrap)   amtWrap.hidden   = kind !== 'monetary';
  if (itemWrap)  itemWrap.hidden  = kind !== 'item';
  if (estWrap)   estWrap.hidden   = kind !== 'item';
  if (methodWrap) methodWrap.hidden = kind !== 'monetary';
}

async function saveDonation(memberId) {
  const donorType    = gv('dn-donor_type');
  const donationKind = gv('dn-donation_kind');
  const body = {
    donor_type:        donorType,
    member_id:         donorType === 'member'       ? (parseInt(gv('dn-member_id')) || null) : null,
    organization_name: donorType === 'organization' ? (gv('dn-organization_name') || null) : null,
    donation_kind:     donationKind,
    amount:            donationKind === 'monetary'  ? (parseFloat(gv('dn-amount')) || null) : null,
    item_description:  donationKind === 'item'      ? (gv('dn-item_description') || null) : null,
    estimated_value:   donationKind === 'item' && gv('dn-estimated_value') ? (parseFloat(gv('dn-estimated_value')) || null) : null,
    donation_date:     gv('dn-donation_date') || null,
    payment_method:    donationKind === 'monetary'  ? (gv('dn-payment_method') || null) : null,
    check_number:      gv('dn-check_number') || null,
    notes:             gv('dn-notes') || null,
  };
  try {
    await api('POST', '/donations', body);
    toast('Donation recorded ✓');
    closeModal();
    if (memberId) viewMember(memberId);
    else loadDonationsTable();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function openEditDonation(id, memberId) {
  const d = await api('GET', '/donations/' + id).catch(() => null);
  if (!d) return;

  let memberOpts = '<option value="">— Select Member —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .map(x => \`<option value="\${x.id}" \${d.member_id===x.id?'selected':''}>\${x.callsign ? escHtml(x.callsign) + ' — ' : ''}\${escHtml(x.first_name)} \${escHtml(x.last_name)}</option>\`)
      .join('');
  } catch {}

  showModal(\`
    <div class="form-grid">
      <div class="form-group">
        <label>Donor Type</label>
        <select id="edn-donor_type" onchange="onEditDonorTypeChange()">
          \${['member','organization','anonymous'].map(t => \`<option value="\${t}" \${d.donor_type===t?'selected':''}>\${t.charAt(0).toUpperCase()+t.slice(1)}</option>\`).join('')}
        </select>
      </div>
      <div class="form-group" id="edn-member-wrap" \${d.donor_type==='member'?'':'hidden'}>
        <label>Member</label>
        <select id="edn-member_id">\${memberOpts}</select>
      </div>
      <div class="form-group" id="edn-org-wrap" \${d.donor_type==='organization'?'':'hidden'}>
        <label>Organization Name</label>
        <input type="text" id="edn-organization_name" value="\${escHtml(d.organization_name||'')}">
      </div>
      <div class="form-group">
        <label>Donation Kind</label>
        <select id="edn-donation_kind" onchange="onEditDonationKindChange()">
          <option value="monetary" \${d.donation_kind==='monetary'?'selected':''}>Monetary</option>
          <option value="item"     \${d.donation_kind==='item'?'selected':''}>Item</option>
        </select>
      </div>
      <div class="form-group" id="edn-amount-wrap" \${d.donation_kind==='monetary'?'':'hidden'}>
        <label>Amount ($)</label>
        <input type="number" id="edn-amount" value="\${escHtml(String(d.amount??''))}" step="0.01" min="0">
      </div>
      <div class="form-group" id="edn-item-wrap" \${d.donation_kind==='item'?'':'hidden'}>
        <label>Item Description</label>
        <input type="text" id="edn-item_description" value="\${escHtml(d.item_description||'')}">
      </div>
      <div class="form-group" id="edn-estval-wrap" \${d.donation_kind==='item'?'':'hidden'}>
        <label>Estimated Value ($)</label>
        <input type="number" id="edn-estimated_value" value="\${escHtml(String(d.estimated_value??''))}" step="0.01" min="0">
      </div>
      \${fi('Donation Date','edn-donation_date',d.donation_date||'','date')}
      <div class="form-group" id="edn-method-wrap" \${d.donation_kind==='monetary'?'':'hidden'}>
        <label>Payment Method</label>
        <select id="edn-payment_method">
          <option value="">— Select —</option>
          \${['cash','check','paypal','stripe','other'].map(m => \`<option value="\${m}" \${d.payment_method===m?'selected':''}>\${m==='stripe'?'Stripe (Online)':m.charAt(0).toUpperCase()+m.slice(1)}</option>\`).join('')}
        </select>
      </div>
      \${fi('Check Number','edn-check_number',d.check_number||'')}
    </div>
    \${fi('Notes','edn-notes',d.notes||'','textarea')}
  \`, 'Edit Donation', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Delete', cls: 'btn-danger',    fn: 'deleteDonation(' + id + ',' + (memberId||'null') + ')' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'updateDonation(' + id + ',' + (memberId||'null') + ')' },
  ]);
}

function onEditDonorTypeChange() {
  const type = document.getElementById('edn-donor_type')?.value;
  const mw = document.getElementById('edn-member-wrap');
  const ow = document.getElementById('edn-org-wrap');
  if (mw) mw.hidden = type !== 'member';
  if (ow) ow.hidden = type !== 'organization';
}

function onEditDonationKindChange() {
  const kind = document.getElementById('edn-donation_kind')?.value;
  const aw = document.getElementById('edn-amount-wrap');
  const iw = document.getElementById('edn-item-wrap');
  const ev = document.getElementById('edn-estval-wrap');
  const mw = document.getElementById('edn-method-wrap');
  if (aw) aw.hidden = kind !== 'monetary';
  if (iw) iw.hidden = kind !== 'item';
  if (ev) ev.hidden = kind !== 'item';
  if (mw) mw.hidden = kind !== 'monetary';
}

async function updateDonation(id, memberId) {
  const donorType    = gv('edn-donor_type');
  const donationKind = gv('edn-donation_kind');
  const body = {
    donor_type:        donorType,
    member_id:         donorType === 'member'       ? (parseInt(gv('edn-member_id')) || null) : null,
    organization_name: donorType === 'organization' ? (gv('edn-organization_name') || null) : null,
    donation_kind:     donationKind,
    amount:            donationKind === 'monetary'  ? (parseFloat(gv('edn-amount')) || null) : null,
    item_description:  donationKind === 'item'      ? (gv('edn-item_description') || null) : null,
    estimated_value:   donationKind === 'item' && gv('edn-estimated_value') ? (parseFloat(gv('edn-estimated_value')) || null) : null,
    donation_date:     gv('edn-donation_date') || null,
    payment_method:    donationKind === 'monetary'  ? (gv('edn-payment_method') || null) : null,
    check_number:      gv('edn-check_number') || null,
    notes:             gv('edn-notes') || null,
  };
  try {
    await api('PUT', '/donations/' + id, body);
    toast('Updated ✓');
    closeModal();
    if (memberId) viewMember(memberId);
    else loadDonationsTable();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function deleteDonation(id, memberId) {
  if (!confirm('Delete this donation record? This cannot be undone.')) return;
  try {
    await api('DELETE', '/donations/' + id);
    toast('Donation deleted');
    closeModal();
    if (memberId) viewMember(memberId);
    else loadDonationsTable();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── ATTENDANCE ────────────────────────────────────────────────────────
const MEETING_TYPES = {
  monthly:    'Monthly Meeting',
  board:      'Board Meeting',
  ve_session: 'VE Session',
  field_day:  'Field Day',
  special:    'Special Event',
  other:      'Other',
};

// Date-only values (YYYY-MM-DD) — format without timezone shifting
function fmtDay(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return ymd || '—';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function meetingLabel(mt) {
  const type = MEETING_TYPES[mt.meeting_type] || mt.meeting_type;
  return mt.title ? escHtml(mt.title) + ' <span style="color:var(--text-muted);font-size:12px">' + escHtml(type) + '</span>' : escHtml(type);
}

async function attendance() {
  const yr = new Date().getFullYear();
  setPage(\`
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <select id="att-filter-year" style="width:120px" onchange="loadMeetingsTable()">
        <option value="">All Time</option>
        \${[yr, yr-1, yr-2, yr-3].map(y => \`<option value="\${y}" \${y===yr?'selected':''}>\${y}</option>\`).join('')}
      </select>
      <span style="font-size:13px;color:var(--text-muted)" id="att-count"></span>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="openMeetingForm()">+ Record Meeting</button>
    </div>
    <div class="card" style="padding:0">
      <div id="att-table"><div class="spinner"></div></div>
    </div>
  \`);
  loadMeetingsTable();
}

async function loadMeetingsTable() {
  const year = document.getElementById('att-filter-year')?.value || '';
  let data;
  try {
    data = await api('GET', '/meetings' + (year ? '?year=' + year : ''));
  } catch(e) {
    const el = document.getElementById('att-table');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Failed to load meetings.</p>';
    toast(e.data?.error || e.message || 'Failed to load meetings', 'error');
    return;
  }

  const list = data.meetings || [];
  const countEl = document.getElementById('att-count');
  if (countEl) countEl.textContent = list.length + ' meeting' + (list.length !== 1 ? 's' : '');

  const el = document.getElementById('att-table');
  if (!el) return;
  el.innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No meetings recorded yet.</p>'
    : \`<div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Meeting</th><th>Members</th><th>Visiting Hams</th><th>Non-Hams</th><th>Total</th><th></th></tr></thead>
        <tbody>
          \${list.map(mt => \`<tr style="cursor:pointer" onclick="openMeeting(\${mt.id})">
            <td style="color:var(--text-muted)">\${escHtml(fmtDay(mt.meeting_date))}</td>
            <td>\${meetingLabel(mt)}</td>
            <td>\${mt.member_count || 0}</td>
            <td>\${mt.visitor_count || 0}</td>
            <td>\${mt.guest_count || 0}</td>
            <td><strong>\${mt.total_count || 0}</strong></td>
            <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openMeeting(\${mt.id})">View</button></td>
          </tr>\`).join('')}
        </tbody>
      </table></div>\`;
}

function attendeeRow(a) {
  const call = a.callsign ? \`<span class="callsign">\${escHtml(a.callsign)}</span> \` : '';
  return \`<div style="padding:6px 0;border-bottom:1px solid var(--border)">\${call}\${escHtml(a.name || '')}\${!a.name && a.callsign ? '<span class="text-muted">(name unknown)</span>' : ''}</div>\`;
}

async function openMeeting(id) {
  let data;
  try { data = await api('GET', '/meetings/' + id); }
  catch(e) { toast(e.data?.error || 'Failed to load meeting', 'error'); return; }

  const mt = data.meeting;
  const att = data.attendees || [];
  const members  = att.filter(a => a.member_id);
  const visitors = att.filter(a => !a.member_id && a.callsign);
  const guests   = att.filter(a => !a.callsign);
  const section = (label, rows) => rows.length ? \`
    <div style="margin-top:16px">
      <div style="font-weight:600;margin-bottom:4px">\${label} <span class="badge badge-gray">\${rows.length}</span></div>
      \${rows.map(attendeeRow).join('')}
    </div>\` : '';

  const buttons = [
    { label: 'Close', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Edit',  cls: 'btn-primary',   fn: 'editMeeting(' + id + ')' },
  ];
  if (state.user?.role === 'admin') buttons.unshift({ label: 'Delete', cls: 'btn-danger', fn: 'deleteMeeting(' + id + ')' });

  showModal(\`
    <div style="color:var(--text-muted)">\${escHtml(fmtDay(mt.meeting_date))} — \${meetingLabel(mt)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px">\${att.length} attendee\${att.length !== 1 ? 's' : ''}</div>
    \${mt.notes ? \`<p style="margin-top:8px;color:var(--text-muted)">\${escHtml(mt.notes)}</p>\` : ''}
    \${section('Members', members)}
    \${section('Visiting Hams', visitors)}
    \${section('Non-Hams', guests)}
    \${att.length === 0 ? '<p class="text-muted" style="margin-top:16px">No attendees recorded.</p>' : ''}
  \`, 'Meeting Attendance', buttons);
}

async function editMeeting(id) {
  try {
    const data = await api('GET', '/meetings/' + id);
    openMeetingForm(data.meeting, data.attendees || []);
  } catch(e) { toast(e.data?.error || 'Failed to load meeting', 'error'); }
}

function openMeetingForm(mt = null, attendees = []) {
  const today = new Date().toISOString().slice(0, 10);
  const calls  = attendees.filter(a => a.callsign).map(a => a.callsign).join('\\n');
  const guests = attendees.filter(a => !a.callsign).map(a => a.name).join('\\n');
  const type   = mt?.meeting_type || 'monthly';

  showModal(\`
    <div class="form-grid">
      <div class="form-group">
        <label>Meeting *</label>
        <select id="mt-type">
          \${Object.entries(MEETING_TYPES).map(([k, v]) => \`<option value="\${k}" \${k===type?'selected':''}>\${v}</option>\`).join('')}
        </select>
      </div>
      \${fi('Date', 'mt-date', mt?.meeting_date || today, 'date', '', true)}
      <div class="form-group full">
        <label>Title (optional)</label>
        <input type="text" id="mt-title" value="\${escHtml(mt?.title || '')}" placeholder="e.g. Christmas Party, Antenna Workshop">
      </div>
      <div class="form-group full">
        <label>Callsigns</label>
        <textarea id="mt-callsigns" rows="5" placeholder="Type or paste callsigns, separated by spaces, commas, or new lines" oninput="queueCallsignPreview()" style="font-family:var(--mono);text-transform:uppercase">\${escHtml(calls)}</textarea>
        <div id="mt-preview" style="margin-top:8px;font-size:13px"></div>
      </div>
      <div class="form-group full">
        <label>Non-Ham Attendees</label>
        <textarea id="mt-guests" rows="3" placeholder="One name per line">\${escHtml(guests)}</textarea>
      </div>
    </div>
    \${fi('Notes', 'mt-notes', mt?.notes || '', 'textarea')}
  \`, mt ? 'Edit Meeting' : 'Record Meeting', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveMeeting(' + (mt?.id || 'null') + ')' },
  ]);
  if (calls) previewCallsigns();
}

let callsignPreviewTimer = null;
function queueCallsignPreview() {
  clearTimeout(callsignPreviewTimer);
  callsignPreviewTimer = setTimeout(previewCallsigns, 600);
}

const ATTENDEE_SOURCE_BADGE = {
  member:    '<span class="badge badge-green">Member</span>',
  local_ham: '<span class="badge badge-blue">Local Ham</span>',
  hamdb:     '<span class="badge badge-gray">Visitor</span>',
  not_found: '<span class="badge badge-red">Not found</span>',
};

async function previewCallsigns() {
  const el = document.getElementById('mt-preview');
  const input = document.getElementById('mt-callsigns')?.value || '';
  if (!el) return;
  if (!input.trim()) { el.innerHTML = ''; return; }
  el.innerHTML = '<span class="text-muted">Looking up callsigns…</span>';
  try {
    const data = await api('POST', '/meetings/resolve', { callsigns: input });
    // Ignore stale responses if the user kept typing
    if ((document.getElementById('mt-callsigns')?.value || '') !== input) return;
    const list = data.attendees || [];
    const unknown = list.filter(a => a.source === 'not_found').length;
    el.innerHTML = list.length === 0 ? '<span class="text-muted">No valid callsigns yet.</span>' : \`
      <div style="color:var(--text-muted);margin-bottom:4px">
        \${list.length} ham\${list.length !== 1 ? 's' : ''}\${unknown ? \` — <span style="color:var(--danger)">\${unknown} not found, check spelling</span>\` : ''}
      </div>
      \${list.map(a => \`<div style="padding:3px 0"><span class="callsign">\${escHtml(a.callsign)}</span> \${escHtml(a.name || '')} \${ATTENDEE_SOURCE_BADGE[a.source] || ''}</div>\`).join('')}
    \`;
  } catch(e) {
    el.innerHTML = '<span style="color:var(--danger)">Lookup failed — callsigns will still be saved.</span>';
  }
}

async function saveMeeting(id) {
  const body = {
    meeting_type: gv('mt-type'),
    meeting_date: gv('mt-date'),
    title:        gv('mt-title'),
    callsigns:    gv('mt-callsigns'),
    guests:       gv('mt-guests'),
    notes:        gv('mt-notes'),
  };
  if (!body.meeting_date) { toast('Date is required', 'error'); return; }
  try {
    const data = await api(id ? 'PUT' : 'POST', '/meetings' + (id ? '/' + id : ''), body);
    const n = (data.attendees || []).length;
    toast(\`Meeting saved — \${n} attendee\${n !== 1 ? 's' : ''} ✓\`);
    closeModal();
    if (state.currentPage === 'attendance') loadMeetingsTable();
  } catch(e) { toast(e.data?.error || 'Failed to save meeting', 'error'); }
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting and its attendance list? This cannot be undone.')) return;
  try {
    await api('DELETE', '/meetings/' + id);
    toast('Meeting deleted');
    closeModal();
    if (state.currentPage === 'attendance') loadMeetingsTable();
  } catch(e) { toast(e.data?.error || 'Failed to delete meeting', 'error'); }
}

// ── INVENTORY ─────────────────────────────────────────────────────────
let invMeta = { locations: [], members: [] };
let invSearchTimer = null;

async function loadInvMeta() {
  invMeta = await api('GET', '/inventory/meta');
  return invMeta;
}

async function inventory() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-secondary btn-sm" onclick="addInvLocation()" style="margin-right:8px">+ Location</button>' +
    '<button class="btn btn-primary" onclick="openInvForm()">+ Add Item</button>';

  try { await loadInvMeta(); }
  catch(e) { toast(e.data?.error || 'Failed to load locations', 'error'); }

  setPage(\`
    <div class="search-bar">
      <input type="text" id="inv-search" placeholder="Search name, manufacturer, model, serial, member…"
        oninput="clearTimeout(invSearchTimer); invSearchTimer = setTimeout(loadInvTable, 250)">
      <select id="inv-filter-location" onchange="loadInvTable()" style="width:190px">
        <option value="">All Locations</option>
        \${invMeta.locations.map(l => \`<option value="\${l.id}">\${escHtml(l.name)}</option>\`).join('')}
        <option value="out">Checked Out</option>
      </select>
      <span style="font-size:13px;color:var(--text-muted)" id="inv-count"></span>
    </div>
    <div class="card" style="padding:0">
      <div id="inv-table"><div class="spinner"></div></div>
    </div>
  \`);
  loadInvTable();
}

function invPhotoUrl(it, thumb) {
  return '/api/inventory/' + it.id + '/photo?' + (thumb ? 'size=thumb&' : '') + 'v=' + encodeURIComponent(it.photo_updated_at || '');
}

function invMemberLabel(callsign, name) {
  if (!callsign && !name) return '<span class="text-muted">a former member</span>';
  return (callsign ? \`<span class="callsign">\${escHtml(callsign)}</span> \` : '') + escHtml(name || '');
}

function invWhere(it) {
  if (it.assigned_member_id) return '<span class="badge badge-yellow">Checked out</span> ' + invMemberLabel(it.member_callsign, it.member_name);
  if (it.location_name) return escHtml(it.location_name);
  return '<span class="text-muted">Unknown</span>';
}

async function loadInvTable() {
  const el = document.getElementById('inv-table');
  if (!el) return;
  const q   = document.getElementById('inv-search')?.value || '';
  const loc = document.getElementById('inv-filter-location')?.value || '';
  let data;
  try {
    data = await api('GET', '/inventory?q=' + encodeURIComponent(q) + '&location=' + encodeURIComponent(loc));
  } catch(e) {
    el.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Failed to load inventory.</p>';
    toast(e.data?.error || e.message || 'Failed to load inventory', 'error');
    return;
  }
  // Ignore stale responses if the search or filter changed while loading
  if ((document.getElementById('inv-search')?.value || '') !== q) return;
  if ((document.getElementById('inv-filter-location')?.value || '') !== loc) return;

  const list = data.items || [];
  const countEl = document.getElementById('inv-count');
  if (countEl) countEl.textContent = list.length + ' item' + (list.length !== 1 ? 's' : '');

  el.innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">' + (q || loc ? 'No items match.' : 'No items in the inventory yet.') + '</p>'
    : \`<div class="tbl-wrap"><table>
        <thead><tr><th></th><th>Item</th><th>Manufacturer</th><th>Model</th><th>Serial #</th><th>Location</th><th>Since</th><th></th></tr></thead>
        <tbody>
          \${list.map(it => \`<tr style="cursor:pointer" onclick="openInvItem(\${it.id})">
            <td style="width:56px">\${it.photo_updated_at
              ? \`<img src="\${invPhotoUrl(it, true)}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block">\`
              : '<div style="width:44px;height:44px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></div>'}</td>
            <td><strong>\${escHtml(it.name)}</strong></td>
            <td>\${escHtml(it.manufacturer || '—')}</td>
            <td>\${escHtml(it.model || '—')}</td>
            <td style="font-family:var(--mono)">\${escHtml(it.serial_number || '—')}</td>
            <td>\${invWhere(it)}</td>
            <td style="color:var(--text-muted);white-space:nowrap">\${it.location_since ? escHtml(fmtDay(it.location_since)) : '—'}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openInvItem(\${it.id})">View</button></td>
          </tr>\`).join('')}
        </tbody>
      </table></div>\`;
}

function invEventText(e) {
  const place = (locName, memberId, callsign, memberName) =>
    memberId ? invMemberLabel(callsign, memberName) : locName ? escHtml(locName) : '';
  const from = place(e.from_location, e.from_member_id, e.from_callsign, e.from_member);
  const to   = place(e.to_location,   e.to_member_id,   e.to_callsign,   e.to_member);
  switch (e.event_type) {
    case 'added':       return 'Added to inventory' + (to ? (e.to_member_id ? ' — checked out to ' : ' — at ') + to : '');
    case 'checked_out': return 'Checked out to ' + (to || invMemberLabel()) + (from ? ' from ' + from : '');
    case 'moved':       return (e.from_member_id ? 'Returned' : 'Moved') + (from ? ' from ' + from : '') + ' to ' + (to || 'an unknown location');
    default:            return 'Note';
  }
}

async function openInvItem(id) {
  let data;
  try { data = await api('GET', '/inventory/' + id); }
  catch(e) { toast(e.data?.error || 'Failed to load item', 'error'); return; }

  const it = data.item;
  const events = data.events || [];
  const today = new Date().toISOString().slice(0, 10);

  const buttons = [
    { label: 'Close', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Edit',  cls: 'btn-secondary', fn: 'editInvItem(' + id + ')' },
    { label: it.assigned_member_id ? 'Return / Move' : 'Move / Check Out', cls: 'btn-primary', fn: 'openInvMove(' + id + ')' },
  ];
  if (state.user?.role === 'admin') buttons.unshift({ label: 'Delete', cls: 'btn-danger', fn: 'deleteInvItem(' + id + ')' });

  showModal(\`
    <div class="flex gap-16" style="flex-wrap:wrap;margin-bottom:20px">
      \${it.photo_updated_at ? \`
        <a href="\${invPhotoUrl(it)}" target="_blank" title="Open full size">
          <img src="\${invPhotoUrl(it)}" alt="\${escHtml(it.name)}" style="width:220px;max-width:100%;max-height:220px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--border);display:block">
        </a>\` : ''}
      <div style="flex:1;min-width:220px">
        <div style="font-size:20px;font-weight:700;margin-bottom:12px">\${escHtml(it.name)}\${it.is_donated ? ' <span class="badge badge-green">Donated</span>' : ''}</div>
        <div class="detail-grid">
          \${dfield('Manufacturer', escHtml(it.manufacturer))}
          \${dfield('Model', escHtml(it.model))}
          \${dfield('Serial Number', it.serial_number ? '<span style="font-family:var(--mono)">' + escHtml(it.serial_number) + '</span>' : '')}
          \${dfield('Location', invWhere(it))}
          \${dfield('There Since', it.location_since ? escHtml(fmtDay(it.location_since)) : '')}
          \${dfield(it.is_donated ? 'Date Donated' : 'Purchase Date', it.purchase_date ? escHtml(fmtDay(it.purchase_date)) : '')}
          \${dfield(it.is_donated ? 'Estimated Value' : 'Price', it.purchase_price != null ? '$' + Number(it.purchase_price).toFixed(2) : '')}
          \${dfield(it.is_donated ? 'Donated By' : 'Purchased From', escHtml(it.purchased_from))}
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h4>History &amp; Notes</h4>
      <div class="form-group" style="margin-bottom:8px">
        <textarea id="inv-new-note" placeholder="Add a note about this item…"></textarea>
      </div>
      <div class="flex gap-8 align-center">
        <input type="date" id="inv-new-note-date" value="\${today}" style="width:160px">
        <button class="btn btn-sm btn-primary" onclick="addInvNote(\${id})">Add Note</button>
      </div>
      <div class="divider"></div>
      \${events.length === 0 ? '<p class="text-muted">No history yet.</p>' : events.map(e => \`
        <div class="note-item">
          <div class="note-meta">\${escHtml(fmtDay(e.event_date))}\${e.user_email ? ' · ' + escHtml(e.user_email) : ''}</div>
          \${e.event_type !== 'note' ? \`<div style="font-size:13px;font-weight:600">\${invEventText(e)}</div>\` : ''}
          \${e.note ? \`<div class="note-text"\${e.event_type !== 'note' ? ' style="margin-top:4px;color:var(--text-muted)"' : ''}>\${escHtml(e.note)}</div>\` : ''}
        </div>
      \`).join('')}
    </div>
  \`, 'Inventory Item', buttons);
}

// Location / member picker shared by the add and move forms
function invDestFields(current) {
  return \`
    <div class="form-group">
      <label>\${current ? 'Move To' : 'Location'} *</label>
      <select id="inv-dest" onchange="onInvDestChange()">
        \${invMeta.locations.map(l => \`<option value="\${l.id}" \${current?.location_id === l.id ? 'disabled' : ''}>\${escHtml(l.name)}\${current?.location_id === l.id ? ' (current)' : ''}</option>\`).join('')}
        <option value="member">Checked out to a member…</option>
      </select>
    </div>
    <div class="form-group hidden" id="inv-member-wrap">
      <label>Member *</label>
      <select id="inv-member">
        <option value="">— Select Member —</option>
        \${invMeta.members.map(m => \`<option value="\${m.id}">\${m.callsign ? escHtml(m.callsign) + ' — ' : ''}\${escHtml(m.first_name)} \${escHtml(m.last_name)}</option>\`).join('')}
      </select>
    </div>
  \`;
}

function onInvDestChange() {
  const wrap = document.getElementById('inv-member-wrap');
  if (wrap) wrap.classList.toggle('hidden', gv('inv-dest') !== 'member');
}

// Returns { location_id } or { member_id }, or null (after a toast) if incomplete
function invDestValue() {
  const dest = gv('inv-dest');
  if (dest !== 'member') {
    if (!dest) { toast('Choose a location', 'error'); return null; }
    return { location_id: Number(dest) };
  }
  const memberId = gv('inv-member');
  if (!memberId) { toast('Choose the member it is checked out to', 'error'); return null; }
  return { member_id: Number(memberId) };
}

async function editInvItem(id) {
  try {
    const data = await api('GET', '/inventory/' + id);
    openInvForm(data.item);
  } catch(e) { toast(e.data?.error || 'Failed to load item', 'error'); }
}

async function openInvForm(it = null) {
  if (!it && !invMeta.locations.length) {
    try { await loadInvMeta(); } catch(e) { toast(e.data?.error || 'Failed to load locations', 'error'); return; }
  }
  const today = new Date().toISOString().slice(0, 10);

  showModal(\`
    <div class="form-grid">
      <div class="form-group full">
        <label>Item Name *</label>
        <input type="text" id="inv-name" value="\${escHtml(it?.name || '')}" placeholder="e.g. HF Transceiver, 2m Repeater, Antenna Analyzer">
      </div>
      \${fi('Manufacturer', 'inv-manufacturer', it?.manufacturer || '')}
      \${fi('Model', 'inv-model', it?.model || '')}
      \${fi('Serial Number', 'inv-serial', it?.serial_number || '')}
      <div class="form-group full" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="inv-donated" style="width:auto" onchange="onInvDonatedChange()" \${it?.is_donated ? 'checked' : ''}>
        <label for="inv-donated" style="margin:0">This item was donated</label>
      </div>
      \${fi('Purchase Date', 'inv-purchase-date', it?.purchase_date || '', 'date')}
      <div class="form-group">
        <label>Price ($)</label>
        <input type="number" id="inv-purchase-price" value="\${it?.purchase_price ?? ''}" step="0.01" min="0">
      </div>
      \${fi('Purchased From', 'inv-purchased-from', it?.purchased_from || '')}
      \${it ? '' : invDestFields() + fi('Date', 'inv-date', today, 'date')}
      <div class="form-group full">
        <label>Photo</label>
        \${it?.photo_updated_at ? \`
          <div class="flex gap-8 align-center" style="margin-bottom:8px">
            <img src="\${invPhotoUrl(it, true)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px">
            <button class="btn btn-sm btn-danger" onclick="removeInvPhoto(\${it.id})">Remove Photo</button>
          </div>\` : ''}
        <input type="file" id="inv-photo" accept="image/*">
        \${it?.photo_updated_at ? '<div style="font-size:12px;color:var(--text-muted)">Choosing a file replaces the current photo.</div>' : ''}
      </div>
    </div>
    \${it ? '' : fi('Notes', 'inv-note', '', 'textarea')}
  \`, it ? 'Edit Item' : 'Add Item', [
    { label: 'Cancel', cls: 'btn-secondary', fn: it ? 'openInvItem(' + it.id + ')' : 'closeModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveInvItem(' + (it?.id || 'null') + ')' },
  ]);
  onInvDonatedChange();
}

// A donated item reuses the purchase fields for when it came in, what it's worth, and who gave it
function onInvDonatedChange() {
  const donated = !!document.getElementById('inv-donated')?.checked;
  const relabel = (id, text) => {
    const label = document.getElementById(id)?.closest('.form-group')?.querySelector('label');
    if (label) label.textContent = text;
  };
  relabel('inv-purchase-date',  donated ? 'Date Donated' : 'Purchase Date');
  relabel('inv-purchase-price', donated ? 'Estimated Value ($)' : 'Price ($)');
  relabel('inv-purchased-from', donated ? 'Donated By' : 'Purchased From');
}

function invScaleImage(img, maxDim, quality) {
  const scale  = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

// Phone photos are several MB — shrink to a JPEG that fits in a D1 row, plus a list thumbnail
async function invReadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload  = () => resolve(i);
      i.onerror = () => reject(new Error('That file could not be read as an image'));
      i.src = url;
    });
    let image = invScaleImage(img, 1600, 0.82);
    if (image.length > 1600000) image = invScaleImage(img, 1200, 0.7);
    return { image, thumb: invScaleImage(img, 240, 0.7) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function saveInvItem(id) {
  const body = {
    name:          gv('inv-name').trim(),
    manufacturer:  gv('inv-manufacturer'),
    model:         gv('inv-model'),
    serial_number: gv('inv-serial'),
    purchase_date:  gv('inv-purchase-date'),
    purchase_price: gv('inv-purchase-price'),
    purchased_from: gv('inv-purchased-from'),
    is_donated:     !!document.getElementById('inv-donated')?.checked,
  };
  if (!body.name) { toast('Item name is required', 'error'); return; }
  if (!id) {
    const dest = invDestValue();
    if (!dest) return;
    Object.assign(body, dest, { event_date: gv('inv-date'), note: gv('inv-note') });
  }
  const file = document.getElementById('inv-photo')?.files?.[0];

  let itemId;
  try {
    const data = await api(id ? 'PUT' : 'POST', '/inventory' + (id ? '/' + id : ''), body);
    itemId = data.item.id;
  } catch(e) { toast(e.data?.error || 'Failed to save item', 'error'); return; }

  let photoError = null;
  if (file) {
    try { await api('PUT', '/inventory/' + itemId + '/photo', await invReadPhoto(file)); }
    catch(e) { photoError = e.data?.error || e.message || 'upload failed'; }
  }
  if (photoError) toast('Item saved, but the photo was not: ' + photoError, 'error');
  else toast('Item saved ✓');

  openInvItem(itemId);
  if (state.currentPage === 'inventory') loadInvTable();
}

async function removeInvPhoto(id) {
  if (!confirm('Remove the photo from this item?')) return;
  try {
    const data = await api('DELETE', '/inventory/' + id + '/photo');
    toast('Photo removed');
    openInvForm(data.item);
    if (state.currentPage === 'inventory') loadInvTable();
  } catch(e) { toast(e.data?.error || 'Failed to remove photo', 'error'); }
}

async function openInvMove(id) {
  let data;
  try {
    [data] = await Promise.all([api('GET', '/inventory/' + id), loadInvMeta()]);
  } catch(e) { toast(e.data?.error || 'Failed to load item', 'error'); return; }
  const it = data.item;
  const today = new Date().toISOString().slice(0, 10);

  showModal(\`
    <div style="margin-bottom:16px">
      <div style="font-size:16px;font-weight:600">\${escHtml(it.name)}</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">Currently: \${invWhere(it)}</div>
    </div>
    <div class="form-grid">
      \${invDestFields(it)}
      \${fi('Date Moved', 'inv-date', today, 'date')}
    </div>
    \${fi('Notes', 'inv-note', '', 'textarea')}
  \`, 'Move Item', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'openInvItem(' + id + ')' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveInvMove(' + id + ')' },
  ]);
  // Start on the first destination that isn't where the item already is
  const sel = document.getElementById('inv-dest');
  const first = [...sel.options].find(o => !o.disabled);
  if (first) sel.value = first.value;
  onInvDestChange();
}

async function saveInvMove(id) {
  const dest = invDestValue();
  if (!dest) return;
  if (!gv('inv-date')) { toast('Date is required', 'error'); return; }
  try {
    await api('POST', '/inventory/' + id + '/move', { ...dest, event_date: gv('inv-date'), note: gv('inv-note') });
    toast(dest.member_id ? 'Item checked out ✓' : 'Item moved ✓');
    openInvItem(id);
    if (state.currentPage === 'inventory') loadInvTable();
  } catch(e) { toast(e.data?.error || 'Failed to move item', 'error'); }
}

async function addInvNote(id) {
  const note = gv('inv-new-note').trim();
  if (!note) { toast('Note text is required', 'error'); return; }
  try {
    await api('POST', '/inventory/' + id + '/notes', { note, event_date: gv('inv-new-note-date') });
    toast('Note added');
    openInvItem(id);
  } catch(e) { toast(e.data?.error || 'Failed to add note', 'error'); }
}

async function deleteInvItem(id) {
  if (!confirm('Delete this item along with its photo and history? This cannot be undone.')) return;
  try {
    await api('DELETE', '/inventory/' + id);
    toast('Item deleted');
    closeModal();
    if (state.currentPage === 'inventory') loadInvTable();
  } catch(e) { toast(e.data?.error || 'Failed to delete item', 'error'); }
}

function addInvLocation() {
  showModal(\`
    \${fi('Location Name', 'inv-loc-name', '', 'text', 'e.g. Clubhouse, Trailer', true)}
    <p class="text-muted" style="font-size:12px;margin-top:8px">Current locations: \${invMeta.locations.map(l => escHtml(l.name)).join(', ') || 'none'}</p>
  \`, 'Add Location', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveInvLocation()' },
  ]);
}

async function saveInvLocation() {
  const name = gv('inv-loc-name').trim();
  if (!name) { toast('Location name is required', 'error'); return; }
  try {
    await api('POST', '/inventory/locations', { name });
    toast('Location added ✓');
    closeModal();
    if (state.currentPage === 'inventory') inventory();
  } catch(e) { toast(e.data?.error || 'Failed to add location', 'error'); }
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

// ── CALLSIGN REPORT ───────────────────────────────────────────────────
async function callsigns() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/callsigns');
    const count = data.callsigns.length;
    setPage(\`
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-weight:600;font-size:15px">Active Member Callsigns</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">\${count} callsign\${count !== 1 ? 's' : ''} · active, non-silent-key members</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="copyCallsigns()">Copy</button>
        </div>
        <textarea id="callsign-csv" readonly
          style="width:100%;min-height:120px;font-family:var(--mono);font-size:13px;
                 background:var(--bg);color:var(--text);border:1px solid var(--border);
                 border-radius:6px;padding:10px;resize:vertical;line-height:1.6"
        >\${escHtml(data.csv)}</textarea>
      </div>
    \`);
  } catch(e) { setPage(\`<p class="text-muted" style="padding:24px">Error: \${escHtml(e.data?.error || e.message)}</p>\`); }
}

function copyCallsigns() {
  const el = document.getElementById('callsign-csv');
  if (!el) return;
  navigator.clipboard.writeText(el.value).then(() => toast('Callsigns copied to clipboard ✓')).catch(() => {
    el.select();
    document.execCommand('copy');
    toast('Callsigns copied to clipboard ✓');
  });
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
        <div class="tbl-wrap"><table>
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
        </table></div>
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
    { label: 'Cancel',         cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Delete',         cls: 'btn-danger',    fn: 'deleteUser(' + id + ')' },
    { label: 'Reset Password', cls: 'btn-secondary', fn: 'adminResetPassword(' + id + ')' },
    { label: 'Save',           cls: 'btn-primary',   fn: 'saveEditUser(' + id + ')' },
  ]);
}

async function adminResetPassword(id) {
  if (!confirm('Send this user a password reset link? This will immediately sign them out of any existing sessions.')) return;
  try {
    const res = await api('POST', '/admin/users/' + id + '/reset-password');
    toast(res.message || 'Reset email sent ✓');
    closeModal();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
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
async function audit(opts = {}) {
  setPage('<div class="spinner"></div>');
  try {
    const params = new URLSearchParams();
    if (opts.action)   params.set('action', opts.action);
    if (opts.callsign) params.set('callsign', opts.callsign);
    const qs = params.toString() ? '?' + params.toString() : '';
    const data = await api('GET', '/admin/audit' + qs);
    setPage(\`
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Filter by callsign</label>
            <input id="audit-callsign" class="form-control" style="width:140px" placeholder="e.g. W4TRC"
              value="\${escHtml(opts.callsign||'')}"
              onkeydown="if(event.key==='Enter')audit({action:document.getElementById('audit-action').value.trim(),callsign:this.value.trim().toUpperCase()})">
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Filter by action</label>
            <input id="audit-action" class="form-control" style="width:180px" placeholder="e.g. member.update"
              value="\${escHtml(opts.action||'')}"
              onkeydown="if(event.key==='Enter')audit({callsign:document.getElementById('audit-callsign').value.trim().toUpperCase(),action:this.value.trim()})">
          </div>
          <button class="btn btn-primary" onclick="audit({callsign:document.getElementById('audit-callsign').value.trim().toUpperCase(),action:document.getElementById('audit-action').value.trim()})">Search</button>
          \${(opts.callsign||opts.action) ? '<button class="btn btn-secondary" onclick="audit()">Clear</button>' : ''}
        </div>
      </div>
      <div class="card" style="padding:0">
        <div class="tbl-wrap"><table>
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
        </table></div>
      </div>
    \`);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

// ── ACTIVE SESSIONS ───────────────────────────────────────────────────
async function sessions() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/sessions');
    setPage(\`
      <div class="card" style="padding:0">
        <div class="tbl-wrap"><table>
          <thead><tr><th>User</th><th>Role</th><th>Device</th><th>IP Address</th><th>Signed In</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            \${data.sessions.map(s => \`<tr>
              <td>\${escHtml(s.email)}\${s.callsign ? ' <span class="callsign">' + escHtml(s.callsign) + '</span>' : ''}</td>
              <td>\${roleBadge(s.role)}</td>
              <td title="\${escHtml(s.user_agent)}">\${escHtml(sessionDevice(s.user_agent))}</td>
              <td style="font-size:12px">\${escHtml(s.ip_address||'—')}</td>
              <td style="color:var(--text-muted);white-space:nowrap">\${fmtDate(s.created_at)}</td>
              <td style="color:var(--text-muted);white-space:nowrap">\${fmtDate(s.expires_at)}</td>
              <td style="white-space:nowrap">
                \${s.current ? '<span class="badge badge-green">This device</span>' : ''}
                <button class="btn btn-sm btn-danger" onclick="revokeSession('\${escHtml(s.id)}', \${s.current ? 'true' : 'false'})">Sign Out</button>
              </td>
            </tr>\`).join('')}
          </tbody>
        </table></div>
      </div>
      <p class="text-muted" style="font-size:12px;margin-top:12px">Everyone currently signed in. Signing a session out takes effect immediately; the user can log in again unless their account is disabled under User Accounts.</p>
    \`);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

// "Chrome on Windows" from a User-Agent string
function sessionDevice(ua) {
  if (!ua) return 'Unknown';
  const has = (t) => ua.includes(t);
  const browser = has('Edg/') ? 'Edge' : has('OPR/') ? 'Opera' : has('Firefox/') ? 'Firefox'
    : has('Chrome/') ? 'Chrome' : has('Safari/') ? 'Safari' : null;
  const os = has('iPhone') ? 'iPhone' : has('iPad') ? 'iPad' : has('Android') ? 'Android'
    : has('Windows') ? 'Windows' : has('Mac OS X') ? 'Mac' : has('CrOS') ? 'ChromeOS' : has('Linux') ? 'Linux' : null;
  if (!browser && !os) return ua.slice(0, 40);
  return [browser || 'Browser', os].filter(Boolean).join(' on ');
}

async function revokeSession(id, current) {
  const msg = current
    ? 'Sign out this device? You will have to log in again.'
    : 'Sign this session out? Whoever is using it will have to log in again.';
  if (!confirm(msg)) return;
  try {
    await api('DELETE', '/admin/sessions/' + id);
    if (current) return doLogout();
    toast('Session signed out ✓');
    sessions();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

function tryParseJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function auditTarget(r) {
  const d = tryParseJson(r.detail);
  if (r.target_type === 'member') {
    const name = r.target_name || d?.name || '';
    const call = r.target_callsign || d?.before?.callsign || d?.callsign || '';
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
  if (r.target_type === 'inventory_item' || r.target_type === 'inventory_location') return d?.name || \`item #\${r.target_id}\`;
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
    case 'meeting.create':
    case 'meeting.update':     return d.meeting_date ? d.meeting_date + ' — ' + d.hams + ' ham' + (d.hams !== 1 ? 's' : '') + ', ' + d.guests + ' non-ham' + (d.guests !== 1 ? 's' : '') : '';
    case 'meeting.delete':     return d.meeting_date || '';
    case 'inventory.update':   return d.changed?.length ? 'Changed: ' + d.changed.map(k => k.replace(/_/g, ' ')).join(', ') : '';
    case 'inventory.move':     return [d.event_type === 'checked_out' ? 'checked out' : 'moved', d.event_date].filter(Boolean).join(' — ');
    case 'membership.create':  return d.year ? 'Year ' + d.year : '';
    case 'member.renewal_activated': return d?.activated_count != null ? d.activated_count + ' renewed member' + (d.activated_count !== 1 ? 's' : '') + ' activated for ' + d.year : '';
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

// ── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const modalOpen = !!document.querySelector('.modal-backdrop');

  if (e.key === 'Escape' && modalOpen) { closeModal(); return; }

  if (!modalOpen && state.currentPage === 'members') {
    if (e.key === '/') { e.preventDefault(); document.getElementById('member-search')?.focus(); return; }
    if (e.key === 'n' || e.key === 'N') { openAddMember(); return; }
  }
});

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

function duesBadge(status, paid, coveredBy, paymentMethod) {
  if (paymentMethod === 'eastman') return '<span class="badge badge-blue">Eastman</span>';
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

// ── LOCAL HAMS (PROSPECTS) ────────────────────────────────────────────
let prospectsState = { q:'', city:'all', status:'all', postcard:'all', page:1, data:null, stats:null };

async function prospects() {
  prospectsState = { q:'', city:'all', status:'all', postcard:'all', license_age:'all', page:1, data:null, stats:null };
  setPage(\`
    <div id="prospects-stats" class="stat-grid" style="margin-bottom:16px"></div>
    <div class="search-bar" style="flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <input type="text" id="prospect-search" placeholder="Search callsign or name…"
        oninput="prospectsState.q=this.value;prospectsState.page=1;loadProspects()" style="max-width:260px">
      <select id="prospect-city" onchange="prospectsState.city=this.value;prospectsState.page=1;loadProspects()" style="width:140px">
        <option value="all">All Cities</option>
        <option value="Church Hill">Church Hill</option>
        <option value="Kingsport">Kingsport</option>
        <option value="Mount Carmel">Mount Carmel</option>
      </select>
      <select id="prospect-status" onchange="prospectsState.status=this.value;prospectsState.page=1;loadProspects()" style="width:160px">
        <option value="all">All Statuses</option>
        <option value="non_members">Non-Members Only</option>
        <option value="not_contacted">Not Contacted</option>
        <option value="contacted">Contacted</option>
        <option value="interested">Interested</option>
        <option value="not_interested">Not Interested</option>
        <option value="members">Already Members</option>
      </select>
      <select id="prospect-postcard" onchange="prospectsState.postcard=this.value;prospectsState.page=1;loadProspects()" style="width:160px">
        <option value="all">All Postcards</option>
        <option value="not_sent">Postcard Not Sent</option>
        <option value="sent">Postcard Sent</option>
      </select>
      <select id="prospect-license-age" onchange="prospectsState.license_age=this.value;prospectsState.page=1;loadProspects()" style="width:160px">
        <option value="all">All License Ages</option>
        <option value="new">New (0–3 yrs)</option>
        <option value="recent">Recent (3–5 yrs)</option>
        <option value="established">Established (5+ yrs)</option>
      </select>
      <span id="prospect-count" style="margin-left:auto;color:var(--text-muted);font-size:12px"></span>
    </div>
    <div class="card" style="padding:0">
      <div id="prospects-results"><div class="spinner"></div></div>
      <div id="prospects-pagination" style="padding:12px 16px;display:flex;gap:8px;align-items:center"></div>
    </div>
    <div id="prospect-modal-wrap"></div>
  \`);
  await loadProspects();
}

async function loadProspects() {
  const s = prospectsState;
  const params = new URLSearchParams({ q: s.q, city: s.city, status: s.status, postcard: s.postcard, license_age: s.license_age, page: s.page });
  const resultsEl = document.getElementById('prospects-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="spinner"></div>';

  try {
    const [data, stats] = await Promise.all([
      api('GET', \`/prospects?\${params}\`),
      s.stats ? Promise.resolve({ stats: s.stats }) : api('GET', '/prospects/stats'),
    ]);
    s.data  = data;
    s.stats = stats.stats;
    renderProspects();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

function renderProspects() {
  const { data, stats, page } = prospectsState;
  const ps = data?.prospects || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / (data?.pageSize || 75));

  const statsEl = document.getElementById('prospects-stats');
  if (statsEl) statsEl.innerHTML = \`
    <div class="stat-card"><div class="stat-val">\${stats?.total ?? '—'}</div><div class="stat-label">Total Hams</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.member_count ?? '—'}</div><div class="stat-label">Already Members</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.non_member_count ?? '—'}</div><div class="stat-label">Not Yet Members</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.not_contacted ?? '—'}</div><div class="stat-label">Not Contacted</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.contacted ?? '—'}</div><div class="stat-label">Contacted</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.interested ?? '—'}</div><div class="stat-label">Interested</div></div>
    <div class="stat-card"><div class="stat-val">\${stats?.postcard_sent ?? '—'}</div><div class="stat-label">Postcards Sent</div></div>
  \`;

  const countEl = document.getElementById('prospect-count');
  if (countEl) countEl.textContent = total + ' results';

  const resultsEl = document.getElementById('prospects-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = \`
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Callsign</th><th>Name</th><th>City</th><th>ZIP</th><th>Address</th>
          <th>Member?</th><th>Outreach</th><th>Postcard</th><th></th>
        </tr></thead>
        <tbody>
          \${ps.length === 0 ? '<tr><td colspan="9" style="color:var(--text-muted);text-align:center;padding:24px">No results</td></tr>' :
            ps.map(p => \`
              <tr>
                <td><span class="callsign">\${escHtml(p.callsign)}</span></td>
                <td>\${escHtml((p.first_name||'') + ' ' + (p.last_name||''))}</td>
                <td>\${escHtml(p.city||'')}</td>
                <td style="color:var(--text-muted);font-size:12px">\${escHtml(p.zip||'')}</td>
                <td style="font-size:12px;color:var(--text-muted)">\${p.address ? escHtml(p.address) : '<span style="opacity:.3">—</span>'}</td>
                <td>\${p.member_id ? \`<span class="badge badge-green" title="Active Member">Member</span>\` : ''}</td>
                <td>\${p.member_id ? '' : prospectStatusBadge(p.outreach_status)}</td>
                <td>\${p.postcard_sent ? '<span class="badge badge-blue">Sent</span>' : ''}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="openProspectModal(\${JSON.stringify(p).replace(/"/g,'&quot;')})">Edit</button></td>
              </tr>
            \`).join('')}
        </tbody>
      </table>
    </div>
  \`;

  const pagEl = document.getElementById('prospects-pagination');
  if (pagEl) {
    if (totalPages > 1) {
      pagEl.innerHTML = \`
        <button class="btn btn-sm btn-secondary" \${page<=1?'disabled':''} onclick="prospectsState.page=\${page-1};loadProspects()">‹ Prev</button>
        <span style="font-size:12px;color:var(--text-muted)">Page \${page} of \${totalPages} (\${total} total)</span>
        <button class="btn btn-sm btn-secondary" \${page>=totalPages?'disabled':''} onclick="prospectsState.page=\${page+1};loadProspects()">Next ›</button>
      \`;
    } else {
      pagEl.innerHTML = \`<span style="font-size:12px;color:var(--text-muted)">\${total} results</span>\`;
    }
  }
}

function prospectStatusBadge(status) {
  const map = {
    not_contacted:  '<span class="badge badge-gray">Not Contacted</span>',
    contacted:      '<span class="badge badge-yellow">Contacted</span>',
    interested:     '<span class="badge badge-green">Interested</span>',
    not_interested: '<span class="badge badge-red">Not Interested</span>',
  };
  return map[status] || '<span class="badge badge-gray">—</span>';
}

function openProspectModal(p) {
  const wrap = document.getElementById('prospect-modal-wrap');
  if (!wrap) return;
  wrap.innerHTML = \`
    <div class="modal-backdrop" onclick="if(event.target===this)closeProspectModal()">
      <div class="modal" style="max-width:520px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3><span class="callsign">\${escHtml(p.callsign)}</span> — \${escHtml((p.first_name||'') + ' ' + (p.last_name||''))}</h3>
          <button class="btn btn-sm btn-secondary" onclick="closeProspectModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid" style="margin-bottom:20px">
            \${p.address ? \`<div class="detail-field" style="grid-column:1/-1"><label>Address</label><div class="val">\${escHtml(p.address)}</div></div>\` : \`<div class="detail-field" style="grid-column:1/-1"><label>Address</label><div class="val" style="color:var(--text-muted)">Not yet synced from HamDB</div></div>\`}
            <div class="detail-field"><label>City</label><div class="val">\${escHtml(p.city||'—')}</div></div>
            <div class="detail-field"><label>ZIP</label><div class="val">\${escHtml(p.zip||'—')}</div></div>
            <div class="detail-field"><label>State</label><div class="val">\${escHtml(p.state||'—')}</div></div>
            \${p.email ? \`<div class="detail-field"><label>Email</label><div class="val">\${escHtml(p.email)}</div></div>\` : ''}
            \${p.license_class ? \`<div class="detail-field"><label>License Class</label><div class="val">\${escHtml(p.license_class)}</div></div>\` : ''}
            \${p.license_expiry ? \`<div class="detail-field"><label>Expires</label><div class="val">\${escHtml(p.license_expiry)}</div></div>\` : ''}
          </div>

          \${p.member_id ? \`
            <div class="card" style="background:rgba(46,204,113,.08);border-color:rgba(46,204,113,.3);margin-bottom:16px">
              <p style="color:var(--success);margin:0">✓ Already a KARC member\${p.member_active ? '' : ' (inactive)'}.</p>
            </div>
          \` : \`
            <div class="form-group" style="margin-bottom:16px">
              <label>Outreach Status</label>
              <select id="pm-status">
                <option value="not_contacted" \${p.outreach_status==='not_contacted'?'selected':''}>Not Contacted</option>
                <option value="contacted"     \${p.outreach_status==='contacted'?'selected':''}>Contacted</option>
                <option value="interested"    \${p.outreach_status==='interested'?'selected':''}>Interested</option>
                <option value="not_interested"\${p.outreach_status==='not_interested'?'selected':''}>Not Interested</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:16px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" id="pm-postcard" \${p.postcard_sent?'checked':''} style="width:auto">
                Postcard Sent
              </label>
              <input type="date" id="pm-postcard-date" value="\${p.postcard_sent_date||''}" style="margin-top:8px">
            </div>
          \`}
          <div class="form-group">
            <label>Notes</label>
            <textarea id="pm-notes" rows="3">\${escHtml(p.notes||'')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeProspectModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveProspect(\${p.id}, \${!!p.member_id})">Save</button>
        </div>
      </div>
    </div>
  \`;
}

function closeProspectModal() {
  const wrap = document.getElementById('prospect-modal-wrap');
  if (wrap) wrap.innerHTML = '';
}

async function saveProspect(id, isMember) {
  const body = {
    notes: document.getElementById('pm-notes')?.value ?? '',
  };
  if (!isMember) {
    body.outreach_status  = document.getElementById('pm-status')?.value;
    body.postcard_sent    = document.getElementById('pm-postcard')?.checked ? 1 : 0;
    body.postcard_sent_date = document.getElementById('pm-postcard-date')?.value || null;
  }
  try {
    const res = await api('PUT', \`/prospects/\${id}\`, body);
    const idx = prospectsState.data?.prospects?.findIndex(p => p.id === id);
    if (idx !== undefined && idx >= 0) {
      prospectsState.data.prospects[idx] = res.prospect;
    }
    prospectsState.stats = null; // force stats refresh next load
    closeProspectModal();
    toast('Saved ✓');
    prospectsState.stats = null;
    loadProspects();
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── Utilities ─────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    // D1 returns UTC datetimes as "YYYY-MM-DD HH:MM:SS" (no Z). Without a
    // timezone indicator, browsers parse it as local time instead of UTC.
    // Normalize to ISO 8601 UTC so the browser converts to the user's local zone.
    const s = String(iso).replace(' ', 'T');
    const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  catch { return iso; }
}

// ═══════════════════════════════════════════════════════════════
// MEMBER PORTAL
// ═══════════════════════════════════════════════════════════════

// ── Portal shell navigation ───────────────────────────────────────────
function togglePortalNav() {
  const open = document.getElementById('portal-sidebar').classList.toggle('open');
  document.getElementById('portal-backdrop').classList.toggle('open', open);
}
function closePortalNav() {
  document.getElementById('portal-sidebar').classList.remove('open');
  document.getElementById('portal-backdrop').classList.remove('open');
}

function showPortal() {
  sessionStorage.setItem('view', 'portal');
  state.currentPage = null; // admin keyboard shortcuts stay off in the portal
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-shell').classList.add('hidden');
  document.getElementById('portal-shell').classList.remove('hidden');
  document.getElementById('portal-avatar').textContent = state.user.email[0].toUpperCase();

  const payStatus = new URL(window.location.href).searchParams.get('payment');
  if (payStatus) history.replaceState({}, '', '/');
  if (payStatus === 'success') toast('Payment received! Your dues record has been updated.', 'success');
  else if (payStatus === 'cancelled') toast('Payment cancelled — you can pay any time.', 'warn');
  else if (payStatus === 'donation-success') toast('Thank you! Your donation has been received.', 'success');
  else if (payStatus === 'donation-cancelled') toast('Donation cancelled — nothing was charged.', 'warn');

  pNav(payStatus?.startsWith('donation-') ? 'portal-donate' : 'portal-home');
}

function setPortalPage(html) { document.getElementById('portal-page').innerHTML = html; }

function pNav(page) {
  document.querySelectorAll('[data-ppage]').forEach(el => {
    el.classList.toggle('active', el.dataset.ppage === page);
  });
  const titles = {
    'portal-home':    'My Dashboard',
    'portal-profile': 'My Profile',
    'portal-history': 'Membership History',
    'portal-donate':  'Donate',
  };
  document.getElementById('portal-page-title').textContent = titles[page] || page;
  if (page === 'portal-home')    portalHome();
  if (page === 'portal-profile') portalProfile();
  if (page === 'portal-history') portalHistory();
  if (page === 'portal-donate')  portalDonate();
}

// ── Portal: My Dashboard ──────────────────────────────────────────────
async function portalHome() {
  setPortalPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/portal/me');
    const m = data.member;
    const year = data.year;

    document.getElementById('portal-callsign').textContent = m.callsign || '';
    document.getElementById('portal-name').textContent     = \`\${m.first_name} \${m.last_name}\`;

    const isLifetime = m.membership_type === 'lifetime_honorary';
    const isPaid = isLifetime || ['active', 'honorary', 'waived'].includes(m.dues_status);
    const duesClass = isPaid ? 'paid' : (m.dues_status ? 'unpaid' : 'unknown');
    const duesHeading = isLifetime
      ? 'Lifetime honorary member — no dues'
      : isPaid
      ? \`✓ Dues paid for \${year}\`
      : (m.dues_status === 'expired' ? \`Dues expired — \${year}\` : \`Dues not yet paid for \${year}\`);
    const dueSub = isPaid
      ? (m.dues_paid_date ? \`Paid \${fmtDate(m.dues_paid_date)}\${m.dues_amount_paid != null ? \` — $\${Number(m.dues_amount_paid).toFixed(2)}\` : ''}\` : '')
      : (m.dues_amount_due != null ? \`Amount due: $\${Number(m.dues_amount_due).toFixed(2)}\` : '');

    // Oct–Dec: online payment applies to next year's dues
    const payYear  = data.renewal_year || year;
    const renewing = payYear !== year;
    const renewalPaid = renewing && ['active', 'honorary', 'waived'].includes(data.renewal?.status);
    const needsPay = !isLifetime && (renewing ? !renewalPaid : !isPaid);

    // Family memberships: dependents are paid for by the primary member
    const memberLabel = x => \`\${x.callsign ? x.callsign + ' — ' : ''}\${x.first_name} \${x.last_name}\`;
    const coveredBy = data.covered_by;
    const coveredMembers = data.covered_members || [];
    const showPay = needsPay && !coveredBy;
    const familyNote = coveredMembers.length
      ? \`<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Your family membership also covers: \${escHtml(coveredMembers.map(memberLabel).join(', '))}</p>\`
      : '';
    const renewalSub = renewalPaid && data.renewal.paid_date
      ? \`Paid \${fmtDate(data.renewal.paid_date)}\${data.renewal.amount_paid != null ? \` — $\${Number(data.renewal.amount_paid).toFixed(2)}\` : ''}\`
      : '';

    const licenseExpiry = m.license_expiry
      ? \`<div class="stat-card"><div class="stat-val" style="font-size:18px">\${escHtml(m.license_expiry)}</div><div class="stat-label">License Expiry</div></div>\`
      : '';

    setPortalPage(\`
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val" style="font-family:var(--mono)">\${escHtml(m.callsign || '—')}</div>
          <div class="stat-label">Callsign</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="font-size:18px">\${escHtml(m.license_class || '—')}</div>
          <div class="stat-label">License Class</div>
        </div>
        \${licenseExpiry}
      </div>

      <div class="dues-card \${duesClass}">
        <div class="dues-status-label">\${year} Dues</div>
        <div style="font-size:15px;font-weight:600">\${escHtml(duesHeading)}</div>
        \${dueSub ? \`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">\${escHtml(dueSub)}</div>\` : ''}
      </div>

      \${renewing && !isLifetime ? \`
      <div class="dues-card \${renewalPaid ? 'paid' : 'unknown'}">
        <div class="dues-status-label">\${payYear} Dues</div>
        <div style="font-size:15px;font-weight:600">\${renewalPaid ? \`✓ Dues paid for \${payYear}\` : coveredBy ? \`\${payYear} renewal — covered by a family membership\` : \`\${payYear} renewal is now open\`}</div>
        \${renewalSub ? \`<div style="font-size:12px;color:var(--text-muted);margin-top:4px">\${escHtml(renewalSub)}</div>\` : ''}
      </div>
      \` : ''}

      \${showPay ? \`
      <div class="payment-box">
        <h4>Pay \${payYear} Dues Online</h4>
        <button id="pay-online-btn" class="btn btn-primary" style="width:100%;margin-bottom:14px" onclick="payOnline()">
          Pay Online — \${m.membership_type === 'family' ? '$31' : '$21'}
        </button>
        \${familyNote}
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Includes a $1 online processing fee. Or pay in person ($\${m.membership_type === 'family' ? '30' : '20'}):</p>
        <ul style="margin:0 0 0 18px;line-height:2;font-size:13px">
          <li><strong>At a meeting:</strong> Cash or check payable to <em>Kingsport Amateur Radio Club</em></li>
          <li><strong>By mail:</strong> Send a check to the club treasurer</li>
        </ul>
        <p style="margin-top:10px;color:var(--text-muted);font-size:12px">In-person payments are recorded by a club officer.</p>
      </div>
      \` : ''}

      \${needsPay && coveredBy ? \`
      <div class="payment-box">
        <h4>Covered by a Family Membership</h4>
        <p style="font-size:13px">Your \${payYear} dues are covered under the family membership of <strong>\${escHtml(memberLabel(coveredBy))}</strong>. There is nothing for you to pay — your dues will show as paid once that membership is renewed.</p>
        <p style="margin-top:10px;color:var(--text-muted);font-size:12px">If this is no longer correct, contact a club officer.</p>
      </div>
      \` : ''}

      \${!needsPay && familyNote ? familyNote : ''}
    \`);
  } catch(e) { setPortalPage(\`<p class="text-muted">\${escHtml(e.data?.error || e.message)}</p>\`); }
}

async function payOnline() {
  const btn = document.getElementById('pay-online-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to checkout…'; }
  try {
    const data = await api('POST', '/stripe/create-checkout', {});
    window.location.href = data.url;
  } catch(e) {
    toast(e.data?.error || 'Failed to start checkout. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = 'Pay Online'; }
  }
}

// ── Portal: My Profile ────────────────────────────────────────────────
async function portalProfile() {
  setPortalPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/portal/me');
    const m = data.member;

    setPortalPage(\`
      <div class="card">
        <div class="card-title">Personal Information</div>
        <div class="form-grid">
          \${fi('First Name','pf-first', m.first_name||'','text','',true)}
          \${fi('Last Name', 'pf-last',  m.last_name ||'','text','',true)}
          \${fi('Email Address','pf-email', m.email||'','email')}
          \${fi('Phone','pf-phone', m.phone||'','tel')}
          \${fi('Street Address','pf-address', m.address||'')}
          \${fi('City','pf-city', m.city||'')}
          \${fi('State','pf-state', m.state||'')}
          \${fi('ZIP Code','pf-zip', m.zip||'')}
        </div>
        <div class="form-grid" style="margin-top:0">
          \${fi('Callsign','pf-callsign', m.callsign||'—')}
          \${fi('License Class','pf-license', m.license_class||'—')}
        </div>
        <p class="form-hint" style="margin-top:4px">Callsign and license data are managed by the club and updated from FCC records automatically.</p>
      </div>

      <div class="card">
        <div class="card-title">About Me</div>
        <div class="form-grid">
          \${fi('Bio','pf-bio', m.bio||'','textarea')}
          \${fi('Interests / Modes','pf-interests', m.interests||'','text','e.g. HF, CW, SOTA, DMR')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Emergency Contact</div>
        <div class="form-grid">
          \${fi('Name','pf-emerg-name', m.emergency_name||'')}
          \${fi('Phone','pf-emerg-phone', m.emergency_phone||'','tel')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Public Directory</div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">
          Opt in to appear on the <a href="/directory" target="_blank" style="color:var(--accent)">public member directory</a>.
          Only your callsign, name, license class, city/state, and interests will be shown.
        </p>
        <div class="toggle-wrap">
          <label class="toggle">
            <input type="checkbox" id="pf-directory" \${m.show_in_directory ? 'checked' : ''} onchange="saveDirectoryOptIn()">
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label" id="directory-label">\${m.show_in_directory ? 'Listed in public directory' : 'Not listed in public directory'}</span>
        </div>
      </div>

      <button class="btn btn-primary" onclick="saveProfile()" style="margin-top:8px">Save Changes</button>
    \`);

    // Make FCC-managed fields read-only
    ['pf-callsign','pf-license'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.readOnly = true; el.style.opacity = '.5'; }
    });
  } catch(e) { setPortalPage(\`<p class="text-muted">\${escHtml(e.data?.error || e.message)}</p>\`); }
}

async function saveProfile() {
  try {
    await api('PUT', '/portal/me', {
      first_name:      gv('pf-first'),
      last_name:       gv('pf-last'),
      email:           gv('pf-email'),
      phone:           gv('pf-phone'),
      address:         gv('pf-address'),
      city:            gv('pf-city'),
      state:           gv('pf-state'),
      zip:             gv('pf-zip'),
      bio:             gv('pf-bio'),
      interests:       gv('pf-interests'),
      emergency_name:  gv('pf-emerg-name'),
      emergency_phone: gv('pf-emerg-phone'),
    });
    toast('Profile saved ✓');
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

async function saveDirectoryOptIn() {
  const checkbox = document.getElementById('pf-directory');
  const show = checkbox.checked;
  try {
    await api('PUT', '/portal/directory-opt-in', { show });
    document.getElementById('directory-label').textContent = show
      ? 'Listed in public directory'
      : 'Not listed in public directory';
    toast(show ? 'Added to public directory ✓' : 'Removed from public directory ✓');
  } catch(e) {
    checkbox.checked = !show; // revert
    toast(e.data?.error || e.message, 'error');
  }
}

// ── Portal: Membership History ────────────────────────────────────────
async function portalHistory() {
  setPortalPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/portal/history');
    if (!data.history.length) {
      setPortalPage(\`
        <div class="card">
          <p class="text-muted">No membership records found yet. Records are added by club officers when dues are paid.</p>
        </div>
      \`);
      return;
    }
    const rows = data.history.map(h => \`
      <tr>
        <td><strong>\${escHtml(String(h.year))}</strong></td>
        <td>\${duesBadge(h.status, h.amount_paid, null)}</td>
        <td style="text-transform:capitalize">\${escHtml(h.membership_type||'individual')}</td>
        <td>\${h.amount_paid != null ? '$' + Number(h.amount_paid).toFixed(2) : '—'}</td>
        <td>\${h.paid_date ? fmtDate(h.paid_date) : '—'}</td>
        <td style="text-transform:capitalize">\${escHtml(h.payment_method||'—')}</td>
      </tr>
    \`).join('');
    setPortalPage(\`
      <div class="card" style="padding:0">
        <table>
          <thead><tr>
            <th>Year</th><th>Status</th><th>Type</th><th>Paid</th><th>Date</th><th>Method</th>
          </tr></thead>
          <tbody>\${rows}</tbody>
        </table>
      </div>
    \`);
  } catch(e) { setPortalPage(\`<p class="text-muted">\${escHtml(e.data?.error || e.message)}</p>\`); }
}

// ── Portal: Donate ────────────────────────────────────────────────────
async function portalDonate() {
  setPortalPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/portal/donations');
    const rows = data.donations.map(d => \`
      <tr>
        <td>\${d.donation_date ? fmtDate(d.donation_date) : '—'}</td>
        <td>\${d.donation_kind === 'monetary'
          ? '$' + Number(d.amount || 0).toFixed(2)
          : escHtml(d.item_description || 'Item') + (d.estimated_value != null ? \` <span style="color:var(--text-muted)">(est. $\${Number(d.estimated_value).toFixed(2)})</span>\` : '')}</td>
        <td style="text-transform:capitalize">\${escHtml(d.donation_kind === 'monetary' ? (d.payment_method || '—') : 'item')}</td>
      </tr>
    \`).join('');

    setPortalPage(\`
      <div class="card">
        <div class="card-title">Donate to the Club</div>
        <p style="font-size:13px;margin-bottom:14px">Donations are separate from dues and go to the Kingsport Amateur Radio Club. Pick an amount or enter your own.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          \${[10, 25, 50, 100].map(n => \`<button class="btn btn-secondary btn-sm" onclick="setDonateAmt(\${n})">$\${n}</button>\`).join('')}
        </div>
        <div class="form-grid">
          <div class="form-group"><label>Amount (USD) *</label><input type="number" id="don-amount" min="1" max="5000" step="1" placeholder="25"></div>
          <div class="form-group"><label>Note (optional)</label><input type="text" id="don-note" maxlength="200" placeholder="e.g. in memory of, or what it is for"></div>
        </div>
        <button id="donate-btn" class="btn btn-primary" style="width:100%;margin-top:6px" onclick="donateOnline()">Donate Online</button>
        <p style="margin-top:10px;color:var(--text-muted);font-size:12px">You will be taken to Stripe's secure checkout to enter your card. To give by cash or check, see a club officer.</p>
      </div>

      <div class="card" style="padding:0">
        <div class="card-title" style="padding:16px 16px 0">My Donations</div>
        \${rows
          ? \`<table><thead><tr><th>Date</th><th>Donation</th><th>Method</th></tr></thead><tbody>\${rows}</tbody></table>\`
          : '<p class="text-muted" style="padding:16px">No donations recorded yet.</p>'}
      </div>
    \`);
  } catch(e) { setPortalPage(\`<p class="text-muted">\${escHtml(e.data?.error || e.message)}</p>\`); }
}

function setDonateAmt(n) {
  const el = document.getElementById('don-amount');
  if (el) el.value = n;
}

async function donateOnline() {
  const amount = parseFloat(gv('don-amount'));
  if (!(amount >= 1 && amount <= 5000)) { toast('Enter an amount between $1 and $5,000.', 'error'); return; }
  const btn = document.getElementById('donate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to checkout…'; }
  try {
    const data = await api('POST', '/stripe/create-donation-checkout', { amount, note: gv('don-note') });
    window.location.href = data.url;
  } catch(e) {
    toast(e.data?.error || 'Failed to start checkout. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Donate Online'; }
  }
}

// ── Boot ──────────────────────────────────────────────────────────────
initTheme();
checkSession();
</script>
</body>
</html>`;
}
