/* ═══════════════════════════════════════════════════════════════
   KARC ADMIN SPA
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────
const state = {
  user: null,
  currentPage: 'dashboard',
  memberFilters: { q: '', status: 'all', arrl: 'all', eastman: 'all', class: 'all', page: 1 },
  memberYear: new Date().getFullYear(),
};

// ── Theme ─────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.classList.toggle('light', saved === 'light');
  updateThemeToggle();
  initNavCollapsed();
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
// On wide screens the menu button hides/shows the sidebar and remembers it.
function initNavCollapsed() {
  let collapsed = false;
  try { collapsed = localStorage.getItem('navCollapsed') === '1'; } catch {}
  document.documentElement.classList.toggle('nav-collapsed', collapsed);
}
function toggleNavCollapsed() {
  const collapsed = document.documentElement.classList.toggle('nav-collapsed');
  try { localStorage.setItem('navCollapsed', collapsed ? '1' : '0'); } catch {}
}

function toggleNav() {
  if (!matchMedia('(max-width: 768px)').matches) return toggleNavCollapsed();
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('nav-backdrop').classList.toggle('open', open);
}
function closeNav() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('nav-backdrop').classList.remove('open');
}

// ── Renewal demo (/demo) ──────────────────────────────────────────────
// Officers preview the member renewal as a made-up member. Portal data is
// faked here in the browser; only the Stripe checkout is real, in test mode,
// and the server never records it.
const DEMO = location.pathname === '/demo';

function demoGet(k) { try { return sessionStorage.getItem('demo-' + k); } catch { return null; } }
function demoSet(k, v) { try { sessionStorage.setItem('demo-' + k, v); } catch {} }
function demoReset() { ['type', 'paid'].forEach(k => { try { sessionStorage.removeItem('demo-' + k); } catch {} }); }

// Year that online renewals pay for: October opens renewals for next year.
function duesYear(now = new Date()) {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function demoData() {
  const now = new Date();
  const year = now.getFullYear();
  const renewalYear = duesYear(now);
  const type = demoGet('type') === 'family' ? 'family' : 'individual';
  const base = type === 'family' ? 30 : 20;
  const paidDate = demoGet('paid'); // set when Stripe sends the officer back
  const renewing = renewalYear !== year;
  const member = {
    id: 0, callsign: 'N0CALL', first_name: 'Demo', last_name: 'Member',
    email: 'demo@example.com', phone: '423-555-0100',
    address: '123 Main St', city: 'Kingsport', state: 'TN', zip: '37660',
    license_class: 'General', license_expiry: '2031-05-14',
    bio: '', interests: 'HF, POTA', emergency_name: '', emergency_phone: '',
    show_in_directory: 0, membership_type: type,
    // In renewal season this year is already paid and the renewal is next year
    dues_status: renewing || paidDate ? 'active' : null,
    dues_paid_date: renewing ? year + '-01-14' : paidDate,
    dues_amount_paid: renewing ? base : (paidDate ? base + 1 : null),
    dues_amount_due: base,
  };
  const renewal = renewing && paidDate
    ? { status: 'active', paid_date: paidDate, amount_paid: base + 1, amount_due: base }
    : null;
  const history = [];
  if (paidDate) history.push({ year: renewalYear, status: 'active', membership_type: type, amount_paid: base + 1, paid_date: paidDate, payment_method: 'stripe' });
  for (let y = renewing ? year : year - 1; y >= year - 2; y--) {
    history.push({ year: y, status: 'active', membership_type: type, amount_paid: base, paid_date: y + '-01-14', payment_method: 'check' });
  }
  return {
    ok: true, member, year, renewal_year: renewalYear, renewal,
    covered_by: null,
    covered_members: type === 'family' ? [{ callsign: '', first_name: 'Demo', last_name: 'Spouse' }] : [],
    history,
  };
}

async function demoApi(method, path) {
  const notSaved = msg => Object.assign(new Error(msg), { status: 400, data: { error: msg } });
  if (method === 'GET' && path === '/portal/me') return demoData();
  if (method === 'GET' && path === '/portal/history') return { ok: true, history: demoData().history };
  if (method === 'GET' && path === '/portal/donations') return { ok: true, donations: [] };
  if (method === 'POST' && path === '/stripe/create-checkout') {
    const resp = await fetch('/api/demo/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membership_type: demoGet('type') || 'individual' }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw Object.assign(new Error(data.error || 'API error'), { status: resp.status, data });
    return data;
  }
  if (path === '/stripe/create-donation-checkout') throw notSaved('Donations are not part of the renewal demo.');
  if (path === '/auth/logout') return { ok: true };
  throw notSaved('This is a demo, so changes are not saved.');
}

function demoSetType(type) {
  demoSet('type', type);
  demoSet('paid', '');
  demoBanner();
  pNav('portal-home');
}

function demoStartOver() {
  demoReset();
  demoBanner();
  pNav('portal-home');
}

function demoBanner() {
  let el = document.getElementById('demo-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'demo-banner';
    el.className = 'demo-banner';
    const content = document.getElementById('portal-content');
    content.insertBefore(el, content.firstChild);
  }
  const family = demoGet('type') === 'family';
  el.innerHTML =
    '<div><strong>Renewal demo.</strong> Nothing here is saved and no real card is charged. ' +
    'At checkout use card <code>4242 4242 4242 4242</code>, any future date and any CVC.</div>' +
    '<div class="demo-controls">' +
      '<button class="btn btn-sm ' + (family ? 'btn-secondary' : 'btn-primary') + '" data-type="individual" onclick="demoSetType(this.dataset.type)">Individual ($21)</button>' +
      '<button class="btn btn-sm ' + (family ? 'btn-primary' : 'btn-secondary') + '" data-type="family" onclick="demoSetType(this.dataset.type)">Family ($31)</button>' +
      '<button class="btn btn-sm btn-secondary" onclick="demoStartOver()">Start over</button>' +
    '</div>';
}

function startDemo() {
  document.title = 'Renewal Demo – W4TRC';
  // Stripe sends the officer back here; a success marks the demo renewal paid
  const payStatus = new URLSearchParams(location.search).get('payment');
  if (payStatus === 'success') demoSet('paid', localToday());
  state.user = { email: 'demo@example.com', role: 'member', memberId: -1 };
  demoBanner();
  showPortal();
}

async function api(method, path, body) {
  if (DEMO) return demoApi(method, path, body);
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
  // The code box appears once the server says this login has two-step sign-in on
  const codeGroup = document.getElementById('login-code-group');
  const codeInput = document.getElementById('login-code');
  const asked = !codeGroup.classList.contains('hidden');
  const code  = asked ? codeInput.value.trim() : '';
  err.classList.add('hidden');
  try {
    const data = await api('POST', '/auth/login', { email, password: pass, ...(code ? { code } : {}) });
    resetLoginCode();
    document.getElementById('login-pass').value = '';
    state.user = data.user;
    showApp();
  } catch (e) {
    const twoStep = !!e.data?.details?.two_step;
    if (twoStep && !asked) {
      codeGroup.classList.remove('hidden');
      codeInput.focus();
      return;
    }
    if (!twoStep) resetLoginCode();
    else { codeInput.value = ''; codeInput.focus(); }
    err.textContent = e.data?.error || 'Login failed';
    err.classList.remove('hidden');
  }
}

function resetLoginCode() {
  document.getElementById('login-code-group').classList.add('hidden');
  document.getElementById('login-code').value = '';
}
for (const id of ['login-pass', 'login-code']) {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}
// A different email starts over at the password
document.getElementById('login-email').addEventListener('input', resetLoginCode);

async function doLogout() {
  if (!leavePageOk()) return;
  if (DEMO) { demoStartOver(); return; }
  await api('POST', '/auth/logout').catch(() => {});
  state.user = null;
  state.pagePath = null;
  writeUrl('/');
  document.title = APP_TITLE;
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
    setTimeout(() => { writeUrl('/'); showLogin(); }, 1800);
  } catch (e) {
    msg.textContent = e.data?.error || 'Something went wrong';
    msg.style.color = 'var(--danger)';
    msg.classList.remove('hidden');
  }
}

async function checkSession() {
  if (DEMO) { startDemo(); return; }
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

  route();
}

// ── URLs ──────────────────────────────────────────────────────────────
// Every page has its own address, so a reload stays put and a link can be
// sent to another officer. The worker serves this page for any path.
const APP_TITLE = document.title;
let urlQuiet = false; // true while the address itself is choosing the page

function adminPath(page, id, tab) {
  const slug = page === 'dashboard' ? '' : page === 'googleGroups' ? 'google-groups' : page;
  return ['/admin', slug, id, tab].filter(Boolean).join('/');
}

function portalPath(page) {
  return page === 'portal-home' ? '/portal' : '/' + page.replace('-', '/');
}

function parseRoute(pathname) {
  const [shell, page, id, tab] = pathname.split('/').filter(Boolean);
  if (shell === 'portal') return { shell, page: page ? 'portal-' + page : 'portal-home' };
  if (shell !== 'admin') return null;
  return { shell, page: page === 'google-groups' ? 'googleGroups' : page || 'dashboard', id, tab };
}

// Each history entry remembers its position, so a Back that would throw away
// a half-filled form can be undone.
let histIdx = history.state?.i ?? 0;
function writeUrl(path, push) {
  if (push) histIdx++;
  history[push ? 'pushState' : 'replaceState']({ i: histIdx }, '', path);
}

// Moving between pages adds to the browser history; arriving from anywhere
// else (the bare site address, a scanned label) replaces that entry instead.
function setUrl(path, replace) {
  if (DEMO || urlQuiet || !state.user || location.pathname + location.search === path) return;
  writeUrl(path, !replace && !!parseRoute(location.pathname));
}

// List filters ride in the address after "?", leaving out anything at its default
const MEMBER_FILTERS = { q: '', status: 'all', arrl: 'all', eastman: 'all', class: 'all', page: 1 };

function pageQuery(page) {
  const p = new URLSearchParams();
  if (page === 'members') {
    for (const k in MEMBER_FILTERS) {
      if (String(state.memberFilters[k]) !== String(MEMBER_FILTERS[k])) p.set(k, state.memberFilters[k]);
    }
  }
  if (page === 'memberships' && state.memberYear !== new Date().getFullYear()) p.set('year', state.memberYear);
  const q = p.toString();
  return q ? '?' + q : '';
}

function readPageQuery(page, search) {
  const p = new URLSearchParams(search);
  if (page === 'members') {
    state.memberFilters = { ...MEMBER_FILTERS };
    for (const k in MEMBER_FILTERS) {
      if (p.has(k)) state.memberFilters[k] = k === 'page' ? Math.max(1, parseInt(p.get(k), 10) || 1) : p.get(k);
    }
  }
  if (page === 'memberships') state.memberYear = parseInt(p.get('year'), 10) || new Date().getFullYear();
}

// The address of the page under any open window, which closing it returns to
function pageUrl(path, replace) {
  state.pagePath = path;
  setUrl(path, replace);
}

function setTitle(title) {
  if (!DEMO) document.title = title + ' – W4TRC';
}

// Show whatever the address bar asks for, if this user may see it
function route() {
  const u = state.user;
  const officer = ['board','admin'].includes(u.role);
  document.getElementById('modal-root').innerHTML = '';
  modalDirty = false;

  // A scanned equipment label (/i/:id) opens that item in the inventory
  const itemId = location.pathname.startsWith('/i/') ? parseInt(location.pathname.slice(3), 10) : 0;
  if (itemId) {
    writeUrl(officer ? adminPath('inventory', itemId) : '/');
    if (!officer) toast('That label opens the club inventory, which is for officers.', 'warn');
  }

  const r = parseRoute(location.pathname);
  urlQuiet = true;
  try {
    if (r?.shell === 'admin' && officer) return routeAdmin(r);
    if (r?.shell === 'portal' && (!officer || u.memberId)) return showPortal(PORTAL_TITLES[r.page] ? r.page : 'portal-home');
  } finally { urlQuiet = false; }

  // Anywhere else: officers with a member record land on the same portal as
  // members, unless they were last in the admin section. Coming back from
  // Stripe checkout (/?payment=...) always returns to the portal.
  if (location.pathname !== '/') writeUrl('/');
  const fromCheckout = new URLSearchParams(location.search).has('payment');
  const lastView = sessionStorage.getItem('view');
  if (!officer || (u.memberId && (fromCheckout || lastView !== 'admin'))) {
    showPortal();
    return;
  }
  showAdmin();
}

function routeAdmin(r) {
  const id = parseInt(r.id, 10);
  adminShell();
  if (r.page === 'agendas' && id) return openAgenda(id);
  if (r.page === 'repeaters' && r.id === 'site') return openSite(r.tab);
  if (r.page === 'repeaters' && id) return openRepeater(id, r.tab);
  if (r.page === 'members' && id) return viewMember(id, r.tab);
  readPageQuery(r.page, location.search);
  nav(ADMIN_TITLES[r.page] ? r.page : 'dashboard');
  if (!id) return;
  if (r.page === 'attendance') openMeeting(id);
  if (r.page === 'inventory') openInvItem(id);
}

let popIgnore = false;
window.addEventListener('popstate', e => {
  if (DEMO || !state.user) return;
  const to = e.state?.i ?? 0;
  if (popIgnore) { popIgnore = false; histIdx = to; return; }
  if ((modalDirty || pageDirty) && !confirm(DISCARD_MSG)) {
    // Step back to where the form is
    if (histIdx !== to) { popIgnore = true; history.go(histIdx - to); }
    return;
  }
  histIdx = to;
  pageDirty = false;
  route();
});

// Leaving the site or reloading with a half-filled form asks first
window.addEventListener('beforeunload', e => {
  if (!modalDirty && !pageDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

// Names in lists are real links too. A plain click runs the row's own handler;
// a ctrl/shift/middle click is left to the browser to open in a new tab.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a.row-link');
  if (!a) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) e.stopPropagation();
  else e.preventDefault();
}, true);

// Sidebar links are real links (open in a new tab, copy the address), but a
// plain click switches pages without reloading.
document.addEventListener('click', e => {
  const a = e.target.closest?.('a.nav-item');
  if (!a || a.target || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if (!leavePageOk()) return;
  closeNav();
  closePortalNav();
  // A sidebar click opens the plain list, the same as its address does
  if (a.dataset.page === 'members') state.memberFilters = { ...MEMBER_FILTERS };
  if (a.dataset.page === 'memberships') state.memberYear = new Date().getFullYear();
  if (a.dataset.shell) return a.dataset.shell === 'admin' ? showAdmin() : showPortal();
  if (a.dataset.ppage) pNav(a.dataset.ppage);
  else nav(a.dataset.page);
});

function showAdmin(page = 'dashboard') {
  adminShell();
  nav(page);
}

function adminShell() {
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
  if (['board','admin'].includes(u.role)) document.getElementById('nav-treasurer')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-officers')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-attendance')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-agendas')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-inventory')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-repeaters')?.classList.remove('hidden');
  if (['board','admin'].includes(u.role)) document.getElementById('nav-callsigns')?.classList.remove('hidden');
  if (u.role !== 'admin') {
    document.getElementById('nav-section-admin')?.classList.add('hidden');
    document.querySelectorAll('[data-page="users"],[data-page="audit"],[data-page="sessions"],[data-page="googleGroups"]').forEach(el => el.classList.add('hidden'));
  }
}

// ── Navigation ────────────────────────────────────────────────────────
const ADMIN_TITLES = { dashboard: 'Dashboard', members: 'Members', memberships: 'Dues & Memberships', donations: 'Donations', treasurer: 'Treasurer Report', attendance: 'Attendance', agendas: 'Meeting Agendas', inventory: 'Inventory', repeaters: 'Repeaters', officers: 'Officers', prospects: 'Local Hams', users: 'User Accounts', audit: 'Audit Log', sessions: 'Active Sessions', googleGroups: 'Google Groups', cutoff: 'Membership Cutoff', callsigns: 'Callsign Report', reminders: 'Renewal Reminders' };

function nav(page) {
  state.currentPage = page;
  pageUrl(adminPath(page) + pageQuery(page));
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.getElementById('page-title').textContent = ADMIN_TITLES[page] || page;
  setTitle(ADMIN_TITLES[page] || page);
  document.getElementById('topbar-actions').innerHTML = '';

  const adminOnly = new Set(['users', 'audit', 'sessions', 'googleGroups', 'cutoff']);
  if (adminOnly.has(page) && state.user?.role !== 'admin') {
    setPage('<p class="text-muted" style="padding:24px">Access restricted to administrators.</p>');
    return;
  }

  const boardOnly = new Set(['prospects', 'callsigns', 'attendance', 'agendas', 'inventory', 'repeaters', 'treasurer', 'officers', 'reminders']);
  if (boardOnly.has(page) && !['board','admin'].includes(state.user?.role)) {
    setPage('<p class="text-muted" style="padding:24px">Access restricted to board members and administrators.</p>');
    return;
  }

  const pages = { dashboard, members, memberships, donations, treasurer, attendance, agendas, inventory, repeaters, officers, prospects, users, audit, sessions, googleGroups, cutoff, callsigns, reminders };
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
    const today = localToday();
    const expiring = stats.expiring_licenses || [];

    const yr = new Date().getFullYear();
    const notRenewed = stats.not_renewed || [];
    const month = new Date().getMonth() + 1; // 1-based
    const inGrace = month >= 1 && month <= 3;

    setPage(`
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val">${stats.members?.active ?? '—'}</div>
          <div class="stat-label">Active Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.members?.total ?? '—'}</div>
          <div class="stat-label">Total Records</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${msStats.stats?.active_count ?? '—'}</div>
          <div class="stat-label">${yr} Paid Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${msStats.stats?.total_collected ? '$' + Number(msStats.stats.total_collected).toFixed(2) : '—'}</div>
          <div class="stat-label">${yr} Revenue Collected</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${msStats.stats?.individual_count ?? '—'}</div>
          <div class="stat-label">Individual Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${msStats.stats?.family_count ?? '—'}</div>
          <div class="stat-label">Family Memberships</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.members?.arrl_count ?? '—'}</div>
          <div class="stat-label">ARRL Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.members?.eastman_count ?? '—'}</div>
          <div class="stat-label">Eastman Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-val">${stats.members?.eastman_count != null ? '$' + (stats.members.eastman_count * 3).toFixed(2) : '—'}</div>
          <div class="stat-label">${yr} Eastman Revenue</div>
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
      ${notRenewed.length > 0 ? `
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Not Yet Renewed — ${yr}
          <span style="background:var(--warn);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">${notRenewed.length}</span>
        </div>
        <p style="color:var(--text-muted);margin:0 0 12px">${inGrace
          ? `Active in ${yr - 1} — still in grace period through March 31. Send renewal reminders now.`
          : `Active in ${yr - 1} but have not renewed for ${yr}. Grace period ended April 1.`
        } <a href="${adminPath('reminders')}" class="row-link" onclick="nav('reminders')" style="color:var(--accent)">Renewal reminders →</a></p>
        <table>
          <thead><tr><th>Callsign</th><th>Name</th><th>Email</th><th></th></tr></thead>
          <tbody>
            ${notRenewed.map(m => `
              <tr>
                <td><a class="row-link" href="${adminPath('members', m.id)}" onclick="viewMember(${m.id})"><strong>${escHtml(m.callsign || '—')}</strong></a></td>
                <td>${escHtml(m.first_name + ' ' + m.last_name)}</td>
                <td style="color:var(--text-muted)">${escHtml(m.email || '—')}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewMember(${m.id})">View</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : ''}
      ${expiring.length > 0 ? `
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Expiring FCC Licenses
          <span style="background:var(--danger);color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">${expiring.length}</span>
        </div>
        <p style="color:var(--text-muted);margin:0 0 12px">Active members whose license expired in the last 90 days or expires within the next year. FCC licenses renew online at wireless.fcc.gov.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Callsign</th><th>Name</th><th>Class</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            ${expiring.map(m => {
              const expired = m.license_expiry < today;
              const daysLeft = Math.ceil((new Date(m.license_expiry) - new Date(today)) / 86400000);
              const color = expired ? 'var(--danger)' : daysLeft <= 30 ? 'var(--warn)' : 'var(--text-muted)';
              const label = expired ? 'Expired' : `${daysLeft}d`;
              return `
              <tr>
                <td><a class="row-link" href="${adminPath('members', m.id)}" onclick="viewMember(${m.id})"><strong>${escHtml(m.callsign || '—')}</strong></a></td>
                <td>${escHtml(m.first_name + ' ' + m.last_name)}</td>
                <td>${licenseBadge(m.license_class)}</td>
                <td><span style="color:${color};font-weight:600">${escHtml(m.license_expiry)} (${label})</span></td>
                <td><button class="btn btn-sm btn-secondary" onclick="viewMember(${m.id})">View</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
      ` : ''}
      <div class="card">
        <div class="card-title">Recent Activity</div>
        <table>
          <thead><tr><th>Action</th><th>User</th><th>Time</th></tr></thead>
          <tbody>
            ${(stats.recent_activity || []).map(r => `
              <tr>
                <td><code style="font-size:12px;color:var(--accent)">${escHtml(r.action)}</code></td>
                <td>${escHtml(r.email || '—')}</td>
                <td style="color:var(--text-muted)">${fmtDate(r.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `);
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

  setPage(`
    <div class="search-bar">
      <input type="text" id="member-search" placeholder="Search callsign, name, email…"
        value="${escHtml(state.memberFilters.q)}"
        oninput="memberFilter()">
      <select id="status-filter" onchange="memberFilter()" style="width:140px">
        <option value="all">All Status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="silent_key">Silent Key</option>
      </select>
      <select id="arrl-filter" onchange="memberFilter()" style="width:140px">
        <option value="all">All Members</option>
        <option value="arrl">ARRL Only</option>
        <option value="nonarrl">Non-ARRL</option>
      </select>
      <select id="eastman-filter" onchange="memberFilter()" style="width:150px">
        <option value="all">All Sponsors</option>
        <option value="eastman">Eastman Only</option>
        <option value="noneastman">Non-Eastman</option>
      </select>
      <select id="class-filter" onchange="memberFilter()" style="width:160px">
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
  `);
  // Show the filters the address asked for; anything it got wrong falls back to "all"
  const f = state.memberFilters;
  for (const k of ['status', 'arrl', 'eastman', 'class']) {
    const el = document.getElementById(k + '-filter');
    el.value = f[k];
    if (el.value !== f[k]) el.value = f[k] = 'all';
  }
  loadMembersTable();
}

function memberFilter() {
  const v = id => document.getElementById(id)?.value;
  state.memberFilters = {
    q: v('member-search') || '', status: v('status-filter') || 'all', arrl: v('arrl-filter') || 'all',
    eastman: v('eastman-filter') || 'all', class: v('class-filter') || 'all', page: 1,
  };
  loadMembersTable();
}

async function loadMembersTable() {
  const tbl = document.getElementById('members-table');
  if (!tbl) return;
  const f = state.memberFilters;
  if (state.currentPage === 'members') pageUrl(adminPath('members') + pageQuery('members'), true);
  tbl.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api('GET', '/members?' + new URLSearchParams(f));
    const { members: list, pagination: pg } = data;

    if (!list.length) {
      tbl.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">No members found.</p>';
      return;
    }

    tbl.innerHTML = `
      <div class="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Callsign</th><th>Name</th><th>Email</th>
            <th>Class</th><th>Type</th><th>Status</th><th>${new Date().getFullYear()} Dues</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${list.map(m => `
            <tr>
              <td><a class="row-link" href="${adminPath('members', m.id)}" onclick="viewMember(${m.id})"><span class="callsign">${escHtml(m.callsign || '—')}</span></a>${m.callsign_mismatch ? ' <span class="badge badge-yellow" title="Callsign may have changed hands — open record to review">⚠</span>' : ''}</td>
              <td><a class="row-link" href="${adminPath('members', m.id)}" onclick="viewMember(${m.id})">${escHtml(m.first_name)} ${escHtml(m.last_name)}</a></td>
              <td style="color:var(--text-muted)">${escHtml(m.email || '—')}</td>
              <td>${licenseBadge(m.license_class)}</td>
              <td>${m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : m.membership_type === 'lifetime_honorary' ? '<span class="badge badge-purple">Life Honorary</span>' : '<span class="badge badge-gray">Individual</span>'} ${m.is_arrl_member ? '<span class="badge badge-green">ARRL</span>' : ''} ${m.is_eastman_member ? '<span class="badge badge-blue">Eastman</span>' : ''}</td>
              <td>${memberStatusBadge(m.is_active, m.is_silent_key)}</td>
              <td>${duesBadge(m.current_year_status, m.current_year_paid, m.current_year_covered_by, m.current_year_payment_method)}</td>
              <td>
                <button class="btn btn-sm btn-secondary" onclick="viewMember(${m.id})">View</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    `;

    // Pagination
    const pagEl = document.getElementById('members-pagination');
    if (pg && pg.pages > 1) {
      pagEl.innerHTML = `
        <button class="btn btn-sm btn-secondary" ${pg.page<=1?'disabled':''} onclick="state.memberFilters.page--; loadMembersTable()">‹ Prev</button>
        <span style="font-size:12px;color:var(--text-muted)">Page ${pg.page} of ${pg.pages} (${pg.total} total)</span>
        <button class="btn btn-sm btn-secondary" ${pg.page>=pg.pages?'disabled':''} onclick="state.memberFilters.page++; loadMembersTable()">Next ›</button>
      `;
    } else {
      pagEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${pg?.total || 0} members</span>`;
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
    a.download = `w4trc-members-${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast('Export failed: ' + e.message, 'error'); }
}

const MEMBER_TABS = [['info', 'Info'], ['dues', 'Dues History'], ['donations', 'Donations'], ['notes', 'Notes']];

// A member's own page. Called again after a save, it redraws in place and
// stays on the tab the officer was using.
async function viewMember(id, tab) {
  const same = state.currentPage === 'member' && state.memberId === id;
  if (tab) state.memberTab = tab;
  else if (!same) state.memberTab = 'info';
  if (!MEMBER_TABS.some(([k]) => k === state.memberTab)) state.memberTab = 'info';
  state.currentPage = 'member';
  state.memberId = id;
  pageUrl(adminPath('members', id, state.memberTab));
  closeModal();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === 'members'));
  const back = '<button class="btn btn-secondary" onclick="nav(\'members\')">← All Members</button>';
  if (!same) {
    document.getElementById('page-title').textContent = 'Member';
    setTitle('Member');
    document.getElementById('topbar-actions').innerHTML = back;
    setPage('<div class="spinner"></div>');
  }
  const here = () => state.currentPage === 'member' && state.memberId === id;
  try {
    const m = await api('GET', '/members/' + id);
    if (!here()) return;
    const currentYear = new Date().getFullYear();
    const curMs = (m.memberships || []).find(ms => ms.year === currentYear);
    const renewalYear = duesYear();
    const renewalMs = (m.memberships || []).find(ms => ms.year === renewalYear);
    const name = (m.callsign ? m.callsign + ' — ' : '') + m.first_name + ' ' + m.last_name;
    const shown = k => (k === state.memberTab ? '' : 'hidden');

    document.getElementById('page-title').textContent = name;
    setTitle(name);
    document.getElementById('topbar-actions').innerHTML = back + `
      <button class="btn btn-secondary" onclick="lookupCallsign('${escHtml(m.callsign||'')}', ${m.id})" ${m.callsign?'':'disabled'}>↻ Sync License</button>
      <button class="btn btn-primary" onclick="openEditMember(${m.id})">Edit Member</button>`;

    const page = document.getElementById('page');
    const scroll = same ? page.scrollTop : 0;
    setPage(`
      <div class="card" style="max-width:900px">
      ${m.callsign_mismatch ? mismatchWarning(m) : ''}
      <div class="flex gap-16 align-center" style="margin-bottom:20px">
        <div>
          <div class="callsign" style="font-size:24px">${escHtml(m.callsign || '—')}</div>
          <div style="font-size:18px;font-weight:600">${escHtml(m.first_name)} ${escHtml(m.last_name)}</div>
        </div>
        <div class="spacer"></div>
        <div>
          ${memberStatusBadge(m.is_active, m.is_silent_key)}
          ${licenseBadge(m.license_class)}
        </div>
      </div>

      <div class="tabs">
        ${MEMBER_TABS.map(([k, label]) => `<div class="tab${k === state.memberTab ? ' active' : ''}" onclick="memberTab(this,'${k}')">${label}</div>`).join('')}
      </div>

      <!-- Info tab -->
      <div id="tab-info" class="${shown('info')}">
        <div class="detail-section">
          <h4>Contact</h4>
          <div class="detail-grid">
            ${dfield('Email', m.email)} ${dfield('Phone', m.phone)}
            ${dfield('Address', m.address)} ${dfield('City', m.city)}
            ${dfield('State', m.state)} ${dfield('ZIP', m.zip)}
          </div>
        </div>
        <div class="detail-section">
          <h4>License</h4>
          <div class="detail-grid">
            ${dfield('Class', m.license_class)} ${dfield('Expiry', m.license_expiry)}
            ${dfield('Status', m.license_status === 'A' ? 'Active' : m.license_status || '—')}
            ${dfield('Last Synced', m.hamdb_synced_at ? fmtDate(m.hamdb_synced_at) : 'Never')}
          </div>
        </div>
        <div class="detail-section">
          <h4>Membership</h4>
          <div class="detail-grid">
            ${dfield('Type', m.membership_type === 'lifetime_honorary' ? '<span class="badge badge-purple">Lifetime Honorary</span>' : m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : '<span class="badge badge-gray">Individual</span>')}
            ${dfield('Joined', m.joined_date)}
            ${dfield('ARRL Member', m.is_arrl_member ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>')}
            ${dfield('Eastman Member', m.is_eastman_member ? '<span class="badge badge-blue">Yes</span>' : '<span class="badge badge-gray">No</span>')}
            ${(m.credential_years || []).map(y => dfield(y + ' Certificate & Card',
              '<a href="/print/certificate?member_id=' + m.id + '&year=' + y + '" target="_blank" rel="noopener">Certificate</a> · ' +
              '<a href="/print/card?member_id=' + m.id + '&year=' + y + '" target="_blank" rel="noopener">Card</a>')).join('')}
            ${dfield(currentYear + ' Dues', curMs ? duesBadge(curMs.status, curMs.amount_paid, curMs.covered_by_member_id, curMs.payment_method) : '<span class="badge badge-yellow">No Record</span>')}
            ${renewalYear !== currentYear ? dfield(renewalYear + ' Dues', renewalMs ? duesBadge(renewalMs.status, renewalMs.amount_paid, renewalMs.covered_by_member_id, renewalMs.payment_method) : '<span class="badge badge-gray">Not Renewed</span>') : ''}
          </div>
        </div>
        ${m.emergency_name ? `<div class="detail-section"><h4>Emergency Contact</h4><div class="detail-grid">${dfield('Name', m.emergency_name)}${dfield('Phone', m.emergency_phone)}</div></div>` : ''}
        ${m.interests ? `<div class="detail-section"><h4>Interests / Modes</h4><p style="font-size:13px">${escHtml(m.interests)}</p></div>` : ''}
        ${m.bio ? `<div class="detail-section"><h4>Bio</h4><p style="font-size:13px">${escHtml(m.bio)}</p></div>` : ''}
      </div>

      <!-- Dues tab (hidden) -->
      <div id="tab-dues" class="${shown('dues')}">
        <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openAddDues(${m.id}, '${escHtml(m.first_name)} ${escHtml(m.last_name)}', '${m.membership_type}')">+ Record Payment</button>
        ${(m.memberships || []).length === 0 ? '<p class="text-muted">No membership records yet.</p>' :
          m.memberships.map(ms => `
            <div class="card" style="margin-bottom:8px;padding:12px">
              <div class="flex align-center gap-8">
                <strong>${ms.year}</strong>
                ${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id, ms.payment_method)}
                ${ms.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : ''}
                <div class="spacer"></div>
                <span style="font-size:12px;color:var(--text-muted)">${ms.payment_method || ''} ${ms.check_number ? '#'+ms.check_number : ''}</span>
                ${ms.paid_date ? `<span style="font-size:12px;color:var(--text-muted)">${ms.paid_date}</span>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="openEditDues(${ms.id}, ${m.id})">Edit</button>
              </div>
              ${ms.covered_by_first_name ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Covered under: ${ms.covered_by_callsign ? '<span class="callsign" style="font-size:12px">' + escHtml(ms.covered_by_callsign) + '</span> ' : ''}${escHtml(ms.covered_by_first_name)} ${escHtml(ms.covered_by_last_name)}</div>` : ''}
              ${ms.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escHtml(ms.notes)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>

      <!-- Donations tab (hidden) -->
      <div id="tab-donations" class="${shown('donations')}">
        <button class="btn btn-sm btn-primary" style="margin-bottom:12px" onclick="openAddDonation(${m.id}, '${escHtml(m.first_name)} ${escHtml(m.last_name)}')">+ Record Donation</button>
        ${(m.donations || []).length === 0 ? '<p class="text-muted">No donations recorded yet.</p>' :
          (m.donations || []).map(d => `
            <div class="card" style="margin-bottom:8px;padding:12px">
              <div class="flex align-center gap-8">
                ${d.donation_kind === 'monetary'
                  ? `<strong>$${Number(d.amount||0).toFixed(2)}</strong><span class="badge badge-green">Monetary</span>`
                  : `<strong>${escHtml(d.item_description||'Item')}</strong><span class="badge badge-blue">Item</span>${d.estimated_value != null ? `<span style="font-size:12px;color:var(--text-muted)">~$${Number(d.estimated_value).toFixed(2)}</span>` : ''}`
                }
                <div class="spacer"></div>
                ${d.payment_method ? `<span style="font-size:12px;color:var(--text-muted)">${escHtml(d.payment_method)}${d.check_number ? ' #'+escHtml(d.check_number) : ''}</span>` : ''}
                ${d.donation_date ? `<span style="font-size:12px;color:var(--text-muted)">${escHtml(d.donation_date)}</span>` : ''}
                <button class="btn btn-sm btn-secondary" onclick="openEditDonation(${d.id}, ${m.id})">Edit</button>
              </div>
              ${d.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escHtml(d.notes)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>

      <!-- Notes tab (hidden) -->
      <div id="tab-notes" class="${shown('notes')}">
        <div class="form-group" style="margin-bottom:12px">
          <textarea id="new-note" placeholder="Add a note about this member…"></textarea>
        </div>
        <button class="btn btn-sm btn-primary" onclick="addNote(${m.id})">Add Note</button>
        <div class="divider"></div>
        <div id="notes-list">
          ${(m.notes || []).length === 0 ? '<p class="text-muted">No notes yet.</p>' :
            m.notes.map(n => `
              <div class="note-item">
                <div class="note-meta">${escHtml(n.author_email || 'Unknown')} · ${fmtDate(n.created_at)} ${n.is_private ? '🔒' : ''}</div>
                <div class="note-text">${escHtml(n.note_text)}</div>
              </div>
            `).join('')
          }
        </div>
      </div>
      </div>
    `);
    page.scrollTop = scroll;
  } catch(e) {
    if (here()) setPage('<p class="text-muted" style="padding:24px">Error: ' + escHtml(e.data?.error || e.message) + '</p>');
  }
}

function memberTab(el, key) {
  state.memberTab = key;
  pageUrl(adminPath('members', state.memberId, key), true);
  switchTab(el, 'tab-' + key);
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
  showModal(`
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
      ${fi('First Name','f-first_name','','text','',true)}
      ${fi('Last Name','f-last_name','','text','',true)}
      ${fi('Email','f-email','','email')}
      ${fi('Phone','f-phone','')}
      ${fi('Address','f-address','')}
      ${fi('City','f-city','')}
      ${fi('State','f-state','','text','2-letter state code')}
      ${fi('ZIP','f-zip','')}
      ${fi('License Class','f-license_class','','select')}
      ${fi('License Expiry','f-license_expiry','','date')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="f-membership_type" onchange="updateAmtDue()">
          <option value="individual">Individual ($20/yr)</option>
          <option value="family">Family ($30/yr)</option>
          <option value="lifetime_honorary">Lifetime Honorary (no dues)</option>
        </select>
      </div>
      ${fi('Joined Date','f-joined_date',localToday(),'date')}
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
        <span>Create ${new Date().getFullYear()} membership record and mark paid</span>
      </label>
      <div id="f-ms-fields" style="margin-top:12px" hidden>
        <div class="form-grid">
          ${fi('Amount Paid','f-amount_paid','20.00','number')}
          ${fi('Payment Date','f-paid_date',localToday(),'date')}
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
          ${fi('Check Number','f-check_number','')}
        </div>
      </div>
    </div>
    ${fi('Notes (optional)','f-bio','','textarea')}
  `, 'Add New Member', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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
  showModal(`
    <div class="form-grid">
      ${fi('Callsign','e-callsign',m.callsign||'')}
      <div></div>
      ${fi('First Name','e-first_name',m.first_name||'')}
      ${fi('Last Name','e-last_name',m.last_name||'')}
      ${fi('Email','e-email',m.email||'')}
      ${fi('Phone','e-phone',m.phone||'')}
      ${fi('Address','e-address',m.address||'')}
      ${fi('City','e-city',m.city||'')}
      ${fi('State','e-state',m.state||'')}
      ${fi('ZIP','e-zip',m.zip||'')}
      ${fi('License Class','e-license_class',m.license_class||'','select')}
      ${fi('License Expiry','e-license_expiry',m.license_expiry||'','date')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="e-membership_type">
          <option value="individual"        ${m.membership_type==='individual'?'selected':''}>Individual ($20/yr)</option>
          <option value="family"            ${m.membership_type==='family'?'selected':''}>Family ($30/yr)</option>
          <option value="lifetime_honorary" ${m.membership_type==='lifetime_honorary'?'selected':''}>Lifetime Honorary (no dues)</option>
        </select>
      </div>
      ${fi('Joined Date','e-joined_date',m.joined_date||'','date')}
      <div class="form-group">
        <label>Status</label>
        <select id="e-member_status">
          <option value="active"     ${m.is_active && !m.is_silent_key ? 'selected' : ''}>Active</option>
          <option value="inactive"   ${!m.is_active && !m.is_silent_key ? 'selected' : ''}>Inactive</option>
          <option value="silent_key" ${m.is_silent_key ? 'selected' : ''}>Silent Key (SK)</option>
        </select>
      </div>
      ${fi('Emergency Contact Name','e-emergency_name',m.emergency_name||'')}
      ${fi('Emergency Phone','e-emergency_phone',m.emergency_phone||'')}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:12px">
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="e-is_arrl_member" style="width:auto" ${m.is_arrl_member ? 'checked' : ''}>
        <span>ARRL Member</span>
      </label>
      <label style="display:inline-flex;gap:8px;align-items:center;cursor:pointer">
        <input type="checkbox" id="e-is_eastman_member" style="width:auto" ${m.is_eastman_member ? 'checked' : ''}>
        <span>Eastman Member</span>
      </label>
    </div>
    <div class="form-group mt-16">
      <label>Bio / Notes</label>
      <textarea id="e-bio">${escHtml(m.bio||'')}</textarea>
    </div>
    <div class="form-group mt-8">
      <label>Interests</label>
      <input type="text" id="e-interests" value="${escHtml(m.interests||'')}" placeholder="DX, CW, VHF contesting…">
    </div>
  `, 'Edit: ' + m.first_name + ' ' + m.last_name + (m.callsign ? ' (' + m.callsign + ')' : ''), [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-secondary" onclick="nav(\'reminders\')">✉ Renewal Reminders</button>';
  setPage('<div class="spinner"></div>');
  const yr = new Date().getFullYear();
  const years = [yr, yr-1, yr-2, yr-3];
  if (duesYear() > yr) years.unshift(yr + 1); // renewal season: next year's dues are coming in

  setPage(`
    <div class="year-row">
      ${years.map(y => `<div class="year-pill ${y===state.memberYear?'active':''}" onclick="state.memberYear=${y};loadDuesTable()">${y}</div>`).join('')}
    </div>
    <div id="dues-stats" class="stat-grid"></div>
    <div class="flex gap-8 align-center" style="margin-bottom:16px">
      <span style="font-size:13px;color:var(--text-muted)" id="dues-count"></span>
      <div class="spacer"></div>
    </div>
    <div class="card" style="padding:0">
      <div id="dues-table"><div class="spinner"></div></div>
    </div>
  `);
  loadDuesTable();
}

async function loadDuesTable() {
  const yr = state.memberYear;
  if (state.currentPage === 'memberships') pageUrl(adminPath('memberships') + pageQuery('memberships'), true);
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
  document.getElementById('dues-stats').innerHTML = `
    <div class="stat-card"><div class="stat-val">${st.active_count||0}</div><div class="stat-label">Paid Members</div></div>
    <div class="stat-card"><div class="stat-val">${st.honorary_count||0}</div><div class="stat-label">Honorary</div></div>
    <div class="stat-card"><div class="stat-val">$${Number(st.total_collected||0).toFixed(2)}</div><div class="stat-label">Collected</div></div>
    <div class="stat-card"><div class="stat-val">${st.individual_count||0}</div><div class="stat-label">Individual</div></div>
    <div class="stat-card"><div class="stat-val">${st.family_count||0}</div><div class="stat-label">Family</div></div>
  `;

  const list = duesData.memberships || [];
  document.getElementById('dues-count').textContent = list.length + ' records for ' + yr;

  document.getElementById('dues-table').innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No membership records for ' + yr + '.</p>'
    : `<div class="tbl-wrap"><table>
        <thead><tr><th>Callsign</th><th>Name</th><th>Type</th><th>Status</th><th>Due</th><th>Paid</th><th>Method</th><th>Check #</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${list.map(ms => `<tr>
            <td><span class="callsign">${escHtml(ms.callsign||'—')}</span></td>
            <td>
              ${escHtml(ms.first_name)} ${escHtml(ms.last_name)}
              ${ms.covered_by_first_name ? `<div style="font-size:11px;color:var(--text-muted)">Covered under: ${ms.covered_by_callsign ? escHtml(ms.covered_by_callsign) + ' ' : ''}${escHtml(ms.covered_by_first_name)} ${escHtml(ms.covered_by_last_name)}</div>` : ''}
            </td>
            <td>${ms.membership_type==='family'?'<span class="badge badge-blue">Family</span>':'<span class="badge badge-gray">Individual</span>'}</td>
            <td>${duesBadge(ms.status, ms.amount_paid, ms.covered_by_member_id, ms.payment_method)}</td>
            <td>$${ms.covered_by_member_id ? '0.00' : Number(ms.amount_due||0).toFixed(2)}</td>
            <td>${ms.amount_paid != null ? '$' + Number(ms.amount_paid).toFixed(2) : '<span class="text-muted">—</span>'}</td>
            <td>${escHtml(ms.payment_method||'—')}</td>
            <td>${escHtml(ms.check_number||'—')}</td>
            <td style="color:var(--text-muted)">${ms.paid_date||'—'}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="openEditDues(${ms.id})">Edit</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
}

async function openAddDues(memberId, memberName, memberType) {
  const yr = new Date().getFullYear();
  const isLifetimeHonorary = memberType === 'lifetime_honorary';
  let memberOpts = '<option value="">— None (primary payer) —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .filter(x => x.id !== memberId)
      .map(x => `<option value="${x.id}">${x.callsign ? escHtml(x.callsign) + ' — ' : ''}${escHtml(x.first_name)} ${escHtml(x.last_name)}</option>`)
      .join('');
  } catch {}
  showModal(`
    <div class="form-grid">
      <div class="form-group"><label>Member</label><input type="text" value="${escHtml(memberName)}" disabled></div>
      ${fi('Year','d-year',yr,'number')}
      <div class="form-group">
        <label>Membership Type</label>
        <select id="d-membership_type" onchange="updateDueAmt()">
          <option value="individual">Individual ($20.00)</option>
          <option value="family">Family ($30.00)</option>
        </select>
      </div>
      <div class="form-group" id="d-covered-by-wrap" hidden>
        <label>Covered under (optional)</label>
        <select id="d-covered_by_member_id" onchange="onCoveredByChange()">${memberOpts}</select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="d-status">
          <option value="active" ${!isLifetimeHonorary?'selected':''}>Active</option>
          <option value="honorary" ${isLifetimeHonorary?'selected':''}>Honorary</option>
          <option value="waived">Waived</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      ${fi('Amount Due','d-amount_due',isLifetimeHonorary?'0.00':'20.00','number')}
      ${fi('Amount Paid','d-amount_paid','','number')}
      ${fi('Payment Date','d-paid_date','','date')}
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
      ${fi('Check Number','d-check_number','')}
    </div>
    ${fi('Notes','d-notes','','textarea')}
  `, 'Record Membership Payment', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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
      .map(x => `<option value="${x.id}" ${ms.covered_by_member_id===x.id?'selected':''}>${x.callsign ? escHtml(x.callsign) + ' — ' : ''}${escHtml(x.first_name)} ${escHtml(x.last_name)}</option>`)
      .join('');
  } catch {}
  showModal(`
    <div class="form-grid">
      <div class="form-group">
        <label>Status</label>
        <select id="ed-status">
          ${['active','expired','honorary','pending','waived'].map(s => `<option value="${s}" ${ms.status===s?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Membership Type</label>
        <select id="ed-membership_type" onchange="updateEditDueAmt()">
          <option value="individual" ${ms.membership_type==='individual'?'selected':''}>Individual ($20.00)</option>
          <option value="family"     ${ms.membership_type==='family'?'selected':''}>Family ($30.00)</option>
        </select>
      </div>
      <div class="form-group" id="ed-covered-by-wrap" ${ms.membership_type==='family'?'':'hidden'}>
        <label>Covered under (optional)</label>
        <select id="ed-covered_by_member_id" onchange="onEditCoveredByChange()">${memberOpts}</select>
      </div>
      ${fi('Amount Due','ed-amount_due',ms.amount_due||'','number')}
      ${fi('Amount Paid','ed-amount_paid',ms.amount_paid||'','number')}
      ${fi('Payment Date','ed-paid_date',ms.paid_date||'','date')}
      <div class="form-group">
        <label>Payment Method</label>
        <select id="ed-payment_method">
          <option value="">— Select —</option>
          ${['cash','check','paypal','stripe','eastman','other'].map(m => `<option value="${m}" ${ms.payment_method===m?'selected':''}>${m === 'stripe' ? 'Stripe (Online)' : m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('')}
        </select>
      </div>
      ${fi('Check Number','ed-check_number',ms.check_number||'')}
    </div>
    ${fi('Notes','ed-notes',ms.notes||'','textarea')}
  `, 'Edit Membership Record – ' + ms.year, [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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

  setPage(`
    <div class="flex gap-8 align-center" style="margin-bottom:16px">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="openAddDonation(null, null)">+ Record Donation</button>
    </div>
    <div id="don-stats" class="stat-grid" style="margin-bottom:16px"></div>
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <select id="don-filter-year" style="width:120px" onchange="loadDonationsTable()">
        <option value="">All Time</option>
        ${[yr, yr-1, yr-2, yr-3].map(y => `<option value="${y}" ${y===yr?'selected':''}>${y}</option>`).join('')}
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
  `);
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
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-val">${st.total_count||0}</div><div class="stat-label">Total Donations</div></div>
    <div class="stat-card"><div class="stat-val">$${Number(st.total_monetary||0).toFixed(2)}</div><div class="stat-label">Cash Collected</div></div>
    <div class="stat-card"><div class="stat-val">${st.item_count||0}</div><div class="stat-label">Item Donations</div></div>
    <div class="stat-card"><div class="stat-val">${st.member_donor_count||0}</div><div class="stat-label">Member Donors</div></div>
    <div class="stat-card"><div class="stat-val">${st.org_donor_count||0}</div><div class="stat-label">Org Donors</div></div>
  `;

  const list = donData.donations || [];
  const countEl = document.getElementById('don-count');
  if (countEl) countEl.textContent = list.length + ' record' + (list.length !== 1 ? 's' : '');

  document.getElementById('don-table').innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No donations recorded yet.</p>'
    : `<div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Donor</th><th>Type</th><th>Kind</th><th>Amount / Item</th><th>Method</th><th>Check #</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          ${list.map(d => `<tr>
            <td style="color:var(--text-muted)">${escHtml(d.donation_date||'—')}</td>
            <td>${donorLabel(d)}</td>
            <td>${donorTypeBadge(d.donor_type)}</td>
            <td>${donationKindBadge(d.donation_kind)}</td>
            <td>
              ${d.donation_kind === 'monetary'
                ? `<strong>$${Number(d.amount||0).toFixed(2)}</strong>`
                : `${escHtml(d.item_description||'—')}${d.estimated_value != null ? ` <span style="font-size:11px;color:var(--text-muted)">(~$${Number(d.estimated_value).toFixed(2)})</span>` : ''}`
              }
            </td>
            <td>${escHtml(d.payment_method||'—')}</td>
            <td>${escHtml(d.check_number||'—')}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${escHtml(d.notes||'')}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="openEditDonation(${d.id}, null)">Edit</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
}

function donorLabel(d) {
  if (d.donor_type === 'member') {
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ') || '—';
    return d.callsign
      ? `<span class="callsign">${escHtml(d.callsign)}</span> ${escHtml(name)}`
      : escHtml(name);
  }
  if (d.donor_type === 'organization') return escHtml(d.organization_name || '—');
  if (d.donor_type === 'individual') {
    return escHtml(d.donor_name || '—')
      + (d.donor_email ? ` <span style="font-size:11px;color:var(--text-muted)">${escHtml(d.donor_email)}</span>` : '');
  }
  return '<span class="text-muted">Anonymous</span>';
}

function donorTypeBadge(type) {
  if (type === 'member')       return '<span class="badge badge-green">Member</span>';
  if (type === 'individual')   return '<span class="badge badge-purple">Individual</span>';
  if (type === 'organization') return '<span class="badge badge-blue">Organization</span>';
  return '<span class="badge badge-gray">Anonymous</span>';
}

function donationKindBadge(kind) {
  if (kind === 'monetary') return '<span class="badge badge-yellow">Monetary</span>';
  if (kind === 'item')     return '<span class="badge badge-purple">Item</span>';
  return '<span class="badge badge-gray">' + escHtml(kind||'—') + '</span>';
}

async function openAddDonation(memberId, memberName) {
  const today = localToday();
  let memberOpts = '<option value="">— Select Member —</option>';
  try {
    const data = await api('GET', '/members?status=active');
    memberOpts += (data.members || [])
      .map(x => `<option value="${x.id}" ${x.id===memberId?'selected':''}>${x.callsign ? escHtml(x.callsign) + ' — ' : ''}${escHtml(x.first_name)} ${escHtml(x.last_name)}</option>`)
      .join('');
  } catch {}

  showModal(`
    <div class="form-grid">
      <div class="form-group">
        <label>Donor Type</label>
        <select id="dn-donor_type" onchange="onDonorTypeChange()">
          <option value="member" ${memberId?'selected':''}>Member</option>
          <option value="individual">Individual (non-member)</option>
          <option value="organization" ${!memberId?'selected':''}>Organization</option>
          <option value="anonymous">Anonymous</option>
        </select>
      </div>
      <div class="form-group" id="dn-member-wrap" ${memberId?'':'hidden'}>
        <label>Member</label>
        <select id="dn-member_id">${memberOpts}</select>
      </div>
      <div class="form-group" id="dn-name-wrap" hidden>
        <label>Donor Name</label>
        <input type="text" id="dn-donor_name" maxlength="100">
      </div>
      <div class="form-group" id="dn-email-wrap" hidden>
        <label>Donor Email (optional)</label>
        <input type="email" id="dn-donor_email">
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
      ${fi('Donation Date','dn-donation_date',today,'date')}
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
      ${fi('Check Number','dn-check_number','')}
    </div>
    ${fi('Notes','dn-notes','','textarea')}
  `, 'Record Donation', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save', cls: 'btn-primary', fn: 'saveDonation(' + (memberId || 'null') + ')' },
  ]);
  onDonorTypeChange();
}

function onDonorTypeChange() {
  const type = document.getElementById('dn-donor_type')?.value;
  const memberWrap = document.getElementById('dn-member-wrap');
  const orgWrap    = document.getElementById('dn-org-wrap');
  const methodWrap = document.getElementById('dn-method-wrap');
  const nameWrap   = document.getElementById('dn-name-wrap');
  const emailWrap  = document.getElementById('dn-email-wrap');
  if (memberWrap) memberWrap.hidden = type !== 'member';
  if (orgWrap)    orgWrap.hidden    = type !== 'organization';
  if (nameWrap)   nameWrap.hidden   = type !== 'individual';
  if (emailWrap)  emailWrap.hidden  = type !== 'individual';
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
    donor_name:        donorType === 'individual'   ? (gv('dn-donor_name') || null) : null,
    donor_email:       donorType === 'individual'   ? (gv('dn-donor_email') || null) : null,
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
      .map(x => `<option value="${x.id}" ${d.member_id===x.id?'selected':''}>${x.callsign ? escHtml(x.callsign) + ' — ' : ''}${escHtml(x.first_name)} ${escHtml(x.last_name)}</option>`)
      .join('');
  } catch {}

  showModal(`
    <div class="form-grid">
      <div class="form-group">
        <label>Donor Type</label>
        <select id="edn-donor_type" onchange="onEditDonorTypeChange()">
          ${['member','individual','organization','anonymous'].map(t => `<option value="${t}" ${d.donor_type===t?'selected':''}>${t==='individual'?'Individual (non-member)':t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" id="edn-member-wrap" ${d.donor_type==='member'?'':'hidden'}>
        <label>Member</label>
        <select id="edn-member_id">${memberOpts}</select>
      </div>
      <div class="form-group" id="edn-name-wrap" ${d.donor_type==='individual'?'':'hidden'}>
        <label>Donor Name</label>
        <input type="text" id="edn-donor_name" maxlength="100" value="${escHtml(d.donor_name||'')}">
      </div>
      <div class="form-group" id="edn-email-wrap" ${d.donor_email||d.donor_type==='individual'?'':'hidden'}>
        <label>Donor Email (optional)</label>
        <input type="email" id="edn-donor_email" value="${escHtml(d.donor_email||'')}">
      </div>
      <div class="form-group" id="edn-org-wrap" ${d.donor_type==='organization'?'':'hidden'}>
        <label>Organization Name</label>
        <input type="text" id="edn-organization_name" value="${escHtml(d.organization_name||'')}">
      </div>
      <div class="form-group">
        <label>Donation Kind</label>
        <select id="edn-donation_kind" onchange="onEditDonationKindChange()">
          <option value="monetary" ${d.donation_kind==='monetary'?'selected':''}>Monetary</option>
          <option value="item"     ${d.donation_kind==='item'?'selected':''}>Item</option>
        </select>
      </div>
      <div class="form-group" id="edn-amount-wrap" ${d.donation_kind==='monetary'?'':'hidden'}>
        <label>Amount ($)</label>
        <input type="number" id="edn-amount" value="${escHtml(String(d.amount??''))}" step="0.01" min="0">
      </div>
      <div class="form-group" id="edn-item-wrap" ${d.donation_kind==='item'?'':'hidden'}>
        <label>Item Description</label>
        <input type="text" id="edn-item_description" value="${escHtml(d.item_description||'')}">
      </div>
      <div class="form-group" id="edn-estval-wrap" ${d.donation_kind==='item'?'':'hidden'}>
        <label>Estimated Value ($)</label>
        <input type="number" id="edn-estimated_value" value="${escHtml(String(d.estimated_value??''))}" step="0.01" min="0">
      </div>
      ${fi('Donation Date','edn-donation_date',d.donation_date||'','date')}
      <div class="form-group" id="edn-method-wrap" ${d.donation_kind==='monetary'?'':'hidden'}>
        <label>Payment Method</label>
        <select id="edn-payment_method">
          <option value="">— Select —</option>
          ${['cash','check','paypal','stripe','other'].map(m => `<option value="${m}" ${d.payment_method===m?'selected':''}>${m==='stripe'?'Stripe (Online)':m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('')}
        </select>
      </div>
      ${fi('Check Number','edn-check_number',d.check_number||'')}
    </div>
    ${fi('Notes','edn-notes',d.notes||'','textarea')}
  `, 'Edit Donation', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Delete', cls: 'btn-danger',    fn: 'deleteDonation(' + id + ',' + (memberId||'null') + ')' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'updateDonation(' + id + ',' + (memberId||'null') + ')' },
  ]);
}

function onEditDonorTypeChange() {
  const type = document.getElementById('edn-donor_type')?.value;
  const mw = document.getElementById('edn-member-wrap');
  const ow = document.getElementById('edn-org-wrap');
  const nw = document.getElementById('edn-name-wrap');
  const ew = document.getElementById('edn-email-wrap');
  if (mw) mw.hidden = type !== 'member';
  if (ow) ow.hidden = type !== 'organization';
  if (nw) nw.hidden = type !== 'individual';
  // An anonymous online donor still has a receipt email on file, so keep it visible
  if (ew) ew.hidden = type !== 'individual' && !gv('edn-donor_email');
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
    donor_name:        donorType === 'individual'   ? (gv('edn-donor_name') || null) : null,
    donor_email:       gv('edn-donor_email') || null,
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
  setPage(`
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <select id="att-filter-year" style="width:120px" onchange="loadMeetingsTable()">
        <option value="">All Time</option>
        ${[yr, yr-1, yr-2, yr-3].map(y => `<option value="${y}" ${y===yr?'selected':''}>${y}</option>`).join('')}
      </select>
      <span style="font-size:13px;color:var(--text-muted)" id="att-count"></span>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" onclick="openMeetingForm()">+ Record Meeting</button>
    </div>
    <div class="card" style="padding:0">
      <div id="att-table"><div class="spinner"></div></div>
    </div>
  `);
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
    : `<div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Meeting</th><th>Members</th><th>Visiting Hams</th><th>Non-Hams</th><th>Total</th><th></th></tr></thead>
        <tbody>
          ${list.map(mt => `<tr style="cursor:pointer" onclick="openMeeting(${mt.id})">
            <td style="color:var(--text-muted)">${escHtml(fmtDay(mt.meeting_date))}</td>
            <td><a class="row-link" href="${adminPath('attendance', mt.id)}">${meetingLabel(mt)}</a></td>
            <td>${mt.member_count || 0}</td>
            <td>${mt.visitor_count || 0}</td>
            <td>${mt.guest_count || 0}</td>
            <td><strong>${mt.total_count || 0}</strong></td>
            <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openMeeting(${mt.id})">View</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
}

function attendeeRow(a) {
  const call = a.callsign ? `<span class="callsign">${escHtml(a.callsign)}</span> ` : '';
  return `<div style="padding:6px 0;border-bottom:1px solid var(--border)">${call}${escHtml(a.name || '')}${!a.name && a.callsign ? '<span class="text-muted">(name unknown)</span>' : ''}</div>`;
}

async function openMeeting(id) {
  let data;
  try { data = await api('GET', '/meetings/' + id); }
  catch(e) { toast(e.data?.error || 'Failed to load meeting', 'error'); return; }
  setUrl(adminPath('attendance', id), true);

  const mt = data.meeting;
  const att = data.attendees || [];
  const members  = att.filter(a => a.member_id);
  const visitors = att.filter(a => !a.member_id && a.callsign);
  const guests   = att.filter(a => !a.callsign);
  const section = (label, rows) => rows.length ? `
    <div style="margin-top:16px">
      <div style="font-weight:600;margin-bottom:4px">${label} <span class="badge badge-gray">${rows.length}</span></div>
      ${rows.map(attendeeRow).join('')}
    </div>` : '';

  const buttons = [
    { label: 'Close', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Edit',  cls: 'btn-primary',   fn: 'editMeeting(' + id + ')' },
  ];
  if (mt.agenda_id) buttons.splice(1, 0, { label: 'Open Agenda', cls: 'btn-secondary', fn: 'closeModal();openAgenda(' + mt.agenda_id + ')' });
  if (state.user?.role === 'admin') buttons.unshift({ label: 'Delete', cls: 'btn-danger', fn: 'deleteMeeting(' + id + ')' });

  showModal(`
    <div style="color:var(--text-muted)">${escHtml(fmtDay(mt.meeting_date))} — ${meetingLabel(mt)}</div>
    <div style="font-size:22px;font-weight:700;margin-top:6px">${att.length} attendee${att.length !== 1 ? 's' : ''}</div>
    ${mt.notes ? `<p style="margin-top:8px;color:var(--text-muted)">${escHtml(mt.notes)}</p>` : ''}
    ${section('Members', members)}
    ${section('Visiting Hams', visitors)}
    ${section('Non-Hams', guests)}
    ${att.length === 0 ? '<p class="text-muted" style="margin-top:16px">No attendees recorded.</p>' : ''}
  `, 'Meeting Attendance', buttons);
}

async function editMeeting(id) {
  try {
    const data = await api('GET', '/meetings/' + id);
    openMeetingForm(data.meeting, data.attendees || []);
  } catch(e) { toast(e.data?.error || 'Failed to load meeting', 'error'); }
}

function openMeetingForm(mt = null, attendees = []) {
  const today = localToday();
  const calls  = attendees.filter(a => a.callsign).map(a => a.callsign).join('\n');
  const guests = attendees.filter(a => !a.callsign).map(a => a.name).join('\n');
  const type   = mt?.meeting_type || 'monthly';

  showModal(`
    <div class="form-grid">
      <div class="form-group">
        <label>Meeting *</label>
        <select id="mt-type">
          ${Object.entries(MEETING_TYPES).map(([k, v]) => `<option value="${k}" ${k===type?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      ${fi('Date', 'mt-date', mt?.meeting_date || today, 'date', '', true)}
      <div class="form-group full">
        <label>Title (optional)</label>
        <input type="text" id="mt-title" value="${escHtml(mt?.title || '')}" placeholder="e.g. Christmas Party, Antenna Workshop">
      </div>
      <div class="form-group full">
        <label>Callsigns</label>
        <textarea id="mt-callsigns" rows="5" placeholder="Type or paste callsigns, separated by spaces, commas, or new lines" oninput="queueCallsignPreview()" style="font-family:var(--mono);text-transform:uppercase">${escHtml(calls)}</textarea>
        <div id="mt-preview" style="margin-top:8px;font-size:13px"></div>
      </div>
      <div class="form-group full">
        <label>Non-Ham Attendees</label>
        <textarea id="mt-guests" rows="3" placeholder="One name per line">${escHtml(guests)}</textarea>
      </div>
    </div>
    ${fi('Notes', 'mt-notes', mt?.notes || '', 'textarea')}
  `, mt ? 'Edit Meeting' : 'Record Meeting', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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
    el.innerHTML = list.length === 0 ? '<span class="text-muted">No valid callsigns yet.</span>' : `
      <div style="color:var(--text-muted);margin-bottom:4px">
        ${list.length} ham${list.length !== 1 ? 's' : ''}${unknown ? ` — <span style="color:var(--danger)">${unknown} not found, check spelling</span>` : ''}
      </div>
      ${list.map(a => `<div style="padding:3px 0"><span class="callsign">${escHtml(a.callsign)}</span> ${escHtml(a.name || '')} ${ATTENDEE_SOURCE_BADGE[a.source] || ''}</div>`).join('')}
    `;
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
    toast(`Meeting saved — ${n} attendee${n !== 1 ? 's' : ''} ✓`);
    closeModal();
    if (state.currentPage === 'attendance') loadMeetingsTable();
    if (state.currentPage === 'agenda') reloadAgenda();
  } catch(e) { toast(e.data?.error || 'Failed to save meeting', 'error'); }
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting, its attendance list, and its agenda if it has one? This cannot be undone.')) return;
  try {
    await api('DELETE', '/meetings/' + id);
    toast('Meeting deleted');
    closeModal();
    if (state.currentPage === 'attendance') loadMeetingsTable();
    if (state.currentPage === 'agenda') nav('agendas');
  } catch(e) { toast(e.data?.error || 'Failed to delete meeting', 'error'); }
}

// ── AGENDAS ───────────────────────────────────────────────────────────
// One agenda per meeting. Every field saves on its own when it changes, so
// officers filling in different parts at the same time do not overwrite
// each other. Refresh (or coming back to the tab) shows everyone's changes.
const AG_STATUS  = { open: 'Open', resolved: 'Resolved', tabled: 'Tabled' };
const AG_RESULTS = { passed: 'Passed', failed: 'Failed', tabled: 'Tabled', withdrawn: 'Withdrawn' };
let agPending = []; // saves still in flight, so a reload waits for them

function agClock(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
}

function agMoney(n) { return '$' + Number(n || 0).toFixed(2); }

function agStatusBadge(a, today) {
  if (a.adjourned_at || a.meeting_date < today) return '<span class="badge badge-gray">Held</span>';
  if (a.meeting_date === today) return '<span class="badge badge-green">Today</span>';
  return '<span class="badge badge-blue">Upcoming</span>';
}

async function agendas() {
  document.getElementById('topbar-actions').innerHTML = '<button class="btn btn-primary" onclick="openNewAgenda()">+ New Agenda</button>';
  setPage(`
    <div class="card" style="padding:0"><div id="ag-table"><div class="spinner"></div></div></div>
    <p class="text-muted" style="font-size:12px">Officers fill in their reports and business ahead of time, and the presiding officer checks things off during the meeting. Business still open carries over to the next agenda of the same kind.</p>
  `);
  let data;
  try { data = await api('GET', '/agendas'); }
  catch(e) {
    const el = document.getElementById('ag-table');
    if (el) el.innerHTML = '<p class="text-muted" style="padding:24px;text-align:center">Failed to load agendas.</p>';
    toast(e.data?.error || e.message || 'Failed to load agendas', 'error');
    return;
  }
  const el = document.getElementById('ag-table');
  if (!el) return;
  const today = localToday();
  const list = data.agendas || [];
  // Upcoming meetings soonest first, then past meetings newest first
  const upcoming = list.filter(a => a.meeting_date >= today).reverse();
  const past = list.filter(a => a.meeting_date < today);
  const none = '<span class="text-muted">—</span>';
  const row = a => `<tr style="cursor:pointer" onclick="openAgenda(${a.id})">
      <td style="color:var(--text-muted);white-space:nowrap">${escHtml(fmtDay(a.meeting_date))}</td>
      <td><a class="row-link" href="${adminPath('agendas', a.id)}">${meetingLabel(a)}</a></td>
      <td>${a.business_count ? a.business_count + (a.open_count ? ' <span class="text-muted">(' + a.open_count + ' open)</span>' : '') : none}</td>
      <td>${a.motion_count || none}</td>
      <td>${a.attendee_count || none}</td>
      <td>${agStatusBadge(a, today)}</td>
    </tr>`;
  el.innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">No agendas yet. Start one for the next meeting.</p>'
    : `<div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Meeting</th><th>Business</th><th>Motions</th><th>Attendance</th><th></th></tr></thead>
        <tbody>${upcoming.map(row).join('')}${past.map(row).join('')}</tbody>
      </table></div>`;
}

function openNewAgenda() {
  showModal(`
    <div class="form-grid">
      <div class="form-group">
        <label>Meeting *</label>
        <select id="ag-type">${Object.entries(MEETING_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      </div>
      ${fi('Date', 'ag-date', localToday(), 'date', '', true)}
      ${fi('Start time', 'ag-start', '', 'time')}
      ${fi('Location', 'ag-location', '')}
      <div class="form-group full">
        <label>Title (optional)</label>
        <input type="text" id="ag-title" placeholder="e.g. Christmas Party, Annual Elections">
      </div>
    </div>
    <p class="form-hint" style="margin-top:12px">Board meetings get a shorter checklist, without the pledge, prayer, and presentation. Business still open on the last agenda of the same kind is carried over. If the meeting is already recorded under Attendance, the agenda is added to it.</p>
  `, 'New Agenda', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Create', cls: 'btn-primary',   fn: 'createAgenda()' },
  ]);
}

async function createAgenda() {
  const body = {
    meeting_type: gv('ag-type'), meeting_date: gv('ag-date'), start_time: gv('ag-start'),
    location: gv('ag-location'), title: gv('ag-title'),
  };
  if (!body.meeting_date) { toast('Date is required', 'error'); return; }
  try {
    const data = await api('POST', '/agendas', body);
    closeModal();
    const carried = data.items.filter(i => i.carried_from_id).length;
    toast('Agenda created' + (carried ? ' — ' + carried + ' item' + (carried !== 1 ? 's' : '') + ' carried over' : '') + ' ✓');
    showAgenda(data);
  } catch(e) {
    if (e.status === 409 && e.data?.agenda_id) {
      closeModal();
      toast('That meeting already has an agenda', 'warn');
      openAgenda(e.data.agenda_id);
      return;
    }
    toast(e.data?.error || 'Failed to create agenda', 'error');
  }
}

async function openAgenda(id) {
  state.currentPage = 'agenda';
  pageUrl(adminPath('agendas', id));
  document.getElementById('topbar-actions').innerHTML = '';
  setPage('<div class="spinner"></div>');
  try { showAgenda(await api('GET', '/agendas/' + id)); }
  catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); }
}

async function reloadAgenda() {
  if (state.currentPage !== 'agenda' || !state.agenda) return;
  await Promise.allSettled(agPending);
  try { showAgenda(await api('GET', '/agendas/' + state.agenda.agenda.id)); }
  catch(e) { toast(e.data?.error || 'Failed to reload the agenda', 'error'); }
}

function showAgenda(data) {
  state.currentPage = 'agenda';
  state.agenda = data;
  const a = data.agenda;
  pageUrl(adminPath('agendas', a.id));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === 'agendas'));
  document.getElementById('page-title').textContent = (MEETING_TYPES[a.meeting_type] || 'Meeting') + ' Agenda';
  setTitle((MEETING_TYPES[a.meeting_type] || 'Meeting') + ' Agenda ' + a.meeting_date);
  document.getElementById('topbar-actions').innerHTML = `
    <span id="ag-saved" class="text-muted" style="font-size:12px"></span>
    <button class="btn btn-secondary" onclick="nav('agendas')">← All Agendas</button>
    <button class="btn btn-secondary" onclick="reloadAgenda()" title="Show changes other officers have made">↻ Refresh</button>
    <button class="btn btn-secondary" onclick="window.open('/print/agenda?id=${a.id}', '_blank')">🖨 Print</button>`;
  const page = document.getElementById('page');
  const scroll = page.scrollTop;
  setPage(agPageHtml(data));
  page.scrollTop = scroll;
}

function agPageHtml(data) {
  const a = data.agenda;
  const att = data.attendance;
  const checks = new Map(data.checks.map(c => [c.step, c]));
  const head = `
    <div class="card">
      <div class="flex gap-8 align-center" style="flex-wrap:wrap">
        <div>
          <div style="font-size:20px;font-weight:700">${escHtml(fmtDay(a.meeting_date))}</div>
          <div class="text-muted">${meetingLabel(a)}</div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-secondary" onclick="editMeeting(${a.meeting_id})">Edit Meeting / Attendance</button>
        ${state.user?.role === 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteAgenda(${a.id})">Delete Agenda</button>` : ''}
      </div>
      <div class="form-grid" style="margin-top:16px">
        ${agInput('Location', 'location', a.location)}
        ${agInput('Planned start', 'start_time', a.start_time, 'time')}
        ${agInput('Presiding', 'presiding', a.presiding)}
        ${agInput('Secretary (recording)', 'secretary', a.secretary)}
        ${agTimeInput('Called to order', 'called_to_order', a.called_to_order, 'call_to_order')}
        ${agTimeInput('Adjourned', 'adjourned_at', a.adjourned_at, 'adjourn')}
        <div class="form-group full">
          <label>Attendance / quorum</label>
          <div class="flex gap-8 align-center" style="flex-wrap:wrap">
            <select style="width:130px" onchange="agField('quorum', this.value)">
              <option value="" ${a.quorum == null ? 'selected' : ''}>Quorum?</option>
              <option value="1" ${a.quorum === 1 ? 'selected' : ''}>Quorum: Yes</option>
              <option value="0" ${a.quorum === 0 ? 'selected' : ''}>Quorum: No</option>
            </select>
            <span style="font-size:13px">${att.total
              ? `<strong>${att.total}</strong> present <span class="text-muted">(${att.members} member${att.members !== 1 ? 's' : ''}, ${att.visitors} visiting, ${att.guests} non-ham${att.guests !== 1 ? 's' : ''})</span>`
              : '<span class="text-muted">No attendance recorded yet — use Edit Meeting / Attendance.</span>'}</span>
          </div>
          <div style="font-size:13px">${agQuorumHtml(data.quorum)}</div>
        </div>
      </div>
    </div>`;
  return head + data.template.sections.map(sec => agSectionHtml(sec, data, checks)).join('');
}

// Voting members are active, licensed, and not honorary
function agQuorumHtml(q) {
  if (!q) return '';
  const base = `Quorum is <strong>${q.needed}</strong> — ${q.percent}% of ${q.voting_members} voting member${q.voting_members !== 1 ? 's' : ''}${q.fixed ? ' when the meeting adjourned' : ''}`;
  if (q.met === null) return '<span class="text-muted">' + base + '.</span>';
  const present = q.present + ' voting member' + (q.present !== 1 ? 's' : '') + ' present';
  return '<span class="text-muted">' + base + ':</span> ' + (q.met
    ? '<span class="badge badge-green">Met — ' + present + '</span>'
    : '<span class="badge badge-red">Not met — ' + present + '</span>');
}

function agInput(label, field, val, type = 'text', placeholder = '') {
  return `<div class="form-group"><label>${escHtml(label)}</label><input type="${type}" value="${escHtml(val || '')}" placeholder="${escHtml(placeholder)}" onchange="agField('${field}', this.value)"></div>`;
}

function agTextarea(label, field, val, rows = 3, placeholder = '') {
  return `<div class="form-group full"><label>${escHtml(label)}</label><textarea rows="${rows}" style="min-height:0" placeholder="${escHtml(placeholder)}" onchange="agField('${field}', this.value)">${escHtml(val || '')}</textarea></div>`;
}

// A time with a Now button that fills in the time and ticks the matching step
function agTimeInput(label, field, val, step) {
  return `<div class="form-group"><label>${escHtml(label)}</label>
    <div class="flex gap-8"><input type="time" id="ag-${field}" value="${escHtml(val || '')}" onchange="agField('${field}', this.value)">
    <button class="btn btn-sm btn-secondary" onclick="agNow('${field}', '${step}')">Now</button></div></div>`;
}

function agSectionHtml(sec, data, checks) {
  const list = sec.list ? agListHtml(sec.list, data) : '';
  const steps = sec.steps.map(st => agStepHtml(st, data.agenda, checks.get(st.key)) + (sec.listAfter === st.key ? list : '')).join('');
  const after = sec.list === 'presentation'
    ? `<div class="form-grid" style="margin-top:12px">${agTextarea('Presentation notes / follow-up', 'presentation_notes', data.agenda.presentation_notes, 2)}</div>` : '';
  return `<div class="card">
    <div class="ag-bar">${sec.number}.&nbsp; ${escHtml(sec.title)}</div>
    ${sec.note ? `<p class="ag-note">${escHtml(sec.note)}</p>` : ''}
    ${sec.listAfter ? steps : list + steps}${after}
  </div>`;
}

function agStepHtml(st, a, check) {
  const extra = st.field
    ? `<input type="text" class="ag-step-field" placeholder="${escHtml(st.fieldLabel)}" value="${escHtml(a[st.field] || '')}" onchange="agField('${st.field}', this.value)">`
    : st.time ? `<span class="text-muted" style="font-size:12px" id="ag-${st.time}-show">${a[st.time] ? 'at ' + agClock(a[st.time]) : ''}</span>` : '';
  return `<div class="ag-step">
    <label class="ag-step-main">
      <input type="checkbox" id="ag-step-${st.key}" ${check ? 'checked' : ''} onchange="agCheck('${st.key}', this.checked)">
      <span><strong>${escHtml(st.label)}</strong>${st.hint ? ` <span class="text-muted">${escHtml(st.hint)}</span>` : ''}${check?.checked_by ? ` <span class="ag-by" title="${escHtml(fmtDate(check.checked_at))}">✓ ${escHtml(check.checked_by)}</span>` : ''}</span>
    </label>
    ${extra}
  </div>`;
}

function agListHtml(kind, data) {
  if (kind === 'reports')      return agReportsHtml(data);
  if (kind === 'old' || kind === 'new') return agItemsHtml(kind, data);
  if (kind === 'announcement') return agAnnouncementsHtml(data);
  if (kind === 'motions')      return agMotionsHtml(data);
  if (kind === 'presentation') return agPresentationHtml(data.agenda);
  if (kind === 'next')         return agNextHtml(data.agenda);
  return '';
}

function agReportsHtml(data) {
  const a = data.agenda, inc = data.income;
  const reports = new Map(data.reports.map(r => [r.report_key, r]));
  return data.report_slots.map(slot => {
    const r = reports.get(slot.key);
    const who = slot.officers.map(o => escHtml(o.name) + (o.callsign ? ' <span class="callsign">' + escHtml(o.callsign) + '</span>' : '')).join(', ');
    const treasurer = slot.key !== 'treasurer' ? '' : `
      <div class="form-row" style="margin:6px 0">
        <div class="form-group" style="flex:1;min-width:140px"><label>Beginning balance</label><input type="text" value="${escHtml(a.treasurer_begin || '')}" placeholder="$0.00" onchange="agField('treasurer_begin', this.value)"></div>
        <div class="form-group" style="flex:1;min-width:140px"><label>Ending balance</label><input type="text" value="${escHtml(a.treasurer_end || '')}" placeholder="$0.00" onchange="agField('treasurer_end', this.value)"></div>
      </div>
      <div class="ag-income">Recorded in this app ${inc.since_last_meeting ? 'since the last meeting' : 'this year'} (${escHtml(fmtDay(inc.since))} – ${escHtml(fmtDay(inc.through))}):
        dues <strong>${agMoney(inc.dues.total)}</strong> (${inc.dues.count}),
        donations <strong>${agMoney(inc.donations.total)}</strong> (${inc.donations.count}),
        total <strong>${agMoney(inc.total)}</strong></div>`;
    return `<div class="ag-report">
      <div class="ag-step">
        <label class="ag-step-main">
          <input type="checkbox" ${r?.given ? 'checked' : ''} onchange="agReport('${slot.key}', { given: this.checked })">
          <span><strong>${escHtml(slot.label)}</strong>${who ? ' — ' + who : ''}</span>
        </label>
        ${r?.body && r?.updated_by ? `<span class="ag-by" title="${escHtml(fmtDate(r.updated_at))}">${escHtml(r.updated_by)}</span>` : ''}
      </div>
      <div class="ag-indent">${treasurer}
        <textarea rows="2" style="min-height:0" placeholder="What this report will cover" onchange="agReport('${slot.key}', { body: this.value })">${escHtml(r?.body || '')}</textarea>
      </div>
    </div>`;
  }).join('');
}

function agItemsHtml(section, data) {
  const items = data.items.filter(i => i.section === section);
  const rows = items.map(i => `
    <div class="ag-item${i.status !== 'open' ? ' done' : ''}">
      <select class="ag-status" onchange="this.closest('.ag-item').classList.toggle('done', this.value !== 'open'); agItem(${i.id}, { status: this.value })">
        ${Object.entries(AG_STATUS).map(([k, v]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <div style="flex:1;min-width:0">
        <div><strong class="ag-title">${escHtml(i.title)}</strong>${i.owner ? ` <span class="text-muted">— ${escHtml(i.owner)}</span>` : ''}${i.carried_from_date ? ` <span class="badge badge-gray">from ${escHtml(fmtDay(i.carried_from_date))}</span>` : ''}</div>
        ${i.details ? `<div style="font-size:13px;white-space:pre-wrap">${escHtml(i.details)}</div>` : ''}
        <div class="ag-by">Added by ${escHtml(i.added_by || '—')}</div>
      </div>
      <button class="btn btn-sm btn-secondary" onclick="openAgItem(${i.id})">Edit</button>
    </div>`).join('');
  const carry = section === 'old' && data.previous
    ? `<button class="btn btn-sm btn-secondary" onclick="agCarry()" title="Copy business still open on the ${escHtml(fmtDay(data.previous.meeting_date))} agenda">Pull In Open Items</button>` : '';
  const empty = `<p class="text-muted" style="font-size:13px;margin:6px 0">${section === 'old' ? 'No unfinished business.' : 'No new business yet.'}</p>`;
  return (rows || empty) + agAddForm(section, carry);
}

function agAddForm(section, extra = '') {
  const enter = `onkeydown="if(event.key==='Enter')agAddItem('${section}')"`;
  return `<div class="ag-add">
    <input type="text" id="ag-add-${section}-title" placeholder="Add an ${section === 'announcement' ? 'announcement' : 'item'}…" ${enter}>
    <input type="text" id="ag-add-${section}-owner" placeholder="Brought by" style="max-width:180px" ${enter}>
    <button class="btn btn-sm btn-primary" onclick="agAddItem('${section}')">Add</button>
    ${extra}
  </div>`;
}

function agAnnouncementsHtml(data) {
  const items = data.items.filter(i => i.section === 'announcement');
  return `<div class="ag-indent" style="margin:4px 0 8px">
    ${items.map(i => `<div class="ag-item">
      <div style="flex:1;min-width:0">• <strong>${escHtml(i.title)}</strong>${i.owner ? ` <span class="text-muted">— ${escHtml(i.owner)}</span>` : ''}
        ${i.details ? `<div style="font-size:13px;white-space:pre-wrap">${escHtml(i.details)}</div>` : ''}</div>
      <button class="btn btn-sm btn-secondary" onclick="openAgItem(${i.id})">Edit</button>
    </div>`).join('')}
    ${agAddForm('announcement')}
  </div>`;
}

function agResultBadge(r) {
  const cls = { passed: 'badge-green', failed: 'badge-red', tabled: 'badge-yellow', withdrawn: 'badge-gray' }[r] || 'badge-gray';
  return `<span class="badge ${cls}">${escHtml(AG_RESULTS[r] || r)}</span>`;
}

function agMotionsHtml(data) {
  const votes = m => [m.votes_yes, m.votes_no, m.votes_abstain].some(v => v != null)
    ? [m.votes_yes, m.votes_no, m.votes_abstain].map(v => v ?? '–').join(' / ') : '';
  const rows = data.motions.map((m, i) => `<tr style="cursor:pointer" onclick="openAgMotion(${m.id})">
    <td class="text-muted">${i + 1}</td>
    <td style="white-space:pre-wrap">${escHtml(m.motion)}</td>
    <td>${escHtml(m.moved_by || '')}</td>
    <td>${escHtml(m.seconded_by || '')}</td>
    <td style="white-space:nowrap">${votes(m)}</td>
    <td>${m.result ? agResultBadge(m.result) : ''}</td>
  </tr>`).join('');
  return `${data.motions.length ? `<div class="tbl-wrap" style="max-height:none"><table>
      <thead><tr><th>#</th><th>Motion</th><th>Moved by</th><th>Seconded</th><th>Yes / No / Abs</th><th>Result</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="text-muted" style="font-size:13px;margin:6px 0">No motions yet.</p>'}
    <div style="margin:8px 0 12px"><button class="btn btn-sm btn-primary" onclick="openAgMotion()">+ Record Motion</button></div>
    <div class="form-grid">${agTextarea('Discussion notes', 'discussion_notes', data.agenda.discussion_notes, 3)}</div>`;
}

function agPresentationHtml(a) {
  return `<div class="form-grid" style="margin:8px 0 12px">
    ${agInput('Presentation title', 'presentation_title', a.presentation_title)}
    ${agInput('Presenter name', 'presenter_name', a.presenter_name)}
    ${agInput('Callsign / title / affiliation', 'presenter_affiliation', a.presenter_affiliation)}
    ${agInput('Phone / email', 'presenter_contact', a.presenter_contact)}
    ${agInput('Est. length', 'presentation_length', a.presentation_length, 'text', 'e.g. 30 min')}
    ${agTextarea('Introduction — presenter bio, topic overview, why it matters to the club', 'presentation_intro', a.presentation_intro, 4)}
  </div>`;
}

function agNextHtml(a) {
  return `<div class="form-grid ag-indent" style="margin:4px 0 8px">
    ${agInput('Next meeting date', 'next_meeting_date', a.next_meeting_date, 'date')}
    ${agInput('Time / location', 'next_meeting_place', a.next_meeting_place)}
    ${agInput('Next presenter / topic', 'next_presenter', a.next_presenter)}
  </div>`;
}

// ── Agenda saves ──
function agSaved() {
  const el = document.getElementById('ag-saved');
  if (el) el.textContent = 'Saved ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function agSend(method, sub, body) {
  const p = api(method, '/agendas/' + state.agenda.agenda.id + sub, body);
  const settled = p.catch(() => {});
  agPending.push(settled);
  settled.then(() => { agPending = agPending.filter(x => x !== settled); });
  try {
    const data = await p;
    agSaved();
    return data;
  } catch(e) {
    toast(e.data?.error || 'Could not save', 'error');
    throw e;
  }
}

async function agField(field, value) {
  try { await agSend('PATCH', '', { [field]: value }); } catch {}
}

function agNow(field, step) {
  const d = new Date();
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const input = document.getElementById('ag-' + field);
  if (input) input.value = hhmm;
  const shown = document.getElementById('ag-' + field + '-show');
  if (shown) shown.textContent = 'at ' + agClock(hhmm);
  agField(field, hhmm);
  const box = document.getElementById('ag-step-' + step);
  if (box && !box.checked) { box.checked = true; agCheck(step, true); }
}

async function agCheck(step, checked) {
  try { await agSend('POST', '/checks', { step, checked }); } catch { reloadAgenda(); }
}

async function agReport(key, patch) {
  try { await agSend('PUT', '/reports/' + key, patch); } catch {}
}

async function agItem(id, patch) {
  try { await agSend('PATCH', '/items/' + id, patch); } catch { reloadAgenda(); }
}

async function agAddItem(section) {
  const titleEl = document.getElementById('ag-add-' + section + '-title');
  const title = (titleEl?.value || '').trim();
  if (!title) { titleEl?.focus(); return; }
  try {
    await agSend('POST', '/items', { section, title, owner: gv('ag-add-' + section + '-owner') });
    await reloadAgenda();
    document.getElementById('ag-add-' + section + '-title')?.focus();
  } catch {}
}

async function agCarry() {
  try {
    const r = await agSend('POST', '/carry', {});
    if (r.carried) {
      toast(r.carried + ' item' + (r.carried !== 1 ? 's' : '') + ' pulled in ✓');
      reloadAgenda();
    } else {
      toast('Nothing new to pull in — the open items are already here');
    }
  } catch {}
}

function openAgItem(id) {
  const i = state.agenda.items.find(x => x.id === id);
  if (!i) return;
  const title = i.section === 'announcement' ? 'Announcement' : i.section === 'old' ? 'Old Business' : 'New Business';
  showModal(`
    <div class="form-grid">
      <div class="form-group full"><label>Title *</label><input type="text" id="agi-title" value="${escHtml(i.title)}"></div>
      ${fi('Brought by', 'agi-owner', i.owner || '')}
      ${i.section !== 'announcement' ? `<div class="form-group"><label>Status</label><select id="agi-status">
        ${Object.entries(AG_STATUS).map(([k, v]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>` : ''}
    </div>
    ${fi('Details', 'agi-details', i.details || '', 'textarea')}
    ${i.carried_from_date ? `<p class="form-hint" style="margin-top:8px">Carried over from the ${escHtml(fmtDay(i.carried_from_date))} agenda.</p>` : ''}
  `, title, [
    { label: 'Delete', cls: 'btn-danger',    fn: 'deleteAgItem(' + id + ')' },
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveAgItem(' + id + ')' },
  ]);
}

async function saveAgItem(id) {
  const body = { title: gv('agi-title'), owner: gv('agi-owner'), details: gv('agi-details') };
  if (document.getElementById('agi-status')) body.status = gv('agi-status');
  if (!body.title.trim()) { toast('Title is required', 'error'); return; }
  try { await agSend('PATCH', '/items/' + id, body); closeModal(); reloadAgenda(); } catch {}
}

async function deleteAgItem(id) {
  if (!confirm('Remove this item from the agenda?')) return;
  try { await agSend('DELETE', '/items/' + id); closeModal(); reloadAgenda(); } catch {}
}

function openAgMotion(id = null) {
  const m = (id && state.agenda.motions.find(x => x.id === id)) || {};
  const num = (label, key) => `<div class="form-group" style="width:90px"><label>${label}</label><input type="number" min="0" id="agm-${key}" value="${m[key] ?? ''}"></div>`;
  showModal(`
    <div class="form-group full"><label>Motion *</label><textarea id="agm-motion" rows="3" placeholder="I move that…">${escHtml(m.motion || '')}</textarea></div>
    <div class="form-row" style="margin-top:12px">
      <div class="form-group" style="flex:1;min-width:160px"><label>Moved by</label><input type="text" id="agm-moved_by" value="${escHtml(m.moved_by || '')}"></div>
      <div class="form-group" style="flex:1;min-width:160px"><label>Seconded by</label><input type="text" id="agm-seconded_by" value="${escHtml(m.seconded_by || '')}"></div>
    </div>
    <div class="form-row" style="margin-top:12px">
      ${num('Yes', 'votes_yes')}${num('No', 'votes_no')}${num('Abstain', 'votes_abstain')}
      <div class="form-group" style="flex:1;min-width:140px"><label>Result</label><select id="agm-result">
        <option value="">—</option>
        ${Object.entries(AG_RESULTS).map(([k, v]) => `<option value="${k}" ${k === m.result ? 'selected' : ''}>${v}</option>`).join('')}
      </select></div>
    </div>
  `, id ? 'Edit Motion' : 'Record Motion', [
    ...(id ? [{ label: 'Delete', cls: 'btn-danger', fn: 'deleteAgMotion(' + id + ')' }] : []),
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveAgMotion(' + (id || 'null') + ')' },
  ]);
}

async function saveAgMotion(id) {
  const body = {};
  ['motion', 'moved_by', 'seconded_by', 'votes_yes', 'votes_no', 'votes_abstain', 'result'].forEach(k => { body[k] = gv('agm-' + k); });
  if (!body.motion.trim()) { toast('Enter the motion', 'error'); return; }
  try { await agSend(id ? 'PATCH' : 'POST', '/motions' + (id ? '/' + id : ''), body); closeModal(); reloadAgenda(); } catch {}
}

async function deleteAgMotion(id) {
  if (!confirm('Delete this motion?')) return;
  try { await agSend('DELETE', '/motions/' + id); closeModal(); reloadAgenda(); } catch {}
}

async function deleteAgenda(id) {
  if (!confirm('Delete this agenda? The meeting and its attendance stay. This cannot be undone.')) return;
  try {
    await api('DELETE', '/agendas/' + id);
    toast('Agenda deleted');
    nav('agendas');
  } catch(e) { toast(e.data?.error || 'Failed to delete agenda', 'error'); }
}

// Coming back to the tab shows what other officers have changed, unless
// something is being typed or a dialog is open
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || state.currentPage !== 'agenda') return;
  if (document.querySelector('.modal-backdrop')) return;
  const el = document.activeElement;
  if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
  reloadAgenda();
});

// ── INVENTORY ─────────────────────────────────────────────────────────
let invMeta = { locations: [], members: [] };
let invSearchTimer = null;
let invListedIds = []; // items in the table now, for Print Labels

// Labels for whatever the search and location filter currently show
function printInvLabels() {
  if (!invListedIds.length) { toast('No items to label', 'warn'); return; }
  window.open('/print/labels?ids=' + invListedIds.join(','), '_blank');
}

async function loadInvMeta() {
  invMeta = await api('GET', '/inventory/meta');
  return invMeta;
}

async function inventory() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-secondary btn-sm" onclick="printInvLabels()" style="margin-right:8px">Print Labels</button>' +
    '<button class="btn btn-secondary btn-sm" onclick="addInvLocation()" style="margin-right:8px">+ Location</button>' +
    '<button class="btn btn-primary" onclick="openInvForm()">+ Add Item</button>';

  try { await loadInvMeta(); }
  catch(e) { toast(e.data?.error || 'Failed to load locations', 'error'); }

  setPage(`
    <div class="search-bar">
      <input type="text" id="inv-search" placeholder="Search name, manufacturer, model, serial, member…"
        oninput="clearTimeout(invSearchTimer); invSearchTimer = setTimeout(loadInvTable, 250)">
      <select id="inv-filter-location" onchange="loadInvTable()" style="width:190px">
        <option value="">All Locations</option>
        ${invMeta.locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('')}
        <option value="out">Checked Out</option>
      </select>
      <span style="font-size:13px;color:var(--text-muted)" id="inv-count"></span>
    </div>
    <div class="card" style="padding:0">
      <div id="inv-table"><div class="spinner"></div></div>
    </div>
  `);
  loadInvTable();
}

function invPhotoUrl(it, thumb) {
  return '/api/inventory/' + it.id + '/photo?' + (thumb ? 'size=thumb&' : '') + 'v=' + encodeURIComponent(it.photo_updated_at || '');
}

function invMemberLabel(callsign, name) {
  if (!callsign && !name) return '<span class="text-muted">a former member</span>';
  return (callsign ? `<span class="callsign">${escHtml(callsign)}</span> ` : '') + escHtml(name || '');
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
  invListedIds = list.map(it => it.id);
  const countEl = document.getElementById('inv-count');
  if (countEl) countEl.textContent = list.length + ' item' + (list.length !== 1 ? 's' : '');

  el.innerHTML = list.length === 0
    ? '<p class="text-muted" style="padding:24px;text-align:center">' + (q || loc ? 'No items match.' : 'No items in the inventory yet.') + '</p>'
    : `<div class="tbl-wrap"><table>
        <thead><tr><th></th><th>Item</th><th>Manufacturer</th><th>Model</th><th>Serial #</th><th>Location</th><th>Since</th><th></th></tr></thead>
        <tbody>
          ${list.map(it => `<tr style="cursor:pointer" onclick="openInvItem(${it.id})">
            <td style="width:56px">${it.photo_updated_at
              ? `<img src="${invPhotoUrl(it, true)}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;display:block">`
              : '<div style="width:44px;height:44px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></div>'}</td>
            <td><a class="row-link" href="${adminPath('inventory', it.id)}"><strong>${escHtml(it.name)}</strong></a></td>
            <td>${escHtml(it.manufacturer || '—')}</td>
            <td>${escHtml(it.model || '—')}</td>
            <td style="font-family:var(--mono)">${escHtml(it.serial_number || '—')}</td>
            <td>${invWhere(it)}</td>
            <td style="color:var(--text-muted);white-space:nowrap">${it.location_since ? escHtml(fmtDay(it.location_since)) : '—'}</td>
            <td><button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openInvItem(${it.id})">View</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
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
  setUrl(adminPath('inventory', id), true);

  const it = data.item;
  const events = data.events || [];
  const today = localToday();

  const buttons = [
    { label: 'Close', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Edit',  cls: 'btn-secondary', fn: 'editInvItem(' + id + ')' },
    { label: 'Print Label', cls: 'btn-secondary', fn: "window.open('/print/labels?ids=" + id + "', '_blank')" },
    { label: it.assigned_member_id ? 'Return / Move' : 'Move / Check Out', cls: 'btn-primary', fn: 'openInvMove(' + id + ')' },
  ];
  if (state.user?.role === 'admin') buttons.unshift({ label: 'Delete', cls: 'btn-danger', fn: 'deleteInvItem(' + id + ')' });

  showModal(`
    <div class="flex gap-16" style="flex-wrap:wrap;margin-bottom:20px">
      ${it.photo_updated_at ? `
        <a href="${invPhotoUrl(it)}" target="_blank" title="Open full size">
          <img src="${invPhotoUrl(it)}" alt="${escHtml(it.name)}" style="width:220px;max-width:100%;max-height:220px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--border);display:block">
        </a>` : ''}
      <div style="flex:1;min-width:220px">
        <div style="font-size:20px;font-weight:700;margin-bottom:12px">${escHtml(it.name)}${it.is_donated ? ' <span class="badge badge-green">Donated</span>' : ''}</div>
        <div class="detail-grid">
          ${dfield('Manufacturer', escHtml(it.manufacturer))}
          ${dfield('Model', escHtml(it.model))}
          ${dfield('Serial Number', it.serial_number ? '<span style="font-family:var(--mono)">' + escHtml(it.serial_number) + '</span>' : '')}
          ${dfield('Location', invWhere(it))}
          ${dfield('There Since', it.location_since ? escHtml(fmtDay(it.location_since)) : '')}
          ${dfield(it.is_donated ? 'Date Donated' : 'Purchase Date', it.purchase_date ? escHtml(fmtDay(it.purchase_date)) : '')}
          ${dfield(it.is_donated ? 'Estimated Value' : 'Price', it.purchase_price != null ? '$' + Number(it.purchase_price).toFixed(2) : '')}
          ${dfield(it.is_donated ? 'Donated By' : 'Purchased From', escHtml(it.purchased_from))}
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h4>History &amp; Notes</h4>
      <div class="form-group" style="margin-bottom:8px">
        <textarea id="inv-new-note" placeholder="Add a note about this item…"></textarea>
      </div>
      <div class="flex gap-8 align-center">
        <input type="date" id="inv-new-note-date" value="${today}" style="width:160px">
        <button class="btn btn-sm btn-primary" onclick="addInvNote(${id})">Add Note</button>
      </div>
      <div class="divider"></div>
      ${events.length === 0 ? '<p class="text-muted">No history yet.</p>' : events.map(e => `
        <div class="note-item">
          <div class="note-meta">${escHtml(fmtDay(e.event_date))}${e.user_email ? ' · ' + escHtml(e.user_email) : ''}</div>
          ${e.event_type !== 'note' ? `<div style="font-size:13px;font-weight:600">${invEventText(e)}</div>` : ''}
          ${e.note ? `<div class="note-text"${e.event_type !== 'note' ? ' style="margin-top:4px;color:var(--text-muted)"' : ''}>${escHtml(e.note)}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `, 'Inventory Item', buttons);
}

// Location / member picker shared by the add and move forms
function invDestFields(current) {
  return `
    <div class="form-group">
      <label>${current ? 'Move To' : 'Location'} *</label>
      <select id="inv-dest" onchange="onInvDestChange()">
        ${invMeta.locations.map(l => `<option value="${l.id}" ${current?.location_id === l.id ? 'disabled' : ''}>${escHtml(l.name)}${current?.location_id === l.id ? ' (current)' : ''}</option>`).join('')}
        <option value="member">Checked out to a member…</option>
      </select>
    </div>
    <div class="form-group hidden" id="inv-member-wrap">
      <label>Member *</label>
      <select id="inv-member">
        <option value="">— Select Member —</option>
        ${invMeta.members.map(m => `<option value="${m.id}">${m.callsign ? escHtml(m.callsign) + ' — ' : ''}${escHtml(m.first_name)} ${escHtml(m.last_name)}</option>`).join('')}
      </select>
    </div>
  `;
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
  const today = localToday();

  showModal(`
    <div class="form-grid">
      <div class="form-group full">
        <label>Item Name *</label>
        <input type="text" id="inv-name" value="${escHtml(it?.name || '')}" placeholder="e.g. HF Transceiver, 2m Repeater, Antenna Analyzer">
      </div>
      ${fi('Manufacturer', 'inv-manufacturer', it?.manufacturer || '')}
      ${fi('Model', 'inv-model', it?.model || '')}
      ${fi('Serial Number', 'inv-serial', it?.serial_number || '')}
      <div class="form-group full" style="flex-direction:row;align-items:center;gap:8px">
        <input type="checkbox" id="inv-donated" style="width:auto" onchange="onInvDonatedChange()" ${it?.is_donated ? 'checked' : ''}>
        <label for="inv-donated" style="margin:0">This item was donated</label>
      </div>
      ${fi('Purchase Date', 'inv-purchase-date', it?.purchase_date || '', 'date')}
      <div class="form-group">
        <label>Price ($)</label>
        <input type="number" id="inv-purchase-price" value="${it?.purchase_price ?? ''}" step="0.01" min="0">
      </div>
      ${fi('Purchased From', 'inv-purchased-from', it?.purchased_from || '')}
      ${it ? '' : invDestFields() + fi('Date', 'inv-date', today, 'date')}
      <div class="form-group full">
        <label>Photo</label>
        ${it?.photo_updated_at ? `
          <div class="flex gap-8 align-center" style="margin-bottom:8px">
            <img src="${invPhotoUrl(it, true)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px">
            <button class="btn btn-sm btn-danger" onclick="removeInvPhoto(${it.id})">Remove Photo</button>
          </div>` : ''}
        <input type="file" id="inv-photo" accept="image/*">
        ${it?.photo_updated_at ? '<div style="font-size:12px;color:var(--text-muted)">Choosing a file replaces the current photo.</div>' : ''}
      </div>
    </div>
    ${it ? '' : fi('Notes', 'inv-note', '', 'textarea')}
  `, it ? 'Edit Item' : 'Add Item', [
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
  const today = localToday();

  showModal(`
    <div style="margin-bottom:16px">
      <div style="font-size:16px;font-weight:600">${escHtml(it.name)}</div>
      <div style="color:var(--text-muted);font-size:13px;margin-top:4px">Currently: ${invWhere(it)}</div>
    </div>
    <div class="form-grid">
      ${invDestFields(it)}
      ${fi('Date Moved', 'inv-date', today, 'date')}
    </div>
    ${fi('Notes', 'inv-note', '', 'textarea')}
  `, 'Move Item', [
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
  showModal(`
    ${fi('Location Name', 'inv-loc-name', '', 'text', 'e.g. Clubhouse, Trailer', true)}
    <p class="text-muted" style="font-size:12px;margin-top:8px">Current locations: ${invMeta.locations.map(l => escHtml(l.name)).join(', ') || 'none'}</p>
  `, 'Add Location', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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

// ── REPEATERS ─────────────────────────────────────────────────────────
const RPT_STATUS = {
  active:  ['Active', 'green'],
  testing: ['Testing', 'blue'],
  offline: ['Offline', 'red'],
  planned: ['Planned', 'gray'],
  retired: ['Retired', 'gray'],
};
const RPT_REPORT_CATEGORIES = {
  noise: 'Noise', interference: 'Interference', unlicensed: 'Unlicensed use', kerchunking: 'Kerchunking',
  conduct: 'Conduct', outage: 'Outage', audio: 'Audio problem', coverage: 'Coverage', other: 'Other',
};
const RPT_REPORT_STATUS = { open: ['Open', 'red'], investigating: ['Investigating', 'yellow'], resolved: ['Resolved', 'green'] };
const RPT_MAINT_KINDS = {
  maintenance: 'Maintenance', repair: 'Repair', upgrade: 'Upgrade', inspection: 'Inspection',
  listing: 'Listing renewal', coordination: 'Coordination', license: 'License', lease: 'Site lease', insurance: 'Insurance', other: 'Other',
};
const RPT_DOC_KINDS = { manual: 'Manual', programming: 'Programming file', license: 'License', agreement: 'Agreement', diagram: 'Diagram', other: 'Other' };
const RPT_TABS = [
  ['info', 'Info'], ['contacts', 'Contacts'], ['reports', 'Reports'], ['visits', 'Visit Log'], ['maintenance', 'Maintenance & Renewals'],
  ['notes', 'Site Notes'], ['photos', 'Photos'], ['documents', 'Manuals & Files'],
];
const RPT_MAX_FILE = 25 * 1024 * 1024;

function rptBadge(map, key) {
  const [label, color] = map[key] || [key, 'gray'];
  return '<span class="badge badge-' + color + '">' + escHtml(label) + '</span>';
}

// Input minus output, the way it's printed in repeater listings (-0.600, +5.000)
function rptOffset(r) {
  const out = parseFloat(r.output_freq), inp = parseFloat(r.input_freq);
  if (!isFinite(out) || !isFinite(inp)) return '';
  const diff = inp - out;
  if (Math.abs(diff) < 0.0000001) return 'Simplex';
  return (diff > 0 ? '+' : '−') + Math.abs(diff).toFixed(3) + ' MHz';
}

function rptFreq(f) { return f ? '<span style="font-family:var(--mono)">' + escHtml(f) + '</span>' : ''; }

function rptDue(d, today) {
  if (d.next_due < today) return '<span class="badge badge-red">Overdue</span>';
  return '<span class="badge badge-yellow">Due</span>';
}

function rptSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function rptMultiline(s) { return escHtml(s || '').replace(/\n/g, '<br>'); }

// ── Markdown for site notes ──
// A small renderer, enough for notes: headings, bold, italic, strikethrough,
// code, links, lists (with [ ] / [x] checkboxes), quotes, and rules. All text
// is escaped first, and links may only be web, email, or phone links, so a
// note can never add its own HTML or script to the page.
function rptSafeUrl(url) {
  return /^(https?:[/][/]|mailto:|tel:)/i.test(url) ? url : null;
}

function rptInline(text) {
  const held = [];
  const hold = html => '\u0000' + (held.push(html) - 1) + '\u0000';
  let s = String(text);
  // Code spans first, so nothing inside them is formatted
  s = s.replace(/`([^`]+)`/g, (_, c) => hold('<code>' + escHtml(c) + '</code>'));
  // [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = rptSafeUrl(url);
    return safe ? hold('<a href="' + escHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + rptInline(label) + '</a>') : m;
  });
  // Bare web addresses
  s = s.replace(/https?:[/][/][^\s<>()]+[^\s<>().,;:!?'"]/g, url =>
    hold('<a href="' + escHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escHtml(url) + '</a>'));
  s = escHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_A-Za-z0-9])_([^_\s][^_]*)_(?![A-Za-z0-9])/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s.replace(/\u0000([0-9]+)\u0000/g, (_, i) => held[Number(i)]);
}

function rptMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null, quote = [], code = null;
  const flushPara = () => { if (para.length) out.push('<p>' + para.map(rptInline).join('<br>') + '</p>'); para = []; };
  const flushQuote = () => { if (quote.length) out.push('<blockquote>' + quote.map(rptInline).join('<br>') + '</blockquote>'); quote = []; };
  const closeList = () => { if (list) out.push('</' + list + '>'); list = null; };
  const flushAll = () => { flushPara(); flushQuote(); closeList(); };
  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) { out.push('<pre><code>' + escHtml(code.join('\n')) + '</code></pre>'); code = null; }
      else code.push(line);
      continue;
    }
    let m;
    if (/^\s*```/.test(line)) { flushAll(); code = []; continue; }
    if (!line.trim()) { flushAll(); continue; }
    if ((m = /^(#{1,4})\s+(.+)$/.exec(line))) {
      flushAll();
      const n = m[1].length + 2; // # is h3 inside a note
      out.push('<h' + n + '>' + rptInline(m[2]) + '</h' + n + '>');
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); closeList(); quote.push(m[1]); continue; }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const number = /^\s*[0-9]+[.)]\s+(.*)$/.exec(line);
    if (bullet || number) {
      flushPara(); flushQuote();
      const type = bullet ? 'ul' : 'ol';
      if (list !== type) { closeList(); out.push('<' + type + '>'); list = type; }
      let item = (bullet || number)[1];
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
      if (task) {
        const done = task[1] !== ' ';
        out.push('<li class="rpt-task' + (done ? ' done' : '') + '">' + (done ? '☑' : '☐') + ' ' + rptInline(task[2]) + '</li>');
      } else {
        out.push('<li>' + rptInline(item) + '</li>');
      }
      continue;
    }
    flushQuote(); closeList();
    para.push(line);
  }
  if (code) out.push('<pre><code>' + escHtml(code.join('\n')) + '</code></pre>');
  flushAll();
  return out.join('');
}

function rptNotePreview() {
  const el = document.getElementById('rpt-new-note-preview');
  if (!el) return;
  const text = gv('rpt-new-note');
  el.classList.toggle('hidden', !text.trim() || el.dataset.open !== '1');
  el.innerHTML = rptMarkdown(text);
}

function toggleRptNotePreview(btn) {
  const el = document.getElementById('rpt-new-note-preview');
  if (!el) return;
  el.dataset.open = el.dataset.open === '1' ? '' : '1';
  btn.textContent = el.dataset.open === '1' ? 'Hide Preview' : 'Preview';
  rptNotePreview();
}

async function repeaters() {
  document.getElementById('topbar-actions').innerHTML = '<button class="btn btn-primary" onclick="openRptForm()">+ Add Repeater</button>';
  setPage('<div class="spinner"></div>');
  let data;
  try { data = await api('GET', '/repeaters'); }
  catch(e) {
    setPage('<p class="text-muted" style="padding:24px;text-align:center">Failed to load repeaters.</p>');
    toast(e.data?.error || e.message || 'Failed to load repeaters', 'error');
    return;
  }
  if (state.currentPage !== 'repeaters') return;
  const list = data.repeaters || [];
  const due = data.due || [];

  const dueCard = due.length ? `
    <div class="card" style="border-color:rgba(243,156,18,.4)">
      <div class="card-title">Coming Due <span class="text-muted" style="font-weight:400;font-size:12px">— overdue or due in the next ${data.due_soon_days} days</span></div>
      ${due.map(d => `
        <div class="flex gap-8 align-center" style="padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;flex-wrap:wrap" onclick="openRepeater(${d.repeater_id}, 'maintenance')">
          ${rptDue(d, data.today)}
          <a class="row-link" href="${adminPath('repeaters', d.repeater_id, 'maintenance')}"><strong>${escHtml(d.title)}</strong></a>
          <span class="text-muted">${escHtml(RPT_MAINT_KINDS[d.kind] || d.kind)} · ${escHtml(d.repeater_name)}</span>
          <span class="spacer"></span>
          <span style="white-space:nowrap">${escHtml(fmtDay(d.next_due))}</span>
        </div>`).join('')}
    </div>` : '';

  const card = r => {
    const offset = rptOffset(r);
    return `
    <div class="card rpt-card" onclick="openRepeater(${r.id})">
      <div class="flex gap-8 align-center" style="margin-bottom:8px">
        <a class="row-link" href="${adminPath('repeaters', r.id)}"><strong style="font-size:15px">${escHtml(r.name)}</strong></a>
        <span class="spacer"></span>
        ${rptBadge(RPT_STATUS, r.status)}
      </div>
      <div class="rpt-freq">${escHtml(r.output_freq || '—')}</div>
      <div class="text-muted" style="font-size:13px;margin-bottom:10px">
        ${[r.callsign ? '<span class="callsign">' + escHtml(r.callsign) + '</span>' : '', escHtml(r.band || ''), escHtml(r.mode || '')].filter(Boolean).join(' · ')}
      </div>
      <div class="rpt-kv">
        <span>Input</span><span>${rptFreq(r.input_freq) || '—'}${offset ? ' <span class="text-muted">(' + offset + ')</span>' : ''}</span>
        <span>Tone</span><span>${escHtml(r.tone_in || '—')}${r.tone_out ? ' <span class="text-muted">/ ' + escHtml(r.tone_out) + ' out</span>' : ''}</span>
        <span>Site</span><span>${escHtml(r.site_name || '—')}</span>
      </div>
      ${r.open_reports ? `<div style="margin-top:10px"><span class="badge badge-red">${r.open_reports} open report${r.open_reports !== 1 ? 's' : ''}</span></div>` : ''}
    </div>`;
  };

  const site = data.site || { notes: 0, photos: 0 };
  const siteCard = `
    <div class="card rpt-card flex gap-8 align-center" style="flex-wrap:wrap" onclick="openSite()">
      <span style="font-size:20px">🏔️</span>
      <div>
        <a class="row-link" href="${adminPath('repeaters', 'site')}"><strong>Repeater Site</strong></a>
        <div class="text-muted" style="font-size:13px">Visit log, contacts, notes, and photos for the whole site, shown with every repeater</div>
      </div>
      <span class="spacer"></span>
      <span class="text-muted" style="font-size:13px">Last visit ${site.last_visit ? escHtml(fmtDay(site.last_visit)) : 'not logged'} · ${site.contacts || 0} contact${site.contacts !== 1 ? 's' : ''} · ${site.notes} note${site.notes !== 1 ? 's' : ''} · ${site.photos} photo${site.photos !== 1 ? 's' : ''}</span>
    </div>`;

  setPage(`
    ${dueCard}
    ${siteCard}
    ${list.length
      ? `<div class="rpt-grid">${list.map(card).join('')}</div>`
      : '<div class="card"><p class="text-muted" style="text-align:center;margin:12px 0">No repeaters yet. Add the club\'s repeaters to keep their listings, visits, and reports in one place.</p></div>'}
  `);
}

async function openRepeater(id, tab) {
  state.currentPage = 'repeater';
  if (tab) state.rptTab = tab;
  else if (state.rpt?.repeater?.id !== id) state.rptTab = 'info';
  pageUrl(adminPath('repeaters', id, state.rptTab));
  document.getElementById('topbar-actions').innerHTML = '';
  setPage('<div class="spinner"></div>');
  try { showRepeater(await api('GET', '/repeaters/' + id)); }
  catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); }
}

// The whole site: its notes and photos, on a page like a repeater's
async function openSite(tab) {
  state.currentPage = 'repeater';
  if (tab || !state.rpt?.site) state.rptTab = tab || 'contacts';
  pageUrl(adminPath('repeaters', 'site', state.rptTab));
  document.getElementById('topbar-actions').innerHTML = '';
  setPage('<div class="spinner"></div>');
  try { showRepeater({ site: true, ...(await api('GET', '/repeaters/site')) }); }
  catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); }
}

async function reloadRepeater() {
  if (state.currentPage !== 'repeater' || !state.rpt) return;
  try {
    if (state.rpt.site) showRepeater({ site: true, ...(await api('GET', '/repeaters/site')) });
    else showRepeater(await api('GET', '/repeaters/' + state.rpt.repeater.id));
  } catch(e) { toast(e.data?.error || 'Failed to reload', 'error'); }
}

// Where a note or photo is changed: the site's, or this repeater's
function rptBase(e) {
  if (state.rpt.site || (e && e.repeater_id == null)) return '/repeaters/site';
  return '/repeaters/' + state.rpt.repeater.id;
}

// The "for" picker on a repeater's note and photo forms. `e` is the entry being edited.
function rptScopeSelect(id, e = null) {
  if (state.rpt.site) return '';
  const own = e && e.repeater_id != null;
  return `<select id="${id}" style="width:auto" title="Who this is for">
    <option value="site">Whole site</option>
    <option value="repeater" ${own ? 'selected' : ''}>${escHtml(state.rpt.repeater.name)} only</option>
  </select>`;
}

// Saving an edited note or photo from a repeater page goes through the repeater,
// which can also move it to or from the site
function rptScopeEdit(selectId, e, body) {
  const sel = document.getElementById(selectId);
  if (!sel) return rptBase(e);
  body.site_wide = sel.value === 'site';
  return '/repeaters/' + state.rpt.repeater.id;
}

function rptScopeBase(selectId) {
  return gv(selectId) === 'repeater' ? '/repeaters/' + state.rpt.repeater.id : '/repeaters/site';
}

const rptSiteBadge = e => (!state.rpt.site && e.repeater_id == null ? '<span class="badge badge-purple" title="For the whole site, shown with every repeater">Site</span>' : '');

function showRepeater(data) {
  state.currentPage = 'repeater';
  state.rpt = data;
  state.rptPinShown = false;
  const r = data.repeater;
  // A tab change swaps the address in place, so Back leaves the repeater
  const rptHome = adminPath('repeaters', data.site ? 'site' : r.id);
  pageUrl(rptHome + '/' + state.rptTab, !!state.pagePath?.startsWith(rptHome + '/'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === 'repeaters'));
  document.getElementById('page-title').textContent = data.site ? 'Repeater Site' : r.name;
  setTitle(data.site ? 'Repeater Site' : r.name);
  document.getElementById('topbar-actions').innerHTML = '<button class="btn btn-secondary" onclick="nav(\'repeaters\')">← All Repeaters</button>';
  const page = document.getElementById('page');
  const scroll = page.scrollTop;
  setPage(data.site ? rptSitePageHtml(data) : rptPageHtml(data));
  page.scrollTop = scroll;
}

function rptTab(key) {
  state.rptTab = key;
  showRepeater(state.rpt);
}

const RPT_SITE_TABS = [['contacts', 'Contacts'], ['visits', 'Visit Log'], ['notes', 'Site Notes'], ['photos', 'Photos']];

function rptSitePageHtml(data) {
  const tab = RPT_SITE_TABS.some(([k]) => k === state.rptTab) ? state.rptTab : 'contacts';
  const count = { contacts: data.contacts.length || '', visits: data.visits.length || '', notes: data.notes.length || '', photos: data.photos.length || '' };
  return `
    <p class="text-muted" style="font-size:13px;margin:0 0 12px">The visit log, contacts, notes, and photos here are for the whole site. They also show on every repeater's tabs.</p>
    <div class="tabs rpt-tabs">${RPT_SITE_TABS.map(([k, label]) =>
      `<div class="tab${k === tab ? ' active' : ''}" onclick="rptTab('${k}')">${label}${count[k] ? ' <span class="badge badge-gray">' + count[k] + '</span>' : ''}</div>`).join('')}</div>
    ${{ contacts: rptContactsHtml, visits: rptVisitsHtml, notes: rptNotesHtml, photos: rptPhotosHtml }[tab](data)}`;
}

function rptPageHtml(data) {
  const r = data.repeater;
  const tab = RPT_TABS.some(([k]) => k === state.rptTab) ? state.rptTab : 'info';
  const open = data.reports.filter(x => x.status !== 'resolved').length;
  const overdue = data.due.filter(d => d.next_due < data.today).length;
  const count = { contacts: data.contacts.length || '', reports: open || '', visits: data.visits.length || '', notes: data.notes.length || '', photos: data.photos.length || '', documents: data.documents.length || '', maintenance: overdue ? overdue + ' overdue' : '' };
  const offset = rptOffset(r);

  const head = `
    <div class="card">
      <div class="flex gap-16 align-center" style="flex-wrap:wrap">
        <div>
          <div class="rpt-freq">${escHtml(r.output_freq || '—')}</div>
          <div class="text-muted" style="font-size:13px">${[r.callsign ? '<span class="callsign">' + escHtml(r.callsign) + '</span>' : '', escHtml(r.band || ''), escHtml(r.mode || ''), escHtml(r.site_name || '')].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="rpt-kv" style="min-width:200px">
          <span>Input</span><span>${rptFreq(r.input_freq) || '—'}${offset ? ' <span class="text-muted">(' + offset + ')</span>' : ''}</span>
          <span>Tone</span><span>${escHtml(r.tone_in || '—')}${r.tone_out ? ' <span class="text-muted">/ ' + escHtml(r.tone_out) + ' out</span>' : ''}</span>
        </div>
        <span class="spacer"></span>
        ${rptBadge(RPT_STATUS, r.status)}
        <button class="btn btn-sm btn-secondary" onclick="openRptForm(state.rpt.repeater)">Edit</button>
        ${state.user?.role === 'admin' ? '<button class="btn btn-sm btn-danger" onclick="deleteRepeater()">Delete</button>' : ''}
      </div>
    </div>`;

  const tabs = `<div class="tabs rpt-tabs">${RPT_TABS.map(([k, label]) =>
    `<div class="tab${k === tab ? ' active' : ''}" onclick="rptTab('${k}')">${label}${count[k] ? ' <span class="badge badge-' + (k === 'reports' || k === 'maintenance' ? 'red' : 'gray') + '">' + count[k] + '</span>' : ''}</div>`).join('')}</div>`;

  const body = { info: rptInfoHtml, contacts: rptContactsHtml, reports: rptReportsHtml, visits: rptVisitsHtml, maintenance: rptMaintHtml, notes: rptNotesHtml, photos: rptPhotosHtml, documents: rptDocsHtml }[tab](data);
  return head + tabs + body;
}

function rptInfoHtml(data) {
  const r = data.repeater;
  const pin = r.screen_pin
    ? `<span id="rpt-pin" style="font-family:var(--mono)">••••</span> <button class="btn btn-sm btn-secondary" style="margin-left:6px" onclick="toggleRptPin(this)">Show</button>`
    : '';
  const map = r.site_address ? ` <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.site_address)}" target="_blank" rel="noopener" style="font-size:12px">Map ↗</a>` : '';
  return `
    <div class="card">
      <div class="card-title">Listing</div>
      <div class="detail-grid">
        ${dfield('Output (repeater transmits)', rptFreq(r.output_freq))}
        ${dfield('Input (users transmit)', rptFreq(r.input_freq))}
        ${dfield('Offset', escHtml(rptOffset(r)))}
        ${dfield('Control (receive only)', rptFreq(r.control_freq))}
        ${dfield('Access tone (users send)', escHtml(r.tone_in))}
        ${dfield('Repeater tone (sent out)', escHtml(r.tone_out))}
        ${dfield('Callsign', r.callsign ? '<span class="callsign">' + escHtml(r.callsign) + '</span>' : '')}
        ${dfield('Band', escHtml(r.band))}
        ${dfield('Mode', escHtml(r.mode))}
        ${dfield('Power', escHtml(r.power))}
        ${dfield('Screen PIN', pin)}
      </div>
      ${r.digital_info ? `<div class="detail-section" style="margin-top:12px"><h4>Digital Settings</h4><div>${rptMultiline(r.digital_info)}</div></div>` : ''}
    </div>
    <div class="card">
      <div class="card-title">Equipment</div>
      <div class="detail-grid">
        ${dfield('Repeater / controller', rptMultiline(r.equipment))}
        ${dfield('Antenna & feedline', rptMultiline(r.antenna))}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Site</div>
      <div class="detail-grid">
        ${dfield('Site', escHtml(r.site_name))}
        ${dfield('Address', r.site_address ? rptMultiline(r.site_address) + map : '')}
      </div>
      ${r.site_access ? `<div class="detail-section" style="margin-top:12px"><h4>Access</h4><div>${rptMultiline(r.site_access)}</div></div>` : ''}
    </div>
    ${r.notes ? `<div class="card"><div class="card-title">Notes</div><div>${rptMultiline(r.notes)}</div></div>` : ''}
    <p class="text-muted" style="font-size:12px">Last changed ${escHtml(fmtDate(r.updated_at))}.</p>`;
}

function toggleRptPin(btn) {
  const el = document.getElementById('rpt-pin');
  if (!el) return;
  state.rptPinShown = !state.rptPinShown;
  el.textContent = state.rptPinShown ? state.rpt.repeater.screen_pin : '••••';
  btn.textContent = state.rptPinShown ? 'Hide' : 'Show';
}

function rptEntryButtons(list, e) {
  return `<span style="white-space:nowrap">
    <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();openRptEntry('${list}', ${e.id})">Edit</button>
    <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteRptEntry('${list}', ${e.id})">✕</button>
  </span>`;
}

function rptBy(e) { return e.added_by ? ' · added by ' + escHtml(e.added_by) : ''; }

function rptReportsHtml(data) {
  const list = data.reports;
  return `
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <span class="text-muted" style="font-size:13px">Noise, interference, unlicensed operators, outages — anything reported about this repeater.</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" onclick="openRptEntry('reports')">+ Log Report</button>
    </div>
    ${list.length === 0 ? '<div class="card"><p class="text-muted" style="text-align:center;margin:12px 0">No reports logged.</p></div>' : list.map(e => `
      <div class="card" style="padding:14px 16px${e.status === 'resolved' ? ';opacity:.75' : ''}">
        <div class="flex gap-8 align-center" style="flex-wrap:wrap">
          ${rptBadge(RPT_REPORT_STATUS, e.status)}
          <strong>${escHtml(RPT_REPORT_CATEGORIES[e.category] || e.category)}</strong>
          <span class="text-muted" style="font-size:12px">${escHtml(fmtDay(e.report_date))}${e.reported_by ? ' · reported by ' + escHtml(e.reported_by) : ''}${rptBy(e)}</span>
          <span class="spacer"></span>
          ${rptEntryButtons('reports', e)}
        </div>
        <div style="margin-top:8px">${rptMultiline(e.description)}</div>
        ${e.resolution || e.resolved_date ? `<div style="margin-top:8px;font-size:13px;color:var(--text-muted)"><strong>Resolution${e.resolved_date ? ' (' + escHtml(fmtDay(e.resolved_date)) + ')' : ''}:</strong> ${rptMultiline(e.resolution || '')}</div>` : ''}
      </div>`).join('')}`;
}

function rptVisitsHtml(data) {
  const list = data.visits;
  const time = e => [e.time_in, e.time_out].filter(Boolean).join('–');
  return `
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <span class="text-muted" style="font-size:13px">Every trip to the site: who went, when, and why. Visits are for the whole site, so every repeater shows the same log.</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" onclick="openRptEntry('visits')">+ Log Visit</button>
    </div>
    <div class="card" style="padding:0">
      ${list.length === 0 ? '<p class="text-muted" style="padding:24px;text-align:center">No visits logged.</p>' : `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Date</th><th>Time</th><th>Who</th><th>Why</th><th>Notes</th><th></th></tr></thead>
        <tbody>${list.map(e => `<tr>
          <td style="white-space:nowrap">${escHtml(fmtDay(e.visit_date))}</td>
          <td style="white-space:nowrap;color:var(--text-muted)">${escHtml(time(e)) || '—'}</td>
          <td>${escHtml(e.visitors)}</td>
          <td>${escHtml(e.purpose)}</td>
          <td style="max-width:320px">${e.notes ? rptMultiline(e.notes) : '<span class="text-muted">—</span>'}</td>
          <td>${rptEntryButtons('visits', e)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
}

function rptMaintHtml(data) {
  const list = data.maintenance;
  const due = data.due;
  return `
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <span class="text-muted" style="font-size:13px">Work done on the repeater, and paperwork kept up: listing renewals, coordination, license, site lease. Give a next-due date to be reminded.</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" onclick="openRptEntry('maintenance')">+ Log Maintenance</button>
    </div>
    ${due.length ? `
    <div class="card">
      <div class="card-title">Next Due</div>
      ${due.map(d => `
        <div class="flex gap-8 align-center" style="padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
          ${d.next_due < data.today ? '<span class="badge badge-red">Overdue</span>' : d.next_due <= rptAddDays(data.today, data.due_soon_days) ? '<span class="badge badge-yellow">Soon</span>' : '<span class="badge badge-gray">Later</span>'}
          <strong>${escHtml(d.title)}</strong>
          <span class="text-muted">${escHtml(RPT_MAINT_KINDS[d.kind] || d.kind)}${d.done_date ? ' · last done ' + escHtml(fmtDay(d.done_date)) : ''}</span>
          <span class="spacer"></span>
          <span style="white-space:nowrap">${escHtml(fmtDay(d.next_due))}</span>
          <button class="btn btn-sm btn-secondary" onclick="rptRenew(${d.id})">Mark Done</button>
        </div>`).join('')}
    </div>` : ''}
    <div class="card" style="padding:0">
      ${list.length === 0 ? '<p class="text-muted" style="padding:24px;text-align:center">Nothing logged yet.</p>' : `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Done</th><th>Type</th><th>What</th><th>By</th><th>Next due</th><th>Cost</th><th>Notes</th><th></th></tr></thead>
        <tbody>${list.map(e => `<tr>
          <td style="white-space:nowrap">${e.done_date ? escHtml(fmtDay(e.done_date)) : '<span class="text-muted">Scheduled</span>'}</td>
          <td>${escHtml(RPT_MAINT_KINDS[e.kind] || e.kind)}</td>
          <td><strong>${escHtml(e.title)}</strong></td>
          <td>${escHtml(e.done_by || '—')}</td>
          <td style="white-space:nowrap">${e.next_due ? escHtml(fmtDay(e.next_due)) : '<span class="text-muted">—</span>'}</td>
          <td>${e.cost != null ? '$' + Number(e.cost).toFixed(2) : '<span class="text-muted">—</span>'}</td>
          <td style="max-width:280px">${e.notes ? rptMultiline(e.notes) : '<span class="text-muted">—</span>'}</td>
          <td>${rptEntryButtons('maintenance', e)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
}

function rptAddDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function rptNotesHtml(data) {
  return `
    <div class="card">
      <div class="form-group" style="margin-bottom:8px">
        <textarea id="rpt-new-note" oninput="rptNotePreview()" placeholder="A note about the site: where things are, who to call, what to bring…"></textarea>
      </div>
      <div id="rpt-new-note-preview" class="rpt-md hidden" style="border:1px dashed var(--border);border-radius:6px;padding:8px 12px;margin-bottom:8px"></div>
      <div class="text-muted" style="font-size:12px;margin-bottom:8px">Markdown works: **bold**, *italic*, # heading, - list, - [ ] checklist, [link](https://…), \`code\`</div>
      <div class="flex gap-8 align-center">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:0"><input type="checkbox" id="rpt-new-note-pin" style="width:auto"> Pin to top</label>
        <span class="spacer"></span>
        ${rptScopeSelect('rpt-new-note-scope')}
        <button class="btn btn-sm btn-secondary" onclick="toggleRptNotePreview(this)">Preview</button>
        <button class="btn btn-sm btn-primary" onclick="addRptNote()">Add Note</button>
      </div>
    </div>
    ${data.notes.length === 0 ? '<p class="text-muted" style="text-align:center">No site notes yet.</p>' : data.notes.map(n => `
      <div class="card" style="padding:14px 16px">
        <div class="flex gap-8 align-center">
          ${rptSiteBadge(n)}
          ${n.pinned ? '<span class="badge badge-blue">Pinned</span>' : ''}
          <span class="note-meta" style="margin:0">${escHtml(fmtDate(n.created_at))}${rptBy(n)}${n.updated_at !== n.created_at ? ' · edited' : ''}</span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-secondary" onclick="pinRptNote(${n.id}, ${n.pinned ? 0 : 1})">${n.pinned ? 'Unpin' : 'Pin'}</button>
          ${rptEntryButtons('notes', n)}
        </div>
        <div class="note-text rpt-md" style="margin-top:8px">${rptMarkdown(n.note)}</div>
      </div>`).join('')}`;
}

function rptContactsHtml(data) {
  const list = data.contacts;
  const tel = p => '<a href="tel:' + escHtml(p.replace(/[^0-9+]/g, '')) + '" style="color:var(--accent);text-decoration:none">' + escHtml(p) + '</a>';
  const mail = e => '<a href="mailto:' + escHtml(e) + '" style="color:var(--accent);text-decoration:none">' + escHtml(e) + '</a>';
  return `
    <div class="flex gap-8 align-center" style="margin-bottom:12px">
      <span class="text-muted" style="font-size:13px">Who to call about the ${state.rpt.site ? 'site' : 'repeater'}: landowner, tower crew, trustee, and who has a key.</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" onclick="openRptEntry('contacts')">+ Add Contact</button>
    </div>
    ${list.length === 0 ? '<div class="card"><p class="text-muted" style="text-align:center;margin:12px 0">No contacts yet.</p></div>' : `
    <div class="rpt-grid">${list.map(c => `
      <div class="card" style="padding:14px 16px">
        <div class="flex gap-8" style="align-items:flex-start">
          <div class="flex gap-8 align-center" style="flex:1;min-width:0;flex-wrap:wrap">
            <strong style="font-size:15px">${escHtml(c.name)}</strong>
            ${rptSiteBadge(c)}
            ${c.has_key ? '<span class="badge badge-green" title="Has a key to the site">🔑 Has key</span>' : ''}
          </div>
          ${rptEntryButtons('contacts', c)}
        </div>
        ${c.title ? `<div class="text-muted" style="font-size:13px;margin-top:2px">${escHtml(c.title)}</div>` : ''}
        <div class="rpt-kv" style="margin-top:10px">
          <span>Phone</span><span>${c.phone ? tel(c.phone) : '<span class="text-muted">—</span>'}</span>
          <span>Email</span><span style="word-break:break-all">${c.email ? mail(c.email) : '<span class="text-muted">—</span>'}</span>
          <span>Key</span><span>${c.has_key ? 'Yes' : 'No'}</span>
        </div>
        ${c.notes ? `<div style="margin-top:8px;font-size:13px">${rptMultiline(c.notes)}</div>` : ''}
      </div>`).join('')}
    </div>`}`;
}

function rptPhotoUrl(p, thumb) {
  return '/api' + rptBase(p) + '/photos/' + p.id + (thumb ? '?size=thumb' : '');
}

function rptPhotosHtml(data) {
  return `
    <div class="card">
      <div class="flex gap-8 align-center" style="flex-wrap:wrap">
        <input type="text" id="rpt-photo-caption" placeholder="Caption (optional)" style="flex:1;min-width:180px">
        <input type="date" id="rpt-photo-date" value="${localToday()}" style="width:160px" title="Date taken">
        ${rptScopeSelect('rpt-photo-scope')}
        <label class="btn btn-primary" style="margin:0">+ Add Photos
          <input type="file" accept="image/*" multiple style="display:none" onchange="uploadRptPhotos(this)">
        </label>
      </div>
      <div id="rpt-photo-status" class="text-muted" style="font-size:12px;margin-top:6px">Photos are shrunk before upload. Pick several at once to add them all with the same caption and date.</div>
    </div>
    ${data.photos.length === 0 ? '<p class="text-muted" style="text-align:center">No site photos yet.</p>' : `
    <div class="rpt-photos">${data.photos.map(p => `
      <div class="rpt-photo card">
        <a href="${rptPhotoUrl(p)}" target="_blank" title="Open full size">
          <img src="${rptPhotoUrl(p, true)}" alt="${escHtml(p.caption || 'Site photo')}" loading="lazy">
        </a>
        ${p.caption ? `<div class="rpt-photo-caption">${escHtml(p.caption)}</div>` : ''}
        <div class="rpt-photo-meta">
          ${rptSiteBadge(p)}
          <span class="text-muted" style="font-size:11px;white-space:nowrap">${p.taken_date ? escHtml(fmtDate(p.taken_date)) : ''}</span>
        </div>
        <div class="rpt-photo-actions">
          <button class="btn btn-sm btn-secondary" onclick="editRptPhoto(${p.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteRptPhoto(${p.id})" title="Delete photo">✕</button>
        </div>
      </div>`).join('')}
    </div>`}`;
}

function rptDocsHtml(data) {
  const id = data.repeater.id;
  return `
    <div class="flex gap-8 align-center" style="margin-bottom:12px;flex-wrap:wrap">
      <span class="text-muted" style="font-size:13px">Manuals, programming files, licenses, and agreements. Upload a file (up to 25 MB) or link to one online.</span>
      <span class="spacer"></span>
      <button class="btn btn-secondary" onclick="openRptDoc('link')">+ Add Link</button>
      <button class="btn btn-primary" onclick="openRptDoc('file')">+ Upload File</button>
    </div>
    <div class="card" style="padding:0">
      ${data.documents.length === 0 ? '<p class="text-muted" style="padding:24px;text-align:center">No manuals or files yet.</p>' : `
      <div class="tbl-wrap"><table>
        <thead><tr><th>Title</th><th>Type</th><th>File</th><th>Added</th><th></th></tr></thead>
        <tbody>${data.documents.map(d => `<tr>
          <td><a href="/api/repeaters/${id}/documents/${d.id}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none"><strong>${escHtml(d.title)}</strong></a></td>
          <td>${escHtml(RPT_DOC_KINDS[d.kind] || d.kind)}</td>
          <td style="font-size:12px">${d.url
            ? '<span class="text-muted">Link: ' + escHtml(d.url.replace(/^https?:[/][/]/, '').slice(0, 50)) + '</span>'
            : escHtml(d.filename || '') + ' <span class="text-muted">' + rptSize(d.size) + '</span>'}</td>
          <td style="white-space:nowrap;color:var(--text-muted);font-size:12px">${escHtml(fmtDate(d.created_at))}${d.added_by ? '<br>' + escHtml(d.added_by) : ''}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm btn-secondary" onclick="editRptDoc(${d.id})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteRptDoc(${d.id})">✕</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;
}

// ── Repeater add / edit ──
function openRptForm(r = null) {
  const v = k => r?.[k] ?? '';
  const ta = (label, id, val, ph = '') => `<div class="form-group full"><label>${escHtml(label)}</label><textarea id="${id}" placeholder="${escHtml(ph)}">${escHtml(String(val))}</textarea></div>`;
  showModal(`
    <div class="form-grid">
      <div class="form-group full">
        <label>Name *</label>
        <input type="text" id="rpt-name" value="${escHtml(v('name'))}" placeholder="e.g. 2m Bays Mountain">
      </div>
      ${fi('Callsign', 'rpt-callsign', v('callsign'), 'text', 'W4TRC')}
      <div class="form-group">
        <label>Status</label>
        <select id="rpt-status">${Object.entries(RPT_STATUS).map(([k, [label]]) => `<option value="${k}" ${(r?.status || 'active') === k ? 'selected' : ''}>${label}</option>`).join('')}</select>
      </div>
      ${fi('Output MHz (repeater transmits)', 'rpt-output', v('output_freq'), 'text', '146.970')}
      ${fi('Input MHz (users transmit)', 'rpt-input', v('input_freq'), 'text', '146.370')}
      ${fi('Control MHz (receive only)', 'rpt-control', v('control_freq'), 'text', 'Control receiver frequency')}
      ${fi('Access tone (users send)', 'rpt-tone-in', v('tone_in'), 'text', '114.8 or D023')}
      ${fi('Repeater tone (sent out)', 'rpt-tone-out', v('tone_out'), 'text', 'blank if none')}
      ${fi('Band', 'rpt-band', v('band'), 'text', '2m, 70cm, 6m…')}
      ${fi('Mode', 'rpt-mode', v('mode'), 'text', 'FM, DMR, Fusion…')}
      ${fi('Power', 'rpt-power', v('power'), 'text', '50 W')}
      ${fi('Screen PIN', 'rpt-pin-input', v('screen_pin'))}
      ${ta('Digital settings', 'rpt-digital', v('digital_info'), 'Color code, NAC, DG-ID, talkgroups…')}
      ${ta('Repeater / controller', 'rpt-equipment', v('equipment'), 'Make and model, duplexer, controller')}
      ${ta('Antenna & feedline', 'rpt-antenna', v('antenna'), 'Antenna, height on the tower, feedline')}
      ${fi('Site', 'rpt-site-name', v('site_name'), 'text', 'e.g. Bays Mountain tower')}
      ${fi('Site address or coordinates', 'rpt-site-address', v('site_address'))}
      ${ta('Site access', 'rpt-site-access', v('site_access'), 'Directions, keys, gate codes, who to call')}
      ${ta('Notes', 'rpt-notes', v('notes'))}
      ${fi('Sort order', 'rpt-sort', r ? v('sort_order') : '', 'number', 'Lower numbers show first')}
    </div>
  `, r ? 'Edit Repeater' : 'Add Repeater', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveRepeater(' + (r?.id || 'null') + ')' },
  ]);
}

async function saveRepeater(id) {
  const body = {
    name: gv('rpt-name').trim(), callsign: gv('rpt-callsign'), status: gv('rpt-status'),
    output_freq: gv('rpt-output'), input_freq: gv('rpt-input'), control_freq: gv('rpt-control'), tone_in: gv('rpt-tone-in'), tone_out: gv('rpt-tone-out'),
    band: gv('rpt-band'), mode: gv('rpt-mode'), power: gv('rpt-power'), screen_pin: gv('rpt-pin-input'),
    digital_info: gv('rpt-digital'), equipment: gv('rpt-equipment'), antenna: gv('rpt-antenna'),
    site_name: gv('rpt-site-name'), site_address: gv('rpt-site-address'), site_access: gv('rpt-site-access'), notes: gv('rpt-notes'),
  };
  if (gv('rpt-sort') !== '') body.sort_order = gv('rpt-sort');
  if (!body.name) { toast('Name is required', 'error'); return; }
  try {
    const data = await api(id ? 'PATCH' : 'POST', '/repeaters' + (id ? '/' + id : ''), body);
    closeModal();
    toast('Repeater saved ✓');
    if (!id) state.rptTab = 'info';
    showRepeater(data);
  } catch(e) { toast(e.data?.error || 'Failed to save repeater', 'error'); }
}

async function deleteRepeater() {
  const r = state.rpt?.repeater;
  if (!r) return;
  if (!confirm('Delete ' + r.name + ' along with its visits, reports, maintenance, notes, photos, and files? This cannot be undone.')) return;
  try {
    await api('DELETE', '/repeaters/' + r.id);
    toast('Repeater deleted');
    nav('repeaters');
  } catch(e) { toast(e.data?.error || 'Failed to delete repeater', 'error'); }
}

// ── Visits, reports, maintenance, notes ──
// [field, label, type, options]; type is text, textarea, date, time, number, or an object of select choices
const RPT_FORMS = {
  visits: {
    title: 'Site Visit', noun: 'Visit', siteOnly: true,
    fields: [
      ['visit_date', 'Date', 'date', { required: true, today: true }],
      ['time_in', 'Arrived', 'time'],
      ['time_out', 'Left', 'time'],
      ['visitors', 'Who visited', 'text', { required: true, full: true, placeholder: 'Names or callsigns' }],
      ['purpose', 'Why', 'text', { required: true, full: true, placeholder: 'e.g. Replace fan, check SWR, show the site to a new trustee' }],
      ['notes', 'What was done / found', 'textarea'],
    ],
  },
  reports: {
    title: 'Report', noun: 'Report',
    fields: [
      ['report_date', 'Date', 'date', { required: true, today: true }],
      ['category', 'What kind', RPT_REPORT_CATEGORIES, { required: true }],
      ['reported_by', 'Reported by', 'text', { placeholder: 'Name or callsign' }],
      ['status', 'Status', Object.fromEntries(Object.entries(RPT_REPORT_STATUS).map(([k, [l]]) => [k, l])), { default: 'open' }],
      ['description', 'What was heard or reported', 'textarea', { required: true, placeholder: 'When, how often, how strong, any callsigns heard' }],
      ['resolution', 'Resolution / follow-up', 'textarea'],
      ['resolved_date', 'Resolved on', 'date'],
    ],
  },
  maintenance: {
    title: 'Maintenance & Renewals', noun: 'Entry',
    fields: [
      ['kind', 'Type', RPT_MAINT_KINDS, { required: true }],
      ['title', 'What', 'text', { required: true, placeholder: 'e.g. RepeaterBook listing, SERA coordination, duplexer retune', list: true }],
      ['done_date', 'Date done', 'date', { today: true }],
      ['next_due', 'Next due', 'date'],
      ['done_by', 'Done by', 'text'],
      ['cost', 'Cost ($)', 'number'],
      ['notes', 'Notes', 'textarea'],
    ],
  },
  contacts: {
    title: 'Contact', noun: 'Contact', siteWide: true,
    fields: [
      ['name', 'Name', 'text', { required: true }],
      ['title', 'Title', 'text', { placeholder: 'e.g. Landowner, Tower climber, Trustee' }],
      ['phone', 'Phone', 'tel'],
      ['email', 'Email', 'email'],
      ['has_key', 'Has a key to the site', 'checkbox', { full: true }],
      ['notes', 'Notes', 'textarea'],
    ],
  },
  notes: {
    title: 'Site Note', noun: 'Note', siteWide: true,
    fields: [['note', 'Note', 'textarea', { required: true }]],
  },
};

function rptField(list, [key, label, type, opt = {}], val) {
  const id = 'rf-' + key;
  const req = opt.required ? ' *' : '';
  if (type === 'textarea') {
    return `<div class="form-group full"><label>${escHtml(label)}${req}</label><textarea id="${id}" placeholder="${escHtml(opt.placeholder || '')}">${escHtml(String(val ?? ''))}</textarea></div>`;
  }
  if (type === 'checkbox') {
    return `<div class="form-group full" style="flex-direction:row;align-items:center;gap:8px">
      <input type="checkbox" id="${id}" style="width:auto" ${val ? 'checked' : ''}><label for="${id}" style="margin:0">${escHtml(label)}</label></div>`;
  }
  if (typeof type === 'object') {
    return `<div class="form-group${opt.full ? ' full' : ''}"><label>${escHtml(label)}${req}</label><select id="${id}">
      ${opt.required && !val ? '<option value="">— Choose —</option>' : ''}
      ${Object.entries(type).map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${escHtml(l)}</option>`).join('')}
    </select></div>`;
  }
  // Suggest titles already used, so a renewal logged again matches the earlier one
  const titles = opt.list ? [...new Set((state.rpt?.[list] || []).map(e => e.title))] : [];
  return `<div class="form-group${opt.full ? ' full' : ''}"><label>${escHtml(label)}${req}</label>
    <input type="${type}" id="${id}" value="${escHtml(String(val ?? ''))}" placeholder="${escHtml(opt.placeholder || '')}"${type === 'number' ? ' step="0.01" min="0"' : ''}${titles.length ? ' list="rf-list-' + key + '"' : ''}>
    ${titles.length ? `<datalist id="rf-list-${key}">${titles.map(t => `<option value="${escHtml(t)}">`).join('')}</datalist>` : ''}
  </div>`;
}

function openRptEntry(list, entryId = null, preset = null) {
  const form = RPT_FORMS[list];
  const e = entryId ? state.rpt[list].find(x => x.id === entryId) : null;
  if (entryId && !e) return;
  const val = ([key, , , opt = {}]) => {
    if (e) return e[key];
    if (preset && key in preset) return preset[key];
    if (opt.today) return localToday();
    return opt.default ?? '';
  };
  showModal(`
    <div class="form-grid">${form.fields.map(f => rptField(list, f, val(f))).join('')}</div>
    ${form.siteWide && (e || list !== 'notes') && !state.rpt.site ? '<div class="form-group" style="margin-top:12px"><label>For</label>' + rptScopeSelect('rf-scope', e) + '</div>' : ''}
    ${list === 'reports' ? '<p class="form-hint" style="margin-top:12px">Marking a report resolved dates it today unless you give another date.</p>' : ''}
    ${list === 'maintenance' ? '<p class="form-hint" style="margin-top:12px">Give a next-due date for things that come around again, like a listing renewal. When you log the same thing again, its new due date replaces the old one.</p>' : ''}
  `, (e ? 'Edit ' : 'Log ') + form.title, [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: "saveRptEntry('" + list + "', " + (entryId || 'null') + ')' },
  ]);
}

async function saveRptEntry(list, entryId) {
  const form = RPT_FORMS[list];
  const body = {};
  for (const [key, label, type, opt = {}] of form.fields) {
    if (type === 'checkbox') { body[key] = !!document.getElementById('rf-' + key)?.checked; continue; }
    const v = gv('rf-' + key).trim();
    if (opt.required && !v) { toast(label + ' is required', 'error'); return; }
    body[key] = v;
  }
  const entry = entryId ? state.rpt[list].find(x => x.id === entryId) : null;
  const base = form.siteOnly ? '/repeaters/site'
    : !form.siteWide || state.rpt.site ? rptBase(entry)
    : entry ? rptScopeEdit('rf-scope', entry, body)
    : rptScopeBase('rf-scope');
  try {
    await api(entryId ? 'PATCH' : 'POST', base + '/' + list + (entryId ? '/' + entryId : ''), body);
    closeModal();
    toast(form.noun + ' saved ✓');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to save', 'error'); }
}

async function deleteRptEntry(list, entryId) {
  if (!confirm('Delete this ' + RPT_FORMS[list].noun.toLowerCase() + '?')) return;
  try {
    await api('DELETE', rptBase(state.rpt[list].find(x => x.id === entryId)) + '/' + list + '/' + entryId);
    toast('Deleted');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to delete', 'error'); }
}

// Log the same renewal again, done today, keeping the same yearly (or whatever) interval
function rptRenew(maintId) {
  const d = state.rpt.maintenance.find(x => x.id === maintId) || state.rpt.due.find(x => x.id === maintId);
  if (!d) return;
  const today = localToday();
  let next = '';
  if (d.done_date && d.next_due) {
    const days = Math.round((Date.parse(d.next_due) - Date.parse(d.done_date)) / 86400000);
    if (days > 0) next = rptAddDays(today, days);
  }
  openRptEntry('maintenance', null, { kind: d.kind, title: d.title, done_date: today, next_due: next });
}

async function addRptNote() {
  const note = gv('rpt-new-note').trim();
  if (!note) { toast('Note text is required', 'error'); return; }
  try {
    await api('POST', (state.rpt.site ? '/repeaters/site' : rptScopeBase('rpt-new-note-scope')) + '/notes', { note, pinned: !!document.getElementById('rpt-new-note-pin')?.checked });
    toast('Note added');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to add note', 'error'); }
}

async function pinRptNote(noteId, pinned) {
  try {
    await api('PATCH', rptBase(state.rpt.notes.find(n => n.id === noteId)) + '/notes/' + noteId, { pinned: !!pinned });
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to change note', 'error'); }
}

// ── Photos ──
async function uploadRptPhotos(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const base = state.rpt.site ? '/repeaters/site' : rptScopeBase('rpt-photo-scope');
  const page = state.rpt;
  const caption = gv('rpt-photo-caption');
  const taken = gv('rpt-photo-date');
  const status = document.getElementById('rpt-photo-status');
  let done = 0, failed = 0;
  for (const file of files) {
    if (status) status.textContent = 'Uploading ' + (done + failed + 1) + ' of ' + files.length + '…';
    try {
      const { image, thumb } = await invReadPhoto(file);
      await api('POST', base + '/photos', { image, thumb, caption, taken_date: taken });
      done++;
    } catch(e) {
      failed++;
      toast((file.name || 'A photo') + ': ' + (e.data?.error || e.message || 'upload failed'), 'error');
    }
  }
  if (done) toast(done + ' photo' + (done !== 1 ? 's' : '') + ' added ✓');
  if (state.rpt === page) reloadRepeater();
}

function editRptPhoto(photoId) {
  const p = state.rpt.photos.find(x => x.id === photoId);
  if (!p) return;
  showModal(`
    <img src="${rptPhotoUrl(p, true)}" alt="" style="max-width:100%;max-height:200px;border-radius:6px;display:block;margin-bottom:12px">
    <div class="form-grid">
      <div class="form-group full"><label>Caption</label><input type="text" id="rpt-photo-edit-caption" value="${escHtml(p.caption || '')}"></div>
      ${fi('Date taken', 'rpt-photo-edit-date', p.taken_date || '', 'date')}
      ${state.rpt.site ? '' : '<div class="form-group"><label>For</label>' + rptScopeSelect('rpt-photo-edit-scope', p) + '</div>'}
    </div>
  `, 'Edit Photo', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'saveRptPhoto(' + photoId + ')' },
  ]);
}

async function saveRptPhoto(photoId) {
  try {
    const body = { caption: gv('rpt-photo-edit-caption'), taken_date: gv('rpt-photo-edit-date') };
    const base = rptScopeEdit('rpt-photo-edit-scope', state.rpt.photos.find(x => x.id === photoId), body);
    await api('PATCH', base + '/photos/' + photoId, body);
    closeModal();
    toast('Photo saved ✓');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to save photo', 'error'); }
}

async function deleteRptPhoto(photoId) {
  if (!confirm('Delete this photo?')) return;
  try {
    await api('DELETE', rptBase(state.rpt.photos.find(x => x.id === photoId)) + '/photos/' + photoId);
    toast('Photo deleted');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to delete photo', 'error'); }
}

// ── Manuals & files ──
function rptDocKindSelect(val = 'manual') {
  return `<div class="form-group"><label>Type</label><select id="rpt-doc-kind">${Object.entries(RPT_DOC_KINDS).map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
}

function openRptDoc(mode) {
  showModal(`
    <div class="form-grid">
      ${mode === 'file'
        ? '<div class="form-group full"><label>File *</label><input type="file" id="rpt-doc-file" onchange="rptDocPicked(this)"></div>'
        : fi('Web address', 'rpt-doc-url', '', 'url', 'https://…', true)}
      <div class="form-group full"><label>Title *</label><input type="text" id="rpt-doc-title" placeholder="e.g. MTR3000 service manual"></div>
      ${rptDocKindSelect()}
    </div>
    ${mode === 'file' ? '<p class="form-hint" style="margin-top:12px">Up to 25 MB. PDFs and pictures open in the browser; other files download.</p>' : ''}
  `, mode === 'file' ? 'Upload File' : 'Add Link', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: mode === 'file' ? 'Upload' : 'Save', cls: 'btn-primary', fn: "saveRptDoc('" + mode + "')" },
  ]);
}

// Title a new upload after its file name, unless one was typed
function rptDocPicked(input) {
  const title = document.getElementById('rpt-doc-title');
  if (title && !title.value) title.value = (input.files[0]?.name || '').replace(/[.][^.]+$/, '');
}

async function saveRptDoc(mode) {
  const id = state.rpt.repeater.id;
  const title = gv('rpt-doc-title').trim();
  const kind = gv('rpt-doc-kind');
  if (!title) { toast('Title is required', 'error'); return; }
  try {
    if (mode === 'link') {
      const url = gv('rpt-doc-url').trim();
      if (!url) { toast('Web address is required', 'error'); return; }
      await api('POST', '/repeaters/' + id + '/documents', { title, kind, url });
    } else {
      const file = document.getElementById('rpt-doc-file')?.files?.[0];
      if (!file) { toast('Choose a file', 'error'); return; }
      if (file.size > RPT_MAX_FILE) { toast('Files can be up to 25 MB', 'error'); return; }
      const btn = document.querySelector('.modal-footer .btn-primary');
      if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
      const q = new URLSearchParams({ title, kind, filename: file.name });
      const resp = await fetch('/api/repeaters/' + id + '/documents?' + q, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
        throw Object.assign(new Error(data.error || 'Upload failed'), { data });
      }
    }
    closeModal();
    toast('Saved ✓');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || e.message || 'Failed to save', 'error'); }
}

function editRptDoc(docId) {
  const d = state.rpt.documents.find(x => x.id === docId);
  if (!d) return;
  showModal(`
    <div class="form-grid">
      <div class="form-group full"><label>Title *</label><input type="text" id="rpt-doc-title" value="${escHtml(d.title)}"></div>
      ${rptDocKindSelect(d.kind)}
      ${d.url ? fi('Web address', 'rpt-doc-url', d.url, 'url') : ''}
    </div>
  `, 'Edit ' + (d.url ? 'Link' : 'File'), [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Save',   cls: 'btn-primary',   fn: 'updateRptDoc(' + docId + ')' },
  ]);
}

async function updateRptDoc(docId) {
  const d = state.rpt.documents.find(x => x.id === docId);
  const body = { title: gv('rpt-doc-title').trim(), kind: gv('rpt-doc-kind') };
  if (d?.url) body.url = gv('rpt-doc-url').trim();
  if (!body.title) { toast('Title is required', 'error'); return; }
  try {
    await api('PATCH', '/repeaters/' + state.rpt.repeater.id + '/documents/' + docId, body);
    closeModal();
    toast('Saved ✓');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to save', 'error'); }
}

async function deleteRptDoc(docId) {
  const d = state.rpt.documents.find(x => x.id === docId);
  if (!confirm('Delete ' + (d ? '"' + d.title + '"' : 'this file') + '?' + (d && !d.url ? ' The uploaded file is removed too.' : ''))) return;
  try {
    await api('DELETE', '/repeaters/' + state.rpt.repeater.id + '/documents/' + docId);
    toast('Deleted');
    reloadRepeater();
  } catch(e) { toast(e.data?.error || 'Failed to delete', 'error'); }
}

// ── MEMBERSHIP CUTOFF ─────────────────────────────────────────────────
async function cutoff() {
  const yr = new Date().getFullYear();
  setPage(`
    <div class="card" style="background:rgba(231,76,60,.05);border-color:rgba(231,76,60,.3);margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px;color:var(--danger)">⚠ Membership Cutoff Tool</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0">
        Sets all active members with no paid, honorary, waived, family-covered, or Eastman record for the
        selected year to <strong style="color:var(--text)">Inactive</strong>.
        Silent Key members are never affected. Always run Preview before executing.
      </p>
    </div>
    <div class="card">
      <div class="flex gap-16 align-center">
        <div class="form-group" style="width:200px;margin:0">
          <label>Cutoff Year</label>
          <select id="cutoff-year">
            ${[yr - 1, yr, yr + 1].map(y => `<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
        </div>
        <div style="padding-top:20px">
          <button class="btn btn-secondary" onclick="previewCutoff()">Preview</button>
        </div>
      </div>
    </div>
    <div id="cutoff-results"></div>
  `);
}

async function previewCutoff() {
  const year = parseInt(document.getElementById('cutoff-year')?.value, 10);
  const res  = document.getElementById('cutoff-results');
  if (!res) return;
  res.innerHTML = '<div class="spinner"></div>';
  try {
    const data = await api('POST', '/admin/cutoff', { year, dry_run: true });
    const list = data.members || [];
    res.innerHTML = `
      <div class="card">
        <div class="card-title" style="display:flex;align-items:center;gap:10px">
          Preview — ${year} Cutoff
          <span style="background:${list.length ? 'var(--danger)' : 'var(--success)'};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px">${list.length}</span>
        </div>
        ${list.length === 0
          ? `<p style="color:var(--success)">✓ All active members have a paid or exempt record for ${year}. No cutoff needed.</p>`
          : `<p style="color:var(--text-muted);margin-bottom:16px;font-size:13px">
              ${list.length} member${list.length !== 1 ? 's' : ''} would be set to Inactive.
              Review the list below, then click Run Cutoff to proceed.
            </p>
            <div class="tbl-wrap">
            <table>
              <thead><tr><th>Callsign</th><th>Name</th><th>Email</th></tr></thead>
              <tbody>
                ${list.map(m => `<tr>
                  <td><span class="callsign">${escHtml(m.callsign || '—')}</span></td>
                  <td>${escHtml(m.first_name)} ${escHtml(m.last_name)}</td>
                  <td style="color:var(--text-muted)">${escHtml(m.email || '—')}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            </div>
            <div class="divider"></div>
            <button class="btn btn-danger" onclick="executeCutoff(${year}, ${list.length})">
              ⚡ Run Cutoff for ${year} (${list.length} member${list.length !== 1 ? 's' : ''})
            </button>`
        }
      </div>
    `;
  } catch(e) { res.innerHTML = '<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'; }
}

async function executeCutoff(year, count) {
  if (!confirm(`Set ${count} member${count !== 1 ? 's' : ''} to Inactive for ${year}?\n\nThis cannot be undone.`)) return;
  const res = document.getElementById('cutoff-results');
  try {
    const data = await api('POST', '/admin/cutoff', { year, dry_run: false });
    const n = data.deactivated_count;
    toast(`Cutoff complete — ${n} member${n !== 1 ? 's' : ''} set to Inactive ✓`);
    res.innerHTML = `
      <div class="card" style="border-color:var(--success)">
        <div style="color:var(--success);font-weight:600;margin-bottom:8px">✓ Cutoff Complete</div>
        <p style="font-size:13px;color:var(--text-muted)">${n} member${n !== 1 ? 's' : ''} set to Inactive for ${year}. Audit log entry recorded.</p>
      </div>
    `;
  } catch(e) { toast(e.data?.error || e.message, 'error'); }
}

// ── RENEWAL REMINDERS ─────────────────────────────────────────────────
// Emails to members who have not paid. Nothing is sent until an officer
// presses Send here; there is no schedule.
const REMINDER_SKIP = {
  family:    m => 'Covered under the family membership of ' + (m.payer || 'another member') + ', who gets the reminder',
  eastman:   () => 'Eastman member — owes no dues',
  no_email:  () => 'No email address on file',
  bad_email: () => 'The email address on file is not a usable one',
};
const REMINDER_QUIET_DAYS = 14; // reminded this recently: listed, but not ticked

async function reminders() {
  document.getElementById('topbar-actions').innerHTML =
    '<button class="btn btn-secondary" onclick="nav(\'memberships\')">← Dues</button>';
  setPage('<div class="spinner"></div>');
  const yr = new Date().getFullYear();
  const years = [...new Set([yr, duesYear()])];
  if (!years.includes(state.reminderYear)) state.reminderYear = duesYear();

  let data;
  try { data = await api('GET', '/reminders?year=' + state.reminderYear); }
  catch (e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); return; }
  if (state.currentPage !== 'reminders') return;

  const year = data.year;
  const list = data.recipients || [];
  const skipped = data.skipped || [];
  const quietSince = Date.now() - REMINDER_QUIET_DAYS * 86400000;
  const recent = m => m.last_reminded && new Date(m.last_reminded.replace(' ', 'T') + 'Z').getTime() > quietSince;

  setPage(`
    ${years.length > 1 ? `<div class="year-row">
      ${years.map(y => `<div class="year-pill ${y === year ? 'active' : ''}" onclick="state.reminderYear=${y};reminders()">${y}</div>`).join('')}
    </div>` : ''}
    ${data.email_ready ? '' : `<div class="card" style="border-color:var(--danger)"><strong style="color:var(--danger)">Email is not set up.</strong> <span class="text-muted">The RESEND_API_KEY secret is missing, so nothing can be sent.</span></div>`}
    <div class="card">
      <div class="card-title">${year} Dues Reminder</div>
      <p class="text-muted" style="font-size:13px;margin:0 0 12px">Each member ticked below gets one email saying their ${year} dues have not been received, with their amount and a button to pay online. Replies go to the club's contact address. <strong>Nothing is sent until you press Send</strong>, and reminders never go out on their own.</p>
      <div class="form-group">
        <label>Add a line of your own (optional)</label>
        <textarea id="rem-note" maxlength="1000" placeholder="For example: Dues can also be paid at the December meeting."></textarea>
      </div>
      <div class="flex gap-8" style="margin-top:12px">
        <button class="btn btn-secondary" onclick="previewReminder(${year})">Preview Email</button>
        <button class="btn btn-secondary" onclick="testReminder(${year})" ${data.email_ready ? '' : 'disabled'}>Send a Test to Me</button>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div style="display:flex;align-items:center;gap:12px;padding:14px 16px">
        <div style="flex:1"><strong>Have not paid for ${year}</strong> <span class="text-muted" id="rem-count"></span></div>
        <button class="btn btn-primary" id="rem-send" onclick="sendReminders(${year})" ${data.email_ready ? '' : 'disabled'}>Send</button>
      </div>
      ${list.length === 0
        ? `<p class="text-muted" style="padding:0 16px 20px">Nobody with an email address needs a ${year} reminder.</p>`
        : `<div class="tbl-wrap"><table>
          <thead><tr>
            <th style="width:32px"><input type="checkbox" id="rem-all" onchange="document.querySelectorAll('.rem-pick').forEach(c => c.checked = this.checked);reminderCount()" aria-label="Tick all"></th>
            <th>Callsign</th><th>Name</th><th>Email</th><th>Type</th><th>Last Reminded</th>
          </tr></thead>
          <tbody>
            ${list.map(m => `<tr>
              <td><input type="checkbox" class="rem-pick" value="${m.id}" ${recent(m) ? '' : 'checked'} onchange="reminderCount()" aria-label="Send to ${escHtml(m.callsign || m.last_name)}"></td>
              <td><a class="row-link" href="${adminPath('members', m.id, 'dues')}" onclick="viewMember(${m.id}, 'dues')"><span class="callsign">${escHtml(m.callsign || '—')}</span></a></td>
              <td>${escHtml(m.first_name)} ${escHtml(m.last_name)}</td>
              <td style="color:var(--text-muted)">${escHtml(m.email)}</td>
              <td>${m.membership_type === 'family' ? '<span class="badge badge-blue">Family</span>' : '<span class="badge badge-gray">Individual</span>'}</td>
              <td style="color:var(--text-muted)">${m.last_reminded ? fmtDate(m.last_reminded) : 'Never'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
    </div>
    <div id="rem-result"></div>
    ${skipped.length ? `<div class="card" style="padding:0">
      <div style="padding:14px 16px"><strong>Not getting an email</strong> <span class="text-muted">${skipped.length} unpaid member${skipped.length !== 1 ? 's' : ''}</span></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Callsign</th><th>Name</th><th>Why</th></tr></thead>
        <tbody>
          ${skipped.map(m => `<tr>
            <td><a class="row-link" href="${adminPath('members', m.id)}" onclick="viewMember(${m.id})"><span class="callsign">${escHtml(m.callsign || '—')}</span></a></td>
            <td>${escHtml(m.first_name)} ${escHtml(m.last_name)}</td>
            <td style="color:var(--text-muted)">${escHtml((REMINDER_SKIP[m.reason] || (() => m.reason))(m))}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>` : ''}
  `);
  reminderCount();
}

function reminderPicks() {
  return [...document.querySelectorAll('.rem-pick:checked')].map(c => Number(c.value));
}

function reminderCount() {
  const all = document.querySelectorAll('.rem-pick').length;
  const n = reminderPicks().length;
  const count = document.getElementById('rem-count');
  const send = document.getElementById('rem-send');
  const box = document.getElementById('rem-all');
  if (count) count.textContent = all ? `${n} of ${all} ticked` : '';
  if (send) send.textContent = n ? `Send to ${n} Member${n !== 1 ? 's' : ''}` : 'Send';
  if (box) { box.checked = n > 0 && n === all; box.indeterminate = n > 0 && n < all; }
}

async function previewReminder(year) {
  let data;
  try { data = await api('POST', '/reminders/preview', { year, note: gv('rem-note') }); }
  catch (e) { return toast(e.data?.error || e.message, 'error'); }
  showModal(`
    <div class="text-muted" style="font-size:12px;margin-bottom:8px">Subject: <span style="color:var(--text)">${escHtml(data.subject)}</span></div>
    <iframe id="rem-preview" sandbox="" title="Email preview" style="width:100%;height:480px;border:1px solid var(--border);border-radius:8px;background:#fff"></iframe>
  `, 'Email Preview', [{ label: 'Close', cls: 'btn-secondary', fn: 'closeModal()' }]);
  document.getElementById('rem-preview').srcdoc = data.html;
}

async function testReminder(year) {
  try {
    const data = await api('POST', '/reminders/test', { year, note: gv('rem-note') });
    toast('Test sent to ' + data.to + ' ✓');
  } catch (e) { toast(e.data?.error || e.message, 'error'); }
}

async function sendReminders(year) {
  const ids = reminderPicks();
  if (!ids.length) return toast('Tick at least one member', 'error');
  if (!confirm(`Email a ${year} dues reminder to ${ids.length} member${ids.length !== 1 ? 's' : ''} now?`)) return;
  const btn = document.getElementById('rem-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  let data;
  try { data = await api('POST', '/reminders/send', { year, member_ids: ids, note: gv('rem-note') }); }
  catch (e) {
    toast(e.data?.error || e.message, 'error');
    btn.disabled = false;
    reminderCount();
    return;
  }
  const failed = data.failed || [];
  toast(`${data.sent} reminder${data.sent !== 1 ? 's' : ''} sent` + (failed.length ? `, ${failed.length} failed` : ' ✓'), failed.length ? 'error' : 'success');
  const note = gv('rem-note');
  await reminders();
  const noteBox = document.getElementById('rem-note');
  if (noteBox) noteBox.value = note;
  const res = document.getElementById('rem-result');
  if (!res) return;
  res.innerHTML = `
    <div class="card" style="border-color:${failed.length ? 'var(--danger)' : 'var(--success)'}">
      <div style="font-weight:600;margin-bottom:6px;color:${data.sent ? 'var(--success)' : 'var(--danger)'}">${data.sent} reminder${data.sent !== 1 ? 's' : ''} sent for ${year}</div>
      ${data.not_sent ? `<p class="text-muted" style="font-size:13px;margin:0 0 6px">${data.not_sent} left out: paid in the meantime, or reminded a few minutes ago.</p>` : ''}
      ${failed.length ? `<p style="font-size:13px;margin:0 0 6px">${failed.length} did not go out and can be sent again:</p>
        <ul style="font-size:13px;margin:0;padding-left:18px">${failed.map(f => `<li><span class="callsign">${escHtml(f.callsign || '')}</span> ${escHtml(f.name)} — <span class="text-muted">${escHtml(f.error)}</span></li>`).join('')}</ul>` : ''}
    </div>`;
}

// ── CALLSIGN REPORT ───────────────────────────────────────────────────
async function callsigns() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/callsigns');
    const count = data.callsigns.length;
    setPage(`
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-weight:600;font-size:15px">Active Member Callsigns</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${count} callsign${count !== 1 ? 's' : ''} · active, non-silent-key members</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="copyCallsigns()">Copy</button>
        </div>
        <textarea id="callsign-csv" readonly
          style="width:100%;min-height:120px;font-family:var(--mono);font-size:13px;
                 background:var(--bg);color:var(--text);border:1px solid var(--border);
                 border-radius:6px;padding:10px;resize:vertical;line-height:1.6"
        >${escHtml(data.csv)}</textarea>
      </div>
    `);
  } catch(e) { setPage(`<p class="text-muted" style="padding:24px">Error: ${escHtml(e.data?.error || e.message)}</p>`); }
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
    setPage(`
      <div class="card" style="padding:0">
        <div class="tbl-wrap"><table>
          <thead><tr><th>Email</th><th>Callsign</th><th>Name</th><th>Role</th><th>Status</th><th>2-Step</th><th>Last Login</th><th></th></tr></thead>
          <tbody>
            ${data.users.map(u => `<tr>
              <td>${escHtml(u.email)}</td>
              <td><span class="callsign">${escHtml(u.callsign||'—')}</span></td>
              <td>${escHtml(u.first_name||'')} ${escHtml(u.last_name||'')}</td>
              <td>${roleBadge(u.role)}</td>
              <td>${u.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Disabled</span>'}</td>
              <td>${u.two_step ? '<span class="badge badge-green">On</span>' : '<span class="text-muted">Off</span>'}</td>
              <td style="color:var(--text-muted)">${u.last_login ? fmtDate(u.last_login) : 'Never'}</td>
              <td>
                ${u.id !== state.user?.id ? `<button class="btn btn-sm btn-secondary" onclick="editUser(${u.id})">Edit</button>` : '<span class="text-muted" style="font-size:12px">You</span>'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-title">Change My Password</div>
        <div class="form-grid">
          ${fi('Current Password','cp-current','','password')}
          ${fi('New Password (10+ chars)','cp-new','','password')}
          ${fi('Confirm New Password','cp-confirm','','password')}
        </div>
        <button class="btn btn-primary mt-16" onclick="changeMyPassword()">Update Password</button>
      </div>
    `);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

function openAddUser() {
  showModal(`
    ${fi('Email','nu-email','','email','')}
    ${fi('Password (10+ chars)','nu-pass','','password')}
    <div class="form-group mt-8">
      <label>Role</label>
      <select id="nu-role">
        <option value="board">Board Member</option>
        <option value="admin">Admin</option>
        <option value="member">Member</option>
      </select>
    </div>
  `, 'Add User Account', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
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
  showModal(`
    <div class="form-group">
      <label>Email</label>
      <input type="text" value="${escHtml(u.email)}" disabled>
    </div>
    <div class="form-group mt-8">
      <label>Role</label>
      <select id="eu-role">
        ${['admin','board','member'].map(r => `<option value="${r}" ${u.role===r?'selected':''}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group mt-8">
      <label>Status</label>
      <select id="eu-active">
        <option value="1" ${u.is_active?'selected':''}>Active</option>
        <option value="0" ${!u.is_active?'selected':''}>Disabled</option>
      </select>
    </div>
  `, 'Edit User: ' + u.email, [
    { label: 'Cancel',         cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Delete',         cls: 'btn-danger',    fn: 'deleteUser(' + id + ')' },
    ...(u.two_step ? [{ label: 'Turn Off 2-Step', cls: 'btn-secondary', fn: 'adminResetTwoStep(' + id + ')' }] : []),
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
  showModal(`
    <div class="form-grid">
      ${fi('Current Password','cp-current','','password')}
      ${fi('New Password (10+ chars)','cp-new','','password')}
      ${fi('Confirm New Password','cp-confirm','','password')}
    </div>
    <div class="divider"></div>
    <div id="two-step-status" style="font-size:13px"></div>
  `, 'Password & Sign-in', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Update Password', cls: 'btn-primary', fn: 'changeMyPassword()' },
  ]);
  loadTwoStepStatus();
}

// ── Two-step sign-in (a code from an authenticator app after the password) ──
async function loadTwoStepStatus() {
  let status;
  try { status = await api('GET', '/auth/two-step'); } catch { return; }
  const el = document.getElementById('two-step-status');
  if (!el) return;
  const left = status.recovery_left;
  el.innerHTML = status.enabled
    ? `<div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1"><strong>Two-step sign-in is on.</strong>
          <div class="text-muted">Signing in asks for a code from your authenticator app. ${left} recovery code${left !== 1 ? 's' : ''} left.</div></div>
        <button class="btn btn-sm btn-secondary" onclick="openTwoStepOff()">Turn off…</button>
      </div>`
    : `<div style="display:flex;align-items:center;gap:12px">
        <div style="flex:1"><strong>Two-step sign-in is off.</strong>
          <div class="text-muted">Turn it on and signing in also asks for a 6-digit code from an authenticator app on your phone, so a stolen password is not enough.</div></div>
        <button class="btn btn-sm btn-primary" onclick="openTwoStepSetup()">Set up…</button>
      </div>`;
}

function openTwoStepSetup() {
  showModal(`
    <p style="font-size:13px;margin:0 0 12px">You need an authenticator app on your phone: Google Authenticator, Microsoft Authenticator, Authy, 1Password and the like all work. Type your password to start.</p>
    ${fi('Current Password','ts-pass','','password')}
  `, 'Set Up Two-Step Sign-in', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Continue', cls: 'btn-primary', fn: 'startTwoStepSetup()' },
  ]);
  document.getElementById('ts-pass').focus();
}

async function startTwoStepSetup() {
  let data;
  try { data = await api('POST', '/auth/two-step/setup', { password: gv('ts-pass') }); }
  catch (e) { return toast(e.data?.error || e.message, 'error'); }
  showModal(`
    <p style="font-size:13px;margin:0 0 12px"><strong>1.</strong> In your authenticator app, add an account and scan this code.</p>
    <div style="width:190px;margin:0 auto 10px;padding:8px;background:#fff;border-radius:8px">${data.qr}</div>
    <p class="text-muted" style="font-size:12px;text-align:center;margin:0 0 16px">Can't scan? Enter this key by hand:<br>
      <span style="font-family:var(--mono);color:var(--text);user-select:all">${escHtml(data.secret.replace(/(.{4})/g, '$1 ').trim())}</span></p>
    <p style="font-size:13px;margin:0 0 8px"><strong>2.</strong> Type the 6-digit code the app shows now.</p>
    <div class="form-group"><input type="text" id="ts-code" name="totp" placeholder="123456" autocomplete="one-time-code" maxlength="8"></div>
  `, 'Set Up Two-Step Sign-in', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Turn On', cls: 'btn-primary', fn: 'finishTwoStepSetup()' },
  ]);
  const code = document.getElementById('ts-code');
  code.addEventListener('keydown', e => { if (e.key === 'Enter') finishTwoStepSetup(); });
  code.focus();
}

async function finishTwoStepSetup() {
  let data;
  try { data = await api('POST', '/auth/two-step/enable', { code: gv('ts-code') }); }
  catch (e) { return toast(e.data?.error || e.message, 'error'); }
  const codes = data.recovery_codes || [];
  showModal(`
    <p style="font-size:13px;margin:0 0 12px"><strong>Two-step sign-in is on.</strong> Other browsers signed in to this login have been signed out.</p>
    <p style="font-size:13px;margin:0 0 12px">Save these recovery codes somewhere safe, away from your phone. Each one signs you in once if you lose the phone. <strong>They are not shown again.</strong></p>
    <div id="ts-recovery" style="font-family:var(--mono);font-size:15px;display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;padding:14px;border:1px solid var(--border);border-radius:8px;user-select:all">
      ${codes.map(c => `<div>${escHtml(c)}</div>`).join('')}
    </div>
  `, 'Recovery Codes', [
    { label: 'Copy', cls: 'btn-secondary', fn: 'copyRecoveryCodes()' },
    { label: 'I Saved Them', cls: 'btn-primary', fn: 'closeModal()' },
  ]);
  toast('Two-step sign-in is on ✓');
}

function copyRecoveryCodes() {
  const text = [...document.querySelectorAll('#ts-recovery div')].map(d => d.textContent).join('\n');
  navigator.clipboard.writeText(text).then(() => toast('Copied ✓'), () => toast('Could not copy; select the codes instead', 'error'));
}

function openTwoStepOff() {
  showModal(`
    <p style="font-size:13px;margin:0 0 12px">After this, your password alone signs you in.</p>
    <div class="form-grid">
      ${fi('Current Password','ts-pass','','password')}
      ${fi('Code from your app, or a recovery code','ts-code','','text')}
    </div>
  `, 'Turn Off Two-Step Sign-in', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'closeModal()' },
    { label: 'Turn Off', cls: 'btn-danger', fn: 'turnOffTwoStep()' },
  ]);
}

async function turnOffTwoStep() {
  try {
    await api('POST', '/auth/two-step/disable', { password: gv('ts-pass'), code: gv('ts-code') });
    toast('Two-step sign-in is off');
    closeModal();
  } catch (e) { toast(e.data?.error || e.message, 'error'); }
}

async function adminResetTwoStep(id) {
  if (!confirm('Turn off two-step sign-in for this user? Use this when they have lost their phone and their recovery codes. They are signed out and can sign in with their password alone.')) return;
  try {
    await api('DELETE', '/admin/users/' + id + '/two-step');
    toast('Two-step sign-in turned off for this user ✓');
    closeModal();
    users();
  } catch (e) { toast(e.data?.error || e.message, 'error'); }
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
    setPage(`
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Filter by callsign</label>
            <input id="audit-callsign" class="form-control" style="width:140px" placeholder="e.g. W4TRC"
              value="${escHtml(opts.callsign||'')}"
              onkeydown="if(event.key==='Enter')audit({action:document.getElementById('audit-action').value.trim(),callsign:this.value.trim().toUpperCase()})">
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Filter by action</label>
            <input id="audit-action" class="form-control" style="width:180px" placeholder="e.g. member.update"
              value="${escHtml(opts.action||'')}"
              onkeydown="if(event.key==='Enter')audit({callsign:document.getElementById('audit-callsign').value.trim().toUpperCase(),action:this.value.trim()})">
          </div>
          <button class="btn btn-primary" onclick="audit({callsign:document.getElementById('audit-callsign').value.trim().toUpperCase(),action:document.getElementById('audit-action').value.trim()})">Search</button>
          ${(opts.callsign||opts.action) ? '<button class="btn btn-secondary" onclick="audit()">Clear</button>' : ''}
        </div>
      </div>
      <div class="card" style="padding:0">
        <div class="tbl-wrap"><table>
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>
            ${data.log.map(r => {
              const _t = auditTarget(r), _d = auditDetail(r);
              return `<tr>
              <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(r.created_at)}</td>
              <td style="font-size:12px">${escHtml(auditUser(r))}</td>
              <td><code style="font-size:11px;color:var(--accent)">${escHtml(r.action)}</code></td>
              <td style="font-size:12px">${escHtml(_t)}</td>
              <td style="font-size:12px;color:var(--text-muted)">${escHtml(_d)}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>
    `);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

// ── ACTIVE SESSIONS ───────────────────────────────────────────────────
async function sessions() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/sessions');
    setPage(`
      <div class="card" style="padding:0">
        <div class="tbl-wrap"><table>
          <thead><tr><th>User</th><th>Role</th><th>Device</th><th>IP Address</th><th>Signed In</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            ${data.sessions.map(s => `<tr>
              <td>${escHtml(s.email)}${s.callsign ? ' <span class="callsign">' + escHtml(s.callsign) + '</span>' : ''}</td>
              <td>${roleBadge(s.role)}</td>
              <td title="${escHtml(s.user_agent)}">${escHtml(sessionDevice(s.user_agent))}</td>
              <td style="font-size:12px">${escHtml(s.ip_address||'—')}</td>
              <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(s.created_at)}</td>
              <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(s.expires_at)}</td>
              <td style="white-space:nowrap">
                ${s.current ? '<span class="badge badge-green">This device</span>' : ''}
                <button class="btn btn-sm btn-danger" onclick="revokeSession('${escHtml(s.id)}', ${s.current ? 'true' : 'false'})">Sign Out</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
      <p class="text-muted" style="font-size:12px;margin-top:12px">Everyone currently signed in. Signing a session out takes effect immediately; the user can log in again unless their account is disabled under User Accounts.</p>
    `);
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

// ── TREASURER REPORT ──────────────────────────────────────────────────
async function treasurer(year) {
  setPage('<div class="spinner"></div>');
  try {
    const r = await api('GET', '/admin/treasurer-report' + (year ? '?year=' + year : ''));
    const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const from = (x) => escHtml(x.name) + (x.callsign ? ' <span class="callsign">' + escHtml(x.callsign) + '</span>' : '');

    document.getElementById('topbar-actions').innerHTML =
      '<a class="btn btn-secondary" href="/print/treasurer?year=' + r.year + '" target="_blank" rel="noopener">Print</a> ' +
      '<button class="btn btn-secondary" onclick="exportTreasurerCSV(' + r.year + ')">⬇ Export CSV</button>';

    setPage(`
      <div class="year-row">
        ${r.years.map(y => `<div class="year-pill ${y === r.year ? 'active' : ''}" onclick="treasurer(${y})">${y}</div>`).join('')}
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-val">${money(r.totals.received)}</div><div class="stat-label">Received in ${r.year}</div></div>
        <div class="stat-card"><div class="stat-val">${money(r.totals.dues)}</div><div class="stat-label">Dues</div></div>
        <div class="stat-card"><div class="stat-val">${money(r.totals.donations)}</div><div class="stat-label">Donations</div></div>
        <div class="stat-card"><div class="stat-val">${r.totals.payments}</div><div class="stat-label">Payments</div></div>
      </div>
      ${r.ledger.length ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">By payment method</div>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Method</th><th>Dues</th><th>Donations</th><th>Total</th></tr></thead>
            <tbody>
              ${r.by_method.map(m => `
                <tr>
                  <td>${cap(m.method)}</td>
                  <td>${m.dues_count ? money(m.dues) + ' <span class="text-muted" style="font-size:12px">' + m.dues_count + '</span>' : '<span class="text-muted">—</span>'}</td>
                  <td>${m.donation_count ? money(m.donations) + ' <span class="text-muted" style="font-size:12px">' + m.donation_count + '</span>' : '<span class="text-muted">—</span>'}</td>
                  <td><strong>${money(m.total)}</strong></td>
                </tr>`).join('')}
              <tr><td><strong>Total</strong></td><td><strong>${money(r.totals.dues)}</strong></td><td><strong>${money(r.totals.donations)}</strong></td><td><strong>${money(r.totals.received)}</strong></td></tr>
            </tbody>
          </table></div>
        </div>
        ${r.dues_by_year.length ? `
          <div class="card" style="margin-bottom:16px">
            <div class="card-title">Dues by membership year</div>
            <div class="tbl-wrap"><table>
              <thead><tr><th>For</th><th>Payments</th><th>Amount</th></tr></thead>
              <tbody>${r.dues_by_year.map(d => `
                <tr>
                  <td>${d.dues_year} dues ${d.dues_year > r.year ? '<span class="badge badge-blue">Paid in advance</span>' : d.dues_year < r.year ? '<span class="badge badge-gray">Paid late</span>' : ''}</td>
                  <td>${d.count}</td>
                  <td>${money(d.amount)}</td>
                </tr>`).join('')}</tbody>
            </table></div>
          </div>` : ''}
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Payments</div>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Date</th><th>For</th><th>From</th><th>Method</th><th>Amount</th></tr></thead>
            <tbody>${r.ledger.map(l => `
              <tr>
                <td>${l.date ? escHtml(l.date) : '<span class="text-muted">—</span>'}</td>
                <td>${escHtml(l.detail)}</td>
                <td>${from(l)}</td>
                <td>${cap(l.method)}${l.check_number && l.method !== 'stripe' ? ' <span class="text-muted">#' + escHtml(l.check_number) + '</span>' : ''}</td>
                <td>${money(l.amount)}</td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>` : '<div class="card" style="margin-bottom:16px"><p class="text-muted" style="font-size:13px">No payments recorded for ' + r.year + '.</p></div>'}
      ${r.items.length ? `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Item donations — ${money(r.items_value)} estimated, not counted as money</div>
          <div class="tbl-wrap"><table>
            <thead><tr><th>Date</th><th>Item</th><th>From</th><th>Estimated value</th></tr></thead>
            <tbody>${r.items.map(i => `
              <tr>
                <td>${escHtml(i.date)}</td>
                <td>${escHtml(i.description || 'Item')}</td>
                <td>${from(i)}</td>
                <td>${i.estimated_value != null ? money(i.estimated_value) : '<span class="text-muted">—</span>'}</td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>` : ''}
      ${r.eastman.members ? '<p class="text-muted" style="font-size:12px;margin-bottom:6px">Not included above: Eastman sponsors ' + r.eastman.members + ' member' + (r.eastman.members !== 1 ? 's' : '') + ' for ' + r.year + ' at $3 each, ' + money(r.eastman.amount) + ' in all.</p>' : ''}
      ${r.undated ? '<p class="text-muted" style="font-size:12px;margin-bottom:6px">' + r.undated + ' dues payment' + (r.undated !== 1 ? 's have' : ' has') + ' no paid date and ' + (r.undated !== 1 ? 'are' : 'is') + ' counted in the year the dues are for.</p>' : ''}
      <p class="text-muted" style="font-size:12px">Money is counted in the year it was received: dues by paid date, donations by donation date. A renewal paid in October for next year is this year's money. Online payments are shown as charged, including the $1 processing fee; Stripe's own fees are not taken off.</p>
    `);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); }
}

async function exportTreasurerCSV(year) {
  try {
    const resp = await fetch('/api/admin/treasurer-report?format=csv&year=' + year, { credentials: 'include' });
    if (!resp.ok) { toast('Export failed', 'error'); return; }
    const url = URL.createObjectURL(await resp.blob());
    const a   = document.createElement('a');
    a.href     = url;
    a.download = `w4trc-treasurer-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { toast('Export failed: ' + e.message, 'error'); }
}

// ── OFFICERS ──────────────────────────────────────────────────────────
async function officers() {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/officers');
    state.officers = data;
    document.getElementById('topbar-actions').innerHTML =
      '<button class="btn btn-secondary" onclick="openOfficerPaste()">Paste a List</button> ' +
      '<button class="btn btn-primary" onclick="openOfficerForm()">+ Add Officer</button>';

    const years = [...new Set(data.officers.map(o => o.year))].sort((a, b) => b - a);
    const cell = (year, pos) => {
      const held = data.officers.filter(o => o.year === year && o.position === pos.key);
      return held.map(o => `
        <a class="officer" onclick="openOfficerForm(${o.id})" title="${o.notes ? escHtml(o.notes) : 'Edit'}">${escHtml(o.name)}${o.callsign ? ' <span class="callsign">' + escHtml(o.callsign) + '</span>' : ''}</a>`).join('<br>')
        || `<a class="officer text-muted" onclick="openOfficerForm(null, ${year}, '${pos.key}')" title="Add">+</a>`;
    };

    setPage(`
      ${years.length ? `
        <div class="card" style="padding:0">
          <div class="tbl-wrap"><table>
            <thead><tr><th>Year</th>${data.positions.map(p => '<th>' + escHtml(p.label) + '</th>').join('')}</tr></thead>
            <tbody>${years.map(y => `
              <tr><td><strong>${y}</strong></td>${data.positions.map(p => '<td>' + cell(y, p) + '</td>').join('')}</tr>`).join('')}</tbody>
          </table></div>
        </div>` : `
        <div class="card"><p class="text-muted" style="font-size:13px">No officers on record yet. Add one, or paste a list of past presidents.</p></div>`}
      <p class="text-muted" style="font-size:12px;margin-top:12px">Click a name to change or remove it, or a + to fill a gap. A year needs only the positions you know. This history is shown on the public <a href="/directory" target="_blank" rel="noopener">member directory</a>.</p>
    `);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.data?.error || e.message) + '</p>'); }
}

function officerPositionOptions(selected) {
  return state.officers.positions.map(p => `<option value="${p.key}" ${p.key === selected ? 'selected' : ''}>${escHtml(p.label)}</option>`).join('');
}

function openOfficerForm(id = null, year = null, position = null) {
  const o = id ? state.officers.officers.find(x => x.id === id) : null;
  showModal(`
    <div class="form-row">
      <div class="form-group" style="width:110px">
        <label>Year</label>
        <input type="number" id="of-year" min="${state.officers.first_year}" max="${state.officers.last_year}" value="${o?.year ?? year ?? new Date().getFullYear()}">
      </div>
      <div class="form-group" style="flex:1;min-width:160px">
        <label>Position</label>
        <select id="of-position">${officerPositionOptions(o?.position ?? position)}</select>
      </div>
    </div>
    <div class="form-row mt-8">
      <div class="form-group" style="width:110px">
        <label>Callsign</label>
        <input type="text" id="of-callsign" value="${escHtml(o?.callsign || '')}" style="text-transform:uppercase" autocomplete="off">
      </div>
      <div class="form-group" style="flex:1;min-width:160px">
        <label>Name</label>
        <input type="text" id="of-name" value="${escHtml(o?.name || '')}" autocomplete="off">
      </div>
    </div>
    <p class="text-muted" style="font-size:12px;margin-top:6px">Enter a name, a callsign, or both. For a member, the callsign alone is enough: the name comes from their record.</p>
    <div class="form-group mt-8">
      <label>Notes</label>
      <input type="text" id="of-notes" value="${escHtml(o?.notes || '')}" placeholder="e.g. took over in June">
    </div>
    <p id="of-error" style="font-size:13px;color:var(--danger);margin-top:10px"></p>
  `, o ? 'Edit Officer' : 'Add Officer', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    ...(o ? [{ label: 'Remove', cls: 'btn-danger', fn: 'removeOfficer(' + o.id + ')' }] : []),
    { label: 'Save', cls: 'btn-primary', fn: 'saveOfficer(' + (o ? o.id : 'null') + ')' },
  ]);
  document.getElementById(o ? 'of-name' : 'of-callsign').focus();
}

async function saveOfficer(id) {
  const body = {
    year: Number(document.getElementById('of-year').value),
    position: document.getElementById('of-position').value,
    callsign: document.getElementById('of-callsign').value.trim(),
    name: document.getElementById('of-name').value.trim(),
    notes: document.getElementById('of-notes').value.trim(),
  };
  try {
    await api(id ? 'PUT' : 'POST', '/officers' + (id ? '/' + id : ''), body);
    closeModal();
    toast('Officer saved ✓');
    officers();
  } catch(e) { document.getElementById('of-error').textContent = e.data?.error || e.message; }
}

async function removeOfficer(id) {
  try {
    await api('DELETE', '/officers/' + id);
    closeModal();
    toast('Officer removed ✓');
    officers();
  } catch(e) { document.getElementById('of-error').textContent = e.data?.error || e.message; }
}

function openOfficerPaste() {
  showModal(`
    <div class="form-group">
      <label>Position</label>
      <select id="op-position">${officerPositionOptions('president')}</select>
    </div>
    <div class="form-group mt-8">
      <label>One per line: the year, then the name, then the callsign if there is one</label>
      <textarea id="op-text" rows="12" style="font-family:monospace;font-size:13px" placeholder="1985 John Smith W4ABC&#10;1986-1988 Mary Jones, K4XYZ&#10;1989 Bob Brown"></textarea>
    </div>
    <p class="text-muted" style="font-size:12px;margin-top:6px">A range such as 1986-1988 adds every year in it. Anyone already listed is skipped. If a line cannot be read, nothing is added.</p>
    <div id="op-error" style="font-size:13px;color:var(--danger);margin-top:10px"></div>
  `, 'Paste a List of Officers', [
    { label: 'Cancel', cls: 'btn-secondary', fn: 'dismissModal()' },
    { label: 'Add', cls: 'btn-primary', fn: 'saveOfficerPaste()' },
  ]);
  document.getElementById('op-text').focus();
}

async function saveOfficerPaste() {
  try {
    const result = await api('POST', '/officers/bulk', {
      position: document.getElementById('op-position').value,
      text: document.getElementById('op-text').value,
    });
    closeModal();
    toast('Added ' + result.added + (result.already_listed ? ', ' + result.already_listed + ' already listed' : '') + ' ✓');
    officers();
  } catch(e) {
    const lines = (e.data?.details || []).map(d => '<div>' + (d.line ? 'Line ' + d.line + ': ' : '') + escHtml(d.error) + ' <span class="text-muted">' + escHtml(d.text) + '</span></div>').join('');
    document.getElementById('op-error').innerHTML = escHtml(e.data?.error || e.message) + lines;
  }
}

// ── GOOGLE GROUPS ─────────────────────────────────────────────────────
async function googleGroups(lastRun, audit) {
  setPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/admin/google-sync');
    document.getElementById('topbar-actions').innerHTML = data.configured
      ? '<button class="btn btn-secondary" onclick="runGoogleAudit()">Audit Groups</button> <button class="btn btn-primary" onclick="runGoogleSync()">Sync Now</button>' : '';

    const emailList = (label, emails) => emails.length ? `
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:13px">${label} (${emails.length})</summary>
        <div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.7">${emails.map(escHtml).join('<br>')}</div>
      </details>` : '';

    setPage(`
      ${data.configured ? '' : `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">Not set up yet</div>
          <p style="font-size:13px;color:var(--text-muted)">The sync needs a Google service account key (the GOOGLE_SERVICE_ACCOUNT_KEY secret). Until it is added, nothing is sent to Google. The lists below show what would be synced. See "Google Groups" in the README.</p>
        </div>`}
      ${lastRun?.error ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--danger)">
          <div class="card-title" style="color:var(--danger)">Sync stopped</div>
          <p style="font-size:13px">${escHtml(lastRun.error)}</p>
        </div>` : ''}
      ${data.years.map(y => {
        const ran = lastRun?.years?.find(r => r.year === y.year);
        const pending = y.to_add.length + y.to_remove.length;
        return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">${y.year} — ${escHtml(y.group)}</div>
          <p style="font-size:13px">
            ${pending ? '<span class="badge badge-yellow">' + pending + ' pending</span>' : '<span class="badge badge-green">Up to date</span>'}
            <span style="margin-left:8px">${y.in_group} current member${y.in_group !== 1 ? 's' : ''} in the group</span>
          </p>
          ${y.no_email ? '<p style="font-size:12px;color:var(--text-muted);margin-top:6px">' + y.no_email + ' current member' + (y.no_email !== 1 ? 's have' : ' has') + ' no email on file and cannot be added.</p>' : ''}
          ${emailList('To add', y.to_add)}
          ${emailList('To remove', y.to_remove)}
          ${ran ? `
            <p style="font-size:12px;color:var(--text-muted);margin-top:10px">Last sync: added ${ran.added.length}, removed ${ran.removed.length}${ran.pending ? ', ' + ran.pending + ' left for the next run' : ''}.</p>
            ${ran.errors.map(e => '<p style="font-size:12px;color:var(--danger);margin-top:4px">' + escHtml(e) + '</p>').join('')}` : ''}
        </div>`;
      }).join('')}
      ${data.years.length ? '' : '<div class="card" style="margin-bottom:16px"><p style="font-size:13px;color:var(--text-muted)">No group is being synced right now. The sync starts with the year set in GOOGLE_SYNC_START_YEAR.</p></div>'}
      <p class="text-muted" style="font-size:12px">Current members are added to their year's group automatically every hour. The sync only removes addresses it added itself; anyone added to a group by hand in Google is left alone. Groups are not created automatically.</p>
      ${audit ? googleAuditHtml(audit) : ''}
    `);
  } catch(e) { setPage('<p class="text-muted">Error: ' + escHtml(e.message) + '</p>'); }
}

// Each group as Google has it, set against the membership list
function googleAuditHtml(audit) {
  const who = (members) => members.length
    ? members.map(m => escHtml(m.name) + (m.callsign ? ' <span class="callsign">' + escHtml(m.callsign) + '</span>' : '')).join(', ')
    : '';
  const roleBadge = (role) => role === 'MEMBER' ? '' : ' <span class="badge badge-blue">' + escHtml(role.charAt(0) + role.slice(1).toLowerCase()) + '</span>';

  return `
    <h3 style="margin:24px 0 12px">Audit</h3>
    ${audit.error ? `
      <div class="card" style="margin-bottom:16px;border-color:var(--danger)">
        <div class="card-title" style="color:var(--danger)">Audit stopped</div>
        <p style="font-size:13px">${escHtml(audit.error)}</p>
      </div>` : ''}
    ${audit.years.filter(y => y.error || y.group_size !== null).map(y => {
      if (y.error) return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">${y.year} — ${escHtml(y.group)}</div>
          <p style="font-size:13px;color:var(--danger)">${escHtml(y.error)}</p>
        </div>`;
      // Missing first, then by address
      const expected = [...y.expected].sort((a, b) => (a.in_group - b.in_group) || a.email.localeCompare(b.email));
      const missing = expected.filter(e => !e.in_group).length;
      return `
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">${y.year} — ${escHtml(y.group)}</div>
          <p style="font-size:13px">
            ${missing ? '<span class="badge badge-red">' + missing + ' missing</span>' : '<span class="badge badge-green">Nobody missing</span>'}
            ${y.extra.length ? '<span class="badge badge-yellow" style="margin-left:6px">' + y.extra.length + ' not current member' + (y.extra.length !== 1 ? 's' : '') + '</span>' : ''}
            <span style="margin-left:8px">${y.expected.length} should be in the group; Google has ${y.group_size}</span>
          </p>
          ${expected.length ? `
            <div class="tbl-wrap" style="margin-top:12px;max-height:420px"><table>
              <thead><tr><th>Should be in the group</th><th>Member</th><th>In Google</th></tr></thead>
              <tbody>${expected.map(e => `
                <tr>
                  <td>${escHtml(e.email)}</td>
                  <td>${who(e.members) || '<span class="text-muted">Always added</span>'}</td>
                  <td>${e.in_group ? '<span class="badge badge-green">Yes</span>'
                    : '<span class="badge badge-red">Missing</span>' + (e.tracked ? ' <span class="text-muted" style="font-size:12px">the sync added it earlier; it has since been removed or left</span>' : '')}</td>
                </tr>`).join('')}</tbody>
            </table></div>` : '<p class="text-muted" style="font-size:13px;margin-top:8px">No current members for this year yet.</p>'}
          ${y.extra.length ? `
            <div class="tbl-wrap" style="margin-top:16px;max-height:420px"><table>
              <thead><tr><th>In Google, not a current member</th><th>On the membership list as</th></tr></thead>
              <tbody>${[...y.extra].sort((a, b) => a.email.localeCompare(b.email)).map(e => `
                <tr>
                  <td>${escHtml(e.email)}${roleBadge(e.role)}</td>
                  <td>${e.members.length ? who(e.members) + ' <span class="text-muted" style="font-size:12px">not current for ' + y.year + '</span>' : '<span class="text-muted">Nobody</span>'}</td>
                </tr>`).join('')}</tbody>
            </table></div>` : ''}
          ${y.no_email.length ? '<p style="font-size:12px;color:var(--text-muted);margin-top:12px">No email on file, so cannot be in the group: ' + who(y.no_email) + '</p>' : ''}
          ${y.club_addresses ? '<p style="font-size:12px;color:var(--text-muted);margin-top:12px">' + y.club_addresses + ' club address' + (y.club_addresses !== 1 ? 'es' : '') + ' (' + escHtml(y.group.slice(y.group.lastIndexOf('@'))) + ') in the group ' + (y.club_addresses !== 1 ? 'are' : 'is') + ' not listed: officers manage the group from their club email.</p>' : ''}
        </div>`;
    }).join('')}
    <p class="text-muted" style="font-size:12px">The audit reads each group from Google and changes nothing. A missing address that the sync added earlier is not added again automatically.</p>
  `;
}

async function runGoogleAudit() {
  setPage('<div class="spinner"></div>');
  try {
    googleGroups(null, await api('GET', '/admin/google-audit'));
  } catch(e) {
    toast(e.data?.error || e.message, 'error');
    googleGroups();
  }
}

async function runGoogleSync() {
  setPage('<div class="spinner"></div>');
  try {
    const result = await api('POST', '/admin/google-sync');
    const problems = Boolean(result.error) || result.years.some(y => y.errors.length);
    toast(problems ? 'Sync finished with problems' : 'Google Groups synced ✓', problems ? 'error' : 'success');
    googleGroups(result);
  } catch(e) {
    toast(e.data?.error || e.message, 'error');
    googleGroups();
  }
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
    if (name && call) return `${name} (${call})`;
    if (name) return name;
    if (call) return call;
    return `member #${r.target_id}`;
  }
  if (r.target_type === 'membership') {
    const name = r.target_name || '';
    const call = r.target_callsign ? ` (${r.target_callsign})` : '';
    const year = r.target_year || d?.year || '';
    if (name) return `${year ? year + ' dues — ' : ''}${name}${call}`;
    return `membership #${r.target_id}`;
  }
  if (r.target_type === 'donation') {
    const name = r.target_name || d?.donor_name || '';
    const call = r.target_callsign ? ` (${r.target_callsign})` : '';
    if (name) return 'Donation — ' + name + call;
    if (d?.member_id) return `Donation — member #${d.member_id}`;
    return r.action === 'donation.stripe_paid' ? 'Donation — anonymous' : `donation #${r.target_id}`;
  }
  if (r.target_type === 'user') return d?.email || `user #${r.target_id}`;
  if (r.target_type === 'inventory_item' || r.target_type === 'inventory_location') return d?.name || `item #${r.target_id}`;
  if (r.target_type === 'repeater') return d?.name || `repeater #${r.target_id}`;
  if (r.target_type === 'note') return d?.member_id ? `note for member #${d.member_id}` : `note #${r.target_id}`;
  return '—';
}

// Stripe webhook entries have no signed-in user behind them
function auditUser(r) {
  if (r.user_email) return r.user_email;
  if (r.action?.endsWith('.stripe_paid')) return 'Stripe (online)';
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
      return changed.length ? `Changed: ${changed.join(', ')}` : '';
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
    case 'agenda.create':      return d.meeting_date ? d.meeting_date + (d.carried ? ' — ' + d.carried + ' item' + (d.carried !== 1 ? 's' : '') + ' carried over' : '') : '';
    case 'agenda.delete':      return d.meeting_date || '';
    case 'agenda.carry':       return d.carried + ' item' + (d.carried !== 1 ? 's' : '') + ' carried over';
    case 'agenda.item.create':
    case 'agenda.item.delete': return ({ old: 'Old business', new: 'New business', announcement: 'Announcement' }[d.section] || 'Item') + ': ' + (d.title || '');
    case 'agenda.motion.create':
    case 'agenda.motion.delete': return d.motion || '';
    case 'repeater.create':    return d.output_freq ? d.output_freq + ' MHz' : '';
    case 'repeater.update':    return d.changed?.length ? 'Changed: ' + d.changed.map(k => k.replace(/_/g, ' ')).join(', ') : '';
    case 'repeater.visit.create':
    case 'repeater.visit.update':
    case 'repeater.visit.delete': return 'Visit ' + [d.visit_date, d.purpose].filter(Boolean).join(' — ');
    case 'repeater.report.create':
    case 'repeater.report.update':
    case 'repeater.report.delete': return 'Report: ' + [d.category, d.status].filter(Boolean).join(', ');
    case 'repeater.maintenance.create':
    case 'repeater.maintenance.update':
    case 'repeater.maintenance.delete': return [d.title, d.done_date ? 'done ' + d.done_date : '', d.next_due ? 'due ' + d.next_due : ''].filter(Boolean).join(' — ');
    case 'repeater.contact.create':
    case 'repeater.contact.update':
    case 'repeater.contact.delete': return 'Contact: ' + (d.contact || '');
    case 'repeater.note.create':
    case 'repeater.note.update':
    case 'repeater.note.delete': return 'Note: ' + (d.note || '');
    case 'repeater.photo.create':
    case 'repeater.photo.delete': return 'Photo' + (d.caption ? ': ' + d.caption : '');
    case 'repeater.document.create':
    case 'repeater.document.delete': return 'File: ' + (d.title || d.filename || '');
    case 'inventory.update':   return d.changed?.length ? 'Changed: ' + d.changed.map(k => k.replace(/_/g, ' ')).join(', ') : '';
    case 'inventory.move':     return [d.event_type === 'checked_out' ? 'checked out' : 'moved', d.event_date].filter(Boolean).join(' — ');
    case 'membership.create':  return d.year ? 'Year ' + d.year : '';
    case 'member.callsign_changed': return d.from && d.to ? 'Callsign ' + d.from + ' → ' + d.to + ' (from the FCC)' : '';
    case 'membership.stripe_paid': {
      const covered = d.covered_member_ids?.length || 0;
      return 'Paid $' + d.amount_paid + ' online for ' + d.year + ' dues'
        + (covered ? ', covers ' + covered + ' family member' + (covered !== 1 ? 's' : '') : '');
    }
    case 'donation.stripe_paid': return 'Donated $' + d.amount + ' online';
    case 'member.renewal_activated': return d?.activated_count != null ? d.activated_count + ' renewed member' + (d.activated_count !== 1 ? 's' : '') + ' activated for ' + d.year : '';
    case 'member.cutoff':      return d?.deactivated_count != null ? d.deactivated_count + ' member' + (d.deactivated_count !== 1 ? 's' : '') + ' set inactive for ' + d.year : '';
    case 'login.failed':       return [d.email, d.reason?.replace(/_/g, ' ')].filter(Boolean).join(' — ');
    case 'login.success':      return d.recovery_code ? 'Signed in with a recovery code' : '';
    case 'two_step.reset':     return d.email ? 'Two-step sign-in turned off for ' + d.email : '';
    case 'reminder.sent':      return d.sent_count + ' renewal reminder' + (d.sent_count !== 1 ? 's' : '') + ' emailed for ' + d.year + (d.failed_count ? ', ' + d.failed_count + ' failed' : '');
    case 'reminder.test':      return 'Test reminder for ' + d.year;
    case 'user.create':        return [d.email, d.role ? 'role: ' + d.role : ''].filter(Boolean).join(', ');
    case 'user.update': {
      const skip = new Set(['password_hash', 'updated_at', 'created_at', 'id']);
      const keys = Object.keys(d).filter(k => !skip.has(k)).map(k => k.replace(/_/g, ' '));
      return keys.length ? `Changed: ${keys.join(', ')}` : '';
    }
    default: return '';
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────
// True once something in the open window has been typed or changed. Closing
// it (Cancel, a click outside, Escape, ✕, Back) asks first; a finished save
// does not.
let modalDirty = false;
const DISCARD_MSG = 'Discard the changes you have not saved?';

// The same for the member's own profile form, which is a page, not a window.
// The directory switch on that page saves by itself, so it does not count.
let pageDirty = false;
document.getElementById('portal-page').addEventListener('input', e => {
  if (e.target.id?.startsWith('pf-') && e.target.id !== 'pf-directory') pageDirty = true;
});

function leavePageOk() {
  if (pageDirty && !confirm(DISCARD_MSG)) return false;
  pageDirty = false;
  return true;
}
for (const type of ['input', 'change']) {
  document.getElementById('modal-root').addEventListener(type, () => { modalDirty = true; });
}

function dismissModal() {
  if (modalDirty && !confirm(DISCARD_MSG)) return;
  closeModal();
}

function showModal(bodyHtml, title, buttons) {
  modalDirty = false;
  const btns = buttons.map(b => `<button class="btn ${b.cls}" onclick="${b.fn}">${b.label}</button>`).join('');
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)dismissModal()">
      <div class="modal">
        <div class="modal-header">
          <h3>${escHtml(title)}</h3>
          <button class="btn btn-sm btn-secondary" onclick="dismissModal()">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-footer">${btns}</div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  modalDirty = false;
  if (state.pagePath) setUrl(state.pagePath, true);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const modalOpen = !!document.querySelector('.modal-backdrop');

  if (e.key === 'Escape' && modalOpen) { dismissModal(); return; }

  if (!modalOpen && state.currentPage === 'members') {
    if (e.key === '/') { e.preventDefault(); document.getElementById('member-search')?.focus(); return; }
    if (e.key === 'n' || e.key === 'N') { openAddMember(); return; }
  }
});

// ── Form helpers ──────────────────────────────────────────────────────
function fi(label, id, val='', type='text', placeholder='', required=false) {
  if (type === 'textarea') {
    return `<div class="form-group full"><label>${escHtml(label)}${required?' *':''}</label><textarea id="${id}">${escHtml(String(val))}</textarea></div>`;
  }
  if (type === 'select') {
    return `<div class="form-group"><label>${escHtml(label)}${required?' *':''}</label><select id="${id}"></select></div>`;
  }
  return `<div class="form-group"><label>${escHtml(label)}${required?' *':''}</label><input type="${type}" id="${id}" value="${escHtml(String(val))}" placeholder="${escHtml(placeholder)}"></div>`;
}

function dfield(label, val) {
  return `<div class="detail-field"><label>${escHtml(label)}</label><div class="val">${val||'<span class="text-muted">—</span>'}</div></div>`;
}

function gv(id) { return document.getElementById(id)?.value || ''; }

// ── Badge helpers ─────────────────────────────────────────────────────
function licenseBadge(cls) {
  if (!cls) return '<span class="badge badge-gray">Unknown</span>';
  const map = { 'Amateur Extra': 'badge-blue', 'General': 'badge-green', 'Technician': 'badge-yellow' };
  return `<span class="badge ${map[cls]||'badge-gray'}">${escHtml(cls)}</span>`;
}

function mismatchWarning(m) {
  let hamData = {};
  try { hamData = JSON.parse(m.hamdb_mismatch_data || '{}'); } catch {}
  const hamName = [hamData.first_name, hamData.last_name].filter(Boolean).join(' ') || '(unknown)';
  const ourName = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return `
    <div style="background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.4);border-radius:var(--radius);padding:14px 16px;margin-bottom:20px">
      <div style="font-weight:600;color:var(--warn);margin-bottom:6px">⚠ Callsign may have changed hands</div>
      <div style="font-size:13px;margin-bottom:10px">
        HamDB now shows <strong>${escHtml(hamName)}</strong> for <span class="callsign" style="font-size:13px">${escHtml(m.callsign)}</span>,
        but our record has <strong>${escHtml(ourName)}</strong>.
        The callsign may have been reassigned by the FCC.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-secondary" onclick="resolveCallsign(${m.id},'keep')">Keep Our Record</button>
        <button class="btn btn-sm btn-danger"    onclick="resolveCallsign(${m.id},'update')">Update from HamDB</button>
      </div>
    </div>
  `;
}

async function resolveCallsign(memberId, action) {
  try {
    await api('POST', `/members/${memberId}/resolve-callsign`, { action });
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
  return `<span class="badge ${map[role]||'badge-gray'}">${escHtml(role)}</span>`;
}

// ── LOCAL HAMS (PROSPECTS) ────────────────────────────────────────────
let prospectsState = { q:'', city:'all', status:'all', postcard:'all', license_age:'all', added:'all', page:1, data:null, stats:null };

async function prospects() {
  prospectsState = { q:'', city:'all', status:'all', postcard:'all', license_age:'all', added:'all', page:1, data:null, stats:null };
  setPage(`
    <div id="prospects-stats" class="stat-grid" style="margin-bottom:16px"></div>
    <div id="prospects-fcc" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;font-size:12px;color:var(--text-muted)"></div>
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
        <option value="gone">No Longer Local</option>
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
      <select id="prospect-added" onchange="prospectsState.added=this.value;prospectsState.page=1;loadProspects()" style="width:170px">
        <option value="all">All Hams</option>
        <option value="7">New this week</option>
        <option value="30">New in last 30 days</option>
        <option value="90">New in last 90 days</option>
        <option value="auto">All added from FCC</option>
      </select>
      <span id="prospect-count" style="margin-left:auto;color:var(--text-muted);font-size:12px"></span>
    </div>
    <div class="card" style="padding:0">
      <div id="prospects-results"><div class="spinner"></div></div>
      <div id="prospects-pagination" style="padding:12px 16px;display:flex;gap:8px;align-items:center"></div>
    </div>
    <div id="prospect-modal-wrap"></div>
  `);
  loadFccStatus();
  await loadProspects();
}

// Show only the hams added from the FCC in the last N days (or 'all')
function showNewProspects(added) {
  prospectsState.added = added;
  prospectsState.page = 1;
  const sel = document.getElementById('prospect-added');
  if (sel) sel.value = added;
  loadProspects();
}

function prospectReasonLabel(reason) {
  return { new_license: 'New license', new_callsign: 'New callsign', new_to_list: 'New to the area', backfill: 'Caught up from FCC' }[reason] || 'Added from FCC';
}

// Why the FCC says a ham is no longer local
function prospectGoneLabel(gone) {
  return { moved: 'Moved away', expired: 'License expired', cancelled: 'License cancelled' }[gone] || '';
}

// Show only the hams the FCC says are no longer local
function showGoneProspects() {
  prospectsState.status = 'gone';
  prospectsState.page = 1;
  const sel = document.getElementById('prospect-status');
  if (sel) sel.value = 'gone';
  loadProspects();
}

// Added from the FCC in the last 30 days
function isNewProspect(p) {
  if (!p.auto_added_at) return false;
  const t = Date.parse(String(p.auto_added_at).replace(' ', 'T') + 'Z');
  return Date.now() - t < 30 * 86400000;
}

async function loadFccStatus() {
  const el = document.getElementById('prospects-fcc');
  if (!el) return;
  try {
    const { imports } = await api('GET', '/prospects/fcc');
    const last = imports[0];
    el.innerHTML = `
      <span>New Church Hill, Kingsport, and Mount Carmel licensees are added daily from the FCC.
        ${last ? 'Last checked ' + escHtml(fmtDate(last.checked_at)) + '.' : 'Not checked yet.'}</span>
      ${state.user?.role === 'admin' ? '<button class="btn btn-sm btn-secondary" id="fcc-check-btn" onclick="runFccCheck()">Check FCC now</button>' : ''}
    `;
  } catch(e) { el.innerHTML = ''; }
}

// Check every FCC daily file from the past week, one request per file
async function runFccCheck() {
  const btn = document.getElementById('fcc-check-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  let added = 0, updated = 0, gone = 0, renamed = 0, errors = 0;
  for (const day of ['mon','tue','wed','thu','fri','sat','sun']) {
    try {
      const r = await api('POST', `/prospects/fcc?day=${day}`);
      if (r.error) errors++;
      added   += r.added?.length   || 0;
      updated += r.updated?.length || 0;
      gone    += r.gone?.length    || 0;
      renamed += r.renamed?.length || 0;
    } catch(e) { errors++; }
  }
  toast(`FCC check: ${added} new, ${updated} updated${gone ? ', ' + gone + ' no longer local' : ''}${renamed ? ', ' + renamed + ' member callsign(s) changed' : ''}${errors ? ', ' + errors + ' file(s) failed' : ''}`, errors ? 'error' : undefined);
  prospectsState.stats = null;
  loadFccStatus();
  loadProspects();
}

async function loadProspects() {
  const s = prospectsState;
  const params = new URLSearchParams({ q: s.q, city: s.city, status: s.status, postcard: s.postcard, license_age: s.license_age, added: s.added, page: s.page });
  const resultsEl = document.getElementById('prospects-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '<div class="spinner"></div>';

  try {
    const [data, stats] = await Promise.all([
      api('GET', `/prospects?${params}`),
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
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-val">${stats?.total ?? '—'}</div><div class="stat-label">Total Hams</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.member_count ?? '—'}</div><div class="stat-label">Already Members</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.non_member_count ?? '—'}</div><div class="stat-label">Not Yet Members</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.not_contacted ?? '—'}</div><div class="stat-label">Not Contacted</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.contacted ?? '—'}</div><div class="stat-label">Contacted</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.interested ?? '—'}</div><div class="stat-label">Interested</div></div>
    <div class="stat-card"><div class="stat-val">${stats?.postcard_sent ?? '—'}</div><div class="stat-label">Postcards Sent</div></div>
    <div class="stat-card" style="cursor:pointer" title="Show hams added from the FCC in the last 30 days" onclick="showNewProspects('30')"><div class="stat-val">${stats?.new_30 ?? '—'}</div><div class="stat-label">New (30 days)</div></div>
    <div class="stat-card" style="cursor:pointer" title="Show non-members who moved away or whose license expired or was cancelled" onclick="showGoneProspects()"><div class="stat-val">${stats?.gone_count ?? '—'}</div><div class="stat-label">No Longer Local</div></div>
  `;

  const countEl = document.getElementById('prospect-count');
  if (countEl) countEl.textContent = total + ' results';

  const resultsEl = document.getElementById('prospects-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = `
    <div class="tbl-wrap">
      <table>
        <thead><tr>
          <th>Callsign</th><th>Name</th><th>City</th><th>ZIP</th><th>Address</th>
          <th>Member?</th><th>Outreach</th><th>Postcard</th><th></th>
        </tr></thead>
        <tbody>
          ${ps.length === 0 ? '<tr><td colspan="9" style="color:var(--text-muted);text-align:center;padding:24px">No results</td></tr>' :
            ps.map(p => `
              <tr>
                <td><span class="callsign">${escHtml(p.callsign)}</span>${isNewProspect(p) ? ` <span class="badge badge-purple" title="${escHtml(prospectReasonLabel(p.added_reason) + ', added ' + fmtDate(p.auto_added_at))}">New</span>` : ''}${p.fcc_gone ? ` <span class="badge badge-gray" title="${escHtml('From the FCC, ' + fmtDate(p.fcc_gone_at))}">${escHtml(prospectGoneLabel(p.fcc_gone))}</span>` : ''}</td>
                <td>${escHtml((p.first_name||'') + ' ' + (p.last_name||''))}</td>
                <td>${escHtml(p.city||'')}</td>
                <td style="color:var(--text-muted);font-size:12px">${escHtml(p.zip||'')}</td>
                <td style="font-size:12px;color:var(--text-muted)">${p.address ? escHtml(p.address) : '<span style="opacity:.3">—</span>'}</td>
                <td>${p.member_id ? `<span class="badge badge-green" title="Active Member">Member</span>` : ''}</td>
                <td>${p.member_id ? '' : prospectStatusBadge(p.outreach_status)}</td>
                <td>${p.postcard_sent ? '<span class="badge badge-blue">Sent</span>' : ''}</td>
                <td><button class="btn btn-sm btn-secondary" onclick="openProspectModal(${JSON.stringify(p).replace(/"/g,'&quot;')})">Edit</button></td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const pagEl = document.getElementById('prospects-pagination');
  if (pagEl) {
    if (totalPages > 1) {
      pagEl.innerHTML = `
        <button class="btn btn-sm btn-secondary" ${page<=1?'disabled':''} onclick="prospectsState.page=${page-1};loadProspects()">‹ Prev</button>
        <span style="font-size:12px;color:var(--text-muted)">Page ${page} of ${totalPages} (${total} total)</span>
        <button class="btn btn-sm btn-secondary" ${page>=totalPages?'disabled':''} onclick="prospectsState.page=${page+1};loadProspects()">Next ›</button>
      `;
    } else {
      pagEl.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">${total} results</span>`;
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
  wrap.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeProspectModal()">
      <div class="modal" style="max-width:520px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3><span class="callsign">${escHtml(p.callsign)}</span> — ${escHtml((p.first_name||'') + ' ' + (p.last_name||''))}</h3>
          <button class="btn btn-sm btn-secondary" onclick="closeProspectModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid" style="margin-bottom:20px">
            ${p.address ? `<div class="detail-field" style="grid-column:1/-1"><label>Address</label><div class="val">${escHtml(p.address)}</div></div>` : `<div class="detail-field" style="grid-column:1/-1"><label>Address</label><div class="val" style="color:var(--text-muted)">Not yet synced from HamDB</div></div>`}
            <div class="detail-field"><label>City</label><div class="val">${escHtml(p.city||'—')}</div></div>
            <div class="detail-field"><label>ZIP</label><div class="val">${escHtml(p.zip||'—')}</div></div>
            <div class="detail-field"><label>State</label><div class="val">${escHtml(p.state||'—')}</div></div>
            ${p.email ? `<div class="detail-field"><label>Email</label><div class="val">${escHtml(p.email)}</div></div>` : ''}
            ${p.license_class ? `<div class="detail-field"><label>License Class</label><div class="val">${escHtml(p.license_class)}</div></div>` : ''}
            ${p.license_granted ? `<div class="detail-field"><label>Granted</label><div class="val">${escHtml(fmtDate(p.license_granted))}</div></div>` : ''}
            ${p.license_expiry ? `<div class="detail-field"><label>Expires</label><div class="val">${escHtml(p.license_expiry)}</div></div>` : ''}
            ${p.fcc_gone ? `<div class="detail-field" style="grid-column:1/-1"><label>No longer local</label><div class="val">${escHtml(prospectGoneLabel(p.fcc_gone))} — from the FCC, ${escHtml(fmtDate(p.fcc_gone_at))}</div></div>` : ''}
            ${p.auto_added_at ? `<div class="detail-field" style="grid-column:1/-1"><label>Added from FCC</label><div class="val">${escHtml(prospectReasonLabel(p.added_reason))} — ${escHtml(fmtDate(p.auto_added_at))}</div></div>` : ''}
          </div>

          ${p.member_id ? `
            <div class="card" style="background:rgba(46,204,113,.08);border-color:rgba(46,204,113,.3);margin-bottom:16px">
              <p style="color:var(--success);margin:0">✓ Already a KARC member${p.member_active ? '' : ' (inactive)'}.</p>
            </div>
          ` : `
            <div class="form-group" style="margin-bottom:16px">
              <label>Outreach Status</label>
              <select id="pm-status">
                <option value="not_contacted" ${p.outreach_status==='not_contacted'?'selected':''}>Not Contacted</option>
                <option value="contacted"     ${p.outreach_status==='contacted'?'selected':''}>Contacted</option>
                <option value="interested"    ${p.outreach_status==='interested'?'selected':''}>Interested</option>
                <option value="not_interested"${p.outreach_status==='not_interested'?'selected':''}>Not Interested</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:16px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" id="pm-postcard" ${p.postcard_sent?'checked':''} style="width:auto">
                Postcard Sent
              </label>
              <input type="date" id="pm-postcard-date" value="${p.postcard_sent_date||''}" style="margin-top:8px">
            </div>
          `}
          <div class="form-group">
            <label>Notes</label>
            <textarea id="pm-notes" rows="3">${escHtml(p.notes||'')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeProspectModal()">Cancel</button>
          <button class="btn btn-primary" onclick="saveProspect(${p.id}, ${!!p.member_id})">Save</button>
        </div>
      </div>
    </div>
  `;
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
    const res = await api('PUT', `/prospects/${id}`, body);
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

// Today's date (YYYY-MM-DD) where the officer is. toISOString() is UTC, which is
// already tomorrow after 8 PM Eastern.
function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Regexes here use [0-9], not \d: this script sits in a template string, which drops lone backslashes.
function fmtDate(iso) {
  if (!iso) return '—';
  const s = String(iso).trim().replace(' ', 'T');

  // A plain date (paid date, donation date) is a calendar day with no time or
  // zone. Show it as that day; read as UTC midnight it lands a day early here.
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // D1 returns UTC datetimes as "YYYY-MM-DD HH:MM:SS" (no Z). Without a zone,
  // browsers read that as local time, so mark it UTC unless it already has one.
  const d = new Date(/(Z|[+-][0-9]{2}:?[0-9]{2})$/.test(s) ? s : s + 'Z');
  if (isNaN(d)) return String(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════
// MEMBER PORTAL
// ═══════════════════════════════════════════════════════════════

// ── Portal shell navigation ───────────────────────────────────────────
function togglePortalNav() {
  if (!matchMedia('(max-width: 640px)').matches) return toggleNavCollapsed();
  const open = document.getElementById('portal-sidebar').classList.toggle('open');
  document.getElementById('portal-backdrop').classList.toggle('open', open);
}
function closePortalNav() {
  document.getElementById('portal-sidebar').classList.remove('open');
  document.getElementById('portal-backdrop').classList.remove('open');
}

function showPortal(page) {
  sessionStorage.setItem('view', 'portal');
  state.currentPage = null; // admin keyboard shortcuts stay off in the portal
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('main-shell').classList.add('hidden');
  document.getElementById('portal-shell').classList.remove('hidden');
  document.getElementById('portal-avatar').textContent = state.user.email[0].toUpperCase();

  const payStatus = new URL(window.location.href).searchParams.get('payment');
  if (payStatus) writeUrl(DEMO ? '/demo' : '/');
  if (payStatus === 'success') toast('Payment received! Your dues record has been updated.', 'success');
  else if (payStatus === 'cancelled') toast('Payment cancelled — you can pay any time.', 'warn');
  else if (payStatus === 'donation-success') toast('Thank you! Your donation has been received.', 'success');
  else if (payStatus === 'donation-cancelled') toast('Donation cancelled — nothing was charged.', 'warn');

  pNav(page || (payStatus?.startsWith('donation-') ? 'portal-donate' : 'portal-home'));
}

function setPortalPage(html) {
  pageDirty = false;
  document.getElementById('portal-page').innerHTML = html;
}

const PORTAL_TITLES = {
  'portal-home':    'My Dashboard',
  'portal-profile': 'My Profile',
  'portal-history': 'Membership History',
  'portal-donate':  'Donate',
};

function pNav(page) {
  pageUrl(portalPath(page));
  document.querySelectorAll('[data-ppage]').forEach(el => {
    el.classList.toggle('active', el.dataset.ppage === page);
  });
  document.getElementById('portal-page-title').textContent = PORTAL_TITLES[page] || page;
  setTitle(PORTAL_TITLES[page] || page);
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
    document.getElementById('portal-name').textContent     = `${m.first_name} ${m.last_name}`;

    const isLifetime = m.membership_type === 'lifetime_honorary';
    const isPaid = isLifetime || ['active', 'honorary', 'waived'].includes(m.dues_status);
    const duesClass = isPaid ? 'paid' : (m.dues_status ? 'unpaid' : 'unknown');
    const duesHeading = isLifetime
      ? 'Lifetime honorary member — no dues'
      : isPaid
      ? `✓ Dues paid for ${year}`
      : (m.dues_status === 'expired' ? `Dues expired — ${year}` : `Dues not yet paid for ${year}`);
    const dueSub = isPaid
      ? (m.dues_paid_date ? `Paid ${fmtDate(m.dues_paid_date)}${m.dues_amount_paid != null ? ` — $${Number(m.dues_amount_paid).toFixed(2)}` : ''}` : '')
      : (m.dues_amount_due != null ? `Amount due: $${Number(m.dues_amount_due).toFixed(2)}` : '');

    // Oct–Dec: online payment applies to next year's dues
    const payYear  = data.renewal_year || year;
    const renewing = payYear !== year;
    const renewalPaid = renewing && ['active', 'honorary', 'waived'].includes(data.renewal?.status);
    const needsPay = !isLifetime && (renewing ? !renewalPaid : !isPaid);

    // Family memberships: dependents are paid for by the primary member
    const memberLabel = x => `${x.callsign ? x.callsign + ' — ' : ''}${x.first_name} ${x.last_name}`;
    const coveredBy = data.covered_by;
    const coveredMembers = data.covered_members || [];
    const showPay = needsPay && !coveredBy;
    const familyNote = coveredMembers.length
      ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Your family membership also covers: ${escHtml(coveredMembers.map(memberLabel).join(', '))}</p>`
      : '';
    const renewalSub = renewalPaid && data.renewal.paid_date
      ? `Paid ${fmtDate(data.renewal.paid_date)}${data.renewal.amount_paid != null ? ` — $${Number(data.renewal.amount_paid).toFixed(2)}` : ''}`
      : '';

    const licenseExpiry = m.license_expiry
      ? `<div class="stat-card"><div class="stat-val" style="font-size:18px">${escHtml(m.license_expiry)}</div><div class="stat-label">License Expiry</div></div>`
      : '';

    setPortalPage(`
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-val" style="font-family:var(--mono)">${escHtml(m.callsign || '—')}</div>
          <div class="stat-label">Callsign</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="font-size:18px">${escHtml(m.license_class || '—')}</div>
          <div class="stat-label">License Class</div>
        </div>
        ${licenseExpiry}
      </div>

      <div class="dues-card ${duesClass}">
        <div class="dues-status-label">${year} Dues</div>
        <div style="font-size:15px;font-weight:600">${escHtml(duesHeading)}</div>
        ${dueSub ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escHtml(dueSub)}</div>` : ''}
      </div>

      ${renewing && !isLifetime ? `
      <div class="dues-card ${renewalPaid ? 'paid' : 'unknown'}">
        <div class="dues-status-label">${payYear} Dues</div>
        <div style="font-size:15px;font-weight:600">${renewalPaid ? `✓ Dues paid for ${payYear}` : coveredBy ? `${payYear} renewal — covered by a family membership` : `${payYear} renewal is now open`}</div>
        ${renewalSub ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escHtml(renewalSub)}</div>` : ''}
      </div>
      ` : ''}

      ${showPay ? `
      <div class="payment-box">
        <h4>Pay ${payYear} Dues Online</h4>
        <button id="pay-online-btn" class="btn btn-primary" style="width:100%;margin-bottom:14px" onclick="payOnline()">
          Pay Online — ${m.membership_type === 'family' ? '$31' : '$21'}
        </button>
        ${familyNote}
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Includes a $1 online processing fee. Or pay in person ($${m.membership_type === 'family' ? '30' : '20'}):</p>
        <ul style="margin:0 0 0 18px;line-height:2;font-size:13px">
          <li><strong>At a meeting:</strong> Cash or check payable to <em>Kingsport Amateur Radio Club</em></li>
          <li><strong>By mail:</strong> Send a check to the club treasurer</li>
        </ul>
        <p style="margin-top:10px;color:var(--text-muted);font-size:12px">In-person payments are recorded by a club officer.</p>
      </div>
      ` : ''}

      ${needsPay && coveredBy ? `
      <div class="payment-box">
        <h4>Covered by a Family Membership</h4>
        <p style="font-size:13px">Your ${payYear} dues are covered under the family membership of <strong>${escHtml(memberLabel(coveredBy))}</strong>. There is nothing for you to pay — your dues will show as paid once that membership is renewed.</p>
        <p style="margin-top:10px;color:var(--text-muted);font-size:12px">If this is no longer correct, contact a club officer.</p>
      </div>
      ` : ''}

      ${!needsPay && familyNote ? familyNote : ''}
    `);
  } catch(e) { setPortalPage(`<p class="text-muted">${escHtml(e.data?.error || e.message)}</p>`); }
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

    setPortalPage(`
      <div class="card">
        <div class="card-title">Personal Information</div>
        <div class="form-grid">
          ${fi('First Name','pf-first', m.first_name||'','text','',true)}
          ${fi('Last Name', 'pf-last',  m.last_name ||'','text','',true)}
          ${fi('Email Address','pf-email', m.email||'','email')}
          ${fi('Phone','pf-phone', m.phone||'','tel')}
          ${fi('Street Address','pf-address', m.address||'')}
          ${fi('City','pf-city', m.city||'')}
          ${fi('State','pf-state', m.state||'')}
          ${fi('ZIP Code','pf-zip', m.zip||'')}
        </div>
        <div class="form-grid" style="margin-top:0">
          ${fi('Callsign','pf-callsign', m.callsign||'—')}
          ${fi('License Class','pf-license', m.license_class||'—')}
        </div>
        <p class="form-hint" style="margin-top:4px">Callsign and license data are managed by the club and updated from FCC records automatically.</p>
      </div>

      <div class="card">
        <div class="card-title">About Me</div>
        <div class="form-grid">
          ${fi('Bio','pf-bio', m.bio||'','textarea')}
          ${fi('Interests / Modes','pf-interests', m.interests||'','text','e.g. HF, CW, SOTA, DMR')}
        </div>
      </div>

      <div class="card">
        <div class="card-title">Emergency Contact</div>
        <div class="form-grid">
          ${fi('Name','pf-emerg-name', m.emergency_name||'')}
          ${fi('Phone','pf-emerg-phone', m.emergency_phone||'','tel')}
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
            <input type="checkbox" id="pf-directory" ${m.show_in_directory ? 'checked' : ''} onchange="saveDirectoryOptIn()">
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label" id="directory-label">${m.show_in_directory ? 'Listed in public directory' : 'Not listed in public directory'}</span>
        </div>
      </div>

      <button class="btn btn-primary" onclick="saveProfile()" style="margin-top:8px">Save Changes</button>
    `);

    // Make FCC-managed fields read-only
    ['pf-callsign','pf-license'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.readOnly = true; el.style.opacity = '.5'; }
    });
  } catch(e) { setPortalPage(`<p class="text-muted">${escHtml(e.data?.error || e.message)}</p>`); }
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
    pageDirty = false;
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
      setPortalPage(`
        <div class="card">
          <p class="text-muted">No membership records found yet. Records are added by club officers when dues are paid.</p>
        </div>
      `);
      return;
    }
    const rows = data.history.map(h => `
      <tr>
        <td><strong>${escHtml(String(h.year))}</strong></td>
        <td>${duesBadge(h.status, h.amount_paid, null)}</td>
        <td style="text-transform:capitalize">${escHtml(h.membership_type||'individual')}</td>
        <td>${h.amount_paid != null ? '$' + Number(h.amount_paid).toFixed(2) : '—'}</td>
        <td>${h.paid_date ? fmtDate(h.paid_date) : '—'}</td>
        <td style="text-transform:capitalize">${escHtml(h.payment_method||'—')}</td>
      </tr>
    `).join('');
    setPortalPage(`
      <div class="card" style="padding:0">
        <table>
          <thead><tr>
            <th>Year</th><th>Status</th><th>Type</th><th>Paid</th><th>Date</th><th>Method</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
  } catch(e) { setPortalPage(`<p class="text-muted">${escHtml(e.data?.error || e.message)}</p>`); }
}

// ── Portal: Donate ────────────────────────────────────────────────────
async function portalDonate() {
  setPortalPage('<div class="spinner"></div>');
  try {
    const data = await api('GET', '/portal/donations');
    const rows = data.donations.map(d => `
      <tr>
        <td>${d.donation_date ? fmtDate(d.donation_date) : '—'}</td>
        <td>${d.donation_kind === 'monetary'
          ? '$' + Number(d.amount || 0).toFixed(2)
          : escHtml(d.item_description || 'Item') + (d.estimated_value != null ? ` <span style="color:var(--text-muted)">(est. $${Number(d.estimated_value).toFixed(2)})</span>` : '')}</td>
        <td style="text-transform:capitalize">${escHtml(d.donation_kind === 'monetary' ? (d.payment_method || '—') : 'item')}</td>
      </tr>
    `).join('');

    setPortalPage(`
      <div class="card">
        <div class="card-title">Donate to the Club</div>
        <p style="font-size:13px;margin-bottom:14px">Donations are separate from dues and go to the Kingsport Amateur Radio Club. Pick an amount or enter your own.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${[10, 25, 50, 100].map(n => `<button class="btn btn-secondary btn-sm" onclick="setDonateAmt(${n})">$${n}</button>`).join('')}
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
        ${rows
          ? `<table><thead><tr><th>Date</th><th>Donation</th><th>Method</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="text-muted" style="padding:16px">No donations recorded yet.</p>'}
      </div>
    `);
  } catch(e) { setPortalPage(`<p class="text-muted">${escHtml(e.data?.error || e.message)}</p>`); }
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
