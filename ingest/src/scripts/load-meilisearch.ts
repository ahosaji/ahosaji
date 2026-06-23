/**
 * Index all snapshots into Meilisearch as `verses_en` and `verses_ar`.
 *
 * Idempotent: deletes and recreates the indexes for a clean state.
 *
 * Document shape (per verse):
 *   {
 *     id: 'en:JHN.3.16',
 *     translation, ref, book, chapter, verse,
 *     book_name, testament, canon, book_group, book_order,
 *     text, normalized_text,
 *     heading
 *   }
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MeiliSearch } from 'meilisearch';
import { env } from '../env.js';
import { normalizeArabic } from '../lib/arabic.js';
import type { Chapter } from '../types/canonical.js';

const SNAP_DIR = resolve(import.meta.dirname, '../../data/snapshots');

interface BookMeta {
  usfm: string;
  name_en: string;
  name_ar: string;
  testament: 'OT' | 'NT';
  canon: 'protocanonical' | 'deuterocanonical';
  book_order: number;
  book_group: string;
}

// Books registry loaded from ingest/data/shared/books.json at startup.
const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');
let BOOKS: Record<string, BookMeta> = {};

interface SearchDoc {
  id: string;
  translation: string;
  ref: string;
  book: string;
  chapter: number;
  verse: number;
  book_name: string;
  testament: string;
  canon: string;
  book_group: string;
  book_order: number;
  text: string;
  normalized_text: string;
  heading: string | null;
}

async function findSnapshots(): Promise<Array<{ translation: string; usfm: string; path: string }>> {
  const out: Array<{ translation: string; usfm: string; path: string }> = [];
  for (const lang of await readdir(SNAP_DIR, { withFileTypes: true })) {
    if (!lang.isDirectory()) continue;
    const dir = resolve(SNAP_DIR, lang.name);
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue;
      out.push({ translation: lang.name, usfm: f.replace(/\.json$/, ''), path: resolve(dir, f) });
    }
  }
  return out;
}

function chaptersFromFile(raw: unknown, fallbackTranslation: string, fallbackUsfm: string): Chapter[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const o = raw as Record<string, unknown>;
  const out: Chapter[] = [];
  if ('chapters' in o && typeof o.chapters === 'object' && o.chapters !== null) {
    for (const c of Object.values(o.chapters as Record<string, Chapter>)) {
      if (c && c.verses) {
        out.push({ ...c, translation: c.translation ?? fallbackTranslation, book: c.book ?? fallbackUsfm });
      }
    }
    return out;
  }
  if ('verses' in o) {
    const c = o as unknown as Chapter;
    return [{ ...c, translation: c.translation ?? fallbackTranslation, book: c.book ?? fallbackUsfm }];
  }
  return [];
}

async function main(): Promise<void> {
  if (!env.meilisearchHost) throw new Error('MEILISEARCH_HOST not set');
  if (!env.meilisearchMasterKey) throw new Error('MEILISEARCH_MASTER_KEY not set');

  // Load books registry
  const booksData = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: BookMeta[] };
  for (const b of booksData.books) BOOKS[b.usfm] = b;

  const client = new MeiliSearch({ host: env.meilisearchHost, apiKey: env.meilisearchMasterKey });

  // Build per-language doc batches
  const buckets = new Map<string, SearchDoc[]>();
  for (const s of await findSnapshots()) {
    const raw = JSON.parse(await readFile(s.path, 'utf8'));
    const chapters = chaptersFromFile(raw, s.translation, s.usfm);
    for (const c of chapters) {
      const meta = BOOKS[c.book];
      if (!meta) { console.warn(`skipping chapter ${c.book}.${c.chapter}: book not in registry`); continue; }
      const headingByVerse = new Map<number, string>();
      for (const h of c.headings ?? []) headingByVerse.set(h.beforeVerse, h.text);

      const lang = c.translation;
      if (!buckets.has(lang)) buckets.set(lang, []);
      const docs = buckets.get(lang)!;

      for (const v of c.verses) {
        docs.push({
          id: `${lang}_${v.book}_${v.chapter}_${v.verse}`,
          translation: lang,
          ref: v.ref ?? `${v.book}.${v.chapter}.${v.verse}`,
          book: v.book,
          chapter: v.chapter,
          verse: v.verse,
          book_name: lang === 'ar' ? meta.name_ar : meta.name_en,
          testament: meta.testament,
          canon: meta.canon,
          book_group: meta.book_group,
          book_order: meta.book_order,
          text: v.text,
          normalized_text: lang === 'ar' ? normalizeArabic(v.text) : v.text,
          heading: headingByVerse.get(v.verse) ?? null,
        });
      }
    }
  }

  for (const lang of buckets.keys()) {
    const indexName = `verses_${lang}`;
    console.log(`\nIndex ${indexName}:`);

    // Recreate cleanly
    try { await client.deleteIndex(indexName).then(t => client.waitForTask(t.taskUid)); }
    catch { /* not present, ignore */ }
    await client.createIndex(indexName, { primaryKey: 'id' }).then(t => client.waitForTask(t.taskUid));

    const idx = client.index<SearchDoc>(indexName);
    // Stop-words are language-specific. The Arabic definite article "ال" and
    // common particles drag down precision when used as standalone tokens
    // (the "العلي" over-match issue we saw during slice-5 search testing).
    const ARABIC_STOPWORDS = [
      'ال', 'و', 'ف', 'ب', 'ل', 'ك', 'هو', 'هي', 'هم',
      'أن', 'إن', 'أنا', 'أنت', 'هذا', 'هذه', 'ذلك', 'تلك',
      'في', 'من', 'إلى', 'على', 'عن', 'مع',
    ];
    const ENGLISH_STOPWORDS = [
      'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
      'this', 'that', 'these', 'those', 'it', 'its',
    ];

    await idx.updateSettings({
      searchableAttributes: ['text', 'normalized_text', 'heading', 'book_name'],
      filterableAttributes: ['book', 'testament', 'canon', 'book_group'],
      sortableAttributes: ['book_order', 'chapter', 'verse'],
      stopWords: lang === 'ar' ? ARABIC_STOPWORDS : ENGLISH_STOPWORDS,
      typoTolerance: {
        enabled: true,
        // Raise thresholds so 3-4 letter Arabic prefixes don't typo-match unrelated tokens.
        minWordSizeForTypos: { oneTypo: 6, twoTypos: 10 },
      },
    }).then(t => client.waitForTask(t.taskUid, { timeOutMs: 120_000 }));

    const docs = buckets.get(lang)!;
    const r = await idx.addDocuments(docs);
    // Large batches (~35k verses) index well past the client's default 5s wait.
    await client.waitForTask(r.taskUid, { timeOutMs: 120_000 });
    const stats = await idx.getStats();
    console.log(`  ✓ ${docs.length} docs indexed; numberOfDocuments=${stats.numberOfDocuments}`);
  }
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
