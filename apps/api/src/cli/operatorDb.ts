import pg from 'pg';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Operator commands deliberately do not load the serving app or its credentials. */
export function operatorPool(source: NodeJS.ProcessEnv = process.env): pg.Pool {
  const connectionString = source.MIGRATION_DATABASE_URL || source.DATABASE_URL;
  if (!connectionString) throw new Error('Set MIGRATION_DATABASE_URL or DATABASE_URL for this operator command');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid operator database URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Operator database URL must use postgres or postgresql');
  return new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000, query_timeout: 300_000 });
}

export function isMain(moduleUrl: string): boolean {
  return Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl);
}
