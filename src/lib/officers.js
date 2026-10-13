/**
 * Officer history: the positions the club tracks, and reading a pasted list
 * of past officers.
 */

// In the order they are shown
export const POSITIONS = [
  { key: 'president',      label: 'President' },
  { key: 'vice_president', label: 'Vice President' },
  { key: 'treasurer',      label: 'Treasurer' },
  { key: 'secretary',      label: 'Secretary' },
  { key: 'trustee',        label: 'Trustee' },
];

export const isPosition = (key) => POSITIONS.some(p => p.key === key);

export const FIRST_YEAR = 1900;
// Next year's officers are usually elected before the year starts
export const lastYear = (now = new Date()) => now.getUTCFullYear() + 1;

export function isOfficerYear(year, now = new Date()) {
  return Number.isInteger(year) && year >= FIRST_YEAR && year <= lastYear(now);
}

const CALLSIGN = '[A-Za-z]{1,2}\\d[A-Za-z]{1,3}';
const TRAILING_CALLSIGN = new RegExp(`^(.*?)[\\s,;:(\\[–—-]+(${CALLSIGN})[)\\]]?$`);
const LEADING_CALLSIGN  = new RegExp(`^[(\\[]?(${CALLSIGN})[)\\]]?[\\s,;:–—-]+(.+)$`);
const ONLY_CALLSIGN     = new RegExp(`^[(\\[]?(${CALLSIGN})[)\\]]?$`);

const tidy = (s) => s.replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').replace(/\s+/g, ' ');

/** Split "John Smith, W4ABC" (or "W4ABC John Smith") into a name and a callsign. */
export function splitNameAndCallsign(text) {
  const s = tidy(text);
  let m;
  if ((m = s.match(ONLY_CALLSIGN)))     return { name: '', callsign: m[1].toUpperCase() };
  if ((m = s.match(TRAILING_CALLSIGN))) return { name: tidy(m[1]), callsign: m[2].toUpperCase() };
  if ((m = s.match(LEADING_CALLSIGN)))  return { name: tidy(m[2]), callsign: m[1].toUpperCase() };
  return { name: s, callsign: null };
}

/**
 * Read a pasted list, one officer per line:
 *
 *   1985 John Smith W4ABC
 *   1986-1988  Mary Jones, K4XYZ
 *   1989: Bob Brown
 *
 * A range of years gives one entry per year. Returns
 * { entries: [{ year, name, callsign }], errors: [{ line, text, error }] };
 * `line` counts from 1. Blank lines are skipped.
 */
export function parseOfficerLines(text, now = new Date()) {
  const entries = [];
  const errors  = [];

  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const fail = (error) => errors.push({ line: i + 1, text: line, error });

    const m = line.match(/^(\d{4})(?:\s*(?:[-–—]|to)\s*(\d{4}|\d{2})(?!\d))?(.*)$/);
    if (!m) return fail('Start the line with a four-digit year');

    const first = Number(m[1]);
    // "1985-87" means 1985 to 1987
    const last = !m[2] ? first : m[2].length === 2 ? Math.floor(first / 100) * 100 + Number(m[2]) : Number(m[2]);
    if (!isOfficerYear(first, now) || !isOfficerYear(last, now)) {
      return fail(`The year must be between ${FIRST_YEAR} and ${lastYear(now)}`);
    }
    if (last < first) return fail('The years are the wrong way round');

    const who = splitNameAndCallsign(m[3]);
    if (!who.name && !who.callsign) return fail('No name after the year');

    for (let year = first; year <= last; year++) entries.push({ year, ...who });
  });

  return { entries, errors };
}

/**
 * Officer rows as one line per year, newest first:
 * [{ year, president: [row, ...], vice_president: [...], ... }].
 */
export function officersByYear(rows) {
  const years = new Map();
  for (const row of rows) {
    if (!isPosition(row.position)) continue;
    if (!years.has(row.year)) {
      years.set(row.year, { year: row.year, ...Object.fromEntries(POSITIONS.map(p => [p.key, []])) });
    }
    years.get(row.year)[row.position].push(row);
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}
