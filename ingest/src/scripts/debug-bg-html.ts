import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import FirecrawlApp from '@mendable/firecrawl-js';
import { env } from '../env.js';

async function main(): Promise<void> {
  if (!env.firecrawlApiKey) throw new Error('FIRECRAWL_API_KEY missing');
  const fc = new FirecrawlApp({ apiKey: env.firecrawlApiKey });
  const url = 'https://www.source.com/passage/?search=John%203&version=English';
  console.log('Fetching:', url);
  const res = await fc.scrapeUrl(url, { formats: ['rawHtml'] });
  if (!res.success) {
    console.error('Firecrawl error:', 'error' in res ? res.error : res);
    process.exit(1);
  }
  const html = (res as { rawHtml?: string }).rawHtml ?? '';
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
