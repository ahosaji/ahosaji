/** Explicit operator key issuance. Plaintext goes to a private new file or an interactive terminal. */
import { open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { generateKey } from '../lib/apiKeys.js';
import { isMain, operatorPool } from './operatorDb.js';

type Tier = 'free' | 'church' | 'paid' | 'admin';
export interface Args { command: string; email?: string; tier?: Tier; label?: string; output?: string }
interface OperatorClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(): void;
}
interface Output { isTTY?: boolean; write(text: string): boolean }

export function parseArgs(argv = process.argv.slice(2)): Args {
  const args: Args = { command: argv[0] ?? '' };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    const flag = argv[i];
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    if (flag === '--email') args.email = value;
    else if (flag === '--tier') args.tier = value as Tier;
    else if (flag === '--label') args.label = value;
    else if (flag === '--output') args.output = value;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

export async function issueKey(args: Args, pool: { connect(): Promise<OperatorClient> }, output: Output = process.stdout): Promise<void> {
  if (!args.email?.trim() || !args.email.includes('@')) throw new Error('--email is required');
  if (!args.tier || !['free', 'church', 'paid', 'admin'].includes(args.tier)) throw new Error('--tier must be free|church|paid|admin');
  if (!args.output && !output.isTTY) throw new Error('Use --output <new-file> when stdout is not an interactive terminal');
  // Reserve the destination before database work; never overwrite an existing key file.
  let file: FileHandle | undefined;
  if (args.output) file = await open(args.output, 'wx', 0o600);
  let client: OperatorClient | undefined;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO consumers(email, tier) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [args.email, args.tier]);
    const consumer = await client.query('SELECT id, tier FROM consumers WHERE email=$1 FOR UPDATE', [args.email]);
    const row = consumer.rows[0];
    if (!row) throw new Error('Consumer was not found');
    const { plaintext, prefix, hash } = generateKey();
    await client.query('INSERT INTO api_keys(consumer_id, key_hash, prefix, label) VALUES ($1, $2, $3, $4)', [row.id, hash, prefix, args.label ?? null]);
    if (file) { await file.writeFile(`${plaintext}\n`, 'utf8'); await file.sync(); }
    await client.query('COMMIT');
    committed = true;
    if (file) output.write(`Issued key for ${args.email} (tier=${row.tier}); saved to ${args.output}\n`);
    else output.write(`${plaintext}\n`);
  } catch (error) {
    if (client && !committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client?.release();
    await file?.close();
    if (file && !committed && args.output) await unlink(args.output);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.command !== 'create') throw new Error('Usage: keys.ts create --email <email> --tier <tier> [--label <label>] [--output <new-file>]');
  const pool = operatorPool();
  try { await issueKey(args, pool); } finally { await pool.end(); }
}

if (isMain(import.meta.url)) {
  main().catch(error => {
    console.error('Key issuance failed:', error instanceof Error ? error.message : 'Operator command failed');
    process.exitCode = 1;
  });
}
