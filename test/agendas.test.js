import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleAgendas } from '../src/routes/agendas.js';
import { handleMeetings } from '../src/routes/meetings.js';
import { agendaHtml } from '../src/routes/printAgenda.js';
import { agendaTemplate, cleanAgendaFields, quorumNeeded } from '../src/lib/agenda.js';
import { resetDb, addMember, addMembership, auditActions } from './helpers.js';

const board = { id: null, role: 'board' };
const admin = { id: null, role: 'admin' };

const request = (handler, base) => (method, path = '', body, user = board) => handler(
  new Request(`https://members.w4trc.org${base}${path}`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
  }),
  env, `${base}${path}`, user
);
const call    = request(handleAgendas, '/api/agendas');
const meeting = request(handleMeetings, '/api/meetings');

async function create(fields = {}) {
  const res = await call('POST', '', { meeting_type: 'monthly', meeting_date: '2026-11-03', ...fields });
  expect(res.status, await res.clone().text()).toBe(201);
  return res.json();
}

const get = async (id) => (await call('GET', `/${id}`)).json();

async function addItem(agendaId, section, title, status) {
  const item = await (await call('POST', `/${agendaId}/items`, { section, title })).json();
  if (status) await call('PATCH', `/${agendaId}/items/${item.id}`, { status });
  return item;
}

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM meeting_attendees'),
    env.DB.prepare('DELETE FROM meetings'),
  ]);
});

describe('templates', () => {
  const steps = (type) => agendaTemplate(type).sections.flatMap(s => s.steps.map(st => st.key));
  const sections = (type) => agendaTemplate(type).sections.map(s => s.key);

  it('gives a general meeting the full checklist', () => {
    expect(sections('monthly')).toContain('presentation');
    expect(steps('monthly')).toEqual(expect.arrayContaining(['pledge', 'prayer', 'welcome', 'recess', 'av_tested']));
  });

  it('leaves the general-meeting parts out of a board meeting and renumbers', () => {
    const t = agendaTemplate('board');
    expect(t.kind).toBe('board');
    expect(sections('board')).not.toContain('presentation');
    expect(steps('board')).not.toEqual(expect.arrayContaining(['pledge']));
    for (const k of ['pledge', 'prayer', 'welcome', 'recess']) expect(steps('board')).not.toContain(k);
    expect(t.sections.map(s => s.number)).toEqual(t.sections.map((_, i) => i + 1));
    expect(t.sections.at(-1).key).toBe('closing');
  });
});

describe('agenda fields', () => {
  it('turns blanks into null and checks times, dates and quorum', () => {
    expect(cleanAgendaFields({ location: '  Hall ', presiding: '', called_to_order: '19:05', quorum: '1', other: 'x' }).values)
      .toEqual({ location: 'Hall', presiding: null, called_to_order: '19:05', quorum: 1 });
    expect(cleanAgendaFields({ start_time: '7pm' }).error).toMatch(/time/);
    expect(cleanAgendaFields({ next_meeting_date: 'Dec 1' }).error).toMatch(/date/);
    expect(cleanAgendaFields({ quorum: 'maybe' }).error).toMatch(/quorum/);
    expect(cleanAgendaFields({ quorum: '' }).values).toEqual({ quorum: null });
  });
});

