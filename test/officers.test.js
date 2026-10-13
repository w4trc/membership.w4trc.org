import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { officersByYear, parseOfficerLines, splitNameAndCallsign } from '../src/lib/officers.js';
import { handleOfficers } from '../src/routes/officers.js';
import { handleDirectoryPage } from '../src/routes/portal.js';
import { resetDb, addMember, auditActions } from './helpers.js';

const NOW = new Date('2026-10-12T15:00:00Z');
const board = { id: null, role: 'board' };

const call = (method, path = '', body, user = board) => handleOfficers(
  new Request(`https://members.w4trc.org/api/officers${path}`, {
    method, ...(body ? { body: JSON.stringify(body) } : {}),
  }),
  env, `/api/officers${path}`, user
);

const add = (fields) => call('POST', '', { year: 2026, position: 'president', ...fields });
const paste = (text, position = 'president') => call('POST', '/bulk', { position, text });

async function listed() {
  const { officers } = await (await call('GET')).json();
  return officers.map(o => `${o.year} ${o.position}: ${o.name}${o.callsign ? ` ${o.callsign}` : ''}`);
}

beforeEach(resetDb);

describe('reading a pasted list', () => {
  const parse = (text) => parseOfficerLines(text, NOW);

  it('reads a year, a name and an optional callsign', () => {
    expect(parse('1985 John Smith W4ABC\n1986 Mary Jones\n\n  1987   Bob Brown,  k4xyz  ').entries).toEqual([
      { year: 1985, name: 'John Smith', callsign: 'W4ABC' },
      { year: 1986, name: 'Mary Jones', callsign: null },
      { year: 1987, name: 'Bob Brown', callsign: 'K4XYZ' },
    ]);
  });

  it('copes with the punctuation people put in lists', () => {
    const { entries, errors } = parse([
      '1985: John Smith (W4ABC)',
      '1986 - Mary Jones - K4XYZ',
      '1987\tBob Brown\tN4AA',
      '1988, W4DEF, Sue Green',
      '1989 Mary-Jane O\'Brien Jr., KI4ABC',
    ].join('\n'));

    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { year: 1985, name: 'John Smith', callsign: 'W4ABC' },
      { year: 1986, name: 'Mary Jones', callsign: 'K4XYZ' },
      { year: 1987, name: 'Bob Brown', callsign: 'N4AA' },
      { year: 1988, name: 'Sue Green', callsign: 'W4DEF' },
      { year: 1989, name: 'Mary-Jane O\'Brien Jr.', callsign: 'KI4ABC' },
    ]);
  });

  it('turns a range of years into one entry per year', () => {
    expect(parse('1986-1988 Mary Jones K4XYZ').entries.map(e => e.year)).toEqual([1986, 1987, 1988]);
    expect(parse('1998-01 Al Long').entries.map(e => e.year)).toEqual([]);
    expect(parse('1998–00 Al Long').entries).toEqual([]);
    expect(parse('1985-87 Al Long').entries.map(e => e.year)).toEqual([1985, 1986, 1987]);
    expect(parse('1985 to 1986 Al Long').entries.map(e => e.year)).toEqual([1985, 1986]);
    expect(parse('2026-2027 Al Long').entries.map(e => e.year)).toEqual([2026, 2027]);
  });

  it('keeps a callsign on its own, for a member whose name is on file', () => {
    expect(parse('2025 W4ABC').entries).toEqual([{ year: 2025, name: '', callsign: 'W4ABC' }]);
  });

  it('says which lines it could not read', () => {
    const { entries, errors } = parse('John Smith 1985\n1985\n1850 Old Timer\n2031 Too Soon\n1990-1985 Back Wards\n1991 Fine Line');

    expect(entries).toEqual([{ year: 1991, name: 'Fine Line', callsign: null }]);
    expect(errors).toEqual([
      { line: 1, text: 'John Smith 1985', error: 'Start the line with a four-digit year' },
      { line: 2, text: '1985', error: 'No name after the year' },
      { line: 3, text: '1850 Old Timer', error: 'The year must be between 1900 and 2027' },
      { line: 4, text: '2031 Too Soon', error: 'The year must be between 1900 and 2027' },
      { line: 5, text: '1990-1985 Back Wards', error: 'The years are the wrong way round' },
    ]);
  });

  it('does not mistake part of a name for a callsign', () => {
    expect(splitNameAndCallsign('John Smith III')).toEqual({ name: 'John Smith III', callsign: null });
    expect(splitNameAndCallsign('Al B4 Jones')).toEqual({ name: 'Al B4 Jones', callsign: null });
  });
});

describe('officersByYear', () => {
  it('puts each year on one line, newest first, leaving unknown positions empty', () => {
    const rows = [
      { year: 1985, position: 'president', name: 'John Smith' },
      { year: 2026, position: 'president', name: 'Ann Able' },
      { year: 2026, position: 'trustee', name: 'Tom Tower' },
      { year: 2026, position: 'president', name: 'Mid Year' },
    ];

    const years = officersByYear(rows);

    expect(years.map(y => y.year)).toEqual([2026, 1985]);
    expect(years[0].president.map(o => o.name)).toEqual(['Ann Able', 'Mid Year']);
    expect(years[0].trustee.map(o => o.name)).toEqual(['Tom Tower']);
    expect(years[1]).toMatchObject({ vice_president: [], treasurer: [], secretary: [], trustee: [] });
  });
});

