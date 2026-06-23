/**
 * GraphQL resolvers — share data-access with REST routes via the same pool
 * and the same shape contract.
 *
 * Where this duplicates REST: in v1 we accept a small bit of redundancy. A
 * v1.x cleanup will lift shared logic into per-domain `service.ts` modules.
 */
import { MeiliSearch } from 'meilisearch';
import { pool } from '../db.js';
import { env } from '../env.js';
import { normalizeArabic } from '../lib/arabic.js';
import { buildMeiliFilter } from '../lib/meiliFilter.js';
import { parseRef, type ParsedRef } from '../refs.js';
import { resolveParallel } from '../lib/parallelService.js';

let mClient: MeiliSearch | null = null;
function getMeili(): MeiliSearch {
  // Query path uses the scoped search-only key (falls back to master in dev).
  if (!mClient) mClient = new MeiliSearch({ host: env.meilisearchHost, apiKey: env.meilisearchSearchKey || env.meilisearchMasterKey });
  return mClient;
}

export const resolvers = {
  Query: {
    async translations() {
      const r = await pool.query(
        `SELECT t.code, t.name, t.language, t.source, t.copyright, t.versification,
                COUNT(DISTINCT v.book) AS book_count,
                COUNT(v.*) AS verse_count
           FROM translations t
           LEFT JOIN verses v ON v.translation = t.code
           GROUP BY t.code, t.name, t.language, t.source, t.copyright, t.versification
           ORDER BY t.code`,
      );
      return r.rows.map(mapTranslation);
    },

    async translation(_: unknown, args: { code: string }) {
      const r = await pool.query(
        `SELECT t.code, t.name, t.language, t.source, t.copyright, t.versification,
                COUNT(DISTINCT v.book) AS book_count,
                COUNT(v.*) AS verse_count
           FROM translations t
           LEFT JOIN verses v ON v.translation = t.code
           WHERE t.code = $1
           GROUP BY t.code, t.name, t.language, t.source, t.copyright, t.versification`,
        [args.code],
      );
      return r.rows[0] ? mapTranslation(r.rows[0]) : null;
    },

    async book(_: unknown, args: { translation: string; usfm: string }) {
      const r = await pool.query(
        `SELECT usfm, name_en, name_ar, testament, canon, book_order, chapter_count, book_group
           FROM books WHERE usfm = $1`,
        [args.usfm],
      );
      return r.rows[0] ? mapBook(r.rows[0]) : null;
    },

    async chapter(_: unknown, args: { translation: string; usfm: string; chapter: number }) {
      const v = await pool.query(
        `SELECT verse, ref, text, structured
           FROM verses WHERE translation = $1 AND book = $2 AND chapter = $3
           ORDER BY verse`,
        [args.translation, args.usfm, args.chapter],
      );
      if (v.rowCount === 0) return null;
      const h = await pool.query(
        `SELECT before_verse, text, level
           FROM headings WHERE translation = $1 AND book = $2 AND chapter = $3
           ORDER BY before_verse`,
        [args.translation, args.usfm, args.chapter],
      );
      return {
        translation: args.translation,
        book: args.usfm,
        chapter: args.chapter,
        verses: v.rows.map(row => mapVerse(row, args.usfm, args.chapter)),
        headings: h.rows.map(row => ({ beforeVerse: row.before_verse, text: row.text, level: row.level })),
      };
    },

    async verse(_: unknown, args: { translation: string; usfm: string; chapter: number; verse: number }) {
      const r = await pool.query(
        `SELECT v.verse, v.ref, v.text, v.structured,
                array(SELECT to_ref FROM cross_refs WHERE from_ref = v.ref ORDER BY to_ref) AS cross_refs_db
           FROM verses v
           WHERE v.translation = $1 AND v.book = $2 AND v.chapter = $3 AND v.verse = $4`,
        [args.translation, args.usfm, args.chapter, args.verse],
      );
      const row = r.rows[0];
      if (!row) return null;
      const verse = mapVerse(row, args.usfm, args.chapter);
      verse.structured.crossRefs = row.cross_refs_db ?? [];
      return verse;
    },

    async verses(_: unknown, args: { translation: string; usfm: string; chapter: number; from: number; to: number }) {
      const r = await pool.query(
        `SELECT verse, ref, text, structured
           FROM verses
           WHERE translation = $1 AND book = $2 AND chapter = $3 AND verse BETWEEN $4 AND $5
           ORDER BY verse`,
        [args.translation, args.usfm, args.chapter, args.from, args.to],
      );
      return r.rows.map(row => mapVerse(row, args.usfm, args.chapter));
    },

    async passage(_: unknown, args: { translation: string; start: string; end: string }) {
      const s = parseRef(args.start);
      const e = parseRef(args.end);
      if (!s || !e || s.book !== e.book) return null;
      const r = await pool.query(
        `SELECT verse, chapter, ref, text, structured
           FROM verses
           WHERE translation = $1 AND book = $2
             AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
             AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
           ORDER BY chapter, verse`,
        [args.translation, s.book, s.chapter, s.verse, e.chapter, e.verse],
      );
      if (r.rowCount === 0) return null;
      return {
        translation: args.translation,
        book: s.book,
        start: args.start,
        end: args.end,
        verses: r.rows.map(row => mapVerse(row, s.book, row.chapter)),
      };
    },

    async parallel(_: unknown, args: { translations: string[]; ref?: string; start?: string; end?: string; preferAligned?: boolean }) {
      let targetRefs: ParsedRef[] = [];
      if (args.ref) {
        const p = parseRef(args.ref);
        if (!p) return null;
        targetRefs = [p];
      } else if (args.start && args.end) {
        const s = parseRef(args.start);
        const e = parseRef(args.end);
        if (!s || !e || s.book !== e.book) return null;
        const r = await pool.query(
          `SELECT DISTINCT chapter, verse
             FROM verses WHERE book = $1 AND translation = ANY($2::text[])
               AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
               AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
             ORDER BY chapter, verse`,
          [s.book, args.translations, s.chapter, s.verse, e.chapter, e.verse],
        );
        targetRefs = r.rows.map(row => ({ book: s.book, chapter: row.chapter as number, verse: row.verse as number }));
      } else {
        return null;
      }

      // Shared resolution (identity + versification mapping + prefer_aligned).
      const resolved = await resolveParallel(pool, args.translations, targetRefs, args.preferAligned ?? false);

      return {
        refs: resolved.map(r => ({
          ref: r.ref,
          translations: r.entries.map(e => ({
            translation: e.translation,
            present: e.present,
            text: e.text,
            // VerseStructured is a single object; N:1 joins yield an array, so
            // expose the first joined verse's structured payload to GraphQL.
            structured: Array.isArray(e.structured) ? (e.structured[0] ?? null) : e.structured,
            mappedTo: e.mappedTo ?? null,
            mappingNote: e.mappingNote ?? null,
          })),
        })),
      };
    },

    async search(
      _: unknown,
      args: { translation: string; q: string; filters?: { book?: string; testament?: string; canon?: string; bookGroup?: string }; limit?: number; offset?: number },
    ) {
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
      const offset = Math.max(args.offset ?? 0, 0);
      // Validated + escaped to prevent Meilisearch filter injection.
      const filter = buildMeiliFilter({
        book: args.filters?.book,
        testament: args.filters?.testament,
        canon: args.filters?.canon,
        bookGroup: args.filters?.bookGroup,
      });

      const idx = getMeili().index(`verses_${args.translation}`);
      const queryText = args.translation === 'ar' ? normalizeArabic(args.q) : args.q;
      const res = await idx.search(queryText, {
        limit,
        offset,
        filter,
        attributesToHighlight: ['text', 'normalized_text', 'heading'],
        attributesToRetrieve: ['ref', 'book', 'chapter', 'verse', 'text', 'heading', 'book_name', 'testament', 'canon'],
        highlightPreTag: '<em>',
        highlightPostTag: '</em>',
      });
      return {
        query: args.q,
        translation: args.translation,
        hits: res.hits.map(h => {
          const formatted = (h as Record<string, unknown>)['_formatted'] as Record<string, string> | undefined;
          return {
            ref: h.ref,
            book: h.book,
            chapter: h.chapter,
            verse: h.verse,
            text: h.text,
            formatted: formatted?.text ?? h.text,
            heading: h.heading ?? null,
            bookName: h.book_name,
            testament: h.testament,
            canon: h.canon,
          };
        }),
        total: (res as { estimatedTotalHits?: number }).estimatedTotalHits ?? null,
        limit,
        offset,
      };
    },
  },
};

