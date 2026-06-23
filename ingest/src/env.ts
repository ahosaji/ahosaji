import { config } from 'dotenv';

config({ path: new URL('../../.env', import.meta.url) });

function read(name: string, opts: { required?: boolean; default?: string } = {}): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    if (opts.default !== undefined) return opts.default;
    if (opts.required) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return '';
  }
  return value;
}

export const env = {
  // Day 2 — source via Firecrawl
  firecrawlApiKey: read('FIRECRAWL_API_KEY'),

  // Day 3 — an Arabic source Arabic
  arabicScraperUserAgent: read('AR_USER_AGENT'),
  arabicScraperBaseUrl: read('AR_BASE_URL', { default: 'https://an arabic source' }),

  // Day 4 — English Deuterocanonicals PDF
  deuteroPdfPath: read('English_PDF_PATH'),

  // Phase 2 — Postgres + Meilisearch
  databaseUrl: read('DATABASE_URL'),
  meilisearchHost: read('MEILISEARCH_HOST'),
  meilisearchMasterKey: read('MEILISEARCH_MASTER_KEY'),
};