describe('starting an agenda', () => {
  it('creates the meeting and fills in the president and secretary for that year', async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO officers (year, position, name, callsign) VALUES (2026, 'president', 'Pat Prez', 'W4PP')`),
      env.DB.prepare(`INSERT INTO officers (year, position, name) VALUES (2026, 'secretary', 'Sam Sec')`),
      env.DB.prepare(`INSERT INTO officers (year, position, name) VALUES (2025, 'president', 'Old Prez')`),
    ]);
    const data = await create({ location: 'Library', start_time: '19:00', title: 'Elections' });

    expect(data.agenda).toMatchObject({
      meeting_type: 'monthly', meeting_date: '2026-11-03', title: 'Elections',
      location: 'Library', start_time: '19:00', presiding: 'Pat Prez W4PP', secretary: 'Sam Sec',
    });
    expect(data.template.kind).toBe('general');
    expect(data.report_slots.find(s => s.key === 'president').officers).toEqual([{ name: 'Pat Prez', callsign: 'W4PP' }]);
    expect(data.report_slots.at(-1).key).toBe('committee');

    const m = await env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(data.agenda.meeting_id).first();
    expect(m).toMatchObject({ meeting_type: 'monthly', meeting_date: '2026-11-03' });
    expect((await auditActions()).map(a => a.action)).toEqual(['agenda.create']);
  });

  it('uses a meeting already recorded for that date and type, and refuses a second agenda', async () => {
    const existing = await (await meeting('POST', '', { meeting_type: 'monthly', meeting_date: '2026-11-03', callsigns: '', guests: ['Jane Doe'] })).json();
    const data = await create();
    expect(data.agenda.meeting_id).toBe(existing.meeting.id);
    expect(data.attendance.total).toBe(1);

    const again = await call('POST', '', { meeting_type: 'monthly', meeting_date: '2026-11-03' });
    expect(again.status).toBe(409);
    expect((await again.json()).agenda_id).toBe(data.agenda.id);

    // A board meeting the same day is a different meeting
    const boardMeeting = await create({ meeting_type: 'board' });
    expect(boardMeeting.agenda.meeting_id).not.toBe(existing.meeting.id);
  });

  it('rejects a bad date, type or time', async () => {
    expect((await call('POST', '', { meeting_type: 'monthly', meeting_date: 'Tuesday' })).status).toBe(400);
    expect((await call('POST', '', { meeting_type: 'party', meeting_date: '2026-11-03' })).status).toBe(400);
    expect((await call('POST', '', { meeting_type: 'monthly', meeting_date: '2026-11-03', start_time: '7pm' })).status).toBe(400);
  });

  it('is for officers only', async () => {
    expect((await call('GET', '', null, { id: null, role: 'member' })).status).toBe(403);
  });
});

describe('carrying business forward', () => {
  it('copies open old and new business into the next agenda of the same type, once', async () => {
    const oct = (await create({ meeting_date: '2026-10-06' })).agenda.id;
    await addItem(oct, 'new', 'Buy a new antenna');
    await addItem(oct, 'new', 'Pick a field day site', 'resolved');
    await addItem(oct, 'old', 'Repeater battery');
    await addItem(oct, 'old', 'Bylaws update', 'tabled');
    await addItem(oct, 'announcement', 'Hamfest Saturday');

    // A board agenda in between does not get general-meeting business
    const boardData = await create({ meeting_type: 'board', meeting_date: '2026-10-20' });
    expect(boardData.items).toEqual([]);

    const nov = await create({ meeting_date: '2026-11-03' });
    expect(nov.items.map(i => [i.section, i.title, i.status, i.carried_from_date])).toEqual([
      ['old', 'Repeater battery', 'open', '2026-10-06'],
      ['old', 'Buy a new antenna', 'open', '2026-10-06'],
    ]);
    expect(nov.previous).toMatchObject({ id: oct, meeting_date: '2026-10-06' });

    // Pulling in again adds nothing new, but picks up an item added since
    expect(await (await call('POST', `/${nov.agenda.id}/carry`, {})).json()).toEqual({ carried: 0 });
    await addItem(oct, 'new', 'Late addition');
    expect(await (await call('POST', `/${nov.agenda.id}/carry`, {})).json()).toEqual({ carried: 1 });
    expect((await get(nov.agenda.id)).items).toHaveLength(3);
  });

  it('keeps a carried copy when the agenda it came from is deleted', async () => {
    const oct = (await create({ meeting_date: '2026-10-06' })).agenda.id;
    await addItem(oct, 'new', 'Buy a new antenna');
    const nov = (await create({ meeting_date: '2026-11-03' })).agenda.id;

    expect((await call('DELETE', `/${oct}`, null, admin)).status).toBe(200);
    const items = (await get(nov)).items;
    expect(items.map(i => [i.title, i.carried_from_id])).toEqual([['Buy a new antenna', null]]);
  });
});

describe('filling in an agenda', () => {
  it('changes only the fields sent', async () => {
    const id = (await create({ location: 'Library' })).agenda.id;
    expect((await call('PATCH', `/${id}`, { presenter_name: 'Dana', called_to_order: '19:02' })).status).toBe(200);
    expect((await call('PATCH', `/${id}`, { quorum: '1' })).status).toBe(200);
    expect((await get(id)).agenda).toMatchObject({ location: 'Library', presenter_name: 'Dana', called_to_order: '19:02', quorum: 1 });

    expect((await call('PATCH', `/${id}`, { adjourned_at: 'late' })).status).toBe(400);
    expect((await call('PATCH', `/${id}`, { meeting_id: 99 })).status).toBe(400);
  });

  it('ticks and unticks checklist steps for this meeting type only', async () => {
    const id = (await create()).agenda.id;
    await call('POST', `/${id}/checks`, { step: 'pledge', checked: true });
    await call('POST', `/${id}/checks`, { step: 'pledge', checked: true });
    await call('POST', `/${id}/checks`, { step: 'quorum', checked: true });
    await call('POST', `/${id}/checks`, { step: 'quorum', checked: false });
    expect((await get(id)).checks.map(c => c.step)).toEqual(['pledge']);
    expect((await call('POST', `/${id}/checks`, { step: 'nope', checked: true })).status).toBe(400);

    const boardId = (await create({ meeting_type: 'board' })).agenda.id;
    expect((await call('POST', `/${boardId}/checks`, { step: 'pledge', checked: true })).status).toBe(400);
  });

  it('saves officer reports without losing what was there', async () => {
    const id = (await create()).agenda.id;
    await call('PUT', `/${id}/reports/treasurer`, { body: 'Paid the repeater insurance' });
    await call('PUT', `/${id}/reports/treasurer`, { given: true });
    await call('PUT', `/${id}/reports/committee`, { body: 'Field day committee' });
    const { reports } = await get(id);
    expect(reports.find(r => r.report_key === 'treasurer')).toMatchObject({ body: 'Paid the repeater insurance', given: 1 });
    expect(reports).toHaveLength(2);
    expect((await call('PUT', `/${id}/reports/dogcatcher`, { body: 'x' })).status).toBe(400);
  });

  it('records, changes and removes motions', async () => {
    const id = (await create()).agenda.id;
    expect((await call('POST', `/${id}/motions`, { motion: '' })).status).toBe(400);
    expect((await call('POST', `/${id}/motions`, { motion: 'Buy coax', votes_yes: -1 })).status).toBe(400);

    const m = await (await call('POST', `/${id}/motions`, { motion: 'Buy coax', moved_by: 'W4AAA', votes_yes: '12', votes_no: '' })).json();
    expect(m).toMatchObject({ motion: 'Buy coax', moved_by: 'W4AAA', votes_yes: 12, votes_no: null, result: null });

    const changed = await (await call('PATCH', `/${id}/motions/${m.id}`, { result: 'passed', votes_no: 2 })).json();
    expect(changed).toMatchObject({ motion: 'Buy coax', votes_yes: 12, votes_no: 2, result: 'passed' });
    expect((await call('PATCH', `/${id}/motions/${m.id}`, { result: 'maybe' })).status).toBe(400);

    expect((await call('DELETE', `/${id}/motions/${m.id}`)).status).toBe(200);
    expect((await get(id)).motions).toEqual([]);
  });

  it('will not touch an item on a different agenda', async () => {
    const a = (await create({ meeting_date: '2026-10-06' })).agenda.id;
    const b = (await create({ meeting_date: '2026-11-03' })).agenda.id;
    const item = await addItem(a, 'new', 'Mine');
    expect((await call('PATCH', `/${b}/items/${item.id}`, { title: 'Yours' })).status).toBe(404);
    expect((await call('DELETE', `/${b}/items/${item.id}`)).status).toBe(404);
    expect((await call('PATCH', `/${a}/items/${item.id}`, { status: 'done' })).status).toBe(400);
    expect((await call('POST', `/${a}/items`, { section: 'other', title: 'x' })).status).toBe(400);
  });
});

describe('treasurer numbers', () => {
  it('counts money received since the last meeting of the same type, through this one', async () => {
    const a = await addMember(), b = await addMember(), c = await addMember();
    await addMembership(a, 2026, { amount_paid: 20, paid_date: '2026-10-06' }); // day of the last meeting: not counted
    await addMembership(b, 2027, { amount_paid: 20, paid_date: '2026-10-20' });
    await addMembership(c, 2027, { amount_paid: 25, paid_date: '2026-11-03' });
    await addMembership(a, 2027, { amount_paid: 20 });                          // no paid date: left out
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO donations (donor_type, member_id, donation_kind, amount, donation_date) VALUES ('member', ?, 'monetary', 50, '2026-10-15')`).bind(a),
      env.DB.prepare(`INSERT INTO donations (donor_type, member_id, donation_kind, estimated_value, item_description, donation_date) VALUES ('member', ?, 'item', 100, 'Radio', '2026-10-15')`).bind(a),
      env.DB.prepare(`INSERT INTO meetings (meeting_type, meeting_date) VALUES ('monthly', '2026-10-06')`),
      env.DB.prepare(`INSERT INTO meetings (meeting_type, meeting_date) VALUES ('board', '2026-10-25')`),
    ]);

    const { income } = await create({ meeting_date: '2026-11-03' });
    expect(income).toEqual({
      since: '2026-10-06', since_last_meeting: true, through: '2026-11-03',
      dues: { count: 2, total: 45 }, donations: { count: 1, total: 50 }, total: 95,
    });
  });

  it('starts at January 1 when there is no earlier meeting', async () => {
    const a = await addMember();
    await addMembership(a, 2026, { amount_paid: 20, paid_date: '2025-12-30' });
    await addMembership(a, 2027, { amount_paid: 20, paid_date: '2026-01-01' });
    const { income } = await create({ meeting_date: '2026-02-03' });
    expect(income).toMatchObject({ since: '2026-01-01', since_last_meeting: false, dues: { count: 1, total: 20 } });
  });
});

