/**
 * Today's date where the club is.
 *
 * Workers run on UTC, which is already tomorrow after 8 PM Eastern (7 PM in
 * winter). A payment, donation or note made on an evening would otherwise be
 * dated the next day, and on December 31 counted in the wrong year.
 */

export const CLUB_TIME_ZONE = 'America/New_York';

// en-CA formats dates as YYYY-MM-DD
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLUB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Today's date in the club's time zone, as YYYY-MM-DD. */
export function clubToday(now = new Date()) {
  return formatter.format(now);
}

/** The current year in the club's time zone. */
export function clubYear(now = new Date()) {
  return Number(clubToday(now).slice(0, 4));
}
