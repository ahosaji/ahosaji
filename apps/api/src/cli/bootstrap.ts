/** Apply pending canonical root migrations. Credential issuance is a separate operator command. */
import { runMigrations } from './migrations.js';
import { isMain, operatorPool } from './operatorDb.js';

export async function bootstrap(): Promise<void> {
  const pool = operatorPool();
  try { await runMigrations(pool); }
  finally { await pool.end(); }
}

if (isMain(import.meta.url)) {
  bootstrap().catch(error => {
    console.error('[migrate] FAILED:', error instanceof Error ? error.message : 'Database migration failed');
    process.exitCode = 1;
  });
}
