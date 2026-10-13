/**
 * Who is a member in good standing for a year, and what their membership
 * certificate and card say.
 */

// Good standing for a year: paid, covered by a paid family membership, paid
// for by Eastman, honorary or waived for the year, or lifetime honorary.
// For a query with `m` (members) LEFT JOINed to `ms`, that year's dues record.
export const IN_GOOD_STANDING = `
  m.is_silent_key = 0
  AND (
    m.membership_type = 'lifetime_honorary'
    OR ms.status IN ('honorary', 'waived')
    OR (ms.status = 'active' AND (
      ms.amount_paid IS NOT NULL
      OR ms.covered_by_member_id IS NOT NULL
      OR ms.payment_method = 'eastman'
    ))
  )
`;

/** Which of `years` the member is in good standing for. */
export async function goodStandingYears(env, memberId, years) {
  const unique = [...new Set(years)];
  const results = await env.DB.batch(unique.map(year => env.DB.prepare(`
    SELECT 1 FROM members m
    LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.year = ?
    WHERE m.id = ? AND ${IN_GOOD_STANDING}
  `).bind(year, memberId)));
  return unique.filter((_, i) => results[i].results.length);
}

/**
 * What goes on a member's certificate and card for `year`, or null if they are
 * not in good standing for it. Returns {
 *   year, name, callsign, license_class, standing, member_since,
 *   president: { name, callsign } | null, secretary: { name, callsign } | null,
 * }.
 */
export async function memberCredential(env, memberId, year) {
  const [member, officers] = await env.DB.batch([
    env.DB.prepare(`
      SELECT m.callsign, m.first_name, m.last_name, m.license_class, m.joined_date,
             m.membership_type AS member_type, ms.status, ms.membership_type AS dues_type,
             ms.covered_by_member_id
      FROM members m
      LEFT JOIN memberships ms ON ms.member_id = m.id AND ms.year = ?
      WHERE m.id = ? AND ${IN_GOOD_STANDING}
    `).bind(year, memberId),
    env.DB.prepare(
      `SELECT position, name, callsign FROM officers
       WHERE year = ? AND position IN ('president', 'secretary') ORDER BY id`
    ).bind(year),
  ]);

  const m = member.results[0];
  if (!m) return null;

  const standing = m.member_type === 'lifetime_honorary' ? 'Lifetime Honorary Member'
    : m.status === 'honorary' ? 'Honorary Member'
    : m.covered_by_member_id || m.dues_type === 'family' ? 'Family Member'
    : 'Member';

  // If the office changed hands during the year, whoever was entered last signs
  const signer = (position) => {
    const held = officers.results.filter(o => o.position === position).pop();
    return held ? { name: held.name, callsign: held.callsign } : null;
  };

  const since = /^\d{4}/.test(m.joined_date || '') ? Number(m.joined_date.slice(0, 4)) : null;

  return {
    year,
    name: `${m.first_name} ${m.last_name}`.trim(),
    callsign: m.callsign,
    license_class: m.license_class,
    standing,
    member_since: since && since <= year ? since : null,
    president: signer('president'),
    secretary: signer('secretary'),
  };
}
