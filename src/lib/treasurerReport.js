/**
 * Treasurer report: the money the club received in one calendar year.
 *
 * Dues are counted in the year they were paid, not the year they are for, so
 * the totals line up with the bank account: a 2027 renewal paid in October
 * 2026 is 2026 money. Each dues payment still says which membership year it
 * covers. Donations are counted by donation date. Item donations carry an
 * estimated value only and are kept out of the money totals.
 */

// What Eastman pays the club for each member it sponsors
export const EASTMAN_PER_MEMBER = 3;

const METHODS = ['cash', 'check', 'paypal', 'stripe', 'eastman', 'other', 'unspecified'];

// Sum in cents so a long column of dollars does not drift
const cents   = (n) => Math.round(Number(n || 0) * 100);
const dollars = (c) => c / 100;

const memberName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');

function donorName(d) {
  if (d.donor_type === 'organization') return d.organization_name || 'Organization';
  if (d.donor_type === 'anonymous')    return 'Anonymous';
  if (d.donor_type === 'individual')   return d.donor_name || 'Individual';
  return memberName(d) || 'Member';
}

// A dues payment with no paid date is counted in the year it is for. Binds: year, year.
const DUES_RECEIVED = `
  SELECT ms.year AS dues_year, ms.membership_type, ms.amount_paid, ms.paid_date,
         ms.payment_method, ms.check_number, m.callsign, m.first_name, m.last_name
  FROM memberships ms
  JOIN members m ON m.id = ms.member_id
  WHERE ms.amount_paid > 0
    AND ((ms.paid_date IS NOT NULL AND substr(ms.paid_date, 1, 4) = ?)
      OR (ms.paid_date IS NULL AND ms.year = ?))
  ORDER BY ms.paid_date, ms.id
`;

// Binds: year.
const DONATIONS_RECEIVED = `
  SELECT d.donor_type, d.organization_name, d.donor_name, d.donation_kind, d.amount,
         d.item_description, d.estimated_value, d.donation_date, d.payment_method,
         d.check_number, m.callsign, m.first_name, m.last_name
  FROM donations d
  LEFT JOIN members m ON m.id = d.member_id
  WHERE substr(d.donation_date, 1, 4) = ?
  ORDER BY d.donation_date, d.id
`;

// Every year with money in it, for the year picker
const YEARS_WITH_MONEY = `
  SELECT CAST(coalesce(substr(paid_date, 1, 4), year) AS INTEGER) AS y FROM memberships WHERE amount_paid > 0
  UNION
  SELECT CAST(substr(donation_date, 1, 4) AS INTEGER) FROM donations
`;

/**
 * Returns {
 *   year, years,
 *   totals:       { dues, donations, received, payments },
 *   by_method:    [{ method, dues_count, dues, donation_count, donations, total }],
 *   dues_by_year: [{ dues_year, count, amount }],
 *   ledger:       [{ date, kind, detail, name, callsign, method, check_number, amount }],
 *   items:        [{ date, name, callsign, description, estimated_value }],
 *   items_value,
 *   eastman:      { members, amount },
 *   undated,
 * }.
 *
 * `ledger` is every payment behind the totals, oldest first; `kind` is 'dues'
 * or 'donation'. For an online payment `check_number` is the Stripe session ID. `eastman` is what Eastman owes for the members it sponsors in
 * `year`; it is not part of the totals. `undated` is how many dues payments
 * had no paid date.
 */
