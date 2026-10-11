/**
 * Family membership links.
 *
 * A family link is stored per year on the dependent's dues record
 * (memberships.covered_by_member_id), so there is no standing "family" row.
 * For a year with no link recorded yet, the link carries forward from the
 * dependent's most recent earlier dues record.
 */

// Who covers `m` for a given year: that year's record if it names a payer,
// otherwise the most recent earlier record. Binds: year, year.
const COVERED_BY_FOR_YEAR = `
  COALESCE(
    (SELECT ms.covered_by_member_id FROM memberships ms
     WHERE ms.member_id = m.id AND ms.year = ?),
    (SELECT ms.covered_by_member_id FROM memberships ms
     WHERE ms.member_id = m.id AND ms.year < ?
     ORDER BY ms.year DESC LIMIT 1)
  )
`;

/** Members covered under `payerId`'s family membership for `year`. */
export async function familyDependents(env, payerId, year) {
  const { results } = await env.DB.prepare(`
    SELECT m.id, m.callsign, m.first_name, m.last_name
    FROM members m
    WHERE m.id != ?
      AND m.is_silent_key = 0
      AND ${COVERED_BY_FOR_YEAR} = ?
    ORDER BY m.last_name, m.first_name
  `).bind(payerId, year, year, payerId).all();
  return results;
}

/** The member whose family membership covers `memberId` for `year`, or null. */
export async function familyPayer(env, memberId, year) {
  const payer = await env.DB.prepare(`
    SELECT p.id, p.callsign, p.first_name, p.last_name
    FROM members m
    JOIN members p ON p.id = ${COVERED_BY_FOR_YEAR}
    WHERE m.id = ? AND p.id != m.id
  `).bind(year, year, memberId).first();
  return payer || null;
}

/**
 * Mark everyone covered under `payerId` as paid for `year`, after the payer's
 * family dues are paid. Dependents who already paid on their own, or are
 * honorary/waived, are left alone. Returns the member IDs that were covered.
 */
export async function coverFamilyDependents(env, payerId, year, paidDate) {
  const dependents = await familyDependents(env, payerId, year);
  const covered = [];

  for (const dep of dependents) {
    const existing = await env.DB.prepare(
      `SELECT id, status, amount_paid FROM memberships WHERE member_id = ? AND year = ? LIMIT 1`
    ).bind(dep.id, year).first();

    if (existing && (existing.amount_paid != null || ['honorary', 'waived'].includes(existing.status))) {
      continue;
    }

    if (existing) {
      await env.DB.prepare(`
        UPDATE memberships SET
          status = 'active', membership_type = 'family', amount_due = 0,
          paid_date = ?, covered_by_member_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(paidDate, payerId, existing.id).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO memberships
          (member_id, year, status, membership_type, amount_due, paid_date, covered_by_member_id)
        VALUES (?, ?, 'active', 'family', 0, ?, ?)
      `).bind(dep.id, year, paidDate, payerId).run();
    }
    covered.push(dep.id);
  }

  return covered;
}