function mapTranslation(row: Record<string, unknown>) {
  return {
    code: row.code,
    name: row.name,
    language: row.language,
    source: row.source,
    copyright: row.copyright ?? null,
    versification: row.versification,
    bookCount: row.book_count !== undefined ? Number(row.book_count) : null,
    verseCount: row.verse_count !== undefined ? Number(row.verse_count) : null,
  };
}

function mapBook(row: Record<string, unknown>) {
  return {
    usfm: row.usfm,
    nameEn: row.name_en,
    nameAr: row.name_ar,
    testament: row.testament,
    canon: row.canon,
    bookOrder: row.book_order,
    chapterCount: row.chapter_count,
    bookGroup: row.book_group ?? null,
  };
}

interface VerseRow {
  ref?: string;
  verse: number;
  text: string;
  structured: {
    tokens?: { text: string; italic: boolean; redLetter: boolean }[];
    footnotes?: { marker: string; text: string }[];
    crossRefs?: string[];
    heading?: string | null;
    paragraphStart?: boolean;
    poetic?: boolean;
    poeticLines?: string[] | null;
  };
}

function mapVerse(row: VerseRow, book: string, chapter: number) {
  const s = row.structured ?? {};
  return {
    ref: row.ref ?? `${book}.${chapter}.${row.verse}`,
    book,
    chapter,
    verse: row.verse,
    text: row.text,
    structured: {
      tokens: s.tokens ?? [],
      footnotes: s.footnotes ?? [],
      crossRefs: s.crossRefs ?? [],
      heading: s.heading ?? null,
      paragraphStart: s.paragraphStart ?? false,
      poetic: s.poetic ?? false,
      poeticLines: s.poeticLines ?? null,
    },
  };
}
