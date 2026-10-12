/**
 * Database backup to R2.
 *
 * Writes the whole D1 database as a gzipped SQL file that can be loaded into
 * an empty database with `wrangler d1 execute --file`. Runs from the daily
 * cron; see "Backups" in the README for how to restore.
 *
 *   daily/karc-membership-YYYY-MM-DD.sql.gz   kept for 30 days
 *   monthly/karc-membership-YYYY-MM.sql.gz    first backup of each month, kept for 12 months
 */

const DAILY_KEEP_DAYS     = 30;
const MONTHLY_KEEP_MONTHS = 12;

// Live credentials. The tables are recreated on restore, but their rows are
// left out so a copy of the backup cannot be used to log in as someone.
const SKIP_DATA = new Set(['sessions', 'password_reset_tokens', 'portal_tokens']);

const PAGE_SIZE      = 500;
const BLOB_PAGE_SIZE = 10; // photo rows are large

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  // D1 returns BLOBs as arrays of bytes
  const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : Uint8Array.from(v);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `X'${hex}'`;
}

/**
 * The database as an ordered list of SQL statements: tables, then rows, then
 * indexes. Returns { statements, tables, rows }.
 */
export async function dumpStatements(db) {
  const { results: objects } = await db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
    ORDER BY rowid
  `).all();

  const tables = objects.filter(o => o.type === 'table');
  // Rows are inserted in table order, not dependency order
  const statements = ['PRAGMA defer_foreign_keys = true'];
  let rows = 0;

  for (const table of tables) statements.push(table.sql);

  for (const table of tables) {
    if (SKIP_DATA.has(table.name)) continue;
    const pageSize = /\bBLOB\b/i.test(table.sql) ? BLOB_PAGE_SIZE : PAGE_SIZE;
    let after = null;

    for (;;) {
      const { results } = await db.prepare(`
        SELECT rowid AS __rowid, * FROM ${ident(table.name)}
        WHERE ? IS NULL OR rowid > ?
        ORDER BY rowid LIMIT ?
      `).bind(after, after, pageSize).all();

      for (const { __rowid, ...row } of results) {
        const cols = Object.keys(row);
        statements.push(
          `INSERT INTO ${ident(table.name)} (${cols.map(ident).join(', ')}) VALUES (${cols.map(c => sqlValue(row[c])).join(', ')})`
        );
        after = __rowid;
      }
      rows += results.length;
      if (results.length < pageSize) break;
    }
  }

  for (const other of objects) {
    if (other.type !== 'table') statements.push(other.sql);
  }

  return { statements, tables: tables.length, rows };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

const pad = (n) => String(n).padStart(2, '0');

/** Delete backups under `prefix` whose date stamp sorts before `cutoff`. */
async function prune(bucket, prefix, cutoff) {
  const expired = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects) {
      const stamp = obj.key.match(/-(\d{4}-\d{2}(?:-\d{2})?)\.sql\.gz$/)?.[1];
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
  const body   = await gzip(header + statements.join(';\n') + ';\n');

  const year  = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day   = `${year}-${pad(month + 1)}-${pad(now.getUTCDate())}`;

  const put = (key) => env.BACKUP_BUCKET.put(key, body, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { tables: String(tables), rows: String(rows) },
  });

  const key = `daily/karc-membership-${day}.sql.gz`;
  await put(key);

  const monthlyKey = `monthly/karc-membership-${day.slice(0, 7)}.sql.gz`;
  if (!(await env.BACKUP_BUCKET.head(monthlyKey))) await put(monthlyKey);

  const dailyCutoff   = new Date(Date.UTC(year, month, now.getUTCDate() - DAILY_KEEP_DAYS)).toISOString().slice(0, 10);
  const monthlyCutoff = new Date(Date.UTC(year, month - MONTHLY_KEEP_MONTHS, 1)).toISOString().slice(0, 7);
  const deleted = [
    ...await prune(env.BACKUP_BUCKET, 'daily/', dailyCutoff),
    ...await prune(env.BACKUP_BUCKET, 'monthly/', monthlyCutoff),
  ];

  return { key, size: body.byteLength, tables, rows, deleted };
}
