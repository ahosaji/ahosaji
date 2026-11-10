/** Validate the complete corpus before connecting; replace selected books transactionally. */
import pg from 'pg';
import { env } from '../env.js';
import { readCorpus, defaultCorpusPaths, printWarnings, assertCorpus } from '../lib/snapshots.js';
import { replacePostgres } from '../lib/postgresImport.js';
async function main(): Promise<void> {
  if (process.argv.slice(2).some(a => a !== '--allow-partial')) throw new Error('Supported option: --allow-partial (never permits empty/invalid snapshots)');
  const corpus = await readCorpus({ ...defaultCorpusPaths, allowPartial: process.argv.includes('--allow-partial') });
  printWarnings(corpus); assertCorpus(corpus);
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  const pool = new pg.Pool({ connectionString: env.databaseUrl, keepAlive: true, connectionTimeoutMillis: 30_000 });
  try { await replacePostgres(async () => corpus, () => pool.connect()); }
  finally { await pool.end(); }
  console.log(`Load complete: ${corpus.snapshots.length} validated snapshots`);
}
main().catch(error => { console.error('FAILED:', error); process.exitCode = 1; });
