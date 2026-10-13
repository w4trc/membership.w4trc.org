import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { goodStandingYears, memberCredential } from '../src/lib/standing.js';
import { handlePrintCredential } from '../src/routes/print.js';
import { resetDb, addMember, addMembership } from './helpers.js';

const paid = (id, year = 2026, fields = {}) =>
  addMembership(id, year, { status: 'active', amount_paid: 20, paid_date: `${year}-01-10`, ...fields });

async function addOfficer(year, position, name, callsign = null) {
  await env.DB.prepare(`INSERT INTO officers (year, position, name, callsign) VALUES (?, ?, ?, ?)`)
    .bind(year, position, name, callsign).run();
}

beforeEach(resetDb);

describe('good standing', () => {
  it('covers every kind of current member', async () => {
    const payer = await addMember({ membership_type: 'family' });
    await paid(payer, 2026, { membership_type: 'family', amount_paid: 30 });
    const covered = await addMember();
    await addMembership(covered, 2026, { status: 'active', amount_due: 0, covered_by_member_id: payer });
    const honorary = await addMember();
    await addMembership(honorary, 2026, { status: 'honorary' });
    const waived = await addMember();
    await addMembership(waived, 2026, { status: 'waived' });
    const eastman = await addMember({ is_eastman_member: 1 });
    await addMembership(eastman, 2026, { status: 'active', amount_due: 0, payment_method: 'eastman' });
    const lifetime = await addMember({ membership_type: 'lifetime_honorary' });

    for (const id of [payer, covered, honorary, waived, eastman, lifetime]) {
      expect(await goodStandingYears(env, id, [2026])).toEqual([2026]);
    }
  });

  it('leaves out anyone who has not paid, and silent keys', async () => {
    const unpaid = await addMember();
    await addMembership(unpaid, 2026, { status: 'active' });
    const pending = await addMember();
    await addMembership(pending, 2026, { status: 'pending' });
    const expired = await addMember();
    await addMembership(expired, 2026, { status: 'expired', amount_paid: 20 });
    const silentKey = await addMember({ is_silent_key: 1 });
    await paid(silentKey);
    const noRecord = await addMember();

    for (const id of [unpaid, pending, expired, silentKey, noRecord, 999999]) {
      expect(await goodStandingYears(env, id, [2026])).toEqual([]);
      expect(await memberCredential(env, id, 2026)).toBeNull();
    }
  });

  it('answers year by year', async () => {
    const id = await addMember();
    await paid(id, 2025);
    await paid(id, 2027);

    expect(await goodStandingYears(env, id, [2026, 2027])).toEqual([2027]);
    expect(await goodStandingYears(env, id, [2025, 2025, 2026])).toEqual([2025]);
  });
});

describe('what the certificate and card say', () => {
  it('has the member, the year and the officers who sign', async () => {
    const id = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able', license_class: 'General', joined_date: '2019-04-02' });
    await paid(id);
    await addOfficer(2026, 'president', 'Larry Dale', 'KD4FTN');
    await addOfficer(2026, 'secretary', 'Sam Scribe');
    await addOfficer(2026, 'treasurer', 'Tina Till');
    await addOfficer(2025, 'president', 'Neil Weber', 'KM4NWH');

    expect(await memberCredential(env, id, 2026)).toEqual({
      year: 2026, name: 'Ann Able', callsign: 'KT4AAA', license_class: 'General',
      standing: 'Member', member_since: 2019,
      president: { name: 'Larry Dale', callsign: 'KD4FTN' },
      secretary: { name: 'Sam Scribe', callsign: null },
    });
  });

  it('leaves the signers blank when the officers are not on record', async () => {
    const id = await addMember();
    await paid(id);

    expect(await memberCredential(env, id, 2026)).toMatchObject({ president: null, secretary: null, member_since: null });
  });

  it('uses whoever was entered last when an office changed hands', async () => {
    const id = await addMember();
    await paid(id);
    await addOfficer(2026, 'president', 'First Half');
    await addOfficer(2026, 'president', 'Second Half');

    expect((await memberCredential(env, id, 2026)).president.name).toBe('Second Half');
  });

  it('names the kind of membership', async () => {
    const payer = await addMember({ membership_type: 'family' });
    await paid(payer, 2026, { membership_type: 'family', amount_paid: 30 });
    const covered = await addMember();
    await addMembership(covered, 2026, { status: 'active', amount_due: 0, covered_by_member_id: payer });
    const honorary = await addMember();
    await addMembership(honorary, 2026, { status: 'honorary' });
    const lifetime = await addMember({ membership_type: 'lifetime_honorary' });
    const individual = await addMember();
    await paid(individual);

    const standing = async (id) => (await memberCredential(env, id, 2026)).standing;
    expect(await standing(payer)).toBe('Family Member');
    expect(await standing(covered)).toBe('Family Member');
    expect(await standing(honorary)).toBe('Honorary Member');
    expect(await standing(lifetime)).toBe('Lifetime Honorary Member');
    expect(await standing(individual)).toBe('Member');
  });

  it('does not claim membership since a year after the one printed', async () => {
    const id = await addMember({ joined_date: '2026-03-01' });
    await paid(id, 2025);

    expect((await memberCredential(env, id, 2025)).member_since).toBeNull();
  });
});

