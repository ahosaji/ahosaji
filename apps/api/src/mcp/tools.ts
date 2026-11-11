/**
 * MCP tool implementations. Each tool wraps a small SQL or Meilisearch
 * call against the same data layer the REST/GraphQL routes use.
 */
import { pool } from '../db.js';
import { getQueryClient } from '../lib/searchClient.js';
import { normalizeArabic } from '../lib/arabic.js';
import { buildMeiliFilter } from '../lib/meiliFilter.js';
import { parseRef } from '../refs.js';
import { queryParallel } from '../lib/parallelService.js';

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
      additionalProperties: false,
      properties: { translation: { type: 'string', minLength: 1, maxLength: 1024, description: 'Translation code (en|ar)' } },
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
      additionalProperties: false,
      properties: {
        translation: { type: 'string', minLength: 1, maxLength: 1024 },
        ref: { type: 'string', minLength: 1, maxLength: 1024, description: 'USFM ref like JHN.3.16' },
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
      additionalProperties: false,
      properties: {
        translation: { type: 'string', minLength: 1, maxLength: 1024 },
        book: { type: 'string', minLength: 1, maxLength: 1024, description: 'USFM book code' },
        chapter: { type: 'integer', minimum: 1, maximum: 1000 },
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
      additionalProperties: false,
      properties: {
        translation: { type: 'string', minLength: 1, maxLength: 1024 },
        start: { type: 'string', minLength: 1, maxLength: 1024, description: 'Start ref (USFM)' },
        end: { type: 'string', minLength: 1, maxLength: 1024, description: 'End ref (USFM, same book)' },
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
      additionalProperties: false,
      properties: {
        translations: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1024 }, minItems: 1, maxItems: 10 },
        ref: { type: 'string', minLength: 1, maxLength: 1024 },
        start: { type: 'string', minLength: 1, maxLength: 1024 },
        end: { type: 'string', minLength: 1, maxLength: 1024 },
        prefer_aligned: {
          type: 'boolean',
          description: 'Versification anchor mode: the first translation anchors and others show their mapped equivalent.',
        },
      },
      required: ['translations'],
    },
    handler: async (args: { translations: string[]; ref?: string; start?: string; end?: string; prefer_aligned?: boolean }) => {
      const resolved = await queryParallel(pool, { ...args, preferAligned: args.prefer_aligned });

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
      additionalProperties: false,
      properties: {
        translation: { type: 'string', minLength: 1, maxLength: 1024 },
        q: { type: 'string', minLength: 1, maxLength: 1024, description: 'search query' },
        book: { type: 'string', minLength: 1, maxLength: 1024, description: 'optional USFM book filter' },
        testament: { type: 'string', minLength: 1, maxLength: 1024, enum: ['OT', 'NT'] },
        canon: { type: 'string', minLength: 1, maxLength: 1024, enum: ['protocanonical', 'deuterocanonical'] },
        limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
      },
      required: ['translation', 'q'],
    },
    handler: async (args: { translation: string; q: string; book?: string; testament?: string; canon?: string; limit?: number }) => {
      const idx = getQueryClient().index(`verses_${args.translation}`);
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
