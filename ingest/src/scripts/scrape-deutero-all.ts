/** Bulk PDF extraction with atomic validated snapshots and a per-book completeness manifest. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../env.js';
import { validateSnapshot, isRecord } from '../validate.js';
import { collectBooks, atomicWrite, completenessExitCode } from '../lib/scrapeRun.js';
const VENV_PYTHON = resolve(import.meta.dirname, '../../python/.venv/bin/python');
const SCRIPT = resolve(import.meta.dirname, '../../python/scrape_deutero_book.py');
const OUT_DIR = resolve(import.meta.dirname, '../../data/snapshots/en');
const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');
interface Book { usfm: string; name_en: string; canon: string; chapter_count: number }
function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res, rej) => {
    const child = spawn(env.pythonBin || (existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3'), args, { stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); }); child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', rej); child.on('close', code => res({ stdout, stderr, code: code ?? -1 }));
  });
}
async function main(): Promise<void> {
  let pdf = env.deuteroPdfPath, manifestPath = resolve(OUT_DIR, '../../.manifests/deutero-all.json');
  const argv = process.argv.slice(2), allowPartial = argv.includes('--allow-partial');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pdf') { if (!argv[i + 1] || argv[i + 1]!.startsWith('--')) throw new Error('--pdf requires a path'); pdf = argv[++i]!; }
    else if (argv[i] === '--manifest') { if (!argv[i + 1] || argv[i + 1]!.startsWith('--')) throw new Error('--manifest requires a path'); manifestPath = argv[++i]!; }
    else if (argv[i] !== '--allow-partial' && argv[i] !== '--') throw new Error(`Unknown option: ${argv[i]}`);
  }
  if (!pdf) throw new Error('Provide --pdf or SOURCE_PDF_PATH (English_PDF_PATH is a compatibility alias)');
  const registry = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: Book[] };
  const books = registry.books.filter(b => b.canon === 'deuterocanonical');
  const details: Record<string, unknown> = {};
  const manifest = await collectBooks(books.map(b => b.usfm), async usfm => {
    const book = books.find(b => b.usfm === usfm)!;
    const result = await run([SCRIPT, '--pdf', pdf, '--usfm', usfm, '--max-chapters', String(book.chapter_count), ...(allowPartial ? ['--allow-partial'] : [])]);
    if (result.stderr) console.error(result.stderr);
    let raw: unknown;
    try { raw = JSON.parse(result.stdout); } catch { throw new Error(`Python exited ${result.code}; invalid/empty JSON output`); }
    if (isRecord(raw)) details[usfm] = raw._completeness ?? { error: 'Python omitted completeness metadata' };
    if (result.code !== 0) throw new Error(`Python exited ${result.code}; see chapter failures in books manifest`);
    const file = resolve(OUT_DIR, `${usfm}.json`);
    const checked = validateSnapshot(file, raw, { translation: 'en', usfm, chapterCount: book.chapter_count }, { allowPartial });
    if (!checked.ok) throw new Error(`Invalid Python snapshot: ${checked.errors.join('; ')}`);
    await atomicWrite(file, JSON.stringify(raw, null, 2));
    return isRecord(raw) && isRecord(raw._completeness) && raw._completeness.complete === true ? 0 : 1;
  });
  await atomicWrite(manifestPath, JSON.stringify({ ...manifest, books: details }, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  process.exitCode = completenessExitCode(manifest, allowPartial);
}
main().catch(error => { console.error('FAILED:', error); process.exitCode = 1; });
