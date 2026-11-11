import { env } from './env.js';

function status(loaded: string): string {
  return loaded ? '✓ loaded' : '✗ not set';
}

console.log('Ahosaji ingest ready\n');
console.log('Day 2 — source (Firecrawl):');
console.log('  SOURCE_BASE_URL   ', status(env.sourceBaseUrl));
console.log('  SOURCE_VERSION    ', status(env.sourceVersion));
console.log('  FIRECRAWL_API_KEY  ', status(env.firecrawlApiKey));
console.log();
console.log('Day 3 — an Arabic source Arabic:');
console.log('  AR_USER_AGENT', status(env.arabicScraperUserAgent));
console.log('  AR_BASE_URL  ', env.arabicScraperBaseUrl);
console.log();
console.log('Day 4 — English Deutero PDF:');
console.log('  SOURCE_PDF_PATH        ', status(env.deuteroPdfPath));
if (env.deuteroPdfPath) {
  console.log('                     ', env.deuteroPdfPath);
}
