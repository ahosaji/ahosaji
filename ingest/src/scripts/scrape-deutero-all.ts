/**
 * Sweep all English Deuterocanonical books via the Python sidecar.
 * Writes ingest/data/snapshots/en/<USFM>.json per book.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../env.js';

const PYTHON_BIN = resolve(import.meta.dirname, '../../python/.venv/bin/python');
const SCRIPT = resolve(import.meta.dirname, '../../python/scrape_deutero_book.py');
const OUT_DIR = resolve(import.meta.dirname, '../../data/snapshots/en');
const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');

interface Book {
  usfm: string;
  name_en: string;
  canon: string;
  chapter_count: number;
}

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res, rej) => {
    const child = spawn(PYTHON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', rej);
    child.on('close', code => res({ stdout, stderr, code: code ?? -1 }));
  });
}

async function main(): Promise<void> {
  if (!env.deuteroPdfPath) throw new Error('English_PDF_PATH not set');
  await mkdir(OUT_DIR, { recursive: true });

  const reg = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: Book[] };
  const deuteros = reg.books.filter(b => b.canon === 'deuterocanonical');
  console.log(`Sweeping ${deuteros.length} Deuterocanonical books from English...\n`);

  for (const b of deuteros) {
    process.stdout.write(`▶ ${b.usfm} (${b.name_en}, ${b.chapter_count} ch)\n`);
    const { stdout, stderr, code } = await run([
      SCRIPT,
      '--pdf', env.deuteroPdfPath,
      '--usfm', b.usfm,
      '--max-chapters', String(b.chapter_count),
    ]);
    // Surface per-chapter progress from stderr
    if (stderr) console.log(stderr.split('\n').filter(l => l.trim()).map(l => '   ' + l).join('\n'));
    if (code !== 0) {
      console.log(`   ✗ exit ${code}, skipping\n`);
      continue;
    }
    const outFile = resolve(OUT_DIR, `${b.usfm}.json`);
    await writeFile(outFile, stdout, 'utf8');
    let chapterCount = 0;
    let verseCount = 0;
    try {
      const parsed = JSON.parse(stdout);
      chapterCount = Object.keys(parsed.chapters ?? {}).length;
      for (const ch of Object.values(parsed.chapters ?? {}) as Array<{ verses: unknown[] }>) {
        verseCount += ch.verses?.length ?? 0;
      }
    } catch { /* leave 0 */ }
    console.log(`   ✓ wrote ${outFile} — ${chapterCount} chapters / ${verseCount} verses\n`);
  }
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