export async function treasurerReport(env, year, now = new Date()) {
  const y = String(year);
  const [dues, donations, eastman, yearRows] = await env.DB.batch([
    env.DB.prepare(DUES_RECEIVED).bind(y, year),
    env.DB.prepare(DONATIONS_RECEIVED).bind(y),
    env.DB.prepare(`SELECT COUNT(*) AS members FROM memberships WHERE year = ? AND payment_method = 'eastman'`).bind(year),
    env.DB.prepare(YEARS_WITH_MONEY),
  ]);

  const methods = new Map(METHODS.map(m => [m, { method: m, dues_count: 0, dues: 0, donation_count: 0, donations: 0 }]));
  const method = (name) => methods.get(METHODS.includes(name) ? name : 'unspecified');
  const duesYears = new Map();
  const ledger = [];
  let undated = 0;

  for (const r of dues.results) {
    const amount = cents(r.amount_paid);
    const m = method(r.payment_method);
    m.dues_count++;
    m.dues += amount;
    const dy = duesYears.get(r.dues_year) || { dues_year: r.dues_year, count: 0, amount: 0 };
    dy.count++;
    dy.amount += amount;
    duesYears.set(r.dues_year, dy);
    if (!r.paid_date) undated++;
    ledger.push({
      date: r.paid_date ? r.paid_date.slice(0, 10) : null,
      kind: 'dues',
      detail: `${r.dues_year} dues${r.membership_type === 'family' ? ' (family)' : ''}`,
      name: memberName(r), callsign: r.callsign,
      method: m.method, check_number: r.check_number, amount: dollars(amount),
    });
  }

  const items = [];
  let itemsValue = 0;
  for (const d of donations.results) {
    const date = d.donation_date.slice(0, 10);
    if (d.donation_kind === 'item') {
      itemsValue += cents(d.estimated_value);
      items.push({
        date, name: donorName(d), callsign: d.callsign,
        description: d.item_description, estimated_value: d.estimated_value,
      });
      continue;
    }
    const amount = cents(d.amount);
    if (!amount) continue;
    const m = method(d.payment_method);
    m.donation_count++;
    m.donations += amount;
    ledger.push({
      date, kind: 'donation', detail: 'Donation',
      name: donorName(d), callsign: d.callsign,
      method: m.method, check_number: d.check_number, amount: dollars(amount),
    });
  }

  // Oldest first; payments with no date go last
  ledger.sort((a, b) => (a.date === null) - (b.date === null) || (a.date || '').localeCompare(b.date || ''));

  const used = [...methods.values()].filter(m => m.dues_count || m.donation_count);
  const duesTotal     = used.reduce((sum, m) => sum + m.dues, 0);
  const donationTotal = used.reduce((sum, m) => sum + m.donations, 0);

  const years = new Set(yearRows.results.map(r => r.y).filter(Boolean));
  years.add(now.getUTCFullYear());
  years.add(year);

  return {
    year,
    years: [...years].sort((a, b) => b - a),
    totals: {
      dues: dollars(duesTotal),
      donations: dollars(donationTotal),
      received: dollars(duesTotal + donationTotal),
      payments: ledger.length,
    },
    by_method: used.map(m => ({
      ...m, dues: dollars(m.dues), donations: dollars(m.donations), total: dollars(m.dues + m.donations),
    })),
    dues_by_year: [...duesYears.values()].sort((a, b) => a.dues_year - b.dues_year)
      .map(d => ({ ...d, amount: dollars(d.amount) })),
    ledger,
    items,
    items_value: dollars(itemsValue),
    eastman: { members: eastman.results[0].members, amount: eastman.results[0].members * EASTMAN_PER_MEMBER },
    undated,
  };
}

function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  // Keep a spreadsheet from running a name or note as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The ledger as CSV, one payment per row, with item donations after it. */
export function treasurerCsv(report) {
  const rows = [['Date', 'Type', 'Detail', 'Name', 'Callsign', 'Method', 'Check # / Reference', 'Amount', 'Estimated Value']];
  for (const l of report.ledger) {
    rows.push([l.date, l.kind === 'dues' ? 'Dues' : 'Donation', l.detail, l.name, l.callsign, l.method, l.check_number, l.amount.toFixed(2), '']);
  }
  for (const i of report.items) {
    rows.push([i.date, 'Item donation', i.description, i.name, i.callsign, '', '', '',
      i.estimated_value != null ? Number(i.estimated_value).toFixed(2) : '']);
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/** A report year from a query string; null if it is not a sensible year. */
export function parseReportYear(value, now = new Date()) {
  if (value == null || value === '') return now.getUTCFullYear();
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}
