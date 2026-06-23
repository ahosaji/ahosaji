/**
 * MCP tool implementations. Each tool wraps a small SQL or Meilisearch
 * call against the same data layer the REST/GraphQL routes use.
 */
import { MeiliSearch } from 'meilisearch';
import { pool } from '../db.js';
import { env } from '../env.js';
import { normalizeArabic } from '../lib/arabic.js';
import { buildMeiliFilter } from '../lib/meiliFilter.js';
import { parseRef, type ParsedRef } from '../refs.js';
import { resolveParallel } from '../lib/parallelService.js';

let meili: MeiliSearch | null = null;
function getMeili(): MeiliSearch {
  // Query path uses the scoped search-only key (falls back to master in dev).
  if (!meili) meili = new MeiliSearch({ host: env.meilisearchHost, apiKey: env.meilisearchSearchKey || env.meilisearchMasterKey });
  return meili;
}

/** Tool registry — name → JSON Schema definition + handler */
export const TOOLS = [
  {
    name: 'list_translations',
    description: 'List all Bible translations available in Ahosaji (currently English English+English and Arabic Arabic).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const r = await pool.query(
        `SELECT code, name, language, source, versification FROM translations ORDER BY code`,
      );
      return r.rows;
    },
  },
  {
    name: 'list_books',
    description: 'List all books available for a given translation, with USFM codes and metadata.',
    inputSchema: {
      type: 'object',
      properties: { translation: { type: 'string', description: 'Translation code (en|ar)' } },
      required: ['translation'],
    },
    handler: async (args: { translation: string }) => {
      const r = await pool.query(
        `SELECT b.usfm, b.name_en, b.name_ar, b.testament, b.canon, b.book_order, b.chapter_count, b.book_group,
                COUNT(v.*) AS verse_count
           FROM books b
           LEFT JOIN verses v ON v.book = b.usfm AND v.translation = $1
           GROUP BY b.usfm, b.name_en, b.name_ar, b.testament, b.canon, b.book_order, b.chapter_count, b.book_group
           ORDER BY b.book_order`,
        [args.translation],
      );
      return r.rows;
    },
  },
  {
    name: 'get_verse',
    description: 'Fetch a single verse by USFM reference (e.g. JHN.3.16).',
    inputSchema: {
      type: 'object',
      properties: {
        translation: { type: 'string' },
        ref: { type: 'string', description: 'USFM ref like JHN.3.16' },
      },
      required: ['translation', 'ref'],
    },
    handler: async (args: { translation: string; ref: string }) => {
      const p = parseRef(args.ref);
      if (!p) throw new Error(`invalid ref: ${args.ref}`);
      const r = await pool.query(
        `SELECT v.ref, v.book, v.chapter, v.verse, v.text, v.structured,
                array(SELECT to_ref FROM cross_refs WHERE from_ref = v.ref ORDER BY to_ref) AS cross_refs
           FROM verses v
           WHERE v.translation = $1 AND v.book = $2 AND v.chapter = $3 AND v.verse = $4`,
        [args.translation, p.book, p.chapter, p.verse],
      );
      const row = r.rows[0];
      if (!row) throw new Error(`${args.ref} not found in ${args.translation}`);
      return {
        ref: row.ref,
        book: row.book,
        chapter: row.chapter,
        verse: row.verse,
        text: row.text,
        structured: { ...row.structured, crossRefs: row.cross_refs ?? [] },
      };
    },
  },
  {
    name: 'get_chapter',
    description: 'Fetch a whole chapter with verses and section headings.',
    inputSchema: {
      type: 'object',
      properties: {
        translation: { type: 'string' },
        book: { type: 'string', description: 'USFM book code' },
        chapter: { type: 'integer' },
      },
      required: ['translation', 'book', 'chapter'],
    },
    handler: async (args: { translation: string; book: string; chapter: number }) => {
      const v = await pool.query(
        `SELECT verse, ref, text, structured FROM verses
           WHERE translation = $1 AND book = $2 AND chapter = $3 ORDER BY verse`,
        [args.translation, args.book, args.chapter],
      );
      const h = await pool.query(
        `SELECT before_verse AS "beforeVerse", text, level FROM headings
           WHERE translation = $1 AND book = $2 AND chapter = $3 ORDER BY before_verse`,
        [args.translation, args.book, args.chapter],
      );
      return { translation: args.translation, book: args.book, chapter: args.chapter, verses: v.rows, headings: h.rows };
    },
  },
  {
    name: 'get_passage',
    description: 'Fetch a verse range across chapters within a single book (e.g. JHN.3.16 to JHN.4.2).',
    inputSchema: {
      type: 'object',
      properties: {
        translation: { type: 'string' },
        start: { type: 'string', description: 'Start ref (USFM)' },
        end: { type: 'string', description: 'End ref (USFM, same book)' },
      },
      required: ['translation', 'start', 'end'],
    },
    handler: async (args: { translation: string; start: string; end: string }) => {
      const s = parseRef(args.start);
      const e = parseRef(args.end);
      if (!s || !e) throw new Error('invalid start/end ref');
      if (s.book !== e.book) throw new Error('cross-book passages not supported in v1');
      const r = await pool.query(
        `SELECT verse, chapter, ref, text, structured FROM verses
           WHERE translation = $1 AND book = $2
             AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
             AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
           ORDER BY chapter, verse`,
        [args.translation, s.book, s.chapter, s.verse, e.chapter, e.verse],
      );
      return { translation: args.translation, book: s.book, start: args.start, end: args.end, verses: r.rows };
    },
  },
  {
    name: 'get_parallel',
    description: 'Fetch the same verse (or range) across multiple translations side-by-side. Each entry has present:bool. Surfaces cross-translation textual divergences in Deuterocanonicals.',
    inputSchema: {
      type: 'object',
      properties: {
        translations: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
        ref: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        prefer_aligned: {
          type: 'boolean',
          description: 'Versification anchor mode: the first translation anchors and others show their mapped equivalent.',
        },
      },
      required: ['translations'],
    },
    handler: async (args: { translations: string[]; ref?: string; start?: string; end?: string; prefer_aligned?: boolean }) => {
      const refs: ParsedRef[] = [];
      if (args.ref) {
        const p = parseRef(args.ref);
        if (!p) throw new Error('invalid ref');
        refs.push(p);
      } else if (args.start && args.end) {
        const s = parseRef(args.start);
        const e = parseRef(args.end);
        if (!s || !e || s.book !== e.book) throw new Error('invalid start/end or cross-book range');
        const r = await pool.query(
          `SELECT DISTINCT chapter, verse FROM verses
             WHERE book = $1 AND translation = ANY($2::text[])
               AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
               AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
             ORDER BY chapter, verse`,
          [s.book, args.translations, s.chapter, s.verse, e.chapter, e.verse],
        );
        for (const row of r.rows) refs.push({ book: s.book, chapter: row.chapter as number, verse: row.verse as number });
      } else {
        throw new Error('either ref OR (start AND end) is required');
      }

      // Shared resolution (identity + versification mapping + prefer_aligned).
      const resolved = await resolveParallel(pool, args.translations, refs, args.prefer_aligned ?? false);

      return {
        refs: resolved.map(r => ({
          ref: r.ref,
          translations: r.entries.map(e => {
            const entry: Record<string, unknown> = { translation: e.translation, present: e.present, text: e.text };
            if (e.mappedTo !== undefined) entry.mapped_to = e.mappedTo;
            if (e.mappingNote !== undefined) entry.mapping_note = e.mappingNote;
            return entry;
          }),
        })),
      };
    },
  },
  {
    name: 'search_bible',
    description: 'Full-text search across one translation. Arabic queries are normalized server-side (tashkeel and alif unified). Returns hits with formatted (highlighted) snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        translation: { type: 'string' },
        q: { type: 'string', description: 'search query' },
        book: { type: 'string', description: 'optional USFM book filter' },
        testament: { type: 'string', enum: ['OT', 'NT'] },
        canon: { type: 'string', enum: ['protocanonical', 'deuterocanonical'] },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
      required: ['translation', 'q'],
    },
    handler: async (args: { translation: string; q: string; book?: string; testament?: string; canon?: string; limit?: number }) => {
      const idx = getMeili().index(`verses_${args.translation}`);
      // Validated + escaped to prevent Meilisearch filter injection.
      const filter = buildMeiliFilter({ book: args.book, testament: args.testament, canon: args.canon });
      const queryText = args.translation === 'ar' ? normalizeArabic(args.q) : args.q;
      const res = await idx.search(queryText, {
        limit: args.limit ?? 20,
        filter,
        attributesToHighlight: ['text', 'normalized_text'],
        attributesToRetrieve: ['ref', 'book', 'chapter', 'verse', 'text', 'heading'],
        highlightPreTag: '**', highlightPostTag: '**',
      });
      return {
        query: args.q,
        translation: args.translation,
        total: (res as { estimatedTotalHits?: number }).estimatedTotalHits ?? null,
        hits: res.hits.map(h => {
          const formatted = (h as Record<string, unknown>)['_formatted'] as Record<string, string> | undefined;
          return { ref: h.ref, text: h.text, formatted: formatted?.text ?? h.text };
        }),
      };
    },
  },
] as const;

export type ToolDef = (typeof TOOLS)[number];
