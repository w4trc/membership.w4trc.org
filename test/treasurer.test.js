import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { parseReportYear, treasurerCsv, treasurerReport } from '../src/lib/treasurerReport.js';
import { handleAdmin } from '../src/routes/admin.js';
import { handlePrintTreasurer } from '../src/routes/print.js';
import { resetDb, addMember, addMembership } from './helpers.js';

const NOW = new Date('2026-10-12T15:00:00Z');
const report = (year = 2026) => treasurerReport(env, year, NOW);

/** A dues payment. */
async function paid(member, year, amount, paid_date, fields = {}) {
  await addMembership(member, year, { status: 'active', amount_paid: amount, paid_date, payment_method: 'cash', ...fields });
}

async function addDonation(fields) {
  const d = { donor_type: 'anonymous', donation_kind: 'monetary', donation_date: '2026-05-01', ...fields };
  const cols = Object.keys(d);
  await env.DB.prepare(
    `INSERT INTO donations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...Object.values(d)).run();
}

beforeEach(resetDb);

describe('what counts', () => {
  it('counts dues in the year they were paid, whichever year they are for', async () => {
    const a = await addMember();
    await paid(a, 2026, 20, '2026-01-15');
    await paid(a, 2027, 20, '2026-10-05');
    const b = await addMember();
    await paid(b, 2026, 30, '2025-11-20', { membership_type: 'family' });
    await paid(b, 2025, 20, '2026-02-01');

    const r = await report(2026);

    expect(r.totals).toEqual({ dues: 60, donations: 0, received: 60, payments: 3 });
    expect(r.dues_by_year).toEqual([
      { dues_year: 2025, count: 1, amount: 20 },
      { dues_year: 2026, count: 1, amount: 20 },
      { dues_year: 2027, count: 1, amount: 20 },
    ]);
    expect((await report(2025)).totals).toMatchObject({ dues: 30, payments: 1 });
  });

  it('leaves out dues records with nothing paid', async () => {
    const payer = await addMember();
    await paid(payer, 2026, 30, '2026-01-10', { membership_type: 'family' });
    await addMembership(await addMember(), 2026, { status: 'active', amount_due: 0, covered_by_member_id: payer });
    await addMembership(await addMember(), 2026, { status: 'pending' });
    await addMembership(await addMember(), 2026, { status: 'honorary' });
    await addMembership(await addMember(), 2026, { status: 'active', amount_paid: 0, paid_date: '2026-01-10' });

    const r = await report();

    expect(r.totals).toEqual({ dues: 30, donations: 0, received: 30, payments: 1 });
  });

  it('counts a dues payment with no paid date in the year it is for', async () => {
    const a = await addMember();
    await paid(a, 2026, 20, null);
    await paid(a, 2025, 20, null);

    const r = await report();

    expect(r.totals.dues).toBe(20);
    expect(r.undated).toBe(1);
    expect(r.ledger[0]).toMatchObject({ date: null, detail: '2026 dues' });
  });

  it('counts money donations by donation date and keeps items apart', async () => {
    await addDonation({ amount: 100, donation_date: '2026-03-01', payment_method: 'check', check_number: '1042' });
    await addDonation({ amount: 50, donation_date: '2025-12-31' });
    await addDonation({ donation_kind: 'item', item_description: 'Yaesu FT-891', estimated_value: 400, donation_date: '2026-04-02' });
    await addDonation({ donation_kind: 'item', item_description: 'Coax', donation_date: '2026-04-03' });

    const r = await report();

    expect(r.totals).toEqual({ dues: 0, donations: 100, received: 100, payments: 1 });
    expect(r.items).toEqual([
      { date: '2026-04-02', name: 'Anonymous', callsign: null, description: 'Yaesu FT-891', estimated_value: 400 },
      { date: '2026-04-03', name: 'Anonymous', callsign: null, description: 'Coax', estimated_value: null },
    ]);
    expect(r.items_value).toBe(400);
  });

  it('adds cents up exactly', async () => {
    for (let i = 0; i < 3; i++) await addDonation({ amount: 0.1, payment_method: 'cash' });
    await addDonation({ amount: 20.3, payment_method: 'stripe' });

    const r = await report();

    expect(r.totals.donations).toBe(20.6);
    expect(r.by_method.map(m => [m.method, m.donations])).toEqual([['cash', 0.3], ['stripe', 20.3]]);
  });
});

describe('breakdowns', () => {
  it('splits dues and donations by payment method', async () => {
    const a = await addMember();
    await paid(a, 2026, 20, '2026-01-15', { payment_method: 'check', check_number: '88' });
    await paid(await addMember(), 2026, 20, '2026-01-16', { payment_method: 'stripe' });
    await paid(await addMember(), 2026, 30, '2026-01-17', { payment_method: 'stripe', membership_type: 'family' });
    await paid(await addMember(), 2026, 20, '2026-01-18', { payment_method: null });
    await addDonation({ amount: 25, payment_method: 'stripe' });
    await addDonation({ amount: 10, payment_method: 'cash' });

    const r = await report();

    expect(r.by_method).toEqual([
      { method: 'cash',        dues_count: 0, dues: 0,  donation_count: 1, donations: 10, total: 10 },
      { method: 'check',       dues_count: 1, dues: 20, donation_count: 0, donations: 0,  total: 20 },
      { method: 'stripe',      dues_count: 2, dues: 50, donation_count: 1, donations: 25, total: 75 },
      { method: 'unspecified', dues_count: 1, dues: 20, donation_count: 0, donations: 0,  total: 20 },
    ]);
    expect(r.totals).toEqual({ dues: 90, donations: 35, received: 125, payments: 6 });
  });

  it('lists every payment, oldest first, with who it came from', async () => {
    const ann = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able' });
    await paid(ann, 2027, 30, '2026-10-03', { payment_method: 'check', check_number: '204', membership_type: 'family' });
    await addDonation({ donor_type: 'member', member_id: ann, amount: 15, donation_date: '2026-02-01', payment_method: 'cash' });
    await addDonation({ donor_type: 'organization', organization_name: 'Eastman', amount: 500, donation_date: '2026-06-01', payment_method: 'check' });
    await addDonation({ donor_type: 'individual', donor_name: 'Pat Public', amount: 5, donation_date: '2026-07-01 14:30:00', payment_method: 'stripe' });

    const { ledger } = await report();

    expect(ledger).toEqual([
      { date: '2026-02-01', kind: 'donation', detail: 'Donation', name: 'Ann Able', callsign: 'KT4AAA', method: 'cash', check_number: null, amount: 15 },
      { date: '2026-06-01', kind: 'donation', detail: 'Donation', name: 'Eastman', callsign: null, method: 'check', check_number: null, amount: 500 },
      { date: '2026-07-01', kind: 'donation', detail: 'Donation', name: 'Pat Public', callsign: null, method: 'stripe', check_number: null, amount: 5 },
      { date: '2026-10-03', kind: 'dues', detail: '2027 dues (family)', name: 'Ann Able', callsign: 'KT4AAA', method: 'check', check_number: '204', amount: 30 },
    ]);
  });

  it('reports what Eastman owes for the year without adding it to the totals', async () => {
    for (let i = 0; i < 2; i++) {
      await addMembership(await addMember({ is_eastman_member: 1 }), 2026, { status: 'active', amount_due: 0, payment_method: 'eastman' });
    }
    await addMembership(await addMember({ is_eastman_member: 1 }), 2025, { status: 'active', amount_due: 0, payment_method: 'eastman' });

    const r = await report();

    expect(r.eastman).toEqual({ members: 2, amount: 6 });
    expect(r.totals.received).toBe(0);
  });

  it('offers every year that has money in it, plus this year', async () => {
    await paid(await addMember(), 2024, 20, '2023-11-01');
    await addDonation({ amount: 5, donation_date: '2022-06-01' });

    expect((await report(2026)).years).toEqual([2026, 2023, 2022]);
    expect((await report(2019)).years).toEqual([2026, 2023, 2022, 2019]);
  });

  it('is empty for a year with nothing in it', async () => {
    const r = await report(2020);

    expect(r).toMatchObject({
      year: 2020, totals: { dues: 0, donations: 0, received: 0, payments: 0 },
      by_method: [], dues_by_year: [], ledger: [], items: [], items_value: 0, undated: 0,
    });
  });
});

describe('CSV', () => {
  it('has one row per payment, then the item donations', async () => {
    const ann = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able' });
    await paid(ann, 2026, 20, '2026-01-15', { payment_method: 'check', check_number: '88' });
    await addDonation({ donor_type: 'organization', organization_name: 'Smith, Jones & Co', amount: 1250.5, donation_date: '2026-02-01', payment_method: 'check' });
    await addDonation({ donation_kind: 'item', item_description: 'A "nice" antenna', estimated_value: 75, donation_date: '2026-03-01' });

    const csv = treasurerCsv(await report());

    expect(csv.split('\r\n')).toEqual([
      'Date,Type,Detail,Name,Callsign,Method,Check # / Reference,Amount,Estimated Value',
      '2026-01-15,Dues,2026 dues,Ann Able,KT4AAA,check,88,20.00,',
      '2026-02-01,Donation,Donation,"Smith, Jones & Co",,check,,1250.50,',
      '2026-03-01,Item donation,"A ""nice"" antenna",Anonymous,,,,,75.00',
    ]);
  });

  it('does not let a name run as a spreadsheet formula', async () => {
    await addDonation({ donor_type: 'individual', donor_name: '=HYPERLINK("http://x","y")', amount: 5 });

    const csv = treasurerCsv(await report());

    expect(csv.split('\r\n')[1]).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});

describe('parseReportYear', () => {
  it('defaults to this year and rejects anything that is not a year', () => {
    expect(parseReportYear(null, NOW)).toBe(2026);
    expect(parseReportYear('', NOW)).toBe(2026);
    expect(parseReportYear('2024', NOW)).toBe(2024);
    expect(parseReportYear('20x4', NOW)).toBeNull();
    expect(parseReportYear('2024.5', NOW)).toBeNull();
    expect(parseReportYear('99999', NOW)).toBeNull();
  });
});

describe('/api/admin/treasurer-report', () => {
  const call = (query, user) => handleAdmin(
    new Request(`https://members.w4trc.org/api/admin/treasurer-report${query}`),
    env, '/api/admin/treasurer-report', user
  );
  const board = { id: 1, role: 'board' };

  it('gives a board member the report for the year asked for', async () => {
    await paid(await addMember(), 2024, 20, '2024-02-01');

    const res = await call('?year=2024', board);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ year: 2024, totals: { received: 20 } });
  });

  it('downloads the CSV', async () => {
    await paid(await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able' }), 2024, 20, '2024-02-01');

    const res = await call('?year=2024&format=csv', board);

    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="w4trc-treasurer-2024.csv"');
    expect(await res.text()).toContain('2024-02-01,Dues,2024 dues,Ann Able,KT4AAA,cash,,20.00,');
  });

  it('rejects a bad year', async () => {
    expect((await call('?year=abc', board)).status).toBe(400);
  });

  it('is for the board and admins only', async () => {
    expect((await call('', { id: 1, role: 'member' })).status).toBe(403);
    expect((await call('', { id: 1, role: 'admin' })).status).toBe(200);
  });
});

