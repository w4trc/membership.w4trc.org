/**
 * New local licensees from the FCC.
 *
 * The FCC publishes a daily file of amateur license changes for each day of
 * the week (l_am_mon.zip ... l_am_sun.zip), replaced weekly. We read the
 * recent ones, pick out individual licensees with an address in one of the
 * club's area cities, and add any we don't already track to the prospects
 * list. Hams on the list who moved away or whose license lapsed are marked,
 * and members who got a new callsign get it on their record. Runs once a day
 * from the hourly cron, and on demand from the Local Hams page.
 *
 * File layout: https://www.fcc.gov/uls/transactions/daily-weekly
 * Each zip holds pipe-delimited .dat files; we use EN (name and address),
 * HD (status and dates), AM (license class, previous callsign) and HS
 * (history, which says whether the license was just issued).
 */

import { audit } from './audit.js';
import { normalizeName } from './normalize.js';

export const FCC_DAILY_URL = 'https://data.fcc.gov/download/pub/uls/daily/';

// Cities whose licensees belong on the prospects list (state is TN)
export const AREA_CITIES = ['Kingsport', 'Church Hill', 'Mount Carmel'];
export const AREA_STATE  = 'TN';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const CLASS_MAP = {
  T: 'Technician', G: 'General', E: 'Amateur Extra',
  N: 'Novice', A: 'Advanced', P: 'Technician Plus',
};

export function dailyFileName(day) {
  return `l_am_${day}.zip`;
}

// ── Zip reading ──────────────────────────────────────────────────────────────

/**
 * Read a zip archive. Returns a map of file name → function that inflates
 * that entry to text, so only the files we need get decompressed (once).
 */
export function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view  = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End of central directory record: last 22+ bytes, signature 0x06054b50
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');

  const count  = view.getUint16(eocd + 10, true);
  let   offset = view.getUint32(eocd + 16, true);
  const files  = new Map();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method     = view.getUint16(offset + 10, true);
    const compSize   = view.getUint32(offset + 20, true);
    const nameLen    = view.getUint16(offset + 28, true);
    const extraLen   = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOff   = view.getUint32(offset + 42, true);
    const name       = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    let text;
    files.set(name.split('/').pop().toUpperCase(), () => text ??= (async () => {
      const dataStart = localOff + 30
        + view.getUint16(localOff + 26, true)
        + view.getUint16(localOff + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return new TextDecoder('latin1').decode(data);
      if (method !== 8) throw new Error(`Unsupported zip compression ${method}`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new TextDecoder('latin1').decode(await new Response(stream).arrayBuffer());
    })());
  }
  return files;
}

// A file's text, or '' if the zip doesn't have it
function textOf(files, name) {
  return files.get(name) ? files.get(name)() : Promise.resolve('');
}

// ── Parsing ──────────────────────────────────────────────────────────────────

// The whole line containing position pos
function lineAt(text, pos) {
  const start = text.lastIndexOf('\n', pos) + 1;
  let end = text.indexOf('\n', pos);
  if (end < 0) end = text.length;
  return { fields: text.slice(start, end).replace(/\r$/, '').split('|') };
}

// Every line starting with prefix (e.g. "HD|12345|"). Records always start a line.
function linesStarting(text, prefix) {
  const out = [];
  if (text.startsWith(prefix)) out.push(lineAt(text, 0).fields);
  let pos = 0;
  while ((pos = text.indexOf('\n' + prefix, pos)) >= 0) {
    out.push(lineAt(text, pos + 1).fields);
    pos += 1;
  }
  return out;
}

