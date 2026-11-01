import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { checkFccLicensees, importFccDay, readZip, findAreaLicensees } from '../src/lib/fccLicensees.js';
import { handleProspects } from '../src/routes/prospects.js';
import { resetDb, addMember } from './helpers.js';

// ── A small FCC daily file, built the way the FCC lays it out ───────────────

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw  = enc.encode(text);
    const data = await deflateRaw(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameBytes.length, true);
    locals.push(new Uint8Array(lh.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameBytes.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
  return new Blob([...locals, ...central, new Uint8Array(eocd.buffer)]).arrayBuffer();
}

// EN: 30 fields. Only the ones we read are filled in.
function en({ usi, call, first, last, email = '', street = '', city, state = 'TN', zip, type = 'I' }) {
  const f = Array(30).fill('');
  Object.assign(f, { 0: 'EN', 1: usi, 4: call, 5: 'L', 8: first, 10: last, 14: email, 15: street, 16: city, 17: state, 18: zip, 23: type });
  return f.join('|');
}
function hd({ usi, call, status = 'A', service = 'HA', grant = '10/28/2026', expires = '10/28/2036' }) {
  const f = Array(60).fill('');
  Object.assign(f, { 0: 'HD', 1: usi, 4: call, 5: status, 6: service, 7: grant, 8: expires });
  return f.join('|');
}
function am({ usi, call, cls = 'T', previous = '' }) {
  const f = Array(18).fill('');
  Object.assign(f, { 0: 'AM', 1: usi, 4: call, 5: cls, 15: previous });
  return f.join('|');
}
const hs = (usi, call, code) => ['HS', usi, '', call, '10/28/2026', code].join('|');

const dat = lines => lines.join('\r\n') + '\r\n';

async function sampleZip() {
  return makeZip({
    'EN.dat': dat([
      en({ usi: 1, call: 'KR4NEW', first: 'JANE', last: 'DOE', email: 'Jane@Example.com', street: '1 Main St', city: 'KINGSPORT', zip: '376601234' }),
      en({ usi: 2, call: 'KR4CHL', first: 'BOB', last: 'SMITH', city: 'CHURCH HILL', zip: '37642' }),
      en({ usi: 3, call: 'KR4MTC', first: 'AL', last: 'JONES', city: 'MT. CARMEL', zip: '37645' }),
      en({ usi: 4, call: 'KR4FAR', first: 'SUE', last: 'FAR', city: 'KNOXVILLE', zip: '37902' }),
      en({ usi: 5, call: 'W4CLB', first: '', last: '', city: 'KINGSPORT', zip: '37660', type: 'B' }),
      en({ usi: 6, call: 'KR4CAN', first: 'CAN', last: 'CELLED', city: 'KINGSPORT', zip: '37660' }),
      en({ usi: 7, call: 'KR4MEM', first: 'MEM', last: 'BER', city: 'KINGSPORT', zip: '37664' }),
      en({ usi: 8, call: 'W4VAN', first: 'VAN', last: 'ITY', city: 'KINGSPORT', zip: '37663' }),
      en({ usi: 9, call: 'KR4VA', first: 'OTHER', last: 'STATE', city: 'KINGSPORT', state: 'VA', zip: '24201' }),
    ]),
    'HD.dat': dat([
      hd({ usi: 1, call: 'KR4NEW' }), hd({ usi: 2, call: 'KR4CHL' }), hd({ usi: 3, call: 'KR4MTC' }),
      hd({ usi: 4, call: 'KR4FAR' }), hd({ usi: 5, call: 'W4CLB' }),
      hd({ usi: 6, call: 'KR4CAN', status: 'C' }), hd({ usi: 7, call: 'KR4MEM' }),
      hd({ usi: 8, call: 'W4VAN', service: 'HV' }),
    ]),
    'AM.dat': dat([
      am({ usi: 1, call: 'KR4NEW' }), am({ usi: 2, call: 'KR4CHL', cls: 'G' }),
      am({ usi: 3, call: 'KR4MTC', cls: 'E' }), am({ usi: 8, call: 'W4VAN', cls: 'E', previous: 'KQ4OLD' }),
    ]),
    'HS.dat': dat([hs(1, 'KR4NEW', 'LIISS'), hs(2, 'KR4CHL', 'LIREN')]),
  });
}

const prospect = call => env.DB.prepare(`SELECT * FROM prospects WHERE callsign = ?`).bind(call).first();

let requests;
function mockFcc({ status = 200, lastModified = 'Wed, 28 Oct 2026 10:00:00 GMT' } = {}) {
  requests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    requests.push({ url, headers: init.headers || {} });
    if (status === 304 || (init.headers?.['If-Modified-Since'] === lastModified)) {
      return new Response(null, { status: 304 });
    }
    if (status !== 200) return new Response('nope', { status });
    return new Response(await sampleZip(), { status: 200, headers: { 'Last-Modified': lastModified } });
  });
}

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM prospects'),
    env.DB.prepare('DELETE FROM fcc_daily_imports'),
  ]);
});
afterEach(() => vi.restoreAllMocks());

