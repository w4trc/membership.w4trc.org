import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { handleRepeaters } from '../src/routes/repeaters.js';
import { clubToday } from '../src/lib/clubDate.js';
import { resetDb, auditActions } from './helpers.js';

const board  = { id: null, role: 'board' };
const admin  = { id: null, role: 'admin' };
const member = { id: null, role: 'member' };

function call(method, path = '', body, user = board, { headers = {}, raw } = {}) {
  const init = { method, headers };
  if (raw !== undefined) init.body = raw;
  else if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json', ...headers }; }
  return handleRepeaters(new Request(`https://members.w4trc.org/api/repeaters${path}`, init), env, `/api/repeaters${path.split('?')[0]}`, user);
}

async function create(fields = {}) {
  const res = await call('POST', '', { name: '2m Bays Mountain', output_freq: '146.970', input_freq: '146.370', tone_in: '114.8', screen_pin: '1234', ...fields });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).repeater;
}

const get = async (id) => (await call('GET', `/${id}`)).json();

// Smallest valid JPEG header bytes, as a data URL
const JPEG = 'data:image/jpeg;base64,' + btoa(String.fromCharCode(0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10));

beforeEach(async () => {
  await resetDb();
  const listed = await env.BACKUP_BUCKET.list({ prefix: 'repeaters/' });
  if (listed.objects.length) await env.BACKUP_BUCKET.delete(listed.objects.map(o => o.key));
});

