import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { env } from '../env.js';
import type { Chapter } from '../types/canonical.js';

export interface DeuteroOpts {
  bookUsfm: string;     // 'TOB'
  chapter: number;
  startPage: number;    // 1-indexed PDF page where chapter content begins
  endPage: number;      // 1-indexed PDF page where chapter content ends (inclusive)
  maxVerse: number;     // upper bound for verse-marker disambiguation
  pdfPath?: string;
}

const VENV_PYTHON = resolve(import.meta.dirname, '../../python/.venv/bin/python');
const SCRIPT_PATH = resolve(import.meta.dirname, '../../python/extract_deutero_chapter.py');

export async function extractDeuteroChapter(opts: DeuteroOpts): Promise<Chapter> {
  const pdfPath = opts.pdfPath || env.deuteroPdfPath;
  if (!pdfPath) {
    throw new Error('Configure SOURCE_PDF_PATH or pass --pdf (English_PDF_PATH remains a compatibility alias)');
  }
  console.log(`  → extracting ${opts.bookUsfm} ${opts.chapter} from PDF pages ${opts.startPage}..${opts.endPage}`);

  const args = [
    SCRIPT_PATH,
    '--pdf', pdfPath,
    '--book-usfm', opts.bookUsfm,
    '--chapter', String(opts.chapter),
    '--start-page', String(opts.startPage),
    '--end-page', String(opts.endPage),
    '--max-verse', String(opts.maxVerse),
  ];

  const { stdout, code } = await runPython(args);
  if (code !== 0) {
    throw new Error(`python sidecar exited with code ${code}`);
  }
  const chapter: Chapter = JSON.parse(stdout);
  if (chapter.verses.length === 0) {
    throw new Error('English extractor returned 0 verses');
  }
  return chapter;
}

function runPython(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res, rej) => {
    const child = spawn(env.pythonBin || (existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3'), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', rej);
    child.on('close', (code) => {
      if (stderr.trim()) console.error('[python stderr]', stderr.trim());
      res({ stdout, stderr, code: code ?? -1 });
    });
  });
}