describe('reading the FCC daily file', () => {
  it('finds individual, active licensees in the area cities', async () => {
    const found = await findAreaLicensees(readZip(await sampleZip()));
    expect(found.map(l => l.callsign).sort()).toEqual(['KR4CHL', 'KR4MEM', 'KR4MTC', 'KR4NEW', 'W4VAN']);

    const jane = found.find(l => l.callsign === 'KR4NEW');
    expect(jane).toMatchObject({
      first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', address: '1 Main St',
      city: 'Kingsport', state: 'TN', zip: '37660-1234', license_class: 'Technician',
      license_granted: '2026-10-28', license_expiry: '2036-10-28', new_license: true,
    });
    expect(found.find(l => l.callsign === 'KR4MTC').city).toBe('Mount Carmel');
    expect(found.find(l => l.callsign === 'KR4CHL').new_license).toBe(false);
  });
});

describe('importing new licensees', () => {
  it('adds new area hams to the prospects list, members included', async () => {
    await addMember({ callsign: 'KR4MEM' });
    mockFcc();

    const r = await importFccDay(env, 'wed');

    expect(requests[0].url).toBe('https://data.fcc.gov/download/pub/uls/daily/l_am_wed.zip');
    expect(r.added.sort()).toEqual(['KR4CHL', 'KR4MEM', 'KR4MTC', 'KR4NEW', 'W4VAN']);
    expect(await prospect('KR4MEM')).toMatchObject({ source: 'fcc', city: 'Kingsport' });

    expect(await prospect('KR4NEW')).toMatchObject({
      source: 'fcc', added_reason: 'new_license', outreach_status: 'not_contacted', city: 'Kingsport',
    });
    expect((await prospect('KR4CHL')).added_reason).toBe('new_to_list');
    expect((await prospect('W4VAN')).added_reason).toBe('new_callsign');
    expect((await prospect('KR4NEW')).auto_added_at).toBeTruthy();
  });

  it('refreshes a ham already on the list without touching their outreach', async () => {
    await env.DB.prepare(
      `INSERT INTO prospects (callsign, first_name, city, state, outreach_status, notes) VALUES ('KR4CHL', 'Bobby', 'Church Hill', 'TN', 'contacted', 'met at hamfest')`
    ).run();
    mockFcc();

    const r = await importFccDay(env, 'wed');

    expect(r.updated).toContain('KR4CHL');
    expect(r.added).not.toContain('KR4CHL');
    expect(await prospect('KR4CHL')).toMatchObject({
      outreach_status: 'contacted', notes: 'met at hamfest', license_class: 'General', auto_added_at: null,
    });
  });

  it('moves a prospect to their new callsign', async () => {
    await env.DB.prepare(
      `INSERT INTO prospects (callsign, city, state, outreach_status) VALUES ('KQ4OLD', 'Kingsport', 'TN', 'interested')`
    ).run();
    mockFcc();

    await importFccDay(env, 'wed');

    expect(await prospect('KQ4OLD')).toBeNull();
    expect(await prospect('W4VAN')).toMatchObject({ outreach_status: 'interested', added_reason: 'new_callsign' });
  });

  it('skips a file it has already read', async () => {
    mockFcc();
    await importFccDay(env, 'wed');
    const again = await importFccDay(env, 'wed');

    expect(again).toEqual({ file: 'l_am_wed.zip', skipped: 'unchanged' });
    expect(requests[1].headers['If-Modified-Since']).toBe('Wed, 28 Oct 2026 10:00:00 GMT');
  });

  it('reports an FCC error without failing', async () => {
    mockFcc({ status: 503 });
    expect(await importFccDay(env, 'wed')).toEqual({ file: 'l_am_wed.zip', error: 'FCC returned 503' });
  });

  it('the daily check reads the last two days, Eastern time', async () => {
    mockFcc();
    // Sunday Nov 1 2026, 9:15 AM Eastern
    await checkFccLicensees(env, new Date('2026-11-01T14:15:00Z'));
    expect(requests.map(r => r.url.split('/').pop())).toEqual(['l_am_sat.zip', 'l_am_fri.zip']);
  });
});

describe('Local Hams page', () => {
  const board = { id: null, role: 'board' };
  const call = (method, path, user = board) => handleProspects(
    new Request(`https://members.w4trc.org${path}`, { method }), env, new URL(`https://x${path}`).pathname, user,
  );

  it('lists the newly added hams and counts them', async () => {
    await env.DB.prepare(`INSERT INTO prospects (callsign, city, state) VALUES ('W4OLD', 'Kingsport', 'TN')`).run();
    mockFcc();
    await importFccDay(env, 'wed');

    const list = await (await call('GET', '/api/prospects?added=30')).json();
    expect(list.total).toBe(5);
    expect(list.prospects.map(p => p.callsign)).not.toContain('W4OLD');
    expect(list.prospects[0]).toHaveProperty('added_reason');

    const { stats } = await (await call('GET', '/api/prospects/stats')).json();
    expect(stats.new_30).toBe(5);

    const status = await (await call('GET', '/api/prospects/fcc')).json();
    expect(status.imports[0]).toMatchObject({ file: 'l_am_wed.zip', added: 5 });
  });

  it('only lets admins run the FCC check', async () => {
    mockFcc();
    expect((await call('POST', '/api/prospects/fcc?day=wed')).status).toBe(403);
    expect((await call('POST', '/api/prospects/fcc?day=xyz', { id: null, role: 'admin' })).status).toBe(400);
    const r = await (await call('POST', '/api/prospects/fcc?day=wed', { id: null, role: 'admin' })).json();
    expect(r.added).toHaveLength(5);
  });
});
