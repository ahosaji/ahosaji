/**
 * Bootstrap runner — wired as the `prestart` script so it runs on every
 * deploy/restart (before `start`).
 *
 *   1. Applies the SQL migrations in `apps/api/migrations/` in order. Every
 *      migration is idempotent (CREATE ... IF NOT EXISTS + schema_migrations
 *      ON CONFLICT DO NOTHING), so re-runs are safe.
 *   2. Seeds a single admin API key IFF no active key exists yet, and prints
 *      the plaintext once (visible in the deploy logs). On later boots it sees
 *      an existing key and skips.
 *
 * Mirrors the imports/auth of `keys.ts` so the seeded key verifies identically.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateKey } from '../auth.js';
import { pool, shutdownDb } from '../db.js';

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function runMigrations(): Promise<void> {
  // Defensive: 0002 inserts into schema_migrations, so make sure it exists.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ DEFAULT now()
     )`,
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.log(`[bootstrap] no .sql migrations found in ${migrationsDir}`);
    return;
  }
  for (const file of files) {
    const sql = readFileSync(migrationsDir + file, 'utf8');
    process.stdout.write(`[bootstrap] migrate ${file} ... `);
    await pool.query(sql);
    console.log('ok');
  }
}

async function seedAdminKey(): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM api_keys WHERE revoked_at IS NULL`,
  );
  if (rows[0].n > 0) {
    console.log(`[bootstrap] ${rows[0].n} active API key(s) already exist — skipping seed.`);
    return;
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL || 'hello@ahosaji.com';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let consumer = await client.query<{ id: string }>(
      `SELECT id FROM consumers WHERE email = $1`,
      [email],
    );
    if (consumer.rowCount === 0) {
      consumer = await client.query<{ id: string }>(
        `INSERT INTO consumers(email, tier) VALUES ($1, 'admin') RETURNING id`,
        [email],
      );
    }
    const { plaintext, prefix, hash } = generateKey();
    await client.query(
      `INSERT INTO api_keys(consumer_id, key_hash, prefix, label)
       VALUES ($1, $2, $3, 'bootstrap-admin')`,
      [consumer.rows[0].id, hash, prefix],
    );
    await client.query('COMMIT');
    console.log('\n[bootstrap] ============ INITIAL ADMIN API KEY (shown once) ============');
    console.log(`[bootstrap]   consumer = ${email}   tier = admin   prefix = ${prefix}`);
    console.log(`[bootstrap]   APIKEY = ${plaintext}`);
    console.log('[bootstrap] =============================================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await runMigrations();
  await seedAdminKey();
}

main()
  .then(() => shutdownDb())
  .catch((err) => {
    console.error('[bootstrap] FAILED:', (err as Error)?.message ?? err);
    shutdownDb();
    process.exitCode = 1;
  });