describe('/print/certificate and /print/card', () => {
  let sessions = 0;

  /** A signed-in request from a user with `role`, linked to `memberId`. */
  async function request(path, role, memberId = null) {
    const id = String(++sessions).padStart(64, 'a');
    const user = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, role, member_id) VALUES (?, 'x', ?, ?)`
    ).bind(`user${sessions}@example.com`, role, memberId).run();
    await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
      .bind(id, user.meta.last_row_id, new Date(Date.now() + 60000).toISOString()).run();
    return new Request(`https://members.w4trc.org${path}`, { headers: { Cookie: `karc_session=${id}` } });
  }

  const testEnv = { DB: env.DB, CLUB_NAME: 'Kingsport Amateur Radio Club', CLUB_CALLSIGN: 'W4TRC' };
  const print = (req, kind = 'certificate') => handlePrintCredential(req, testEnv, kind);

  async function paidMember(fields = {}) {
    const id = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: '<Able>', license_class: 'General', joined_date: '2019-04-02', ...fields });
    await paid(id);
    return id;
  }

  it('prints a certificate for a board member', async () => {
    const id = await paidMember();
    await addOfficer(2026, 'president', 'Larry Dale', 'KD4FTN');

    const res = await print(await request(`/print/certificate?year=2026&member_id=${id}`, 'board'));

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Certificate of Membership');
    expect(html).toContain('<div class="name">Ann &lt;Able&gt;</div>');
    expect(html).toContain('is a <strong>Member</strong> in good standing of the Kingsport Amateur Radio Club for the year <strong>2026</strong>.');
    expect(html).toContain('Member since 2019');
    expect(html).toContain('Larry Dale, <span class="callsign">KD4FTN</span>');
    expect(html).not.toContain('undefined');
  });

  it('prints a card for a board member', async () => {
    const id = await paidMember();

    const html = await (await print(await request(`/print/card?year=2026&member_id=${id}`, 'board'), 'card')).text();

    expect(html).toContain('<div class="membercall callsign">KT4AAA</div>');
    expect(html).toContain('Member · General');
    expect(html).toContain('Valid through December 31, 2026');
    expect(html).not.toContain('undefined');
  });

  it('words a lifetime honorary membership without a year', async () => {
    const id = await addMember({ membership_type: 'lifetime_honorary' });

    const certificate = await (await print(await request(`/print/certificate?year=2026&member_id=${id}`, 'admin'))).text();
    const card = await (await print(await request(`/print/card?year=2026&member_id=${id}`, 'board'), 'card')).text();

    expect(certificate).toContain('is a <strong>Lifetime Honorary Member</strong> in good standing of the Kingsport Amateur Radio Club.');
    expect(card).toContain('Lifetime membership');
  });

  it('says "an Honorary Member"', async () => {
    const id = await addMember();
    await addMembership(id, 2026, { status: 'honorary' });

    const html = await (await print(await request(`/print/certificate?year=2026&member_id=${id}`, 'admin'))).text();

    expect(html).toContain('is an <strong>Honorary Member</strong>');
  });

  it('refuses until dues are paid', async () => {
    const id = await addMember();
    await addMembership(id, 2026, { status: 'pending' });

    const res = await print(await request(`/print/certificate?year=2026&member_id=${id}`, 'admin'));

    expect(res.status).toBe(404);
    expect(await res.text()).toContain('available once 2026 dues are paid');
  });

  it('is not open to members yet, even for their own record', async () => {
    const id = await paidMember();

    for (const kind of ['certificate', 'card']) {
      const res = await print(await request(`/print/${kind}?year=2026&member_id=${id}`, 'member', id), kind);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('/');
    }
  });

  it('turns away a missing member, a bad year, and anyone signed out', async () => {
    const id = await paidMember();

    expect((await print(await request('/print/certificate', 'board'))).status).toBe(404);
    expect((await print(await request('/print/certificate?member_id=abc', 'board'))).status).toBe(404);
    expect((await print(await request('/print/certificate?member_id=999999', 'board'))).status).toBe(404);
    expect((await print(await request(`/print/certificate?member_id=${id}&year=abc`, 'board'))).status).toBe(400);

    const signedOut = await print(new Request(`https://members.w4trc.org/print/certificate?member_id=${id}`));
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get('Location')).toBe('/');
  });
});
