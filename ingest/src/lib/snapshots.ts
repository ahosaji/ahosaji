import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isRecord, validateSnapshot, type SnapshotValidation } from '../validate.js';

export interface BookMeta {
  usfm: string; name_en: string; name_ar: string; testament: string; canon: string;
  book_order: number; chapter_count: number; book_group?: string;
}
export interface Corpus {
  books: BookMeta[]; snapshots: Array<SnapshotValidation & { translation: string; usfm: string }>;
  crossRefs: Array<{ from: string; to: string }>; errors: string[]; warnings: string[];
}
export interface CorpusPaths { snapshotsRoot: string; booksPath: string; crossrefsRoot?: string; allowPartial?: boolean }
export const defaultCorpusPaths: CorpusPaths = {
  snapshotsRoot: resolve(import.meta.dirname, '../../data/snapshots'),
  booksPath: resolve(import.meta.dirname, '../../data/shared/books.json'),
  crossrefsRoot: resolve(import.meta.dirname, '../../data/shared/crossrefs'),
};
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const missing = (error: unknown): boolean => isRecord(error) && error.code === 'ENOENT';

/** Read and validate the complete input before consumers create any connections. */
export async function readCorpus(paths: CorpusPaths = defaultCorpusPaths): Promise<Corpus> {
  const corpus: Corpus = { books: [], snapshots: [], crossRefs: [], errors: [], warnings: [] };
  const registry = await readJson(paths.booksPath);
  if (!isRecord(registry) || !Array.isArray(registry.books) || !registry.books.length) throw new Error('Corpus validation: books registry must be non-empty');
  const books = new Map<string, BookMeta>();
  for (const raw of registry.books) {
    if (!isRecord(raw) || typeof raw.usfm !== 'string' || !/^[A-Z0-9]{3}$/.test(raw.usfm)
      || !['name_en', 'name_ar', 'testament', 'canon'].every(k => typeof raw[k] === 'string' && raw[k].trim())
      || !Number.isSafeInteger(raw.chapter_count) || Number(raw.chapter_count) < 1
      || typeof raw.book_order !== 'number' || !Number.isFinite(raw.book_order) || raw.book_order <= 0
      || (raw.book_group !== undefined && typeof raw.book_group !== 'string')) {
      corpus.errors.push('invalid books registry entry'); continue;
    }
    if (books.has(raw.usfm)) corpus.errors.push(`duplicate registry book ${raw.usfm}`);
    const book = raw as unknown as BookMeta; books.set(book.usfm, book); corpus.books.push(book);
  }
  const found = new Set<string>();
  for (const lang of (await readdir(paths.snapshotsRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!lang.isDirectory()) continue;
    const dir = resolve(paths.snapshotsRoot, lang.name);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
      const path = resolve(dir, file), usfm = file.slice(0, -5);
      found.add(`${lang.name}/${usfm}`);
      const meta = books.get(usfm);
      if (!meta) corpus.errors.push(`${path}: book is not in registry`);
      try {
        const checked = validateSnapshot(path, await readJson(path), { translation: lang.name, usfm, chapterCount: meta?.chapter_count }, paths);
        corpus.snapshots.push({ ...checked, translation: lang.name, usfm });
        corpus.errors.push(...checked.errors.map(e => `${path}: ${e}`));
        corpus.warnings.push(...checked.warnings.map(w => `${path}: ${w}`));
      } catch (error) { corpus.errors.push(`${path}: unable to read JSON: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  for (const lang of ['en', 'ar']) for (const book of books.keys()) if (!found.has(`${lang}/${book}`)) {
    const message = `missing snapshot ${lang}/${book}`;
    if (paths.allowPartial) corpus.warnings.push(`${message}; explicit partial import`); else corpus.errors.push(message);
  }
  if (!corpus.snapshots.length) corpus.errors.push('snapshot corpus is empty');
  if (paths.crossrefsRoot) {
    let files: string[] = [];
    try { files = await readdir(paths.crossrefsRoot); } catch (error) { if (!missing(error)) throw error; }
    const ref = /^[A-Z0-9]{3}\.[1-9]\d*\.[1-9]\d*$/;
    for (const file of files.filter(f => f.endsWith('.json')).sort()) {
      const path = resolve(paths.crossrefsRoot, file);
      try {
        const data = await readJson(path);
        if (!isRecord(data) || !Array.isArray(data.refs)) throw new Error('refs must be an array');
        for (const entry of data.refs) {
          if (!isRecord(entry) || typeof entry.from !== 'string' || !ref.test(entry.from) || !Array.isArray(entry.to) || !entry.to.every(to => typeof to === 'string' && ref.test(to))) throw new Error('invalid cross-reference entry');
          for (const to of entry.to) corpus.crossRefs.push({ from: entry.from, to: to as string });
        }
      } catch (error) { corpus.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return corpus;
}
export function assertCorpus(corpus: Corpus): void {
  if (corpus.errors.length || !corpus.snapshots.length || corpus.snapshots.some(s => !s.ok || !s.chapters.length)) throw new Error(`Corpus validation failed before mutation:\n${corpus.errors.join('\n') || 'empty or invalid snapshots'}`);
}
export function printWarnings(corpus: Corpus): void {
  for (const warning of corpus.warnings) console.warn(`WARN: ${warning}`);
  const legacy = new Map<string, number>();
  for (const snapshot of corpus.snapshots) {
    const count = snapshot.warnings.filter(w => w.includes('legacy missing italic')).length;
    if (count) legacy.set(`${snapshot.translation}/${snapshot.usfm}`, count);
  }
  console.warn(`Warnings: ${corpus.warnings.length}; legacy missing italic: ${[...legacy.values()].reduce((a, b) => a + b, 0)} (${[...legacy].map(([book, count]) => `${book}=${count}`).join(', ') || 'none'})`);
}
