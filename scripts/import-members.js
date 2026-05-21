#!/usr/bin/env node
/**
 * KARC Member Import Script
 *
 * Imports karc-members.csv into the membership API, creating member records
 * and historical membership entries for every year marked with X.
 *
 * PREREQUISITES:
 *   1. Clean the database first (hard-deletes all member data):
 *        Local:  npx wrangler d1 execute karc-membership --local --file=scripts/cleanup.sql
 *        Prod:   dotenv -e .env -- npx wrangler d1 execute karc-membership --remote --file=scripts/cleanup.sql
 *
 *   2. Start the server:
 *        Local:  npm run dev
 *        Prod:   already deployed
 *
 * USAGE:
 *   node scripts/import-members.js --url http://localhost:8787 --email admin@example.com --password yourpassword
 *   node scripts/import-members.js --url http://localhost:8787 --email admin@example.com --password yourpassword --dry-run
 *
 * FLAGS:
 *   --url       Base URL of the worker (default: http://localhost:8787)
 *   --email     Admin/board account email
 *   --password  Admin/board account password
 *   --dry-run   Parse and print members without calling the API
 *
 * NOTES:
 *   - Years marked X → status=active, payment_method=other, amount_paid=20.00
 *   - Lifetime honorary members → status=honorary, amount_due/paid=0/null
 *   - Duplicate callsigns → later row is skipped (first occurrence wins)
 *   - Same email + last name → better row (with callsign) wins
 *   - After import, re-link your admin user account to its member record in
 *     Admin > User Accounts if the link was cleared by the cleanup.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CLI args ────────────────────────────────────────────────────────────────

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

const BASE_URL = arg('--url') || 'http://localhost:8787';
const EMAIL    = arg('--email');
const PASSWORD = arg('--password');
const DRY_RUN  = process.argv.includes('--dry-run');

if (!DRY_RUN && (!EMAIL || !PASSWORD)) {
  console.error('Usage: node scripts/import-members.js --url <url> --email <email> --password <pass>');
  console.error('       Add --dry-run to parse/validate without calling the API');
  process.exit(1);
}

// ─── CSV column indices ──────────────────────────────────────────────────────

const C = {
  NAME: 0, CALLSIGN: 1, ARRL: 2, PHONE: 3, EMAIL: 4,
  // col 5 = "GMail updated 2026" — admin metadata, ignored
  Y2027: 6, Y2026: 7, Y2025: 8, Y2024: 9, Y2023: 10,
  Y2022: 11, Y2021: 12, Y2020: 13, Y2019: 14, Y2018: 15,
  Y2017: 16, Y2016: 17, Y2015: 18,
  NOTES: 19,
};

const YEAR_COLS = [
  [2027, C.Y2027], [2026, C.Y2026], [2025, C.Y2025], [2024, C.Y2024],
  [2023, C.Y2023], [2022, C.Y2022], [2021, C.Y2021], [2020, C.Y2020],
  [2019, C.Y2019], [2018, C.Y2018], [2017, C.Y2017], [2016, C.Y2016],
  [2015, C.Y2015],
];

// ─── CSV parser ──────────────────────────────────────────────────────────────

function parseCSV(text) {
  const rows  = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row    = [];
    let field    = '';
    let inQuote  = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        row.push(field.trim());
        field = '';
      } else {
        field += c;
      }
    }
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

// ─── Field cleaners ──────────────────────────────────────────────────────────

function cleanCallsign(raw) {
  if (!raw) return null;
  const val = raw.trim().toUpperCase();
  if (['TBD', 'NEW', 'N/A', ''].includes(val)) return null;
  // Must be alphanumeric only (no spaces, apostrophes, encoding artifacts, etc.)
  if (/[^A-Z0-9/]/.test(val)) return null;
  // Must contain at least one digit and be at least 3 chars
  if (val.length < 3 || !/\d/.test(val)) return null;
  return val;
}

function cleanEmail(raw) {
  if (!raw) return null;
  // Take first address when multiple are listed (comma or slash separated)
  let email = raw.split(',')[0].split('/')[0].trim();
  // Strip alternate address in parens: "joe@ewi.ng (family@ewi.ng)"
  email = email.split(' ')[0].trim();
  if (!email.includes('@')) return null;
  return email.toLowerCase();
}

function isX(val) {
  return (val || '').trim().toUpperCase() === 'X';
}

// ─── Name parser ─────────────────────────────────────────────────────────────

function parseName(raw) {
  if (!raw) return null;
  raw = raw.trim();
  // Normalize curly/smart apostrophes and UTF-8 encoding artifacts
  raw = raw.replace(/[‘’ʼâ]/g, "'");

  // Special: "McCord. Becky (Eric)" — period separator instead of comma
  if (/^McCord\./i.test(raw)) return { first: 'Becky', last: 'McCord' };

  // No comma → "First [Nickname] Last" or "First Last" format
  if (!raw.includes(',')) {
    const clean = raw.replace(/'[^']*'/g, '').replace(/\([^)]*\)/g, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return { first: parts[0], last: parts[parts.length - 1] };
    return null;
  }

  const commaIdx = raw.indexOf(',');
  const last = raw.slice(0, commaIdx).trim();
  const rest = raw.slice(commaIdx + 1).trim();

  const first = rest
    .replace(/\s*\([^)]*\)/g, '')  // remove (Nickname) / (Spouse) / (Family)
    .replace(/-deceased/gi, '')     // remove -deceased suffix
    .trim()
    .split(/\s+/)[0];              // first word only (ignore middle name / extras)

  if (!first || !last) return null;
  return { first, last };
}

// ─── Row filter ──────────────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /^KARC/i, /^Updated$/i, /^By$/i, /^TOTAL\s+PAID/i, /^Name$/i,
];

function isDataRow(row) {
  const name = (row[C.NAME] || '').trim();
  if (!name || name === ',') return false;
  for (const pat of SKIP_PATTERNS) if (pat.test(name)) return false;
  return true;
}

// ─── Deduplication ───────────────────────────────────────────────────────────
// When two rows share the same callsign OR (same last name + email), keep the
// one with a callsign; if both have callsigns, keep the first occurrence.

function deduplicateRows(rows) {
  const byCallsign = new Map(); // callsign  → index in result[]
  const byEmailKey = new Map(); // "last:email" → index in result[]
  const result     = [];

  for (const row of rows) {
    const callsign = cleanCallsign(row[C.CALLSIGN]);
    const email    = cleanEmail(row[C.EMAIL]);
    const name     = parseName(row[C.NAME]);
    if (!name) continue;

    const emailKey = email ? `${name.last.toLowerCase()}:${name.first.toLowerCase()}:${email}` : null;

    // Duplicate callsign — skip
    if (callsign && byCallsign.has(callsign)) continue;

    // Duplicate email+lastname
    if (emailKey && byEmailKey.has(emailKey)) {
      const existIdx = byEmailKey.get(emailKey);
      const existingCallsign = cleanCallsign(result[existIdx][C.CALLSIGN]);
      if (!existingCallsign && callsign) {
        // Upgrade the existing slot to this better row
        if (existingCallsign) byCallsign.delete(existingCallsign); // (was null, no-op)
        result[existIdx] = row;
        byCallsign.set(callsign, existIdx);
        byEmailKey.set(emailKey, existIdx);
      }
      // else existing is already better or equal — skip this row
      continue;
    }

    const idx = result.length;
    result.push(row);
    if (callsign) byCallsign.set(callsign, idx);
    if (emailKey) byEmailKey.set(emailKey, idx);
  }

  return result;
}

// ─── API client ──────────────────────────────────────────────────────────────

let cookie = '';

async function api(method, endpoint, body) {
  const resp = await fetch(BASE_URL + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const setCookie = resp.headers.get('set-cookie') || '';
  const m = setCookie.match(/karc_session=([^;]+)/);
  if (m) cookie = `karc_session=${m[1]}`;

  let data;
  try { data = await resp.json(); } catch { data = {}; }
  return { ok: resp.ok, status: resp.status, data };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.join(__dirname, 'karc-members.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const allRows  = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const dataRows = allRows.filter(isDataRow);
  const members  = deduplicateRows(dataRows);

  console.log(`Parsed ${allRows.length} rows → ${dataRows.length} data rows → ${members.length} unique members\n`);

  if (DRY_RUN) {
    console.log('─── DRY RUN ─────────────────────────────────────────────────────\n');
    for (const row of members) {
      const name     = parseName(row[C.NAME]);
      const callsign = cleanCallsign(row[C.CALLSIGN]);
      const email    = cleanEmail(row[C.EMAIL]);
      const years    = YEAR_COLS.filter(([, col]) => isX(row[col])).map(([yr]) => yr);
      const note     = (row[C.NOTES] || '').trim();
      const isARRL   = isX(row[C.ARRL]);
      const isLifetime = /lifetime/i.test(note);
      const isDeceased = /deceased/i.test(row[C.NAME] || '');
      console.log(
        `  ${name ? `${name.first} ${name.last}` : '???'}`
        + ` | ${callsign || '(no callsign)'}`
        + ` | ${email || '(no email)'}`
        + (isARRL     ? ' | ARRL'     : '')
        + (isLifetime ? ' | LIFETIME' : '')
        + (isDeceased ? ' | SK'       : '')
        + ` | years: [${years.join(', ')}]`
        + (note ? ` | note: ${note}` : '')
      );
    }
    console.log(`\nTotal: ${members.length} members`);
    return;
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  console.log(`Connecting to ${BASE_URL} ...`);
  const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (!login.ok) {
    console.error('Login failed:', login.data?.error || login.status);
    process.exit(1);
  }
  console.log(`Logged in as ${login.data.user?.email} (${login.data.user?.role})\n`);

  // ── Import loop ────────────────────────────────────────────────────────────
  let created = 0, skipped = 0, errors = 0;

  for (const row of members) {
    const rawName    = row[C.NAME] || '';
    const name       = parseName(rawName);
    if (!name) {
      console.warn(`  SKIP: Cannot parse name "${rawName}"`);
      skipped++;
      continue;
    }

    const callsign   = cleanCallsign(row[C.CALLSIGN]);
    const isARRL     = isX(row[C.ARRL]);
    const phone      = (row[C.PHONE] || '').trim() || null;
    const email      = cleanEmail(row[C.EMAIL]);
    const noteText   = (row[C.NOTES] || '').trim();
    const isDeceased = /deceased/i.test(rawName);
    const isLifetime = /lifetime/i.test(noteText);

    const yearsPaid = YEAR_COLS
      .filter(([, col]) => isX(row[col]))
      .map(([yr]) => yr);

    const earliestYear = yearsPaid.length > 0 ? Math.min(...yearsPaid) : null;
    const joinedDate   = earliestYear ? `${earliestYear}-01-01` : null;

    const label = `${name.first} ${name.last}${callsign ? ` (${callsign})` : ''}`;

    // ── Create member ──────────────────────────────────────────────────────
    const memberResp = await api('POST', '/api/members', {
      callsign:         callsign   || undefined,
      first_name:       name.first,
      last_name:        name.last,
      email:            email      || undefined,
      phone:            phone      || undefined,
      membership_type:  isLifetime ? 'lifetime_honorary' : 'individual',
      is_active:        isDeceased ? 0 : 1,
      is_arrl_member:   isARRL ? 1 : 0,
      joined_date:      joinedDate || undefined,
      create_membership: false,
    });

    if (!memberResp.ok) {
      if (memberResp.status === 409) {
        console.warn(`  SKIP (conflict): ${label} — ${memberResp.data?.error}`);
        skipped++;
      } else {
        console.error(`  ERROR: ${label} — ${memberResp.data?.error}`);
        errors++;
      }
      continue;
    }

    const memberId = memberResp.data.id;

    // Mark silent key for deceased members (requires a separate PUT)
    if (isDeceased) {
      await api('PUT', `/api/members/${memberId}`, { is_silent_key: 1 });
    }

    // ── Historical memberships ─────────────────────────────────────────────
    for (const year of yearsPaid) {
      const msResp = await api('POST', '/api/memberships', {
        member_id:       memberId,
        year,
        status:          isLifetime ? 'honorary' : 'active',
        membership_type: 'individual',
        amount_due:      isLifetime ? 0.00 : 20.00,
        amount_paid:     isLifetime ? null  : 20.00,
        paid_date:       null,
        payment_method:  isLifetime ? null  : 'other',
      });
      if (!msResp.ok) {
        console.warn(`    WARN year ${year} for ${label}: ${msResp.data?.error}`);
      }
    }

    // ── Spreadsheet note ──────────────────────────────────────────────────
    if (noteText) {
      await api('POST', '/api/notes', {
        member_id:  memberId,
        note_text:  noteText,
        is_private: 1,
      });
    }

    console.log(
      `  + ${label}`
      + (isLifetime ? ' [LIFETIME]' : '')
      + (isDeceased ? ' [SK]'       : '')
      + (isARRL     ? ' [ARRL]'     : '')
      + ` — ${yearsPaid.length} years${noteText ? ` — "${noteText}"` : ''}`
    );
    created++;
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n─── Import complete ─────────────────────────────────────────────');
  console.log(`    Created: ${created}`);
  console.log(`    Skipped: ${skipped}`);
  console.log(`    Errors:  ${errors}`);
  if (created > 0) {
    console.log('\n  Next steps:');
    console.log('    1. Verify member count in the UI');
    console.log('    2. Re-link your admin user account to its member record');
    console.log('       in Admin > User Accounts if the link was cleared');
    console.log('    3. Manually set family membership links (covered_by_member_id)');
    console.log('       for family members as needed');
  }
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
