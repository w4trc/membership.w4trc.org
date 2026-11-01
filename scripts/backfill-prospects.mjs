#!/usr/bin/env node
/**
 * Catch up the Local Hams list from the FCC's full amateur license database.
 *
 * The daily check (src/lib/fccLicensees.js) only sees licenses that changed
 * in the last few days. This reads the whole database, picks out active
 * individual licensees in the area cities, and writes a SQL file that:
 *   - gives members and hams on the list their new callsign, if they changed it
 *   - adds the ones not already on the list (members included)
 *   - marks hams on the list who moved away or whose license expired or was
 *     cancelled, and clears that mark for anyone active here again
 * Hams already on the list keep their outreach details, so it is safe to run
 * again whenever you want to catch up.
 *
 * Usage:
 *   npm run db:backfill:prospects                    # download and write the SQL
 *   npm run db:backfill:prospects -- --zip FILE      # use an l_amat.zip you downloaded
 *   npm run db:backfill:prospects -- --dir FOLDER    # or one you already unzipped
 *   npm run db:backfill:prospects:apply              # add them to the live database
 *   npm run db:backfill:prospects:apply:local        # or to the local one
 *
 * The download is about 200 MB and is kept in your temp folder for a day.
 * Needs Node 22.12 or later.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { areaCandidate, toLicensee, inactiveReason, AREA_CITIES, AREA_STATE } from '../src/lib/fccLicensees.js';

const FULL_URL = 'https://data.fcc.gov/download/pub/uls/complete/l_amat.zip';
const ROOT     = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT      = path.join(ROOT, 'scripts', 'prospects-backfill.sql');

// ── Arguments ────────────────────────────────────────────────────────────────

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}
const flag = name => process.argv.includes(`--${name}`);

// ── Getting the file ─────────────────────────────────────────────────────────

async function download() {
  const dir  = path.join(os.tmpdir(), 'karc-fcc');
  const file = path.join(dir, 'l_amat.zip');
  fs.mkdirSync(dir, { recursive: true });

  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 86400000;
  if (fresh && !flag('fresh')) {
    console.log(`Using the copy downloaded today: ${file}`);
    return file;
  }

  console.log(`Downloading ${FULL_URL} ...`);
  const resp = await fetch(FULL_URL, { headers: { 'User-Agent': 'KARC-Membership/1.0 (W4TRC)' } });
  if (!resp.ok) throw new Error(`FCC returned ${resp.status}`);

  const total = Number(resp.headers.get('Content-Length')) || 0;
  let got = 0, shown = -1;
  const body = Readable.fromWeb(resp.body);
  body.on('data', chunk => {
    got += chunk.length;
    const pct = total ? Math.floor(got / total * 100) : Math.floor(got / 1e7);
    if (pct !== shown) { shown = pct; process.stdout.write(`\r  ${total ? pct + '%' : (got / 1e6).toFixed(0) + ' MB'}   `); }
  });
  await pipeline(body, fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
  process.stdout.write('\n');
  return file;
}

// ── Reading lines from the zip (or an unzipped folder) ───────────────────────

// name → function returning a readable stream of that file's text
function openZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file} is not a zip file`);

  const entries = new Map();
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const method   = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen  = buf.readUInt16LE(off + 28);
    const local    = buf.readUInt32LE(off + 42);
    const name     = buf.toString('latin1', off + 46, off + 46 + nameLen);
    if (compSize === 0xffffffff || local === 0xffffffff) {
      throw new Error('This zip is too large to read directly. Unzip it and run again with --dir FOLDER.');
    }
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);

    entries.set(name.split('/').pop().toUpperCase(), () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data  = Readable.from([buf.subarray(start, start + compSize)]);
      return method === 0 ? data : data.pipe(zlib.createInflateRaw());
    });
  }
  return entries;
}

function openDir(dir) {
  const entries = new Map();
  for (const name of fs.readdirSync(dir)) {
    entries.set(name.toUpperCase(), () => fs.createReadStream(path.join(dir, name)));
  }
  return entries;
}

// Call onLine(fields) for every line of a .dat file that passes the quick test
async function eachLine(files, name, quick, onLine) {
  const open = files.get(name);
  if (!open) throw new Error(`${name} is missing from the FCC file`);
  const rl = readline.createInterface({ input: open().setEncoding('latin1'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (quick(line)) onLine(line.split('|'));
  }
}

// ── Writing the SQL ──────────────────────────────────────────────────────────

const sql  = v => v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const list = calls => calls.length ? calls.map(sql).join(', ') : "''";

// A ham who changed callsign: follow it on their member record and their
// row on the list. The FCC's previous callsign can be years old and given
// to someone else since, so only when the last names match.
function renameFor(l) {
  const to = sql(l.callsign), from = sql(l.previous_callsign), last = sql(l.last_name.toUpperCase());
  const member = `UPPER(callsign) = ${from} AND UPPER(TRIM(last_name)) = ${last}
  AND NOT EXISTS (SELECT 1 FROM members WHERE UPPER(callsign) = ${to})`;
  return `INSERT INTO audit_log (action, target_type, target_id, detail)
SELECT 'member.callsign_changed', 'member', id,
  json_object('from', callsign, 'to', ${to}, 'name', first_name || ' ' || last_name, 'source', 'fcc_backfill')
FROM members WHERE ${member};
UPDATE members SET callsign = ${to}, updated_at = datetime('now') WHERE ${member};
UPDATE prospects SET callsign = ${to}, updated_at = datetime('now')
WHERE UPPER(callsign) = ${from} AND (last_name IS NULL OR UPPER(TRIM(last_name)) = ${last})
  AND NOT EXISTS (SELECT 1 FROM prospects WHERE UPPER(callsign) = ${to});`;
}

// Mark hams on the list who are no longer local, and clear the mark for
// anyone active here again. Anyone not in the area at all has moved away.
function goneFor(active, lapsed) {
  const set = reason => `fcc_gone = '${reason}', fcc_gone_at = datetime('now'), updated_at = datetime('now')`;
  const byReason = reason => [...lapsed].filter(([, r]) => r === reason).map(([c]) => c);
  return [
    `UPDATE prospects SET fcc_gone = NULL, fcc_gone_at = NULL, updated_at = datetime('now')
WHERE fcc_gone IS NOT NULL AND UPPER(callsign) IN (${list(active)});`,
    ...['expired', 'cancelled'].map(reason => `UPDATE prospects SET ${set(reason)}
WHERE fcc_gone IS NOT '${reason}' AND UPPER(callsign) IN (${list(byReason(reason))});`),
    `UPDATE prospects SET ${set('moved')}
WHERE fcc_gone IS NOT 'moved' AND UPPER(callsign) NOT IN (${list([...active, ...lapsed.keys()])});`,
  ];
}

function insertFor(l) {
  const call = sql(l.callsign);
  const cols = [
    l.callsign, l.first_name, l.last_name, l.address, l.city, l.state, l.zip, l.email,
    l.license_class, l.license_status, l.license_granted, l.license_expiry,
  ].map(sql).join(', ');
  return `INSERT OR IGNORE INTO prospects (callsign, first_name, last_name, address, city, state, zip, email,
  license_class, license_status, license_granted, license_expiry, source, added_reason, auto_added_at)
SELECT ${cols}, 'fcc_backfill', 'backfill', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM prospects WHERE UPPER(callsign) = ${call});`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const dir   = arg('dir');
  const files = dir ? openDir(dir) : openZip(arg('zip') || await download());

  console.log(`Looking for ${AREA_CITIES.join(', ')} (${AREA_STATE}) ...`);
  const candidates = new Map();
  await eachLine(files, 'EN.DAT', line => line.includes(`|${AREA_STATE}|`), f => {
    const c = areaCandidate(f);
    if (c) candidates.set(c.usi, c);
  });

  const hd = new Map(), am = new Map();
  await eachLine(files, 'HD.DAT', line => line.startsWith('HD|'), f => { if (candidates.has(f[1])) hd.set(f[1], f); });
  await eachLine(files, 'AM.DAT', line => line.startsWith('AM|'), f => { if (candidates.has(f[1])) am.set(f[1], f); });

  const today = new Date().toISOString().slice(0, 10);
  // The full database has every license: active ones go on the list, and
  // expired or cancelled ones mark hams already on it
  const byCall = new Map(), lapsed = new Map();
  for (const c of candidates.values()) {
    const h = hd.get(c.usi);
    if (!h) continue;
    const reason = inactiveReason(h, today);
    const l = reason ? null : toLicensee(c, h, am.get(c.usi));
    if (l) byCall.set(l.callsign, l);
    else if (reason) lapsed.set(c.callsign, reason);
  }
  for (const call of byCall.keys()) lapsed.delete(call);  // a callsign given to someone new
  if (!byCall.size) throw new Error('No active licensees found. Is the FCC file complete?');

  const licensees = [...byCall.values()].sort((a, b) =>
    a.city.localeCompare(b.city) || (a.last_name || '').localeCompare(b.last_name || ''));
  const renames = licensees.filter(l => l.previous_callsign && l.previous_callsign !== l.callsign && l.last_name);

  const out = arg('out') || OUT;
  fs.writeFileSync(out, [
    `-- Local Hams catch-up from the FCC full database, ${today}`,
    `-- ${licensees.length} active licensees in ${AREA_CITIES.join(', ')}.`,
    '',
    `-- New callsigns (${renames.length} hams have a previous one; most are already up to date)`,
    ...renames.map(renameFor),
    '',
    `-- Add hams not already on the list`,
    ...licensees.map(insertFor),
    '',
    `-- No longer local: ${lapsed.size} expired or cancelled here, and anyone not in the area at all`,
    ...goneFor([...byCall.keys()], lapsed),
    '',
  ].join('\n'));

  const counts = AREA_CITIES.map(city => `${city} ${licensees.filter(l => l.city === city).length}`);
  console.log(`\nFound ${licensees.length} active licensees (${counts.join(', ')}), and ${lapsed.size} expired or cancelled.`);
  console.log(`Wrote ${path.relative(process.cwd(), out)}. Hams already on the list keep their outreach details.`);
  console.log(`\nTo add them:  npm run db:backfill:prospects:apply`);
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
