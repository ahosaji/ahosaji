import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scrapeFirecrawlRawHtml } from '../lib/firecrawl.js';
import { env } from '../env.js';
import { sourceEndpoint, requireSourceVersion } from '../lib/config.js';

async function main(): Promise<void> {
  const version = requireSourceVersion(env.sourceVersion);
  if (!env.firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY missing');
  const endpoint = sourceEndpoint(env.sourceBaseUrl, 'passage/');
  endpoint.searchParams.set('search', 'John 3');
  endpoint.searchParams.set('version', version);
  const url = endpoint.href;
  console.log('Fetching:', url);
  const html = await scrapeFirecrawlRawHtml(url, env.firecrawlApiKey);
  console.log('rawHtml length:', html.length);

  const cacheDir = resolve(import.meta.dirname, '../../data/.scratch');
  await mkdir(cacheDir, { recursive: true });
  const out = resolve(cacheDir, 'john-3-english.html');
  await writeFile(out, html, 'utf8');
  console.log('Wrote', out);

  // Quick probes
  const probes = [
    /class="[^"]*\bJHN-3-1\b/,
    /class="[^"]*\btext\b[^"]*"/,
    /class="[^"]*\bversenum\b/,
    /class="[^"]*\bwoj\b/,
    /class="[^"]*\bpassage-text\b/,
    /class="[^"]*\bpassage-content\b/,
    /<h3/,
    /<sup/,
  ];
  for (const p of probes) {
    const m = html.match(p);
    console.log('  ', p.toString().padEnd(45), m ? `MATCH: ${m[0].slice(0, 80)}` : 'no match');
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
