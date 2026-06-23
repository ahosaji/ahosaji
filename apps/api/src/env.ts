import { config } from 'dotenv';

config({ path: new URL('../../../.env', import.meta.url) });

function read(name: string, opts: { required?: boolean; default?: string } = {}): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    if (opts.default !== undefined) return opts.default;
    if (opts.required) throw new Error(`Missing required env: ${name}`);
    return '';
  }
  return v;
}

export const env = {
  port: Number(read('PORT', { default: '3001' })),  // 3000 commonly taken on macOS dev machines
  host: read('HOST', { default: '0.0.0.0' }),
  databaseUrl: read('DATABASE_URL', { required: true }),
  logLevel: read('LOG_LEVEL', { default: 'info' }),
  // Search backend is required: a misconfigured host/master-key should fail
  // fast at startup rather than 503 on the first search request. No insecure
  // hardcoded fallback.
  meilisearchHost: read('MEILISEARCH_HOST', { required: true }),
  meilisearchMasterKey: read('MEILISEARCH_MASTER_KEY', { required: true }),
  // Optional scoped search-only key for the query path. Falls back to the
  // master key when unset (dev convenience); prod should set a search-only key
  // and reserve the master key for the indexer (ingest).
  meilisearchSearchKey: read('MEILISEARCH_SEARCH_KEY'),
};
