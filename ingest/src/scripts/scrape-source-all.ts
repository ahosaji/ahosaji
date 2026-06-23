/**
 * Scrape every book in the registry for a given source.
 *   pnpm scrape:source:all -- --source source   (all books with source_name)
 *   pnpm scrape:source:all -- --source arabic       (all books with source_id)
 *
 * Resume-friendly: per-book scrape-book.ts already skips already-cached
 * chapters. This script just iterates the registry and shells out once per
 * book, writing per-book progress to the same snapshot files.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');
const SCRAPE_BOOK = resolve(import.meta.dirname, 'scrape-book.ts');

interface Book {
  usfm: string;
  name_en: string;
  chapter_count: number;
  source_id?: number;
  source_name?: string;
}

function args(): { source: 'source' | 'arabic'; delay: number; only?: string } {
  const a = process.argv.slice(2);
  const out: { source: 'source' | 'arabic'; delay: number; only?: string } = {
    source: 'source',
    delay: 1200,
  };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--source') out.source = a[++i] as 'source' | 'arabic';
    else if (a[i] === '--delay') out.delay = Number(a[++i]);
    else if (a[i] === '--only') out.only = a[++i];
  }
  if (out.source === 'arabic' && !process.argv.includes('--delay')) out.delay = 600;
  return out;
}

function shouldScrape(book: Book, source: string): boolean {
  if (source === 'source') return Boolean(book.source_name);
  if (source === 'arabic') return Boolean(book.source_id);
  return false;
}

function runOne(args: string[]): Promise<number> {
  return new Promise((res, rej) => {
    const child = spawn('pnpm', ['--filter', '@ahosaji/ingest', 'exec', 'tsx', SCRAPE_BOOK, ...args], {
      stdio: 'inherit',
    });
    child.on('error', rej);
    child.on('close', code => res(code ?? -1));
  });
}

async function main(): Promise<void> {
  const { source, delay, only } = args();
  const reg = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: Book[] };
  const filtered = reg.books.filter(b => shouldScrape(b, source));
  const target = only ? filtered.filter(b => b.usfm === only) : filtered;
  console.log(`\n# scrape-source-all: ${source} — ${target.length} books, est ${Math.round(target.reduce((s, b) => s + b.chapter_count, 0) * (delay / 1000) / 60)} min wall\n`);

  let okBooks = 0;
  let failBooks = 0;
  for (const b of target) {
    console.log(`\n=== ${b.usfm} ${b.name_en} (${b.chapter_count} ch) ===`);
    const code = await runOne(['--source', source, '--usfm', b.usfm, '--delay', String(delay)]);
    if (code === 0) okBooks++;
    else { failBooks++; console.log(`!! ${b.usfm} exited ${code}`); }
  }

  console.log(`\n# done: ${okBooks} ok, ${failBooks} failed (of ${target.length})`);
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
