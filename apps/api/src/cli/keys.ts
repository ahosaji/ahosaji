/**
 * API key management CLI.
 *
 *   pnpm --filter @ahosaji/api keys:create -- --email a@b.com --tier admin
 *
 * Issues a new API key. Plaintext is printed once; only the sha256 hash and
 * the 12-char prefix are stored. If the email isn't yet a consumer, creates
 * one with the given tier.
 */
import { generateKey, type Tier } from '../auth.js';
import { pool, shutdownDb } from '../db.js';

interface Args {
  command: string;
  email?: string;
  tier?: Tier;
  label?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { command: argv[0] ?? '' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') args.email = argv[++i];
    else if (a === '--tier') args.tier = argv[++i] as Tier;
    else if (a === '--label') args.label = argv[++i];
  }
  return args;
}

async function createKey(args: Args): Promise<void> {
  if (!args.email) throw new Error('--email is required');
  if (!args.tier) throw new Error('--tier is required (free|church|paid|admin)');
  const validTiers: Tier[] = ['free', 'church', 'paid', 'admin'];
  if (!validTiers.includes(args.tier)) throw new Error(`tier must be one of ${validTiers.join(', ')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let consumer = await client.query(
      `SELECT id, email, tier FROM consumers WHERE email = $1`,
      [args.email],
    );
    if (consumer.rowCount === 0) {
      consumer = await client.query(
        `INSERT INTO consumers(email, tier) VALUES ($1, $2)
         RETURNING id, email, tier`,
        [args.email, args.tier],
      );
      console.log(`✓ created consumer ${args.email} (tier=${args.tier})`);
    } else {
      const existingTier = consumer.rows[0].tier as Tier;
      if (existingTier !== args.tier) {
        console.log(`note: consumer ${args.email} exists with tier=${existingTier}; new key uses that tier (not ${args.tier})`);
      }
    }

    const consumerId = consumer.rows[0].id as string;
    const { plaintext, prefix, hash } = generateKey();
    const r = await client.query(
      `INSERT INTO api_keys(consumer_id, key_hash, prefix, label)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [consumerId, hash, prefix, args.label ?? null],
    );
    await client.query('COMMIT');

    console.log(`\n✓ issued API key`);
    console.log(`  consumer: ${args.email}`);
    console.log(`  key id:   ${r.rows[0].id}`);
    console.log(`  prefix:   ${prefix}`);
    console.log(`\n  ⚠ KEY (shown once, save it now):`);
    console.log(`  ${plaintext}\n`);
    console.log(`  Use as: curl -H "Authorization: Bearer ${plaintext}" http://localhost:3001/v1/...`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.command === 'create') {
    await createKey(args);
  } else {
    console.error('Usage: keys.ts create --email <e> --tier <free|church|paid|admin> [--label <l>]');
    process.exitCode = 2;
    return;
  }
}

main().then(() => shutdownDb()).catch(err => {
  console.error('FAILED:', err.message ?? err);
  shutdownDb();
  process.exitCode = 1;
});
