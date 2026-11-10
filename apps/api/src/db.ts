import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000,
  statement_timeout: 5_000, query_timeout: 6_000, idle_in_transaction_session_timeout: 5_000, allowExitOnIdle: true });

export async function shutdownDb(): Promise<void> {
  await pool.end();
}