describe('/print/treasurer', () => {
  const SESSION = 'a'.repeat(64);

  async function signedIn(role) {
    const user = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, role) VALUES (?, 'x', ?)`
    ).bind(`${role}@example.com`, role).run();
    await env.DB.prepare(`DELETE FROM sessions`).run();
    await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
      .bind(SESSION, user.meta.last_row_id, new Date(Date.now() + 60000).toISOString()).run();
    return new Request('https://members.w4trc.org/print/treasurer?year=2026', { headers: { Cookie: `karc_session=${SESSION}` } });
  }

  it('prints the report for a board member', async () => {
    const ann = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: '<Able>' });
    await paid(ann, 2027, 1030, '2026-10-03', { payment_method: 'check', check_number: '204' });
    await paid(await addMember(), 2026, 21, '2026-02-03', { payment_method: 'stripe', check_number: 'cs_test_a1b2c3' });
    await addDonation({ amount: 15, payment_method: 'cash' });
    await addDonation({ donation_kind: 'item', item_description: 'Coax', estimated_value: 40 });
    await addMembership(await addMember(), 2026, { status: 'active', amount_due: 0, payment_method: 'eastman' });

    const res = await handlePrintTreasurer(await signedIn('board'), env);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Money received in 2026');
    expect(html).toContain('<strong>$1,066.00</strong>Total received');
    expect(html).toContain('2027 dues (paid in advance)');
    expect(html).toContain('Ann &lt;Able&gt; <span class="callsign">KT4AAA</span>');
    expect(html).toContain('Check #204');
    // An online payment's reference is a Stripe session ID, too long to print
    expect(html).not.toContain('cs_test_a1b2c3');
    expect(html).toContain('Eastman sponsors 1 member for 2026 at $3.00 each, $3.00 in all.');
    expect(html).toContain('Item donations (not money)');
    expect(html).not.toContain('undefined');
  });

  it('sends anyone else back to the sign-in page', async () => {
    const anonymous = await handlePrintTreasurer(new Request('https://members.w4trc.org/print/treasurer?year=2026'), env);
    const member = await handlePrintTreasurer(await signedIn('member'), env);

    for (const res of [anonymous, member]) {
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
    }
  });
});
