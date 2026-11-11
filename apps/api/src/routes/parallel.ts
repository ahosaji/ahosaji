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
import { queryParallel } from '../lib/parallelService.js';

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
      const resolved = await queryParallel(pool, {
        translations: translationsParam.split(',').map(code => code.trim()).filter(Boolean),
        ref, start, end, preferAligned,
      });
      const translations = [...new Set(translationsParam.split(',').map(code => code.trim()).filter(Boolean))];

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
