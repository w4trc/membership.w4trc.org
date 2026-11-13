/**
 * Merging a duplicate member record into the one being kept: everything
 * attached to the duplicate moves across, blanks on the kept record are
 * filled from it, and the duplicate is deleted.
 */

const blank = (v) => v == null || String(v).trim() === '';

// Profile fields the kept record takes from the duplicate when its own is blank
const FILL_FIELDS = [
  'callsign', 'email', 'phone', 'license_class', 'license_expiry', 'license_status',
  'bio', 'interests', 'photo_url',
];

/** Which of the kept record's fields change, as { field: new value }. */
function fillFrom(into, from) {
  const fill = {};
  for (const f of FILL_FIELDS) {
    if (blank(into[f]) && !blank(from[f])) fill[f] = from[f];
  }
  // An address or an emergency contact moves as a whole, never mixed
  if (blank(into.address) && !blank(from.address)) {
    for (const f of ['address', 'city', 'state', 'zip']) {
      if (!blank(from[f]) && from[f] !== into[f]) fill[f] = from[f];
    }
  }
  if (blank(into.emergency_name) && blank(into.emergency_phone)) {
    for (const f of ['emergency_name', 'emergency_phone']) {
      if (!blank(from[f])) fill[f] = from[f];
    }
  }
  // Member since the earlier of the two
  if (!blank(from.joined_date) && (blank(into.joined_date) || from.joined_date < into.joined_date)) {
    fill.joined_date = from.joined_date;
  }
  if (from.membership_type === 'lifetime_honorary' && into.membership_type !== 'lifetime_honorary') {
    fill.membership_type = 'lifetime_honorary';
  }
  if (from.is_active && !into.is_active && !into.is_silent_key) fill.is_active = 1;
  return fill;
}

// How much a year's dues record is worth keeping: money paid beats good
// standing without a payment (covered, Eastman, honorary, waived), which
// beats an unpaid record.
function duesRank(ms) {
  if (Number(ms.amount_paid) > 0) return 3;
  if (['honorary', 'waived'].includes(ms.status)) return 2;
  if (ms.status === 'active' && (ms.amount_paid != null || ms.covered_by_member_id || ms.payment_method === 'eastman')) return 2;
  return 1;
}

const duesSummary = (ms) => ({
  id: ms.id, status: ms.status, membership_type: ms.membership_type, amount_paid: ms.amount_paid,
  paid_date: ms.paid_date, payment_method: ms.payment_method, check_number: ms.check_number,
});

const memberSummary = (m) => ({
  id: m.id, callsign: m.callsign, first_name: m.first_name, last_name: m.last_name,
  email: m.email, is_active: m.is_active, is_silent_key: m.is_silent_key, joined_date: m.joined_date,
});

const label = (m) => `${m.callsign ? m.callsign + ' ' : ''}${m.first_name} ${m.last_name}`.trim();

/**
 * What merging member `fromId` into member `intoId` would do. Returns
 * { error, status } when it cannot be planned, otherwise {
 *   from, into,               the two records (summary fields)
 *   blockers: [text],         reasons the merge is refused until fixed by hand
 *   fill: { field: value },   what the kept record gains
 *   dues: { move: [year], conflicts: [{ year, keep: 'from'|'into', kept, dropped }] },
 *   counts: { notes, donations, attendance, officers, inventory, reminders, covers },
 *   login: null | { email, action: 'move'|'delete'|'unlink' },
 * }
 */