describe('quorum', () => {
  it('is 30% of voting members, rounded up', () => {
    expect([0, 1, 10, 11, 37, 40].map(quorumNeeded)).toEqual([0, 1, 3, 4, 12, 12]);
  });

  it('counts active licensed members who are not honorary, and who of them is present', async () => {
    const voting = [];
    for (let i = 0; i < 10; i++) voting.push(await addMember({ callsign: `W4Q${String.fromCharCode(65 + i)}` }));
    const lifetime = await addMember({ callsign: 'W4LIF', membership_type: 'lifetime_honorary' });
    const honorary = await addMember({ callsign: 'W4HON' });
    await addMembership(honorary, 2026, { status: 'honorary' });
    await addMember({ callsign: null });                        // not licensed
    await addMember({ callsign: 'W4OFF', is_active: 0 });      // lapsed
    await addMember({ callsign: 'W4SK', is_silent_key: 1 });   // silent key

    const data = await create({ meeting_date: '2026-11-03' });
    expect(data.quorum).toEqual({ percent: 30, voting_members: 10, needed: 3, present: 0, met: null, fixed: false });

    // Two voting members and the two honorary members: not enough
    const take = (callsigns) => meeting('PUT', `/${data.agenda.meeting_id}`, {
      meeting_type: 'monthly', meeting_date: '2026-11-03', callsigns, guests: ['Jane Guest'],
    });
    await take(['W4QA', 'W4QB', 'W4LIF', 'W4HON']);
    expect((await get(data.agenda.id)).quorum).toMatchObject({ present: 2, met: false });

    await take(['W4QA', 'W4QB', 'W4QC', 'W4LIF', 'W4HON']);
    expect((await get(data.agenda.id)).quorum).toMatchObject({ present: 3, met: true });
    expect(voting).toHaveLength(10);
    expect(lifetime).toBeTruthy();
  });

  it('keeps the member count from when the meeting adjourned', async () => {
    for (let i = 0; i < 10; i++) await addMember({ callsign: `K4Q${String.fromCharCode(65 + i)}` });
    const id = (await create()).agenda.id;
    await call('PATCH', `/${id}`, { adjourned_at: '20:30' });
    for (let i = 0; i < 5; i++) await addMember({ callsign: `N4Q${String.fromCharCode(65 + i)}` });

    expect((await get(id)).quorum).toMatchObject({ voting_members: 10, needed: 3, fixed: true });
    // A later edit to the adjourn time keeps the first count
    await call('PATCH', `/${id}`, { adjourned_at: '20:45' });
    expect((await get(id)).quorum.voting_members).toBe(10);

    const later = (await create({ meeting_date: '2026-12-01' })).quorum;
    expect(later).toMatchObject({ voting_members: 15, needed: 5, fixed: false });
  });

  it('prints the quorum', async () => {
    for (let i = 0; i < 4; i++) await addMember({ callsign: `W4P${String.fromCharCode(65 + i)}` });
    const html = agendaHtml(await create());
    expect(html).toContain('Quorum is <b>2</b> — 30% of 4 voting members');
  });
});