describe('/api/officers', () => {
  it('adds an officer by name, with no member record needed', async () => {
    const res = await add({ year: 1962, name: '  Old   Timer ', callsign: 'w4old', notes: 'Founder' });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      year: 1962, position: 'president', name: 'Old Timer', callsign: 'W4OLD', member_id: null, notes: 'Founder',
    });
  });

  it('fills in the name and links the member when the callsign is on the membership list', async () => {
    const id = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able' });

    const byCallsign = await (await add({ callsign: 'kt4aaa' })).json();
    const withName = await (await add({ position: 'trustee', callsign: 'KT4AAA', name: 'Annie Able' })).json();

    expect(byCallsign).toMatchObject({ name: 'Ann Able', callsign: 'KT4AAA', member_id: id });
    expect(withName).toMatchObject({ name: 'Annie Able', member_id: id });
  });

  it('needs a name when the callsign is not a member', async () => {
    const res = await add({ callsign: 'W4ZZZ' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('W4ZZZ is not on the membership list, so a name is needed');
    expect((await add({})).status).toBe(400);
  });

  it('rejects a bad year or position', async () => {
    expect((await add({ name: 'A B', year: 1850 })).status).toBe(400);
    expect((await add({ name: 'A B', year: 'soon' })).status).toBe(400);
    expect((await add({ name: 'A B', position: 'emperor' })).status).toBe(400);
    expect(await listed()).toEqual([]);
  });

  it('allows two people in one position in a year, but not the same person twice', async () => {
    await add({ name: 'Ann Able' });

    expect((await add({ name: 'Mid Year' })).status).toBe(201);
    expect((await add({ name: 'ann able' })).status).toBe(409);
    expect(await listed()).toEqual(['2026 president: Ann Able', '2026 president: Mid Year']);
  });

  it('updates and removes an officer', async () => {
    const { id } = await (await add({ name: 'Ann Abel', callsign: 'KT4AAA' })).json();

    const updated = await call('PUT', `/${id}`, { name: 'Ann Able', position: 'secretary' });
    expect(await updated.json()).toMatchObject({ year: 2026, position: 'secretary', name: 'Ann Able', callsign: 'KT4AAA' });

    expect((await call('DELETE', `/${id}`)).status).toBe(200);
    expect(await listed()).toEqual([]);
    expect((await call('PUT', `/${id}`, { name: 'X' })).status).toBe(404);
    expect((await call('DELETE', `/${id}`)).status).toBe(404);
  });

  it('records changes in the audit log', async () => {
    const { id } = await (await add({ name: 'Ann Able' })).json();
    await call('DELETE', `/${id}`);

    expect((await auditActions()).map(a => a.action)).toEqual(['officer.create', 'officer.delete']);
  });

  it('is for the board and admins only', async () => {
    expect((await call('GET', '', null, { id: 1, role: 'member' })).status).toBe(403);
    expect((await call('POST', '', { year: 2026, position: 'president', name: 'A B' }, { id: 1, role: 'member' })).status).toBe(403);
    expect((await call('GET', '', null, { id: null, role: 'admin' })).status).toBe(200);
  });
});

describe('/api/officers/bulk', () => {
  it('adds a pasted list of presidents', async () => {
    const member = await addMember({ callsign: 'KT4AAA', first_name: 'Ann', last_name: 'Able' });

    const res = await paste('1985 John Smith W4ABC\n1986-1987 Mary Jones\n2025 KT4AAA');

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: 4, already_listed: 0 });
    expect(await listed()).toEqual([
      '2025 president: Ann Able KT4AAA',
      '1987 president: Mary Jones',
      '1986 president: Mary Jones',
      '1985 president: John Smith W4ABC',
    ]);
    const linked = await env.DB.prepare(`SELECT member_id FROM officers WHERE year = 2025`).first();
    expect(linked.member_id).toBe(member);
  });

  it('skips anyone already listed, so a list can be pasted twice', async () => {
    await paste('1985 John Smith\n1986 Mary Jones');

    const res = await paste('1985 John Smith\n1986 Mary Jones\n1987 Bob Brown');

    expect(await res.json()).toEqual({ added: 1, already_listed: 2 });
    expect(await listed()).toHaveLength(3);
  });

  it('adds nothing if any line cannot be read', async () => {
    const res = await paste('1985 John Smith\nMary Jones\n2025 W4ZZZ');

    expect(res.status).toBe(400);
    expect((await res.json()).details).toEqual([
      { line: 2, text: 'Mary Jones', error: 'Start the line with a four-digit year' },
      { line: null, text: '2025', error: 'W4ZZZ is not on the membership list, so a name is needed' },
    ]);
    expect(await listed()).toEqual([]);
  });

  it('files the list under the position chosen', async () => {
    await paste('2024 Tom Tower', 'trustee');

    expect(await listed()).toEqual(['2024 trustee: Tom Tower']);
    expect((await paste('2024 Tom Tower', 'emperor')).status).toBe(400);
    expect((await paste('   ')).status).toBe(400);
  });
});

describe('public directory', () => {
  const page = async () => (await handleDirectoryPage(new Request('https://members.w4trc.org/directory'), env)).text();

  it('shows the officer history, newest year first', async () => {
    await paste('1985 John <Smith> W4ABC\n2026 Ann Able');
    await add({ position: 'trustee', name: 'Tom Tower', callsign: 'W4TT', notes: 'Private note' });

    const html = await page();

    expect(html).toContain('Club Officers');
    expect(html).toContain('John &lt;Smith&gt; <span class="call">W4ABC</span>');
    expect(html.indexOf('Ann Able')).toBeLessThan(html.indexOf('John &lt;Smith&gt;'));
    expect(html).toContain('<th>Vice President</th>');
    expect(html).not.toContain('Private note');
  });

  it('leaves the section out when there are no officers on record', async () => {
    expect(await page()).not.toContain('Club Officers');
  });
});
