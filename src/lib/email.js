/**
 * Email sending via Resend (https://resend.com)
 * Requires: RESEND_API_KEY secret and FROM_EMAIL env var (or defaults to membership@{CLUB_DOMAIN})
 */

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('Email not configured: run `wrangler secret put RESEND_API_KEY`');
  }
  const from = env.FROM_EMAIL || `membership@${env.CLUB_DOMAIN || 'w4trc.org'}`;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }
}

export async function sendVerificationCode(env, { to, code, name }) {
  const club = env.CLUB_NAME || 'W4TRC';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';
  await sendEmail(env, {
    to,
    subject: `Your ${club} verification code: ${code}`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
  <h2 style="color:#3b7dd8;margin-bottom:8px">W4TRC Member Portal</h2>
  <p style="color:#555">Hi ${escHtml(name)},</p>
  <p>Your verification code to claim your member account:</p>
  <div style="background:#f0f4ff;border:2px solid #3b7dd8;border-radius:8px;padding:20px;text-align:center;margin:20px 0">
    <span style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:0.4em;color:#1a1a2e">${escHtml(code)}</span>
  </div>
  <p style="color:#777;font-size:13px">This code expires in <strong>15 minutes</strong>. If you didn't request this, you can safely ignore it.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
  <p style="color:#aaa;font-size:12px">Kingsport Amateur Radio Club &mdash; <a href="https://${domain}" style="color:#3b7dd8">${domain}</a></p>
</body>
</html>`,
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
