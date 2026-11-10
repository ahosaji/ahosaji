import { mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Chapter } from '../types/canonical.js';
import { validateChapter } from '../validate.js';
export interface ChapterManifest { kind: 'chapters'; book: string; translation: string; expected: number[]; requested: number[]; cached: number[]; succeeded: number[]; failed: Array<{ chapter: number; error: string }>; missing: number[]; complete: boolean; finishedAt: string }
export interface BookManifest { kind: 'books'; requested: string[]; succeeded: string[]; failed: Array<{ book: string; error: string }>; complete: boolean; finishedAt: string }
export const completenessExitCode = (manifest: { complete: boolean }, allowPartial = false): number => manifest.complete || allowPartial ? 0 : 1;
export function checkChapter(chapter: Chapter, book: string, translation: string, number: number): void {
  const checked = validateChapter(`${book}.${number}`, chapter);
  if (!checked.ok || chapter.book !== book || chapter.translation !== translation || chapter.chapter !== number) throw new Error(`Chapter validation failed ${book}.${number}: ${checked.errors.join('; ') || 'identity mismatch'}`);
}
export async function collectChapters(options: { book: string; translation: string; expected: number[]; requested: number[]; cached: Record<string, Chapter>; scrape(n: number): Promise<Chapter>; save?(chapters: Record<string, Chapter>, manifest: ChapterManifest): Promise<void> }): Promise<{ chapters: Record<string, Chapter>; manifest: ChapterManifest }> {
  const chapters = { ...options.cached };
  for (const [key, chapter] of Object.entries(chapters)) {
    try { checkChapter(chapter, options.book, options.translation, Number(key)); } catch (error) { throw new Error(`Invalid cached chapter ${key}: ${String(error)}`); }
  }
  const manifest: ChapterManifest = { kind: 'chapters', book: options.book, translation: options.translation, expected: options.expected, requested: options.requested, cached: [], succeeded: [], failed: [], missing: [], complete: false, finishedAt: '' };
  const finish = () => { manifest.missing = options.expected.filter(n => !chapters[n]); manifest.complete = !manifest.failed.length && !manifest.missing.length; manifest.finishedAt = new Date().toISOString(); };
  for (const n of options.requested) {
    if (chapters[n]) manifest.cached.push(n);
    else {
      try { const chapter = await options.scrape(n); checkChapter(chapter, options.book, options.translation, n); chapters[n] = chapter; manifest.succeeded.push(n); }
      catch (error) { manifest.failed.push({ chapter: n, error: error instanceof Error ? error.message : String(error) }); }
    }
    finish(); await options.save?.(chapters, manifest);
  }
  finish(); return { chapters, manifest };
}
export async function collectBooks(books: string[], run: (book: string) => Promise<number>): Promise<BookManifest> {
  const result: BookManifest = { kind: 'books', requested: books, succeeded: [], failed: [], complete: false, finishedAt: '' };
  for (const book of books) {
    try { const code = await run(book); if (code !== 0) throw new Error(`child exited ${code}`); result.succeeded.push(book); }
    catch (error) { result.failed.push({ book, error: error instanceof Error ? error.message : String(error) }); }
  }
  result.complete = result.failed.length === 0 && result.requested.length > 0;
  result.finishedAt = new Date().toISOString(); return result;
}
export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