describe('deleting', () => {
  it('lets only an admin delete an agenda, and keeps the meeting', async () => {
    const data = await create();
    const id = data.agenda.id;
    await addItem(id, 'new', 'Thing');
    await call('POST', `/${id}/checks`, { step: 'quorum', checked: true });

    expect((await call('DELETE', `/${id}`)).status).toBe(403);
    expect((await call('DELETE', `/${id}`, null, admin)).status).toBe(200);
    expect((await call('GET', `/${id}`)).status).toBe(404);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM agenda_items').first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT id FROM meetings WHERE id = ?').bind(data.agenda.meeting_id).first()).not.toBeNull();
  });

  it('deletes the agenda along with its meeting', async () => {
    const data = await create();
    await addItem(data.agenda.id, 'new', 'Thing');
    await call('POST', `/${data.agenda.id}/motions`, { motion: 'Buy coax' });
    const shown = await (await meeting('GET', `/${data.agenda.meeting_id}`)).json();
    expect(shown.meeting.agenda_id).toBe(data.agenda.id);

    expect((await meeting('DELETE', `/${data.agenda.meeting_id}`, null, admin)).status).toBe(200);
    for (const t of ['agendas', 'agenda_items', 'agenda_motions']) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).toEqual({ n: 0 });
    }
  });
});

