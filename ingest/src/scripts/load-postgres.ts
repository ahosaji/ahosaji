/**
 * Load all snapshots from ingest/data/snapshots/{ar,en}/ into Postgres.
 *
 * Idempotent: uses ON CONFLICT to upsert. Re-running replaces verse content
 * with the latest snapshot for the same (translation, book, chapter, verse).
 *
 * Snapshot file formats supported:
 *   1. Multi-chapter (preferred, written by scrape-book.ts):
 *        { usfm, source, chapters: { "<n>": Chapter, ... } }
 *   2. Single-chapter (legacy):  Chapter object directly
 *
 * Books and translations are loaded from ingest/data/shared/books.json.
 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import pg from 'pg';
import { env } from '../env.js';
import type { Chapter } from '../types/canonical.js';

const { Pool } = pg;

const SNAP_DIR = resolve(import.meta.dirname, '../../data/snapshots');
const BOOKS_PATH = resolve(import.meta.dirname, '../../data/shared/books.json');
const CR_DIR = resolve(import.meta.dirname, '../../data/shared/crossrefs');

const TRANSLATIONS = [
  { code: 'en', name: 'English', language: 'en', source: 'English', copyright: '', versification: 'masoretic+rahlfs' },
  { code: 'ar', name: 'Arabic', language: 'ar', source: 'an Arabic source', copyright: '', versification: 'vulgate' },
];

interface BookMeta {
  usfm: string;
  name_en: string;
  name_ar: string;
  testament: string;
  canon: string;
  book_order: number;
  chapter_count: number;
  book_group?: string;
}

async function loadBooks(): Promise<BookMeta[]> {
  const data = JSON.parse(await readFile(BOOKS_PATH, 'utf8')) as { books: BookMeta[] };
  return data.books;
}

interface Found { translation: string; usfm: string; path: string; }

async function findSnapshots(): Promise<Found[]> {
  const out: Found[] = [];
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

function chaptersFromFile(raw: unknown): Chapter[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const o = raw as Record<string, unknown>;
  if ('chapters' in o && typeof o.chapters === 'object' && o.chapters !== null) {
    return Object.values(o.chapters as Record<string, Chapter>).filter(c => c && (c as Chapter).verses);
  }
  // Legacy single-chapter format
  if ('verses' in o) return [o as unknown as Chapter];
  return [];
}

interface CrossRefFile { refs: Array<{ from: string; to: string[] }> }

async function loadCrossRefs(): Promise<Array<{ from: string; to: string }>> {
  const out: Array<{ from: string; to: string }> = [];
  let files: string[] = [];
  try { files = await readdir(CR_DIR); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(await readFile(resolve(CR_DIR, f), 'utf8')) as CrossRefFile;
    for (const entry of data.refs ?? []) for (const to of entry.to) out.push({ from: entry.from, to });
  }
  return out;
}

/**
 * Insert rows in chunked multi-row INSERTs to minimize round-trips (critical
 * when loading over a high-latency link). Param count per chunk stays well
 * under Postgres' 65535 limit.
 */
async function batchInsert(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflict: string,
  chunkSize = 800,
): Promise<void> {
  if (rows.length === 0) return;
  const ncol = columns.length;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row, r) => {
      values.push(...row);
      return `(${columns.map((_, c) => `$${r * ncol + c + 1}`).join(',')})`;
    });
    await client.query(
      `INSERT INTO ${table}(${columns.join(', ')}) VALUES ${tuples.join(',')} ${conflict}`,
      values,
    );
  }
}

/** Keep only the last row per conflict key (matches per-row upsert semantics,
 *  and avoids "ON CONFLICT cannot affect row a second time" within a batch). */
function dedupeByKey(rows: unknown[][], keyIdx: number[]): unknown[][] {
  const map = new Map<string, unknown[]>();
  for (const row of rows) map.set(keyIdx.map((i) => String(row[i])).join(' '), row);
  return [...map.values()];
}

