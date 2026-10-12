/**
 * Database backup to R2.
 *
 * Writes the whole D1 database as a SQL file that can be loaded into an empty
 * database with `wrangler d1 execute --file`. Runs from the daily cron; see
 * "Backups" in the README for how to restore.
 *
 *   daily/karc-membership-YYYY-MM-DD.sql   kept for 30 days
 *   monthly/karc-membership-YYYY-MM.sql    first backup of each month, kept for 12 months
 *
 * Built to fit the Workers free plan (10 ms CPU, 50 subrequests): SQLite
 * formats every row itself with quote(), tables are read together in batches,
 * and the file is stored uncompressed.
 */

const DAILY_KEEP_DAYS     = 30;
const MONTHLY_KEEP_MONTHS = 12;

// Live credentials. The tables are recreated on restore, but their rows are
// left out so a copy of the backup cannot be used to log in as someone.
const SKIP_DATA = new Set(['sessions', 'password_reset_tokens', 'portal_tokens']);

const PAGE_SIZE      = 2000;
const BLOB_PAGE_SIZE = 4; // photo rows are large

const USER_OBJECTS = `m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'`;

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * The database as an ordered list of SQL statements: tables, then rows, then
 * indexes. Returns { statements, tables, rows }.
 */
export async function dumpStatements(db) {
  const [{ results: objects }, { results: columns }] = await db.batch([
    db.prepare(`
      SELECT m.type, m.name, m.sql FROM sqlite_master m
      WHERE m.sql IS NOT NULL AND ${USER_OBJECTS}
      ORDER BY m.rowid
    `),
    db.prepare(`
      SELECT m.name AS tbl, p.name AS col
      FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table' AND ${USER_OBJECTS}
      ORDER BY m.rowid, p.cid
    `),
  ]);

  const tables = objects.filter(o => o.type === 'table');

  const dumps = tables.filter(t => !SKIP_DATA.has(t.name)).map(t => {
    const cols = columns.filter(c => c.tbl === t.name).map(c => ident(c.col));
    return {
      insert: `INSERT INTO ${ident(t.name)} (${cols.join(', ')}) VALUES (`,
      // quote() renders each value as a SQL literal, so no row data is escaped here
      select: `SELECT rowid AS r, ${cols.map(c => `quote(${c})`).join(` || ', ' || `)} AS v
               FROM ${ident(t.name)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      pageSize: /\bBLOB\b/i.test(t.sql) ? BLOB_PAGE_SIZE : PAGE_SIZE,
      after: 0,
      rows: [],
    };
  });

  // One batch per round reads the next page of every table that has rows left
  let pending = dumps;
  while (pending.length) {
    const pages = await db.batch(pending.map(d => db.prepare(d.select).bind(d.after, d.pageSize)));
    pending = pending.filter((d, i) => {
      const { results } = pages[i];
      for (const row of results) d.rows.push(`${d.insert}${row.v})`);
      if (results.length) d.after = results[results.length - 1].r;
      return results.length === d.pageSize;
    });
  }

  const statements = [
    // Rows are inserted in table order, not dependency order
    'PRAGMA defer_foreign_keys = true',
    ...tables.map(t => t.sql),
    ...dumps.flatMap(d => d.rows),
    ...objects.filter(o => o.type !== 'table').map(o => o.sql),
  ];

  return { statements, tables: tables.length, rows: dumps.reduce((n, d) => n + d.rows.length, 0) };
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the UTC day `offsetDays` away from `now`. */
function utcDay(now, offsetDays = 0) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays))
    .toISOString().slice(0, 10);
}

const dailyKey   = (day)   => `daily/karc-membership-${day}.sql`;
const monthlyKey = (month) => `monthly/karc-membership-${month}.sql`;

/** Delete backups under `prefix` whose date stamp sorts before `cutoff`. */
async function prune(bucket, prefix, cutoff) {
  const expired = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects) {
      const stamp = obj.key.match(/-(\d{4}-\d{2}(?:-\d{2})?)\.sql$/)?.[1];
      if (stamp && stamp < cutoff) expired.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (expired.length) await bucket.delete(expired);
  return expired;
}

/**
 * Back up the database to R2 and remove backups past their retention.
 * Returns { key, size, tables, rows, deleted }.
 */
export async function backupDatabase(env, now = new Date()) {
  if (!env.BACKUP_BUCKET) throw new Error('BACKUP_BUCKET is not configured');

  const { statements, tables, rows } = await dumpStatements(env.DB);
  const header = `-- ${env.CLUB_CALLSIGN || 'KARC'} membership database backup, ${now.toISOString()}\n`;
  const body   = new TextEncoder().encode(header + statements.join(';\n') + ';\n');

  const put = (key) => env.BACKUP_BUCKET.put(key, body, {
    httpMetadata: { contentType: 'application/sql' },
    customMetadata: { tables: String(tables), rows: String(rows) },
  });

  const day = utcDay(now);
  const key = dailyKey(day);
  await put(key);

  const monthly = monthlyKey(day.slice(0, 7));
  if (!(await env.BACKUP_BUCKET.head(monthly))) await put(monthly);

  const monthlyCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHLY_KEEP_MONTHS, 1))
    .toISOString().slice(0, 7);
  const deleted = [
    ...await prune(env.BACKUP_BUCKET, 'daily/', utcDay(now, -DAILY_KEEP_DAYS)),
    ...await prune(env.BACKUP_BUCKET, 'monthly/', monthlyCutoff),
  ];

  return { key, size: body.byteLength, tables, rows, deleted };
}

/**
 * Whether the daily backup is current, for the health check. It is 'ok' when
 * a backup exists for today or yesterday (UTC), which allows for the hours
 * before today's cron has run, and 'stale' otherwise — including when no
 * backup has ever been taken. Returns { status, last_backup }.
 */
export async function backupStatus(env, now = new Date()) {
  if (!env.BACKUP_BUCKET) return { status: 'error', last_backup: null };

  for (const day of [utcDay(now), utcDay(now, -1)]) {
    if (await env.BACKUP_BUCKET.head(dailyKey(day))) return { status: 'ok', last_backup: day };
  }
  return { status: 'stale', last_backup: null };
}
