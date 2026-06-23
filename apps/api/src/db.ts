import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

export async function shutdownDb(): Promise<void> {
  await pool.end();
}
