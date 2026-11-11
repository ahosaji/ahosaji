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
import { readFile } from 'node:fs/promises';
import { collectChapters, completenessExitCode, atomicWrite } from '../lib/scrapeRun.js';
import { validateSnapshot } from '../validate.js';
import { resolve } from 'node:path';
import { env } from '../env.js';
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
  allowPartial?: boolean;
  pdfPath?: string;
  manifestPath?: string;
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
    else if (a[i] === '--pdf') args.pdfPath = a[++i];
    else if (a[i] === '--manifest') args.manifestPath = a[++i];
    else if (a[i] === '--allow-partial') args.allowPartial = true;
    else if (a[i] !== '--') throw new Error(`Unknown option: ${a[i]}`);
  }
  if (!args.usfm) throw new Error('--usfm required');
  if (!['arabic','source','deutero'].includes(args.source)) throw new Error('Invalid --source');
  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) throw new Error('--delay must be a finite nonnegative number');
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
      version: env.sourceVersion,
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
      pdfPath: args.pdfPath,
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

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > book.chapter_count) throw new Error('Invalid chapter range');
  const lang = languageOf(args.source);
  const outFile = resolve(SNAP_DIR, lang, `${book.usfm}.json`);
  let existing: Record<string, Chapter> = {};
  try {
    const prior: unknown = JSON.parse(await readFile(outFile, 'utf8'));
    const checked = validateSnapshot(outFile, prior, { translation: lang, usfm: book.usfm, chapterCount: book.chapter_count }, { allowPartial: true });
    if (!checked.ok) throw new Error(`Invalid cached snapshot: ${checked.errors.join('; ')}`);
    existing = Object.fromEntries(checked.chapters.map(c => [String(c.chapter), c]));
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const manifestPath = args.manifestPath ?? resolve(SNAP_DIR, '../.manifests', `${lang}-${book.usfm}.json`);
  const result = await collectChapters({ book: book.usfm, translation: lang,
    expected: Array.from({ length: book.chapter_count }, (_, i) => i + 1),
    requested: Array.from({ length: end - start + 1 }, (_, i) => start + i), cached: existing,
    scrape: async n => { if (n > start && args.source !== 'deutero') await sleep(args.delayMs); return scrapeChapter(args, book, n); },
    save: async (chapters, manifest) => {
      if (Object.keys(chapters).length) await atomicWrite(outFile, JSON.stringify({ usfm: book.usfm, source: args.source, chapters }, null, 2));
      await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    },
  });
  await atomicWrite(manifestPath, JSON.stringify(result.manifest, null, 2));
  console.log(JSON.stringify(result.manifest, null, 2));
  process.exitCode = completenessExitCode(result.manifest, args.allowPartial);
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
