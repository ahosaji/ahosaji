import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const rootMigrations = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const legacyVersions = new Set(['0001_init', '0002_consumers_keys', '0003_book_order_numeric']);
const lockId = '714904124305113';

export async function loadMigrations(directory = rootMigrations) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error('No SQL migrations found');
  const prefixes = new Set<string>();
  return Promise.all(files.map(async file => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) throw new Error(`Invalid migration filename: ${file}`);
    const prefix = file.slice(0, 4);
    if (prefixes.has(prefix)) throw new Error(`Duplicate migration number: ${prefix}`);
    prefixes.add(prefix);
    const sql = await readFile(join(directory, file), 'utf8');
    return { version: file.slice(0, -4), sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function runMigrations(pool: Pick<pg.Pool, 'connect'>, directory = rootMigrations, log: (message: string) => void = console.log): Promise<void> {
  const migrations = await loadMigrations(directory);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [lockId]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now(), checksum TEXT
    )`);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    const { rows } = await client.query<{ version: string; checksum: string | null }>('SELECT version, checksum FROM schema_migrations');
    const applied = new Map(rows.map(row => [row.version, row.checksum]));
    for (const row of rows) {
      const migration = migrations.find(candidate => candidate.version === row.version);
      if (!migration) throw new Error(`Unknown tracked migration: ${row.version}`);
      if (row.checksum && row.checksum !== migration.checksum) throw new Error(`Migration checksum mismatch: ${row.version}`);
      if (!row.checksum && !legacyVersions.has(row.version)) throw new Error(`Missing checksum for non-legacy migration: ${row.version}`);
    }
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        if (!applied.get(migration.version)) {
          // Legacy runners recorded only versions. Attest to this baseline without replaying SQL.
          await client.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1', [migration.version, migration.checksum]);
          log(`[migrate] recorded legacy checksum ${migration.version} (SQL not replayed)`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        // Original migrations self-insert their versions; preserve their bytes unchanged.
        await client.query(`INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)
          ON CONFLICT (version) DO UPDATE SET checksum=EXCLUDED.checksum`, [migration.version, migration.checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      log(`[migrate] applied ${migration.version}`);
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]); }
    finally { client.release(); }
  }
}
