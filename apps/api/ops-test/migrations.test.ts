import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';

const runnerUrl = new URL('../src/cli/migrations.ts', import.meta.url);

test('bootstrap is migration-only and independent of serving configuration', async () => {
  const source = await readFile(new URL('../src/cli/bootstrap.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /generateKey|seedAdminKey|APIKEY|\.\.\/db\.js|\.\.\/auth\.js/);
});

test('migration loader preserves full legacy names and checksums SQL bytes', async () => {
  const { loadMigrations } = await import(runnerUrl.href);
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.slice(0, 3).map((m: {version: string}) => m.version), [
    '0001_init', '0002_consumers_keys', '0003_book_order_numeric',
  ]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
});

test('fresh canonical migrations create no credentials and repeat without applying SQL', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const { runMigrations, loadMigrations } = await import(runnerUrl.href);
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `ops_fresh_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool, undefined, () => {});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM api_keys')).rows[0].n, 0);
    const applied = await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version');
    assert.deepEqual(applied.rows.map(row => row.version), (await loadMigrations()).map((migration: {version: string}) => migration.version));
    assert.ok(applied.rows.every(row => /^[a-f0-9]{64}$/.test(row.checksum)));
    const logs: string[] = [];
    await runMigrations(pool, undefined, message => logs.push(message));
    assert.deepEqual(logs, []);
    assert.deepEqual((await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version')).rows, applied.rows);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});

test('tracked migrations apply once, preserve legacy rows, serialize and roll back failures', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const { runMigrations, loadMigrations } = await import(runnerUrl.href);
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `ops_test_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  const dir = await mkdtemp(join(tmpdir(), 'ahosaji-migrations-'));
  try {
    // Emulate old deployments, where SQL itself recorded these names and no checksum existed.
    for (const migration of (await loadMigrations()).slice(0, 3)) await pool.query(migration.sql);
    await pool.query("INSERT INTO translations VALUES ('test','Test','en','fixture',NULL,'fixture')");
    await runMigrations(pool, undefined, () => {});
    await runMigrations(pool, undefined, () => {});
    const count = await pool.query("SELECT count(*)::int AS n FROM translations WHERE code='test'");
    assert.equal(count.rows[0].n, 1);
    const legacy = await pool.query("SELECT checksum FROM schema_migrations WHERE version='0003_book_order_numeric'");
    assert.match(legacy.rows[0].checksum, /^[a-f0-9]{64}$/);

    await pool.query('TRUNCATE schema_migrations');
    await writeFile(join(dir, '0001_once.sql'), 'CREATE TABLE once_only (id int); SELECT pg_sleep(0.05);');
    await Promise.all([runMigrations(pool, dir, () => {}), runMigrations(pool, dir, () => {})]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 1);
    await writeFile(join(dir, '0001_once.sql'), 'SELECT 2;');
    await assert.rejects(runMigrations(pool, dir, () => {}), /checksum/i);
    await writeFile(join(dir, '0001_once.sql'), 'CREATE TABLE once_only (id int); SELECT pg_sleep(0.05);');
    await writeFile(join(dir, '0002_fail.sql'), 'CREATE TABLE must_rollback (id int); SELECT missing_function();');
    await assert.rejects(runMigrations(pool, dir, () => {}));
    assert.equal((await pool.query("SELECT to_regclass('must_rollback') AS t")).rows[0].t, null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='0002_fail'")).rows[0].n, 0);
    await pool.query("INSERT INTO schema_migrations(version) VALUES ('0999_unknown')");
    await assert.rejects(runMigrations(pool, dir, () => {}), /unknown/i);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
