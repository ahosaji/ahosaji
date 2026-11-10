import { isIP } from 'node:net';

export function loadEnv(source: NodeJS.ProcessEnv = process.env) {
  const read = (name: string, fallback?: string): string => {
    const value = source[name]?.trim() || fallback;
    if (!value) throw new Error(`Missing required env: ${name}`);
    return value;
  };
  const mode = source.NODE_ENV ?? 'production';
  const fallbackAllowed = mode === 'development' && source.ALLOW_MEILISEARCH_MASTER_KEY_FALLBACK === 'true';
  if (source.MEILISEARCH_MASTER_KEY !== undefined && !fallbackAllowed) throw new Error('MEILISEARCH_MASTER_KEY must not be present in the serving environment');
  const searchKey = source.MEILISEARCH_SEARCH_KEY?.trim() || (fallbackAllowed ? source.MEILISEARCH_MASTER_KEY?.trim() : undefined);
  if (!searchKey) throw new Error('Missing required env: MEILISEARCH_SEARCH_KEY');
  const trustedProxyCidrs = source.TRUSTED_PROXY_CIDRS?.split(',').map(v => v.trim()).filter(Boolean) ?? [];
  for (const cidr of trustedProxyCidrs) {
    const [address, prefix, extra] = cidr.split('/');
    const family = isIP(address ?? '');
    if (!family || extra !== undefined || !prefix || !/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)) throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
  }
  const port = Number(source.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {
    port, host: source.HOST || '0.0.0.0', databaseUrl: read('DATABASE_URL'),
    logLevel: source.LOG_LEVEL || 'info', meilisearchHost: read('MEILISEARCH_HOST'),
    meilisearchSearchKey: searchKey, trustedProxyCidrs,
  };
}

// Entrypoints explicitly load environment files; imports never load local secrets.
export const env = loadEnv();
