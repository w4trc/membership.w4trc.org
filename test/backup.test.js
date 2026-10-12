import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { backupDatabase, backupStatus, dumpStatements } from '../src/lib/backup.js';
import { handleAdmin } from '../src/routes/admin.js';
import { resetDb, addMember, addMembership, auditActions } from './helpers.js';

const NOW = new Date('2026-10-12T08:00:00Z');

async function bucketKeys() {
  const { objects } = await env.BACKUP_BUCKET.list();
  return objects.map(o => o.key).sort();
}

async function readBackup(key) {
  return (await env.BACKUP_BUCKET.get(key)).text();
}

async function addUser(role = 'admin') {
  const result = await env.DB.prepare(
    `INSERT INTO users (email, password_hash, role) VALUES (?, 'x', ?)`
  ).bind(`${role}@example.com`, role).run();
  return result.meta.last_row_id;
}

async function tableNames(db) {
  const { results } = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name`
  ).all();
  return results.map(r => r.name);
}

async function dropEverything(db) {
  const names = await tableNames(db);
  if (names.length) {
    await db.batch([
      db.prepare('PRAGMA defer_foreign_keys = true'),
      ...names.map(n => db.prepare(`DROP TABLE "${n}"`)),
    ]);
  }
}

beforeEach(async () => {
  await resetDb();
  await dropEverything(env.RESTORE_DB);
  const keys = await bucketKeys();
  if (keys.length) await env.BACKUP_BUCKET.delete(keys);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dumpStatements', () => {
  it('produces a dump that restores into an empty database', async () => {
    const payer = await addMember({
      membership_type: 'family',
      first_name: "D'Arcy",
      last_name: 'Ünïcode — 73',
      bio: 'Line one\nLine two; with a semicolon\n-- and a comment marker',
      phone: null,
    });
    const dependent = await addMember();
    await addMembership(payer, 2026, { amount_paid: 31.5, paid_date: '2026-03-15', payment_method: 'stripe' });
    await addMembership(dependent, 2026, { amount_due: 0, covered_by_member_id: payer });
    for (let start = 0; start < 600; start += 100) {
      await env.DB.batch(Array.from({ length: 100 }, (_, i) =>
        env.DB.prepare(`INSERT INTO prospects (callsign, first_name) VALUES (?, ?)`)
          .bind(`KX4${start + i}`, `Ham ${start + i}`)
      ));
    }
    // More photos than one page of a BLOB table, so paging is exercised
    for (let n = 0; n < 9; n++) {
      const item = (await env.DB.prepare(`INSERT INTO inventory_items (name) VALUES (?)`).bind(`Radio ${n}`).run()).meta.last_row_id;
      const image = Uint8Array.from({ length: 300 }, (_, i) => (i + n) % 256);
      await env.DB.prepare(`INSERT INTO inventory_photos (item_id, image, thumb) VALUES (?, ?, ?)`)
        .bind(item, image, new Uint8Array([0, 255, n])).run();
    }

    const { statements, tables, rows } = await dumpStatements(env.DB);
    await env.RESTORE_DB.batch(statements.map(s => env.RESTORE_DB.prepare(s)));

    const names = await tableNames(env.DB);
    expect(await tableNames(env.RESTORE_DB)).toEqual(names);
    expect(tables).toBe(names.length);

    let total = 0;
    for (const name of names) {
      const original = (await env.DB.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
      const restored = (await env.RESTORE_DB.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()).results;
      expect(restored, name).toEqual(original);
      total += original.length;
    }
    expect(rows).toBe(total);
    expect(total).toBeGreaterThan(600);

    const schema = (db) => db.prepare(
      `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name`
    ).all().then(r => r.results);
    expect(await schema(env.RESTORE_DB)).toEqual(await schema(env.DB));
  });

  it('leaves out sessions and one-time tokens but keeps their tables', async () => {
    const member = await addMember();
    const user = await addUser();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES ('secret-session-id', ?, '2099-01-01')`).bind(user),
      env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ('r1', ?, 'secret-reset-hash', '2099-01-01')`).bind(user),
      env.DB.prepare(`INSERT INTO portal_tokens (id, member_id, email, code_hash, expires_at) VALUES ('p1', ?, 'a@example.com', 'secret-code-hash', '2099-01-01')`).bind(member),
    ]);

    const { statements } = await dumpStatements(env.DB);
    const dump = statements.join('\n');

    expect(dump).not.toContain('secret-');
    expect(dump).toContain('CREATE TABLE sessions');
    expect(dump).toContain('admin@example.com');
  });
});

describe('backupDatabase', () => {
  it('writes a SQL file for the day and the month', async () => {
    await addMember({ callsign: 'KT4BKP' });

    const result = await backupDatabase(env, NOW);

    expect(result).toMatchObject({ key: 'daily/karc-membership-2026-10-12.sql', deleted: [] });
    expect(result.size).toBeGreaterThan(0);
    expect(await bucketKeys()).toEqual([
      'daily/karc-membership-2026-10-12.sql',
      'monthly/karc-membership-2026-10.sql',
    ]);

    const sql = await readBackup(result.key);
    const { statements } = await dumpStatements(env.DB);
    expect(sql).toBe(`-- W4TRC membership database backup, 2026-10-12T08:00:00.000Z\n${statements.join(';\n')};\n`);
    expect(sql).toContain("'KT4BKP'");
  });

  it('keeps the first backup of the month as the monthly copy', async () => {
    await backupDatabase(env, NOW);
    await addMember({ callsign: 'KT4LATE' });
    await backupDatabase(env, new Date('2026-10-13T08:00:00Z'));

    expect(await readBackup('daily/karc-membership-2026-10-13.sql')).toContain('KT4LATE');
    expect(await readBackup('monthly/karc-membership-2026-10.sql')).not.toContain('KT4LATE');
  });

  it('replaces the daily backup when run twice in a day', async () => {
    await backupDatabase(env, NOW);
    await addMember({ callsign: 'KT4TWICE' });
    await backupDatabase(env, NOW);

    expect(await bucketKeys()).toHaveLength(2);
    expect(await readBackup('daily/karc-membership-2026-10-12.sql')).toContain('KT4TWICE');
  });

  it('deletes daily backups older than 30 days and monthly ones older than 12 months', async () => {
    const stale = [
      'daily/karc-membership-2026-09-11.sql',
      'daily/karc-membership-2025-12-31.sql',
      'monthly/karc-membership-2025-09.sql',
    ];
    const kept = [
      'daily/karc-membership-2026-09-12.sql',
      'daily/karc-membership-2026-10-11.sql',
      'monthly/karc-membership-2025-10.sql',
      'monthly/karc-membership-2026-09.sql',
      'notes/karc-membership-2020-01-01.sql',
      'daily/readme.txt',
    ];
    for (const key of [...stale, ...kept]) await env.BACKUP_BUCKET.put(key, 'x');

    const result = await backupDatabase(env, NOW);

    expect(result.deleted.sort()).toEqual([...stale].sort());
    expect(await bucketKeys()).toEqual([
      ...kept,
      'daily/karc-membership-2026-10-12.sql',
      'monthly/karc-membership-2026-10.sql',
    ].sort());
  });

  it('fails clearly when the bucket is not configured', async () => {
    await expect(backupDatabase({ DB: env.DB }, NOW)).rejects.toThrow('BACKUP_BUCKET is not configured');
    expect(await bucketKeys()).toEqual([]);
  });
});

describe('backupStatus', () => {
  it('is ok when a backup exists for today', async () => {
    await backupDatabase(env, NOW);

    expect(await backupStatus(env, NOW)).toEqual({ status: 'ok', last_backup: '2026-10-12' });
  });

  it('is ok on the backup from the day before, until the cron has run', async () => {
    await backupDatabase(env, NOW);

    expect(await backupStatus(env, new Date('2026-10-13T07:59:00Z')))
      .toEqual({ status: 'ok', last_backup: '2026-10-12' });
  });

  it('is stale once a whole day has been missed', async () => {
    await backupDatabase(env, NOW);

    expect(await backupStatus(env, new Date('2026-10-14T00:00:00Z')))
      .toEqual({ status: 'stale', last_backup: null });
  });

  it('is stale when no backup has ever been taken', async () => {
    expect(await backupStatus(env, NOW)).toEqual({ status: 'stale', last_backup: null });
  });

  it('does not count the monthly copy', async () => {
    await env.BACKUP_BUCKET.put('monthly/karc-membership-2026-10.sql', 'x');

    expect((await backupStatus(env, NOW)).status).toBe('stale');
  });

  it('is an error when the bucket is not configured', async () => {
    expect(await backupStatus({ DB: env.DB }, NOW)).toEqual({ status: 'error', last_backup: null });
  });
});

describe('POST /api/admin/backup', () => {
  const run = (user, runEnv = env) => handleAdmin(
    new Request('https://members.w4trc.org/api/admin/backup', { method: 'POST' }),
    runEnv, '/api/admin/backup', user
  );

  it('lets an admin take a backup and records it in the audit log', async () => {
    const id = await addUser('admin');

    const res = await run({ id, role: 'admin' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(await bucketKeys()).toContain(body.key);
    expect(await auditActions()).toEqual([
      { action: 'backup.run', detail: { key: body.key, size: body.size, rows: body.rows } },
    ]);
  });

  it('refuses board users', async () => {
    const id = await addUser('board');

    expect((await run({ id, role: 'board' })).status).toBe(403);
    expect(await bucketKeys()).toEqual([]);
  });

  it('reports a failed backup as a 500', async () => {
    const id = await addUser('admin');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await run({ id, role: 'admin' }, { DB: env.DB });

    expect(res.status).toBe(500);
    expect(await auditActions()).toEqual([]);
  });
});