async function main(): Promise<void> {
  if (!env.databaseUrl) throw new Error('DATABASE_URL not set');
  const pool = new Pool({ connectionString: env.databaseUrl, keepAlive: true, keepAliveInitialDelayMillis: 5000, connectionTimeoutMillis: 30000 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const t of TRANSLATIONS) {
      await client.query(
        `INSERT INTO translations(code, name, language, source, copyright, versification)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           name = EXCLUDED.name, language = EXCLUDED.language,
           source = EXCLUDED.source, copyright = EXCLUDED.copyright,
           versification = EXCLUDED.versification`,
        [t.code, t.name, t.language, t.source, t.copyright, t.versification],
      );
    }
    console.log(`  ✓ translations: ${TRANSLATIONS.length}`);

    const books = await loadBooks();
    for (const b of books) {
      await client.query(
        `INSERT INTO books(usfm, name_en, name_ar, testament, canon, book_order, chapter_count, book_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (usfm) DO UPDATE SET
           name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
           testament = EXCLUDED.testament, canon = EXCLUDED.canon,
           book_order = EXCLUDED.book_order, chapter_count = EXCLUDED.chapter_count,
           book_group = EXCLUDED.book_group`,
        [b.usfm, b.name_en, b.name_ar, b.testament, b.canon, b.book_order, b.chapter_count, b.book_group ?? null],
      );
    }
    console.log(`  ✓ books:        ${books.length}`);

    const snapshots = await findSnapshots();
    let totalVerses = 0;
    let totalHeadings = 0;
    let totalChapters = 0;
    for (const s of snapshots) {
      const raw = JSON.parse(await readFile(s.path, 'utf8'));
      const chapters = chaptersFromFile(raw);
      // Wipe existing rows for this (translation, book) BEFORE re-inserting.
      // Without this, verses that disappear between snapshots (e.g. when
      // an extractor regression is fixed and produces fewer verses than the
      // previous broken run) remain as orphaned rows. The upsert path only
      // updates rows it touches.
      await client.query(
        `DELETE FROM verses WHERE translation = $1 AND book = $2`,
        [s.translation, s.usfm],
      );
      await client.query(
        `DELETE FROM headings WHERE translation = $1 AND book = $2`,
        [s.translation, s.usfm],
      );
      const verseRows: unknown[][] = [];
      const headingRows: unknown[][] = [];
      for (const c of chapters) {
        totalChapters++;
        for (const v of c.verses) {
          verseRows.push([c.translation ?? s.translation, c.book ?? s.usfm, c.chapter, v.verse, v.text, JSON.stringify(v.structured)]);
        }
        for (const h of c.headings ?? []) {
          headingRows.push([c.translation ?? s.translation, c.book ?? s.usfm, c.chapter, h.beforeVerse, h.text, h.level]);
        }
      }
      await batchInsert(client, 'verses',
        ['translation', 'book', 'chapter', 'verse', 'text', 'structured'], dedupeByKey(verseRows, [0, 1, 2, 3]),
        'ON CONFLICT (translation, book, chapter, verse) DO UPDATE SET text = EXCLUDED.text, structured = EXCLUDED.structured');
      await batchInsert(client, 'headings',
        ['translation', 'book', 'chapter', 'before_verse', 'text', 'level'], dedupeByKey(headingRows, [0, 1, 2, 3]),
        'ON CONFLICT (translation, book, chapter, before_verse) DO UPDATE SET text = EXCLUDED.text, level = EXCLUDED.level');
      totalVerses += verseRows.length;
      totalHeadings += headingRows.length;
      console.log(`    ${relative(process.cwd(), s.path)}: ${chapters.length} chapter(s), ${chapters.reduce((n, c) => n + c.verses.length, 0)} verses`);
    }
    console.log(`  ✓ chapters:     ${totalChapters}`);
    console.log(`  ✓ verses:       ${totalVerses}`);
    console.log(`  ✓ headings:     ${totalHeadings}`);

    const crs = await loadCrossRefs();
    await batchInsert(client, 'cross_refs', ['from_ref', 'to_ref'],
      crs.map(cr => [cr.from, cr.to]), 'ON CONFLICT DO NOTHING');
    console.log(`  ✓ cross_refs:   ${crs.length}`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\n✓ load complete');
}

main().catch(err => { console.error('FAILED:', err); process.exitCode = 1; });