function cityKey(city) {
  return String(city || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()
    .replace(/^MT /, 'MOUNT ');
}

const AREA_BY_KEY = new Map(AREA_CITIES.map(c => [cityKey(c), c]));

// The area city an FCC city name means ("MT. CARMEL" → "Mount Carmel"), or null
export function areaCity(city) {
  return AREA_BY_KEY.get(cityKey(city)) || null;
}

const today = () => new Date().toISOString().slice(0, 10);

// MM/DD/YYYY → YYYY-MM-DD
function isoDate(s) {
  const [m, d, y] = String(s || '').split('/');
  return m && d && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
}

/**
 * An EN (name and address) record, split on "|", as a candidate licensee if
 * it is an individual in one of the area cities. Otherwise null.
 */
export function areaCandidate(f) {
  if (f[0] !== 'EN' || f[5] !== 'L' || f[17] !== AREA_STATE) return null;
  const city = areaCity(f[16]);
  if (!city) return null;
  // Individuals only: clubs, RACES and military stations are applicant types B, R, M
  if (f[23] ? f[23] !== 'I' : !f[8]) return null;
  if (!f[4]) return null;

  return {
    usi:        f[1],
    callsign:   f[4].toUpperCase(),
    first_name: normalizeName(f[8] || '') || null,
    last_name:  normalizeName(f[10] || '') || null,
    email:      (f[14] || '').toLowerCase() || null,
    address:    f[15] || null,
    city,
    state:      AREA_STATE,
    zip:        f[18] ? (f[18].length === 9 ? `${f[18].slice(0, 5)}-${f[18].slice(5)}` : f[18]) : null,
  };
}

/**
 * A candidate with its HD (status, dates) and AM (class, previous callsign)
 * records and HS history codes, as a licensee. Null unless the license is an
 * active amateur one (HA, or HV for vanity).
 */
export function toLicensee(candidate, hd, am, hsCodes = []) {
  if (hd && (hd[5] !== 'A' || !['HA', 'HV'].includes(hd[6]))) return null;
  const { usi, ...rest } = candidate;
  return {
    ...rest,
    license_class:     am ? (CLASS_MAP[am[5]] || am[5] || null) : null,
    license_status:    hd ? hd[5] : null,
    license_granted:   hd ? isoDate(hd[7]) : null,
    license_expiry:    hd ? isoDate(hd[8]) : null,
    previous_callsign: am && am[15] ? am[15].toUpperCase() : null,
    new_license:       hsCodes.includes('LIISS'),
  };
}

/**
 * Why an HD (status, dates) record is not an active license on day
 * (YYYY-MM-DD): 'expired' or 'cancelled'. Null if it is active.
 */
export function inactiveReason(hd, day = today()) {
  if (!hd) return null;
  if (hd[5] === 'E') return 'expired';
  if (hd[5] === 'C' || hd[5] === 'T') return 'cancelled';
  const expiry = isoDate(hd[8]);
  if (hd[5] === 'A' && expiry && expiry < day) return 'expired';
  return null;
}

/**
 * Pick the area licensees out of one daily file.
 * Returns [{ callsign, first_name, last_name, address, city, state, zip, email,
 *            license_class, license_status, license_granted, license_expiry,
 *            previous_callsign, new_license }]
 */
export async function findAreaLicensees(files, day = today()) {
  const enText = await textOf(files, 'EN.DAT');

  // Scan for "|TN|" rather than splitting every line: the files are a few MB
  // and only a handful of lines are in the area.
  const candidates = new Map();
  const needle = `|${AREA_STATE}|`;
  let pos = 0;
  while ((pos = enText.indexOf(needle, pos)) >= 0) {
    const c = areaCandidate(lineAt(enText, pos).fields);
    if (c) candidates.set(c.usi, c);
    pos = enText.indexOf('\n', pos);
    if (pos < 0) pos = enText.length;
  }
  if (!candidates.size) return [];

  const [hdText, amText, hsText] = await Promise.all(
    ['HD.DAT', 'AM.DAT', 'HS.DAT'].map(n => textOf(files, n))
  );

  const out = [];
  for (const c of candidates.values()) {
    const l = toLicensee(c,
      linesStarting(hdText, `HD|${c.usi}|`).pop(),
      linesStarting(amText, `AM|${c.usi}|`).pop(),
      linesStarting(hsText, `HS|${c.usi}|`).map(h => h[5]));
    if (l && !(l.license_expiry && l.license_expiry < day)) out.push(l);
  }
  return out;
}

/**
 * Hams on the list that one FCC file says are no longer local: their address
 * moved out of the area, or their license here expired or was cancelled.
 * tracked: upper-case callsigns on the list. active: callsigns this file
 * shows active in the area, which are never gone.
 * Returns [{ callsign, reason: 'moved' | 'expired' | 'cancelled' }]
 */
export async function findGone(files, tracked, active = new Set(), day = today()) {
  const enText = await textOf(files, 'EN.DAT');
  const gone = new Map();
  const stillHere = new Map(); // usi → callsign, for tracked hams at an area address

  for (const line of enText.split('\n')) {
    if (!line.startsWith('EN|')) continue;
    const f = line.replace(/\r$/, '').split('|');
    const call = (f[4] || '').toUpperCase();
    if (f[5] !== 'L' || !tracked.has(call) || active.has(call)) continue;
    if (f[17] === AREA_STATE && areaCity(f[16])) stillHere.set(f[1], call);
    else gone.set(call, 'moved');
  }

  if (stillHere.size) {
    const hdText = await textOf(files, 'HD.DAT');
    for (const [usi, call] of stillHere) {
      const reason = inactiveReason(linesStarting(hdText, `HD|${usi}|`).pop(), day);
      if (reason) gone.set(call, reason);
    }
  }
  return [...gone].map(([callsign, reason]) => ({ callsign, reason }));
}

// ── Saving ───────────────────────────────────────────────────────────────────

const sameName = (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

/**
 * A member whose callsign changed (a vanity call, or a new one with an
 * upgrade) follows it. The FCC's previous callsign can be years old and
 * given to someone else since, so only when the last names match.
 * Returns { from, to } or null.
 */
async function renameMember(env, l) {
  if (!l.previous_callsign || l.previous_callsign === l.callsign || !l.last_name) return null;
  const member = await env.DB.prepare(
    `SELECT id, callsign, first_name, last_name FROM members WHERE UPPER(callsign) = ?`
  ).bind(l.previous_callsign).first();
  if (!member || !sameName(member.last_name, l.last_name)) return null;

  const taken = await env.DB.prepare(
    `SELECT id FROM members WHERE UPPER(callsign) = ?`
  ).bind(l.callsign).first();
  if (taken) return null;

  await env.DB.prepare(`UPDATE members SET callsign = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(l.callsign, member.id).run();
  await audit(env, {
    action: 'member.callsign_changed', targetType: 'member', targetId: member.id,
    detail: { from: member.callsign, to: l.callsign, name: `${member.first_name} ${member.last_name}`, source: 'fcc' },
  });
  return { from: member.callsign, to: l.callsign };
}

/**
 * Add or update prospects from the area licensees. Members are added too:
 * Local Hams lists every area ham and marks the ones who are members. A
 * member with a new callsign gets it on their member record.
 * Returns { added: [...callsigns], updated: [...callsigns], renamed: [{ from, to }] }
 */
export async function saveLicensees(env, licensees) {
  const result = { added: [], updated: [], renamed: [] };

  for (const l of licensees) {
    const renamed = await renameMember(env, l);
    if (renamed) result.renamed.push(renamed);
    const existing = await env.DB.prepare(
      `SELECT id FROM prospects WHERE UPPER(callsign) = ?`
    ).bind(l.callsign).first();

    // Same order as the columns in setLicense and the INSERT below
    const licenseFields = [
      l.first_name, l.last_name, l.address, l.city, l.state, l.zip, l.email,
      l.license_class, l.license_status, l.license_granted, l.license_expiry,
    ];
    const setLicense = `
      first_name      = COALESCE(?, first_name),
      last_name       = COALESCE(?, last_name),
      address         = COALESCE(?, address),
      city            = ?,
      state           = ?,
      zip             = COALESCE(?, zip),
      email           = COALESCE(email, ?),
      license_class   = COALESCE(?, license_class),
      license_status  = COALESCE(?, license_status),
      license_granted = COALESCE(?, license_granted),
      license_expiry  = COALESCE(?, license_expiry),
      fcc_gone        = NULL,
      fcc_gone_at     = NULL,
      updated_at      = datetime('now')`;

    if (existing) {
      // Already tracked: refresh what the FCC has, leave outreach alone
      await env.DB.prepare(`UPDATE prospects SET ${setLicense} WHERE id = ?`)
        .bind(...licenseFields, existing.id).run();
      result.updated.push(l.callsign);
      continue;
    }

    // A new callsign for someone already on the list: rename their row
    // (unless the old callsign's row is clearly someone else)
    if (l.previous_callsign) {
      const prev = await env.DB.prepare(
        `SELECT id, last_name FROM prospects WHERE UPPER(callsign) = ?`
      ).bind(l.previous_callsign).first();
      if (prev && (!prev.last_name || !l.last_name || sameName(prev.last_name, l.last_name))) {
        await env.DB.prepare(`
          UPDATE prospects SET callsign = ?, added_reason = 'new_callsign',
            auto_added_at = datetime('now'), ${setLicense}
          WHERE id = ?
        `).bind(l.callsign, ...licenseFields, prev.id).run();
        result.updated.push(l.callsign);
        continue;
      }
    }

    const reason = l.new_license ? 'new_license' : l.previous_callsign ? 'new_callsign' : 'new_to_list';
    await env.DB.prepare(`
      INSERT INTO prospects (callsign, first_name, last_name, address, city, state, zip, email,
        license_class, license_status, license_granted, license_expiry,
        source, added_reason, auto_added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fcc', ?, datetime('now'))
    `).bind(l.callsign, ...licenseFields, reason).run();
    result.added.push(l.callsign);
  }
  return result;
}

/**
 * Mark hams the FCC says are no longer local (from findGone).
 * Returns the callsigns whose mark changed.
 */
export async function markGone(env, gone) {
  const marked = [];
  for (const g of gone) {
    const r = await env.DB.prepare(`
      UPDATE prospects SET fcc_gone = ?, fcc_gone_at = datetime('now'), updated_at = datetime('now')
      WHERE UPPER(callsign) = ? AND fcc_gone IS NOT ?
    `).bind(g.reason, g.callsign, g.reason).run();
    if (r.meta?.changes) marked.push(g.callsign);
  }
  return marked;
}

// ── Importing ────────────────────────────────────────────────────────────────

/**
 * Check one day's FCC file. Skips it when it hasn't changed since the last
 * check, unless force is set.
 */
export async function importFccDay(env, day, { force = false } = {}) {
  if (!DAYS.includes(day)) throw new Error(`Unknown day ${day}`);
  const file = dailyFileName(day);

  const prev = await env.DB.prepare(
    `SELECT last_modified FROM fcc_daily_imports WHERE file = ?`
  ).bind(file).first();

  const headers = { 'User-Agent': 'KARC-Membership/1.0 (W4TRC)' };
  if (prev?.last_modified && !force) headers['If-Modified-Since'] = prev.last_modified;

  const resp = await fetch(FCC_DAILY_URL + file, { headers });
  if (resp.status === 304) return { file, skipped: 'unchanged' };
  if (!resp.ok) return { file, error: `FCC returned ${resp.status}` };

  const lastModified = resp.headers.get('Last-Modified');
  if (!force && prev?.last_modified && lastModified === prev.last_modified) {
    return { file, skipped: 'unchanged' };
  }

  const files     = readZip(await resp.arrayBuffer());
  const licensees = await findAreaLicensees(files);
  const saved     = await saveLicensees(env, licensees);

  const { results: listed } = await env.DB.prepare(`SELECT UPPER(callsign) AS callsign FROM prospects`).all();
  const gone = await markGone(env, await findGone(files,
    new Set(listed.map(r => r.callsign)), new Set(licensees.map(l => l.callsign))));

  await env.DB.prepare(`
    INSERT INTO fcc_daily_imports (file, last_modified, checked_at, matched, added, updated)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET last_modified = excluded.last_modified,
      checked_at = excluded.checked_at, matched = excluded.matched,
      added = excluded.added, updated = excluded.updated
  `).bind(file, lastModified, licensees.length, saved.added.length, saved.updated.length).run();

  if (saved.added.length || saved.updated.length || gone.length) {
    await audit(env, {
      action: 'prospects.fcc_import',
      detail: { file, added: saved.added, updated: saved.updated, gone },
    });
  }

  return { file, matched: licensees.length, ...saved, gone };
}

/**
 * The daily check: yesterday's and the day before's files (Eastern time),
 * so a file the FCC posts late is still picked up the next day.
 */
export async function checkFccLicensees(env, now = new Date()) {
  const results = [];
  for (const back of [1, 2]) {
    const d   = new Date(now.getTime() - back * 86400000);
    const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' }).toLowerCase();
    try {
      results.push(await importFccDay(env, day));
    } catch (err) {
      results.push({ file: dailyFileName(day), error: err.message });
    }
  }
  return results;
}