export async function mergePlan(env, fromId, intoId) {
  if (!fromId || !intoId) return { error: 'Pick the member record to merge into', status: 400 };
  if (fromId === intoId) return { error: 'A member cannot be merged into itself', status: 400 };

  const count = (sql, ...ids) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(...ids);
  const [members, dues, logins, ...counted] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM members WHERE id IN (?, ?)`).bind(fromId, intoId),
    env.DB.prepare(`SELECT * FROM memberships WHERE member_id IN (?, ?) ORDER BY year`).bind(fromId, intoId),
    env.DB.prepare(`SELECT id, email, role, member_id FROM users WHERE member_id IN (?, ?) ORDER BY id`).bind(fromId, intoId),
    count(`notes WHERE member_id = ?`, fromId),
    count(`donations WHERE member_id = ?`, fromId),
    count(`meeting_attendees WHERE member_id = ?`, fromId),
    count(`officers WHERE member_id = ?`, fromId),
    count(`inventory_items WHERE assigned_member_id = ?`, fromId),
    count(`renewal_reminders WHERE member_id = ?`, fromId),
    count(`memberships WHERE covered_by_member_id = ? AND member_id != ?`, fromId, intoId),
  ]);

  const from = members.results.find(m => m.id === fromId);
  const into = members.results.find(m => m.id === intoId);
  if (!from || !into) return { error: 'Member not found', status: 404 };

  const blockers = [];
  const plan = { move: [], conflicts: [] };
  const intoByYear = new Map(dues.results.filter(ms => ms.member_id === intoId).map(ms => [ms.year, ms]));
  for (const ms of dues.results.filter(d => d.member_id === fromId)) {
    const other = intoByYear.get(ms.year);
    if (!other) { plan.move.push(ms.year); continue; }
    if (duesRank(ms) === 3 && duesRank(other) === 3) {
      blockers.push(
        `Both records show dues paid for ${ms.year}. Only one can be kept, and dropping the other would ` +
        `lose a payment from the books. Clear the amount paid on one of them first (record it as a donation ` +
        `or a refund if the money was really received twice).`
      );
    }
    const keepFrom = duesRank(ms) > duesRank(other);
    plan.conflicts.push({
      year: ms.year,
      keep: keepFrom ? 'from' : 'into',
      kept: duesSummary(keepFrom ? ms : other),
      dropped: duesSummary(keepFrom ? other : ms),
    });
  }

  // One sign-in per member: the kept record's own wins. An officer's account
  // on the duplicate is left in place, no longer tied to a member record.
  const fromLogin = logins.results.find(u => u.member_id === fromId);
  const intoLogin = logins.results.find(u => u.member_id === intoId);
  const login = !fromLogin ? null : {
    email: fromLogin.email,
    action: !intoLogin ? 'move' : fromLogin.role === 'member' ? 'delete' : 'unlink',
  };

  const [notes, donations, attendance, officers, inventory, reminders, covers] = counted.map(r => r.results[0].n);
  return {
    from: memberSummary(from),
    into: memberSummary(into),
    blockers,
    fill: fillFrom(into, from),
    dues: plan,
    counts: { notes, donations, attendance, officers, inventory, reminders, covers },
    login,
    // For the audit log: the record being deleted, in full
    removed: from,
  };
}

/**
 * Carry out a plan from mergePlan, all or nothing. Returns the plan.
 * The caller checks plan.blockers first.
 */
export async function mergeMembers(env, plan) {
  const from = plan.from.id;
  const into = plan.into.id;
  const run = (sql, ...args) => env.DB.prepare(sql).bind(...args);

  const statements = [
    // Years both records have: the losing row goes, whichever record it is on
    ...plan.dues.conflicts.map(c => run(`DELETE FROM memberships WHERE id = ?`, c.dropped.id)),
    run(`UPDATE memberships SET member_id = ?, updated_at = datetime('now') WHERE member_id = ?`, into, from),
    run(`UPDATE memberships SET covered_by_member_id = ? WHERE covered_by_member_id = ?`, into, from),
    // The two records covering each other's dues would now be one covering itself
    run(`UPDATE memberships SET covered_by_member_id = NULL WHERE member_id = ? AND covered_by_member_id = ?`, into, into),

    run(`UPDATE notes             SET member_id = ? WHERE member_id = ?`, into, from),
    run(`UPDATE donations         SET member_id = ? WHERE member_id = ?`, into, from),
    run(`UPDATE renewal_reminders SET member_id = ? WHERE member_id = ?`, into, from),
    run(`UPDATE officers          SET member_id = ? WHERE member_id = ?`, into, from),
    run(`UPDATE google_group_members SET member_id = ? WHERE member_id = ?`, into, from),
    run(`UPDATE inventory_items   SET assigned_member_id = ? WHERE assigned_member_id = ?`, into, from),
    run(`UPDATE inventory_events  SET from_member_id = ? WHERE from_member_id = ?`, into, from),
    run(`UPDATE inventory_events  SET to_member_id   = ? WHERE to_member_id   = ?`, into, from),

    // Signed in to the same meeting under both records: count them once
    run(`DELETE FROM meeting_attendees WHERE member_id = ?
         AND meeting_id IN (SELECT meeting_id FROM meeting_attendees WHERE member_id = ?)`, from, into),
    run(`UPDATE meeting_attendees SET member_id = ? WHERE member_id = ?`, into, from),
  ];

  if (plan.login?.action === 'move') {
    statements.push(run(`UPDATE users SET member_id = ? WHERE member_id = ?`, into, from));
  } else if (plan.login?.action === 'delete') {
    statements.push(run(`DELETE FROM users WHERE member_id = ? AND role = 'member'`, from));
  }

  // Whatever is left on the duplicate (sign-in codes) goes with it. It is
  // deleted before the kept record is filled in, so its callsign is free.
  statements.push(run(`DELETE FROM members WHERE id = ?`, from));

  const fields = Object.keys(plan.fill);
  statements.push(run(
    `UPDATE members SET ${fields.map(f => `${f} = ?, `).join('')}updated_at = datetime('now') WHERE id = ?`,
    ...fields.map(f => plan.fill[f]), into
  ));

  await env.DB.batch(statements);
  return plan;
}

export { label as mergeLabel };