describe('repeaters', () => {
  it('is for officers only', async () => {
    expect((await call('GET', '', null, member)).status).toBe(403);
  });

  it('adds a repeater with its listing and keeps frequencies as typed', async () => {
    const r = await create({ callsign: 'w4trc', output_freq: '146.970 MHz' });
    expect(r).toMatchObject({ name: '2m Bays Mountain', callsign: 'W4TRC', output_freq: '146.970', input_freq: '146.370', tone_in: '114.8', screen_pin: '1234', status: 'active' });
    expect((await auditActions()).map(a => a.action)).toEqual(['repeater.create']);
  });

  it('rejects a missing name and a bad frequency', async () => {
    expect((await call('POST', '', { output_freq: '146.97' })).status).toBe(400);
    expect((await call('POST', '', { name: 'x', output_freq: 'two meters' })).status).toBe(400);
    expect((await call('POST', '', { name: 'x', status: 'gone' })).status).toBe(400);
  });

  it('changes only the fields sent', async () => {
    const r = await create();
    const res = await call('PATCH', `/${r.id}`, { screen_pin: '9999' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.repeater).toMatchObject({ screen_pin: '9999', output_freq: '146.970', tone_in: '114.8' });
    const updates = (await auditActions()).filter(a => a.action === 'repeater.update');
    expect(updates[0].detail.changed).toEqual(['screen_pin']);
    // The PIN itself is not written to the audit log
    expect(JSON.stringify(updates)).not.toContain('9999');
  });

  it('lists repeaters in order with open reports and the last visit', async () => {
    const a = await create({ name: 'A' });
    const b = await create({ name: 'B' });
    await call('POST', `/${a.id}/reports`, { category: 'noise', description: 'Hum' });
    await call('POST', `/${a.id}/visits`, { visit_date: '2026-10-01', visitors: 'KT4AAA', purpose: 'Check duplexer' });
    await call('POST', `/${a.id}/visits`, { visit_date: '2026-11-01', visitors: 'KT4AAA', purpose: 'Swap fan' });
    const { repeaters } = await (await call('GET')).json();
    expect(repeaters.map(r => r.name)).toEqual(['A', 'B']);
    expect(repeaters[0]).toMatchObject({ open_reports: 1, last_visit: '2026-11-01' });
    expect(repeaters[1]).toMatchObject({ id: b.id, open_reports: 0, last_visit: null });
  });

  it('deletes a repeater and everything on it, for admins only', async () => {
    const r = await create();
    await call('POST', `/${r.id}/notes`, { note: 'Key is in the lockbox' });
    await call('POST', `/${r.id}/documents?filename=manual.pdf`, null, board, { headers: { 'Content-Type': 'application/pdf' }, raw: '%PDF-1.4' });
    expect((await call('DELETE', `/${r.id}`)).status).toBe(403);
    expect((await call('DELETE', `/${r.id}`, null, admin)).status).toBe(200);
    expect((await call('GET', `/${r.id}`)).status).toBe(404);
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM repeater_notes`).first();
    expect(left.n).toBe(0);
    expect((await env.BACKUP_BUCKET.list({ prefix: 'repeaters/' })).objects).toHaveLength(0);
  });
});

describe('visits, reports, notes', () => {
  it('logs a visit, dated today if no date is given', async () => {
    const r = await create();
    const res = await call('POST', `/${r.id}/visits`, { visitors: 'KT4AAA, KT4BBB', purpose: 'Replace battery', time_in: '09:30' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ visit_date: clubToday(), time_in: '09:30', visitors: 'KT4AAA, KT4BBB' });
    expect((await call('POST', `/${r.id}/visits`, { visitors: 'x' })).status).toBe(400);
    expect((await call('POST', `/${r.id}/visits`, { visitors: 'x', purpose: 'y', time_in: '25:00' })).status).toBe(400);
  });

  it('resolves a report with today\'s date and clears it when reopened', async () => {
    const r = await create();
    const rep = await (await call('POST', `/${r.id}/reports`, { category: 'unlicensed', description: 'No ID given', reported_by: 'KT4AAA' })).json();
    expect(rep).toMatchObject({ status: 'open', resolved_date: null });
    const resolved = await (await call('PATCH', `/${r.id}/reports/${rep.id}`, { status: 'resolved', resolution: 'Passed to the OO' })).json();
    expect(resolved).toMatchObject({ status: 'resolved', resolved_date: clubToday(), resolution: 'Passed to the OO' });
    const reopened = await (await call('PATCH', `/${r.id}/reports/${rep.id}`, { status: 'open' })).json();
    expect(reopened.resolved_date).toBeNull();
    expect((await call('POST', `/${r.id}/reports`, { category: 'aliens', description: 'x' })).status).toBe(400);
  });

  it('lists open reports before resolved ones and pinned notes first', async () => {
    const r = await create();
    const first = await (await call('POST', `/${r.id}/reports`, { category: 'noise', description: 'Old', report_date: '2026-01-01' })).json();
    await call('PATCH', `/${r.id}/reports/${first.id}`, { status: 'resolved' });
    await call('POST', `/${r.id}/reports`, { category: 'outage', description: 'Older but open', report_date: '2025-12-01' });
    await call('POST', `/${r.id}/notes`, { note: 'Plain' });
    await call('POST', `/${r.id}/notes`, { note: 'Gate code', pinned: true });
    const data = await get(r.id);
    expect(data.reports.map(x => x.description)).toEqual(['Older but open', 'Old']);
    expect(data.notes.map(x => x.note)).toEqual(['Gate code', 'Plain']);
  });

  it('only touches entries on the repeater in the path', async () => {
    const a = await create({ name: 'A' });
    const b = await create({ name: 'B' });
    const note = await (await call('POST', `/${a.id}/notes`, { note: 'Mine' })).json();
    expect((await call('PATCH', `/${b.id}/notes/${note.id}`, { note: 'Yours' })).status).toBe(404);
    expect((await call('DELETE', `/${b.id}/notes/${note.id}`)).status).toBe(404);
    expect((await call('DELETE', `/${a.id}/notes/${note.id}`)).status).toBe(200);
  });
});

describe('maintenance and renewals', () => {
  it('needs a done date or a due date', async () => {
    const r = await create();
    expect((await call('POST', `/${r.id}/maintenance`, { kind: 'listing', title: 'RepeaterBook' })).status).toBe(400);
  });

  it('shows what is due from the latest entry of each kind and title', async () => {
    const r = await create();
    const today = clubToday();
    const soon = new Date(Date.parse(today) + 10 * 86400000).toISOString().slice(0, 10);
    // Renewed last year, due soon
    await call('POST', `/${r.id}/maintenance`, { kind: 'coordination', title: 'SERA coordination', done_date: '2024-01-15', next_due: soon });
    // An older listing renewal, then the renewal done again: only the newer due date counts
    await call('POST', `/${r.id}/maintenance`, { kind: 'listing', title: 'RepeaterBook', done_date: '2025-01-01', next_due: '2026-01-01' });
    await call('POST', `/${r.id}/maintenance`, { kind: 'listing', title: 'repeaterbook', done_date: '2026-01-02', next_due: '2099-01-01' });
    // Work with no due date is history only
    await call('POST', `/${r.id}/maintenance`, { kind: 'repair', title: 'Fan', done_date: '2026-05-01' });

    const data = await get(r.id);
    expect(data.maintenance).toHaveLength(4);
    expect(data.due.map(d => [d.title, d.next_due])).toEqual([['SERA coordination', soon], ['repeaterbook', '2099-01-01']]);

    const list = await (await call('GET')).json();
    // The list only shows what is due in the next 60 days (or overdue)
    expect(list.due.map(d => d.title)).toEqual(['SERA coordination']);
    expect(list.due[0].repeater_name).toBe('2m Bays Mountain');
  });
});

describe('photos', () => {
  it('stores a photo and its thumbnail and serves them back', async () => {
    const r = await create();
    const res = await call('POST', `/${r.id}/photos`, { image: JPEG, thumb: JPEG, caption: 'Rack', taken_date: '2026-11-01' });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const img = await call('GET', `/${r.id}/photos/${id}?size=thumb`);
    expect(img.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await img.arrayBuffer())[0]).toBe(0xFF);
    const data = await get(r.id);
    expect(data.photos).toEqual([expect.objectContaining({ id, caption: 'Rack' })]);
    expect(data.photos[0].image).toBeUndefined();
    expect((await call('DELETE', `/${r.id}/photos/${id}`)).status).toBe(200);
    expect((await get(r.id)).photos).toEqual([]);
  });

  it('rejects anything that is not a JPEG', async () => {
    const r = await create();
    const png = 'data:image/png;base64,' + btoa('\x89PNG');
    expect((await call('POST', `/${r.id}/photos`, { image: png, thumb: png })).status).toBe(400);
  });
});

describe('documents', () => {
  it('adds a link to a manual', async () => {
    const r = await create();
    const res = await call('POST', `/${r.id}/documents`, { title: 'MTR3000 manual', url: 'https://example.com/mtr3000.pdf' });
    expect(res.status).toBe(201);
    const doc = await res.json();
    expect(doc).toMatchObject({ kind: 'manual', url: 'https://example.com/mtr3000.pdf', filename: null });
    const open = await call('GET', `/${r.id}/documents/${doc.id}`);
    expect(open.status).toBe(302);
    expect((await call('POST', `/${r.id}/documents`, { title: 'x', url: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('uploads a file to R2 and serves it back', async () => {
    const r = await create();
    const res = await call('POST', `/${r.id}/documents?title=Controller%20manual&kind=manual&filename=../ctrl.pdf`, null, board,
      { headers: { 'Content-Type': 'application/pdf' }, raw: '%PDF-1.4 test' });
    expect(res.status, await res.clone().text()).toBe(201);
    const doc = await res.json();
    expect(doc).toMatchObject({ title: 'Controller manual', filename: 'ctrl.pdf', content_type: 'application/pdf', size: 13 });

    const file = await call('GET', `/${r.id}/documents/${doc.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('Content-Type')).toBe('application/pdf');
    expect(file.headers.get('Content-Disposition')).toMatch(/^inline/);
    expect(await file.text()).toBe('%PDF-1.4 test');

    expect((await call('DELETE', `/${r.id}/documents/${doc.id}`)).status).toBe(200);
    expect((await env.BACKUP_BUCKET.list({ prefix: 'repeaters/' })).objects).toHaveLength(0);
  });

  it('sends files that could run script as downloads', async () => {
    const r = await create();
    const doc = await (await call('POST', `/${r.id}/documents?filename=evil.html`, null, board,
      { headers: { 'Content-Type': 'text/html' }, raw: '<script>alert(1)</script>' })).json();
    const file = await call('GET', `/${r.id}/documents/${doc.id}`);
    expect(file.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(file.headers.get('Content-Disposition')).toMatch(/^attachment/);
  });

  it('refuses an empty upload', async () => {
    const r = await create();
    expect((await call('POST', `/${r.id}/documents?filename=x.pdf`, null, board, { headers: { 'Content-Type': 'application/pdf' }, raw: '' })).status).toBe(400);
  });
});

describe('the whole site', () => {
  it('keeps site notes and photos apart from any one repeater, and shows them with every repeater', async () => {
    const a = await create({ name: 'A' });
    const b = await create({ name: 'B' });
    const note = await (await call('POST', '/site/notes', { note: 'Shelter key is in the lockbox', pinned: true })).json();
    expect(note).toMatchObject({ repeater_id: null, pinned: 1 });
    await call('POST', `/${a.id}/notes`, { note: 'Only about A' });
    const photo = await (await call('POST', '/site/photos', { image: JPEG, thumb: JPEG, caption: 'Tower' })).json();

    const site = await (await call('GET', '/site')).json();
    expect(site.notes.map(n => n.note)).toEqual(['Shelter key is in the lockbox']);
    expect(site.photos.map(p => p.caption)).toEqual(['Tower']);

    const dataA = await get(a.id);
    expect(dataA.notes.map(n => [n.note, n.repeater_id])).toEqual([['Shelter key is in the lockbox', null], ['Only about A', a.id]]);
    expect((await get(b.id)).notes.map(n => n.note)).toEqual(['Shelter key is in the lockbox']);
    expect((await get(b.id)).photos.map(p => p.id)).toEqual([photo.id]);

    const list = await (await call('GET')).json();
    expect(list.site).toEqual({ notes: 1, photos: 1 });

    // A site photo is served from the site, not through a repeater
    expect((await call('GET', `/site/photos/${photo.id}`)).status).toBe(200);
    expect((await call('GET', `/${a.id}/photos/${photo.id}`)).status).toBe(404);
    // and site notes are changed through the site
    expect((await call('PATCH', `/${a.id}/notes/${note.id}`, { note: 'x' })).status).toBe(404);
    expect((await (await call('PATCH', `/site/notes/${note.id}`, { pinned: false })).json()).pinned).toBe(0);
  });

  it('keeps site notes and photos when a repeater is deleted', async () => {
    const a = await create();
    await call('POST', '/site/notes', { note: 'Site note' });
    await call('DELETE', `/${a.id}`, null, admin);
    expect((await (await call('GET', '/site')).json()).notes).toHaveLength(1);
  });

  it('moves notes and photos between a repeater and the site', async () => {
    const a = await create({ name: 'A' });
    const b = await create({ name: 'B' });
    const note = await (await call('POST', `/${a.id}/notes`, { note: 'Breaker 12 feeds the rack' })).json();
    const moved = await (await call('PATCH', `/${a.id}/notes/${note.id}`, { site_wide: true })).json();
    expect(moved.repeater_id).toBeNull();
    expect((await get(b.id)).notes.map(n => n.note)).toEqual(['Breaker 12 feeds the rack']);
    // Back to one repeater, through that repeater
    expect((await call('PATCH', `/site/notes/${note.id}`, { site_wide: false })).status).toBe(400);
    expect((await (await call('PATCH', `/${b.id}/notes/${note.id}`, { site_wide: false })).json()).repeater_id).toBe(b.id);
    // Another repeater's own note is still out of reach
    expect((await call('PATCH', `/${a.id}/notes/${note.id}`, { site_wide: true })).status).toBe(404);

    const photo = await (await call('POST', `/${a.id}/photos`, { image: JPEG, thumb: JPEG })).json();
    expect((await (await call('PATCH', `/${a.id}/photos/${photo.id}`, { site_wide: true })).json()).repeater_id).toBeNull();
    expect((await call('GET', `/site/photos/${photo.id}`)).status).toBe(200);
    // Visits and other lists stay with their repeater
    const visit = await (await call('POST', `/${a.id}/visits`, { visitors: 'x', purpose: 'y' })).json();
    await call('PATCH', `/${a.id}/visits/${visit.id}`, { site_wide: true, notes: 'z' });
    expect((await get(a.id)).visits[0].repeater_id).toBe(a.id);
  });

  it('only has notes and photos', async () => {
    expect((await call('POST', '/site/visits', { visitors: 'x', purpose: 'y' })).status).toBe(404);
    expect((await call('PATCH', '/site', { name: 'x' })).status).toBe(405);
  });
});
