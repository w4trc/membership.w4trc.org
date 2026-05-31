/**
 * Email sending via Resend (https://resend.com)
 * Requires: RESEND_API_KEY secret and FROM_EMAIL env var (or defaults to membership@{CLUB_DOMAIN})
 */

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('Email not configured: run `wrangler secret put RESEND_API_KEY`');
  }
  const fromAddr = env.FROM_EMAIL || `membership@${env.CLUB_DOMAIN || 'w4trc.org'}`;
  const from = `KARC Membership <${fromAddr}>`;
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
  const club = env.CLUB_NAME || 'KARC';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';
  await sendEmail(env, {
    to,
    subject: `Your ${club} verification code: ${code}`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
  <div style="text-align:center;margin-bottom:16px">
    <img src="https://${domain}/logo.png" alt="KARC" style="height:64px">
  </div>
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

export async function sendPasswordResetEmail(env, { to, resetUrl }) {
  const club = env.CLUB_NAME || 'KARC';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';
  await sendEmail(env, {
    to,
    subject: `${club} password reset`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a2e">
  <div style="text-align:center;margin-bottom:16px">
    <img src="https://${domain}/logo.png" alt="KARC" style="height:64px">
  </div>
  <p>A password reset was requested for your account.</p>
  <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
  <div style="text-align:center;margin:28px 0">
    <a href="${escHtml(resetUrl)}" style="background:#3b7dd8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;display:inline-block">Reset Password</a>
  </div>
  <p style="color:#777;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
  <p style="color:#aaa;font-size:12px">Kingsport Amateur Radio Club &mdash; <a href="https://${domain}" style="color:#3b7dd8">${domain}</a></p>
</body>
</html>`,
  });
}

export async function sendWeeklyRoundup(env, { boardEmails, newPayments, totalActiveMembers, weekOf }) {
  const club   = env.CLUB_NAME   || 'KARC';
  const domain = env.CLUB_DOMAIN || 'members.w4trc.org';
  const count  = newPayments.length;

  const rows = newPayments.map(p => {
    const name    = escHtml(`${p.first_name} ${p.last_name}`);
    const call    = escHtml(p.callsign || '—');
    const type    = escHtml(p.membership_type || '—');
    const method  = escHtml(p.payment_method  || 'manual');
    const amount  = p.amount_paid != null ? `$${Number(p.amount_paid).toFixed(2)}` : '—';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-weight:600">${call}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize">${type}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-transform:capitalize">${method}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${amount}</td>
    </tr>`;
  }).join('');

  await sendEmail(env, {
    to: boardEmails,
    subject: `${club} Weekly Membership Update — ${weekOf}`,
    html: `
<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e">
  <div style="text-align:center;margin-bottom:16px">
    <img src="https://${domain}/logo.png" alt="${escHtml(club)}" style="height:64px">
  </div>
  <h2 style="margin:0 0 4px">Weekly Membership Update</h2>
  <p style="color:#777;margin:0 0 24px;font-size:14px">Week of ${escHtml(weekOf)}</p>

  <div style="background:#f0f4ff;border-radius:8px;padding:16px 20px;margin-bottom:24px;display:inline-block;width:100%;box-sizing:border-box">
    <span style="font-size:28px;font-weight:bold;color:#1a1a2e">${totalActiveMembers}</span>
    <span style="color:#555;margin-left:8px">total active members</span>
  </div>

  <h3 style="margin:0 0 12px">New dues payments this week (${count})</h3>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:8px 12px;text-align:left;font-weight:600">Callsign</th>
        <th style="padding:8px 12px;text-align:left;font-weight:600">Name</th>
        <th style="padding:8px 12px;text-align:left;font-weight:600">Type</th>
        <th style="padding:8px 12px;text-align:left;font-weight:600">Method</th>
        <th style="padding:8px 12px;text-align:right;font-weight:600">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
  <p style="color:#aaa;font-size:12px">${escHtml(club)} &mdash; <a href="https://${domain}" style="color:#3b7dd8">${domain}</a></p>
</body>
</html>`,
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
