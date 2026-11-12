/**
 * Renewal reminder emails. Nothing here runs by itself: an officer opens the
 * list, sees who would get one, and presses Send.
 *
 * GET  /api/reminders?year=YYYY   - who would get a reminder for that dues year, and who is left out and why
 * POST /api/reminders/preview     - { year, note } → the email as it will look
 * POST /api/reminders/test        - { year, note } → send one copy to the officer's own login address
 * POST /api/reminders/send        - { year, member_ids, note } → send to those members (board+)
 */

import { isBoardOrAbove } from '../lib/auth.js';
import { jsonResponse, jsonError } from '../lib/response.js';
import { audit } from '../lib/audit.js';
import { clubYear } from '../lib/clubDate.js';
import { duesYear } from '../lib/duesYear.js';
import { COVERED_BY_FOR_YEAR } from '../lib/family.js';
import { sendEmailBatch, renewalReminderEmail } from '../lib/email.js';

const NOTE_MAX = 1000;
// A second press of Send, or two officers at once, does not email anyone twice
const RESEND_GAP_MINUTES = 10;

const EMAIL_SHAPE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// A dues record that puts its member in good standing for its year
const paidOrExempt = (ms) => `(
  ${ms}.status IN ('honorary', 'waived')
  OR (${ms}.status = 'active' AND (
    ${ms}.amount_paid IS NOT NULL
    OR ${ms}.covered_by_member_id IS NOT NULL
    OR ${ms}.payment_method = 'eastman'
  ))
)`;

