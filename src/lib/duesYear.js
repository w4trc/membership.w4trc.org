/**
 * Membership year that online dues payments apply to.
 *
 * Renewal season opens October 1: from then through December 31, members pay
 * for the following year. The rest of the year, they pay for the current year.
 */

import { audit } from './audit.js';

export const RENEWAL_START_MONTH = 10; // October

export function duesYear(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= RENEWAL_START_MONTH ? year + 1 : year;
}

/**
 * Reactivate lapsed members who paid in advance for the year that just began.
 *
 * A member made inactive by a cutoff who renews in Oct–Dec stays inactive for
 * the rest of that year; their new year starts January 1. Runs from the daily
 * cron during January only, and only touches records paid before Jan 1, so an
 * officer deactivating a member later in the year is never undone.
 */
export async function activateRenewedMembers(env, now = new Date()) {
  if (now.getUTCMonth() !== 0) return;

  const year = now.getUTCFullYear();
  const paidInAdvance = `
    SELECT ms.member_id FROM memberships ms
    WHERE ms.year = ?
      AND ms.status = 'active'
      AND (ms.amount_paid IS NOT NULL OR ms.covered_by_member_id IS NOT NULL)
      AND ms.paid_date < ?
  `;
  const yearStart = `${year}-01-01`;

  const { results } = await env.DB.prepare(`
    SELECT id FROM members
    WHERE is_active = 0 AND is_silent_key = 0
      AND id IN (${paidInAdvance})
  `).bind(year, yearStart).all();

  if (!results.length) return;

  await env.DB.prepare(`
    UPDATE members SET is_active = 1, updated_at = datetime('now')
    WHERE is_active = 0 AND is_silent_key = 0
      AND id IN (${paidInAdvance})
  `).bind(year, yearStart).run();

  await audit(env, {
    userId: null,
    action: 'member.renewal_activated',
    detail: { year, activated_count: results.length, member_ids: results.map(r => r.id) },
  });
}
