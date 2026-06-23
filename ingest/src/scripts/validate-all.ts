import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { validateChapter } from '../validate.js';

const SNAPSHOTS_ROOT = resolve(import.meta.dirname, '../../data/snapshots');

interface Found { translation: string; book: string; path: string; }

async function findSnapshots(): Promise<Found[]> {
  const out: Found[] = [];
  const langs = await readdir(SNAPSHOTS_ROOT, { withFileTypes: true });
  for (const lang of langs) {
    if (!lang.isDirectory()) continue;
    const langDir = resolve(SNAPSHOTS_ROOT, lang.name);
    const files = await readdir(langDir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      out.push({ translation: lang.name, book: f.replace(/\.json$/, ''), path: resolve(langDir, f) });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const snapshots = await findSnapshots();
  console.log(`Validating ${snapshots.length} snapshot file(s) against canonical Chapter shape...\n`);

  let failed = 0;
  let warned = 0;
  const allStats: Array<{ file: string; verses: number; headings: number }> = [];

  for (const s of snapshots) {
    const raw = JSON.parse(await readFile(s.path, 'utf8'));
    const result = validateChapter(s.path, raw);
    const rel = relative(process.cwd(), s.path);
    const status = result.ok ? '✓' : '✗';
    const warnTag = result.warnings.length > 0 ? ` (${result.warnings.length}⚠)` : '';
    console.log(`${status} ${rel}${warnTag}`);
    console.log(`    verses=${result.stats.verseCount}  headings=${result.stats.headingCount}  ` +
      `redLetter=${result.stats.redLetterTokenCount}  italic=${result.stats.italicTokenCount}  ` +
      `footnotes=${result.stats.footnoteCount}  chars=${result.stats.totalChars}`);
    for (const e of result.errors) console.log(`    ERROR: ${e}`);
    for (const w of result.warnings) console.log(`    warn:  ${w}`);
    if (!result.ok) failed++;
    if (result.warnings.length > 0) warned++;
    allStats.push({ file: rel, verses: result.stats.verseCount, headings: result.stats.headingCount });
  }

  console.log();
  console.log(`Summary: ${snapshots.length - failed}/${snapshots.length} pass, ${warned} with warnings`);

  // Cross-translation alignment report (informational, not a failure mode)
  console.log();
  console.log('Cross-translation alignment (same book, both translations):');
  const byBook = new Map<string, Found[]>();
  for (const s of snapshots) {
    if (!byBook.has(s.book)) byBook.set(s.book, []);
    byBook.get(s.book)!.push(s);
  }
  for (const [book, list] of byBook) {
    if (list.length < 2) continue;
    const counts: Record<string, { v: number; h: number }> = {};
    for (const s of list) {
      const c = JSON.parse(await readFile(s.path, 'utf8'));
      counts[s.translation] = { v: c.verses.length, h: c.headings.length };
    }
    const verseSets = Object.values(counts).map(c => c.v);
    const matched = new Set(verseSets).size === 1;
    const tag = matched ? '✓ aligned' : '⚠ DIVERGENT';
    const detail = Object.entries(counts).map(([t, x]) => `${t}=${x.v}v/${x.h}h`).join('  ');
    console.log(`  ${book}: ${tag}  (${detail})`);
  }

  if (failed > 0) {
    console.log();
    console.log(`✗ ${failed} file(s) failed validation`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
