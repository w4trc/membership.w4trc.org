/**
 * Public donate page
 * GET /donate — anyone can give to the club online, no login required.
 *
 * The form posts to /api/stripe/create-public-donation-checkout (see stripe.js),
 * and Stripe sends the donor back here with ?payment=success or ?payment=cancelled.
 */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function handleDonatePage(env) {
  return new Response(donatePageHtml(env.CLUB_NAME || 'Kingsport Amateur Radio Club'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  });
}

function donatePageHtml(club) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Donate — ${esc(club)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0f1117; --surface: #181c27; --surface2: #1f2438;
  --border: #2a3050; --accent: #3b7dd8; --accent-h: #5594f0;
  --success: #2ecc71; --warn: #f39c12; --danger: #e74c3c;
  --text: #e8eaf0; --text-muted: #8892aa;
  --radius: 6px; --shadow: 0 4px 24px rgba(0,0,0,.4);
}
body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; font-size: 14px; line-height: 1.6; display: flex; align-items: center; justify-content: center; padding: 24px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px; width: 100%; max-width: 480px; box-shadow: var(--shadow); }
.logo { text-align: center; margin-bottom: 28px; }
.logo h1 { font-size: 18px; font-weight: 600; margin-top: 4px; }
.logo p { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
.step { display: none; }
.step.active { display: block; }
.form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
label { font-size: 12px; color: var(--text-muted); font-weight: 500; }
input { background: var(--bg); border: 1px solid var(--border); color: var(--text); border-radius: var(--radius); padding: 9px 12px; font-size: 13px; width: 100%; outline: none; transition: border-color .15s; font-family: inherit; }
input:focus { border-color: var(--accent); }
.btn { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; border: none; cursor: pointer; transition: all .15s; width: 100%; }
.btn-primary { background: var(--accent); color: white; }
.btn-primary:hover { background: var(--accent-h); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-secondary { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover, .btn-secondary.selected { border-color: var(--accent); color: var(--accent); }
.presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.err { color: var(--danger); font-size: 13px; margin-top: 10px; text-align: center; min-height: 20px; }
.notice { background: var(--surface2); border: 1px solid var(--warn); border-radius: var(--radius); padding: 10px 14px; margin-bottom: 16px; font-size: 13px; text-align: center; }
.hint { font-size: 12px; color: var(--text-muted); }
.back-link { text-align: center; margin-top: 16px; font-size: 13px; color: var(--text-muted); }
.success-icon { font-size: 48px; text-align: center; margin-bottom: 16px; }
a { color: var(--accent); }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <img src="/logo.png" alt="KARC" style="height:72px;margin-bottom:10px">
    <h1>Donate</h1>
    <p>${esc(club)}</p>
  </div>

  <!-- Donation form -->
  <div class="step active" id="step-form">
    <div class="notice" id="cancelled-notice" hidden>Donation cancelled — nothing was charged.</div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;text-align:center">
      Thank you for supporting the club. Pick an amount or enter your own.
    </p>
    <div class="presets">
      <button type="button" class="btn btn-secondary" data-amt="10" onclick="setAmount(10)">$10</button>
      <button type="button" class="btn btn-secondary" data-amt="25" onclick="setAmount(25)">$25</button>
      <button type="button" class="btn btn-secondary" data-amt="50" onclick="setAmount(50)">$50</button>
      <button type="button" class="btn btn-secondary" data-amt="100" onclick="setAmount(100)">$100</button>
    </div>
    <div class="form-group">
      <label for="don-amount">Amount (USD) *</label>
      <input type="number" id="don-amount" min="1" max="5000" step="1" placeholder="25" inputmode="decimal" oninput="markPreset()">
    </div>
    <div class="form-group">
      <label for="don-name">Your Name (optional)</label>
      <input type="text" id="don-name" maxlength="100" placeholder="Jane Smith" autocomplete="name">
      <span class="hint">Leave blank to give anonymously.</span>
    </div>
    <div class="form-group">
      <label for="don-note">Note (optional)</label>
      <input type="text" id="don-note" maxlength="200" placeholder="e.g. in memory of, or what it is for">
    </div>
    <button class="btn btn-primary" id="donate-btn" onclick="donate()">Donate Online</button>
    <div class="err" id="donate-err"></div>
    <p class="hint" style="text-align:center">You will be taken to Stripe's secure checkout to enter your card.</p>
    <div class="back-link">
      Club member? <a href="/">Sign in</a> to donate so it shows on your record.
    </div>
  </div>

  <!-- Thank you -->
  <div class="step" id="step-success">
    <div class="success-icon">✅</div>
    <h2 style="text-align:center;margin-bottom:8px">Thank you!</h2>
    <p style="text-align:center;color:var(--text-muted);font-size:13px;margin-bottom:24px">
      Your donation to the ${esc(club)} has been received.
    </p>
    <a href="/donate" class="btn btn-secondary" style="text-decoration:none">Make Another Donation</a>
  </div>
</div>

<script>
// ── Returning from Stripe Checkout ────────────────────────────────────────
(function () {
  var status = new URLSearchParams(window.location.search).get('payment');
  if (status === 'success') {
    document.getElementById('step-form').classList.remove('active');
    document.getElementById('step-success').classList.add('active');
  } else if (status === 'cancelled') {
    document.getElementById('cancelled-notice').hidden = false;
  }
  if (status) history.replaceState(null, '', '/donate');
})();

function setAmount(n) {
  document.getElementById('don-amount').value = n;
  markPreset();
}

// Highlight the preset button that matches the amount field
function markPreset() {
  var amount = document.getElementById('don-amount').value;
  document.querySelectorAll('.presets .btn').forEach(function (btn) {
    btn.classList.toggle('selected', btn.dataset.amt === amount);
  });
}

async function donate() {
  var err = document.getElementById('donate-err');
  var btn = document.getElementById('donate-btn');
  var amount = parseFloat(document.getElementById('don-amount').value);
  err.textContent = '';
  if (!(amount >= 1 && amount <= 5000)) { err.textContent = 'Enter an amount between $1 and $5,000.'; return; }

  btn.disabled = true;
  btn.textContent = 'Redirecting to checkout…';
  try {
    var r = await fetch('/api/stripe/create-public-donation-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amount,
        name: document.getElementById('don-name').value,
        note: document.getElementById('don-note').value,
      }),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || !data.url) {
      throw new Error(r.status === 429 ? 'Too many attempts. Please try again in a few minutes.' : (data.error || ''));
    }
    window.location.href = data.url;
  } catch (e) {
    err.textContent = e.message || 'Failed to start checkout. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Donate Online';
  }
}

document.querySelectorAll('#step-form input').forEach(function (el) {
  el.addEventListener('keydown', function (e) { if (e.key === 'Enter') donate(); });
});
</script>
</body>
</html>`;
}