describe('printed agenda', () => {
  it('prints what is filled in, escapes it, and leaves the rest blank', async () => {
    const data = await create({ location: 'Library <Room 2>' });
    const id = data.agenda.id;
    await call('PATCH', `/${id}`, { called_to_order: '19:05', presentation_title: 'Antennas & You' });
    await call('POST', `/${id}/checks`, { step: 'pledge', checked: true });
    await addItem(id, 'new', 'Buy a <b>new</b> antenna');
    await call('POST', `/${id}/motions`, { motion: 'Buy coax', result: 'passed' });

    const html = agendaHtml(await get(id));
    expect(html).toContain('Library &lt;Room 2&gt;');
    expect(html).toContain('7:05 PM');
    expect(html).toContain('Antennas &amp; You');
    expect(html).toContain('Buy a &lt;b&gt;new&lt;/b&gt; antenna');
    expect(html).toContain('Buy coax');
    expect(html).toContain('Pledge of Allegiance');
    expect(html).toContain('box on');
    expect(html).toContain('8.&nbsp; Presentation');
    expect(html).not.toContain('Robert');
  });

  it('prints a board agenda without the general-meeting parts', async () => {
    const html = agendaHtml(await create({ meeting_type: 'board' }));
    expect(html).not.toContain('Pledge of Allegiance');
    expect(html).not.toContain('Presentation');
    expect(html).toContain('Board Meeting');
  });
});
