/** Environment parsing is separate from dotenv loading so tests never read local credentials. */
export function requireSourceVersion(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('SOURCE_VERSION is required for English HTTP scraping');
  const version = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version)) throw new Error('SOURCE_VERSION must be a provider identifier of 1-64 letters, digits, dots, underscores or hyphens');
  return version;
}

export function sourceEndpoint(base: string, path: string): URL {
  if (!base.trim()) throw new Error('Source base URL is required; configure SOURCE_BASE_URL or AR_BASE_URL');
  let url: URL; try { url = new URL(base); } catch { throw new Error('Source base URL must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /^(?:www\.)?(?:example\.(?:org|com|net)|source\.com)$/.test(url.hostname)) throw new Error('Source base URL must be a real HTTP(S) endpoint without credentials, query or fragment');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return url;
}
export function parseIngestConfig(values: Record<string, string | undefined>) {
  const read = (key: string): string => values[key]?.trim() ?? '';
  const arabicScraperBaseUrl = read('AR_BASE_URL'), sourceBaseUrl = read('SOURCE_BASE_URL');
  if (arabicScraperBaseUrl) sourceEndpoint(arabicScraperBaseUrl, '');
  if (sourceBaseUrl) sourceEndpoint(sourceBaseUrl, '');
  return { firecrawlApiKey: read('FIRECRAWL_API_KEY'), arabicScraperUserAgent: read('AR_USER_AGENT'), arabicScraperBaseUrl, sourceBaseUrl, sourceVersion: read('SOURCE_VERSION'),
    deuteroPdfPath: read('SOURCE_PDF_PATH') || read('English_PDF_PATH'), pythonBin: read('PYTHON_BIN'),
    databaseUrl: read('DATABASE_URL'), meilisearchHost: read('MEILISEARCH_HOST'), meilisearchMasterKey: read('MEILISEARCH_MASTER_KEY') };
}
