/**
 * Full-text search across the Bible domain.
 *
 *   GET /v1/search?q=<query>&translation=<en|ar>
 *     Pagination: either limit/offset OR page/pageSize (clients pick; both
 *     accepted). Internally we use Meilisearch's `hitsPerPage`/`page` mode
 *     when client sends page/pageSize (returns *exact* totals); else the
 *     `limit`/`offset` mode (returns *estimated* totals — slightly faster).
 *     Filters: book, testament, canon, bookGroup
 *
 * Arabic queries are normalized server-side (tashkeel stripped, alif unified)
 * so "الراعي" matches "الرَّاعِي".
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getQueryClient } from '../lib/searchClient.js';
import { normalizeArabic } from '../lib/arabic.js';
import { buildMeiliFilter } from '../lib/meiliFilter.js';

interface SearchQuery {
  q?: string;
  translation?: string;
  book?: string;
  testament?: string;
  canon?: string;
  bookGroup?: string;
  limit?: string;
  offset?: string;
  page?: string;
  pageSize?: string;
}

function buildPaginationLink(req: FastifyRequest, overrides: Record<string, string | number>): string {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  for (const [k, v] of Object.entries(overrides)) {
    url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: SearchQuery }>(
    '/v1/search',
    async (req, reply) => {
      const q = (req.query.q ?? '').trim();
      const translation = req.query.translation;
      if (!q) return reply.code(400).send({ title: 'Bad Request', detail: 'q query param is required' });
      if (!translation) return reply.code(400).send({ title: 'Bad Request', detail: 'translation query param is required (en|ar)' });
      if (!['en', 'ar'].includes(translation)) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'translation must be en or ar' });
      }

      const integer = (value: string | undefined, fallback: number, min: number, max: number): number => {
        const n = value === undefined ? fallback : (/^\d+$/.test(value) ? Number(value) : NaN);
        if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('pagination values must be integers within supported bounds');
        return n;
      };
      const usePageMode = req.query.page !== undefined || req.query.pageSize !== undefined;
      let limit: number, offset: number, page: number, pageSize: number;
      try {
        // Validate every provided input, including those overridden by page mode.
        const requestedLimit = integer(req.query.limit, 20, 1, 100);
        const requestedOffset = integer(req.query.offset, 0, 0, 100000);
        pageSize = integer(req.query.pageSize, 20, 1, 100);
        page = integer(req.query.page, 1, 1, 1000);
        limit = usePageMode ? pageSize : requestedLimit;
        offset = usePageMode ? (page - 1) * pageSize : requestedOffset;
        if (!usePageMode) { pageSize = limit; page = Math.floor(offset / limit) + 1; }
      } catch {
        return reply.code(400).send({ title: 'Bad Request', detail: 'invalid pagination (limit/pageSize 1..100, page 1..1000, offset 0..100000)' });
      }

      // Filters — validated + escaped to prevent Meilisearch filter injection.
      let filter: string | undefined;
      try {
        filter = buildMeiliFilter({
          book: req.query.book,
          testament: req.query.testament,
          canon: req.query.canon,
          bookGroup: req.query.bookGroup,
        });
      } catch (err) {
        return reply.code(400).send({ title: 'Bad Request', detail: err instanceof Error ? err.message : 'invalid filter' });
      }

      const idx = getQueryClient().index(`verses_${translation}`);
      const queryText = translation === 'ar' ? normalizeArabic(q) : q;

      try {
        const baseSearch = {
          filter,
          attributesToHighlight: ['text', 'normalized_text', 'heading'],
          attributesToRetrieve: ['ref', 'book', 'chapter', 'verse', 'text', 'heading', 'book_name', 'testament', 'canon'],
          highlightPreTag: '<em>',
          highlightPostTag: '</em>',
        };

        // Use Meilisearch's exact-pagination mode when client opted into page form.
        const res = usePageMode
          ? await idx.search(queryText, { ...baseSearch, hitsPerPage: pageSize, page })
          : await idx.search(queryText, { ...baseSearch, limit, offset });

        const total = (res as { totalHits?: number; estimatedTotalHits?: number }).totalHits
                    ?? (res as { estimatedTotalHits?: number }).estimatedTotalHits
                    ?? null;
        const totalPages = (res as { totalPages?: number }).totalPages
                          ?? (total !== null ? Math.ceil(total / pageSize) : null);

        // Build next/prev pagination URLs.
        let next: string | null = null;
        let prev: string | null = null;
        if (usePageMode) {
          if (totalPages !== null && page < totalPages) {
            next = buildPaginationLink(req, { page: page + 1, pageSize });
          }
          if (page > 1) {
            prev = buildPaginationLink(req, { page: page - 1, pageSize });
          }
        } else {
          const nextOffset = offset + limit;
          if (total === null || nextOffset < total) {
            next = buildPaginationLink(req, { offset: nextOffset, limit });
          }
          if (offset > 0) {
            prev = buildPaginationLink(req, { offset: Math.max(0, offset - limit), limit });
          }
        }

        return {
          query: q,
          translation,
          filters: { book: req.query.book, testament: req.query.testament, canon: req.query.canon, bookGroup: req.query.bookGroup },
          hits: res.hits.map(h => {
            const formatted = (h as Record<string, unknown>)['_formatted'] as Record<string, string> | undefined;
            return {
              ref: h.ref,
              book: h.book,
              chapter: h.chapter,
              verse: h.verse,
              book_name: h.book_name,
              testament: h.testament,
              canon: h.canon,
              text: h.text,
              heading: h.heading ?? null,
              formatted: formatted?.text ?? h.text,
            };
          }),
          meta: {
            count: res.hits.length,
            total,
            limit,
            offset,
            page,
            pageSize,
            totalPages,
            next,
            prev,
            mode: usePageMode ? 'page' : 'offset',
            processingTimeMs: res.processingTimeMs,
          },
        };
      } catch (err) {
        req.log.error({ err }, 'search backend error');
        return reply.code(503).send({ title: 'Service Unavailable', detail: 'search backend unavailable', requestId: req.id });
      }
    },
  );
}