export async function handleReminders(request, env, path, user) {
  if (!isBoardOrAbove(user)) return jsonError('Forbidden', 403);
  const method = request.method;
  const action = path.replace('/api/reminders', '').replace(/^\//, '');

  if (method === 'GET' && action === '') {
    const year = parseYear(new URL(request.url).searchParams.get('year'));
    if (!year) return jsonError('Invalid year', 400);
    return jsonResponse({ ...(await reminderList(env, year)), email_ready: !!env.RESEND_API_KEY });
  }

  if (method !== 'POST') return jsonError('Not found', 404);
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid JSON', 400); }
  const year = parseYear(body?.year);
  if (!year) return jsonError('Invalid year', 400);
  const note = String(body?.note ?? '').slice(0, NOTE_MAX);

  if (action === 'preview') {
    const { recipients } = await reminderList(env, year);
    return jsonResponse(renewalReminderEmail(env, { member: recipients[0] || SAMPLE_MEMBER, year, note }));
  }

  if (action === 'test') {
    const { recipients } = await reminderList(env, year);
    const email = renewalReminderEmail(env, { member: recipients[0] || SAMPLE_MEMBER, year, note });
    let result;
    try {
      [result] = await sendEmailBatch(env, [{ to: user.email, subject: `[Test] ${email.subject}`, html: email.html }]);
    } catch (err) {
      return jsonError(err.message, 500);
    }
    if (!result.ok) return jsonError(result.error, 502);
    await audit(env, { userId: user.id, action: 'reminder.test', detail: { year }, request });
    return jsonResponse({ ok: true, to: user.email });
  }

  if (action === 'send') return sendReminders(request, env, user, year, note, body?.member_ids);

  return jsonError('Not found', 404);
}

const SAMPLE_MEMBER = { first_name: 'Pat', callsign: 'W4XYZ', membership_type: 'individual' };

// The dues year reminders default to, and the years one can be sent for
function parseYear(value) {
  const now = clubYear();
  if (value == null || value === '') return Math.min(duesYear(), now + 1);
  const year = Number(value);
  return Number.isInteger(year) && year >= now - 1 && year <= now + 1 ? year : null;
}

/**
 * Who has not paid for `year`: members still on the roll (active, or in good
 * standing the year before) with no paid or exempt dues record for it.
 * Returns { year, recipients, skipped }; a skipped member has a `reason`:
 *   family    covered under someone else's family membership (the payer gets the reminder)
 *   eastman   an Eastman member, who owes no dues
 *   no_email  no email address on file
 *   bad_email the address on file is not a usable one
 */
export async function reminderList(env, year) {
  const { results } = await env.DB.prepare(`
    SELECT m.id, m.callsign, m.first_name, m.last_name, m.email, m.membership_type,
           m.is_active, m.is_eastman_member,
           p.id AS payer_id, p.callsign AS payer_callsign,
           p.first_name AS payer_first_name, p.last_name AS payer_last_name,
           (SELECT MAX(r.sent_at) FROM renewal_reminders r
            WHERE r.member_id = m.id AND r.year = ?) AS last_reminded
    FROM members m
    LEFT JOIN memberships ms   ON ms.member_id = m.id   AND ms.year = ?
    LEFT JOIN memberships prev ON prev.member_id = m.id AND prev.year = ?
    LEFT JOIN members p ON p.id = ${COVERED_BY_FOR_YEAR} AND p.id != m.id
    WHERE m.is_silent_key = 0
      AND m.membership_type != 'lifetime_honorary'
      AND NOT COALESCE(${paidOrExempt('ms')}, 0)
      AND (m.is_active = 1 OR COALESCE(${paidOrExempt('prev')}, 0))
    ORDER BY m.last_name COLLATE NOCASE, m.first_name COLLATE NOCASE
  `).bind(year, year, year - 1, year, year).all();

  const recipients = [];
  const skipped = [];
  for (const m of results) {
    const email = (m.email || '').trim();
    const row = {
      id: m.id, callsign: m.callsign, first_name: m.first_name, last_name: m.last_name,
      email: email || null, membership_type: m.membership_type, last_reminded: m.last_reminded,
    };
    if (m.payer_id) {
      const payer = [m.payer_callsign, `${m.payer_first_name} ${m.payer_last_name}`].filter(Boolean).join(' ');
      skipped.push({ ...row, reason: 'family', payer });
    } else if (m.is_eastman_member) skipped.push({ ...row, reason: 'eastman' });
    else if (!email) skipped.push({ ...row, reason: 'no_email' });
    else if (!EMAIL_SHAPE.test(email)) skipped.push({ ...row, reason: 'bad_email' });
    else recipients.push(row);
  }
  return { year, recipients, skipped };
}

async function sendReminders(request, env, user, year, note, memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) return jsonError('Choose at least one member', 400);
  const wanted = new Set(memberIds.map(Number));

  // Only members who are on the list right now: someone who paid a minute ago
  // is not emailed, whatever the page that sent this still shows
  const { recipients } = await reminderList(env, year);
  const recent = Date.now() - RESEND_GAP_MINUTES * 60 * 1000;
  const sentAt = (m) => (m.last_reminded ? Date.parse(m.last_reminded.replace(' ', 'T') + 'Z') : 0);
  const chosen = recipients.filter(m => wanted.has(m.id));
  const toSend = chosen.filter(m => sentAt(m) < recent);
  const justSent = chosen.length - toSend.length;

  if (toSend.length === 0) {
    return jsonError(justSent
      ? `Those members were sent a reminder in the last ${RESEND_GAP_MINUTES} minutes`
      : 'None of those members needs a reminder', 409);
  }

  let results;
  try {
    results = await sendEmailBatch(env, toSend.map(member => ({
      to: member.email,
      replyTo: env.CONTACT_EMAIL || undefined,
      ...renewalReminderEmail(env, { member, year, note }),
    })));
  } catch (err) {
    return jsonError(err.message, 500);
  }

  const sent   = toSend.filter((_, i) => results[i].ok);
  const failed = toSend.map((m, i) => ({ m, r: results[i] })).filter(x => !x.r.ok)
    .map(({ m, r }) => ({ id: m.id, callsign: m.callsign, name: `${m.first_name} ${m.last_name}`, email: m.email, error: r.error }));

  if (sent.length) {
    await env.DB.batch(sent.map(m => env.DB.prepare(
      `INSERT INTO renewal_reminders (member_id, year, email, sent_by) VALUES (?, ?, ?, ?)`
    ).bind(m.id, year, m.email, user.id)));
  }

  await audit(env, {
    userId: user.id,
    action: 'reminder.sent',
    detail: { year, sent_count: sent.length, failed_count: failed.length, member_ids: sent.map(m => m.id) },
    request,
  });

  return jsonResponse({
    year, sent: sent.length, failed,
    not_sent: wanted.size - chosen.length + justSent, // paid since, no longer on the list, or just reminded
  });
}
