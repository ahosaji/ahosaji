/**
 * Cross-chapter passage queries.
 *   GET /v1/bible/passages?translation=en&start=JHN.3.16&end=JHN.4.2
 *
 * Single-book ranges only in v1 (the cross-book rare-edge case can be
 * client-composed). Same-chapter ranges still work but the dedicated
 * /chapters/:n/verses?from=&to= endpoint is more direct.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { parseRef } from '../refs.js';

interface PassageQuery { translation?: string; start?: string; end?: string; }

export async function passageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PassageQuery }>(
    '/v1/bible/passages',
    async (req, reply) => {
      const { translation, start, end } = req.query;
      if (!translation || !start || !end) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'translation, start, and end query params are required' });
      }
      const s = parseRef(start);
      const e = parseRef(end);
      if (!s || !e) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'start and end must be USFM refs (e.g. JHN.3.16)' });
      }
      if (s.book !== e.book) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'cross-book passages are not supported in v1; restrict start and end to the same book' });
      }
      if (s.chapter > e.chapter || (s.chapter === e.chapter && s.verse > e.verse)) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'start must come before end' });
      }

      // Filter: include verses where (chapter, verse) is within [(s.chapter, s.verse), (e.chapter, e.verse)]
      const r = await pool.query(
        `SELECT verse, chapter, ref, text, structured
           FROM verses
           WHERE translation = $1 AND book = $2
             AND ((chapter = $3 AND verse >= $4) OR chapter > $3)
             AND ((chapter = $5 AND verse <= $6) OR chapter < $5)
           ORDER BY chapter, verse`,
        [translation, s.book, s.chapter, s.verse, e.chapter, e.verse],
      );
      if (r.rowCount === 0) {
        return reply.code(404).send({ title: 'Not Found', detail: `passage ${start}–${end} returned no verses in ${translation}` });
      }
      return {
        translation,
        book: s.book,
        start: { chapter: s.chapter, verse: s.verse },
        end: { chapter: e.chapter, verse: e.verse },
        verses: r.rows,
        meta: { count: r.rowCount },
      };
    },
  );
}
