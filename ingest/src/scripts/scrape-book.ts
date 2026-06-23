/**
 * Scrape an entire book (all chapters) from a single source and write a
 * combined snapshot at ingest/data/snapshots/<lang>/<USFM>.json.
 *
 *   pnpm scrape:book -- --source arabic --usfm JHN
 *   pnpm scrape:book -- --source source --usfm JHN
 *   pnpm scrape:book -- --source deutero --usfm TOB
 *
 * Polite: 800ms delay between chapter requests for HTTP sources.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scrapesourceChapter } from '../scrapers/webSource.js';
import { scrapeArabicSourceChapter } from '../scrapers/arabicScraper.js';
import { extractDeuteroChapter } from '../scrapers/deuteroScraper.js';
import type { Chapter } from '../types/canonical.js';

const SNAP_DIR = resolve(import.meta.dirname, '../../data/snapshots');
const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');

interface BookMeta {
  usfm: string;
  name_en: string;
  name_ar: string;
  testament: string;
  canon: string;
  chapter_count: number;
  source_id?: number;
  source_name?: string;
  deutero_page_ranges?: Record<string, [number, number, number]>;  // chapter → [start, end, maxVerse]
}

interface Args {
  source: 'arabic' | 'source' | 'deutero';
  usfm: string;
  startChapter?: number;
  endChapter?: number;
  delayMs: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const args: Args = { source: 'arabic', usfm: '', delayMs: 800 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--source') args.source = a[++i] as Args['source'];
    else if (a[i] === '--usfm') args.usfm = a[++i]!;
    else if (a[i] === '--start') args.startChapter = Number(a[++i]);
    else if (a[i] === '--end') args.endChapter = Number(a[++i]);
    else if (a[i] === '--delay') args.delayMs = Number(a[++i]);
  }
  if (!args.usfm) throw new Error('--usfm required');
  return args;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function loadBook(usfm: string): Promise<BookMeta> {
  const all = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: BookMeta[] };
  const b = all.books.find(x => x.usfm === usfm);
  if (!b) throw new Error(`book ${usfm} not in registry`);
  return b;
}

async function scrapeChapter(args: Args, book: BookMeta, chapter: number): Promise<Chapter> {
  if (args.source === 'source') {
    if (!book.source_name) throw new Error(`${book.usfm} not on source (no source_name)`);
    return scrapesourceChapter({
      version: 'English',
      bookName: book.source_name,
      bookUsfm: book.usfm,
      chapter,
    });
  }
  if (args.source === 'arabic') {
    if (!book.source_id) throw new Error(`${book.usfm} has no source_id`);
    return scrapeArabicSourceChapter({
      bookId: book.source_id,
      bookUsfm: book.usfm,
      chapter,
    });
  }
  if (args.source === 'deutero') {
    if (!book.deutero_page_ranges?.[String(chapter)]) {
      throw new Error(`${book.usfm} chapter ${chapter} has no deutero_page_ranges entry`);
    }
    const [start, end, maxVerse] = book.deutero_page_ranges[String(chapter)]!;
    return extractDeuteroChapter({
      bookUsfm: book.usfm,
      chapter,
      startPage: start,
      endPage: end,
      maxVerse,
    });
  }
  throw new Error(`unknown source: ${args.source}`);
}

function languageOf(source: Args['source']): 'en' | 'ar' {
  if (source === 'arabic') return 'ar';
  return 'en';  // source + deutero are both English
}

async function main(): Promise<void> {
  const args = parseArgs();
  const book = await loadBook(args.usfm);
  const start = args.startChapter ?? 1;
  const end = args.endChapter ?? book.chapter_count;
  console.log(`Scraping ${book.usfm} ${book.name_en} (${args.source}) chapters ${start}..${end}`);

  const lang = languageOf(args.source);
  const outDir = resolve(SNAP_DIR, lang);
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `${book.usfm}.json`);

  // Resume: load existing chapters from disk if any, so re-runs append.
  let existing: Record<number, Chapter> = {};
  try {
    const prior = JSON.parse(await readFile(outFile, 'utf8')) as Chapter | { chapters: Record<number, Chapter> };
    if ('chapters' in prior) existing = prior.chapters;
    else existing[prior.chapter] = prior;  // legacy single-chapter file
  } catch { /* not present */ }

  const chapters = { ...existing };
  let succeeded = 0, failed = 0;
  for (let n = start; n <= end; n++) {
    const cached = chapters[n];
    if (cached && (cached.verses?.length ?? 0) > 0) {
      console.log(`  [${n}/${end}] ${book.usfm} ${n}: cached, skipping`);
      continue;
    }
    try {
      const c = await scrapeChapter(args, book, n);
      chapters[n] = c;
      succeeded++;
      console.log(`  [${n}/${end}] ${book.usfm} ${n}: ${c.verses.length}v + ${c.headings.length}h`);
    } catch (err) {
      failed++;
      console.error(`  [${n}/${end}] ${book.usfm} ${n}: FAILED — ${err instanceof Error ? err.message : err}`);
    }
    // Save incrementally so a crash doesn't lose work.
    await writeFile(outFile, JSON.stringify({ usfm: book.usfm, source: args.source, chapters }, null, 2), 'utf8');
    if (n < end && args.source !== 'deutero') await sleep(args.delayMs);
  }

  console.log(`\nDone: ${succeeded} new, ${failed} failed, ${Object.keys(chapters).length}/${book.chapter_count} total`);
  console.log(`Wrote ${outFile}`);
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
