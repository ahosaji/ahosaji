/**
 * Cross-translation parallel queries (signature feature).
 *
 *   GET /v1/parallel?translations=en,ar&ref=JHN.3.16
 *   GET /v1/parallel?translations=en,ar&start=PSA.23.1&end=PSA.23.6
 *
 * Each translation either has the verse (present:true) or doesn't
 * (present:false). Resolution — identity match, versification mapping for
 * divergent Deuteros, and the prefer_aligned anchor mode — lives in the
 * shared parallelService so REST, GraphQL and MCP behave identically.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { parseRef, type ParsedRef } from '../refs.js';
import { resolveParallel } from '../lib/parallelService.js';

interface ParallelQuery {
  translations?: string;
  ref?: string;
  start?: string;
  end?: string;
  /**
   * Versification-aware mode. When set ("1", "true", "yes"), the FIRST
   * translation in `translations` is treated as the anchor: other
   * translations show their semantic equivalent of the anchor's verse per
   * the versification mapping tables, rather than the identity-numbered
   * verse. Vulgate-only verses correctly surface as `present:false +
   * mapping_note` for translations that don't have an equivalent.
   *
   * Default: off (identity matching wins; mapping only fills in when one
   * side is absent).
   */
  prefer_aligned?: string;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export async function parallelRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ParallelQuery }>(
    '/v1/parallel',
    async (req, reply) => {
      const { translations: translationsParam, ref, start, end, prefer_aligned } = req.query;
      const preferAligned = TRUTHY.has((prefer_aligned ?? '').toLowerCase());
      if (!translationsParam) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'translations query param required (e.g. translations=en,ar)' });
      }
      const translations = translationsParam.split(',').map(s => s.trim()).filter(Boolean);
      if (translations.length === 0) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'translations must list at least one code' });
      }
      // Validate translations exist
      const t = await pool.query(
        `SELECT code FROM translations WHERE code = ANY($1::text[])`,
        [translations],
      );
      const knownCodes = new Set(t.rows.map(r => r.code as string));
      const unknownCodes = translations.filter(c => !knownCodes.has(c));
      if (unknownCodes.length > 0) {
        return reply.code(404).send({ title: 'Not Found', detail: `unknown translation(s): ${unknownCodes.join(', ')}` });
      }

      // Build target refs: either single ref, or expand range start..end
      let targetRefs: ParsedRef[] = [];
      if (ref) {
        const p = parseRef(ref);
        if (!p) return reply.code(400).send({ title: 'Bad Request', detail: 'ref must be a USFM ref (e.g. JHN.3.16)' });
        targetRefs = [p];
      } else if (start && end) {
        const s = parseRef(start);
        const e = parseRef(end);
        if (!s || !e) return reply.code(400).send({ title: 'Bad Request', detail: 'start/end must be USFM refs' });
        if (s.book !== e.book) return reply.code(400).send({ title: 'Bad Request', detail: 'cross-book ranges not supported in v1' });
        if (s.chapter > e.chapter || (s.chapter === e.chapter && s.verse > e.verse)) {
          return reply.code(400).send({ title: 'Bad Request', detail: 'start must come before end' });
        }
        // Need verse counts per chapter to enumerate. Cheaper: query by (chapter, verse) BETWEEN bounds.
        // We'll fetch the union of refs that exist in any of the requested translations within this window.
        const r = await pool.query(
          `SELECT DISTINCT chapter, verse
             FROM verses
             WHERE book = $1 AND translation = ANY($2::text[])
               AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
               AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
             ORDER BY chapter, verse`,
          [s.book, translations, s.chapter, s.verse, e.chapter, e.verse],
        );
        targetRefs = r.rows.map(row => ({
          book: s.book,
          chapter: row.chapter as number,
          verse: row.verse as number,
        }));
      } else {
        return reply.code(400).send({ title: 'Bad Request', detail: 'either ref OR (start AND end) is required' });
      }

      // Shared resolution (identity + versification mapping + prefer_aligned).
      const resolved = await resolveParallel(pool, translations, targetRefs, preferAligned);

      // Shape into the REST contract (snake_case mapped_to / mapping_note).
      const result = resolved.map(r => ({
        ref: r.ref,
        translations: r.entries.map(e => {
          const base: Record<string, unknown> = {
            translation: e.translation,
            present: e.present,
            text: e.text,
            structured: e.structured,
          };
          if (e.mappedTo !== undefined) base.mapped_to = e.mappedTo;
          if (e.mappingNote !== undefined) base.mapping_note = e.mappingNote;
          return base;
        }),
      }));

      return { refs: result, meta: { count: result.length, translations } };
    },
  );
}
