/**
 * Discovery routes (public, no auth required).
 * Per PLAN.md these are the routes any client may hit without an API key.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/healthz', async () => {
    const r = await pool.query('SELECT 1 as ok');
    return { status: 'ok', db: r.rows[0]?.ok === 1 ? 'ok' : 'down' };
  });

  app.get('/v1/info', async () => ({
    name: 'Ahosaji',
    version: '0.1.0',
    domains: ['bible'],
    transports: ['rest', 'graphql', 'mcp'],
  }));

  app.get('/v1/translations', async () => {
    const r = await pool.query(
      `SELECT t.code, t.name, t.language, t.source, t.versification,
              COUNT(DISTINCT v.book) AS book_count
         FROM translations t
         LEFT JOIN verses v ON v.translation = t.code
         GROUP BY t.code, t.name, t.language, t.source, t.versification
         ORDER BY t.code`,
    );
    return { translations: r.rows };
  });

  app.get<{ Params: { code: string } }>(
    '/v1/translations/:code',
    async (req, reply) => {
      const r = await pool.query(
        `SELECT t.code, t.name, t.language, t.source, t.copyright, t.versification,
                COUNT(DISTINCT v.book) AS book_count,
                COUNT(v.*) AS verse_count
           FROM translations t
           LEFT JOIN verses v ON v.translation = t.code
           WHERE t.code = $1
           GROUP BY t.code, t.name, t.language, t.source, t.copyright, t.versification`,
        [req.params.code],
      );
      const row = r.rows[0];
      if (!row) return reply.code(404).send({ type: 'about:blank', title: 'Not Found', detail: `translation '${req.params.code}' not found` });
      return row;
    },
  );

  app.get<{ Params: { code: string } }>(
    '/v1/translations/:code/books',
    async (req, reply) => {
      const exists = await pool.query('SELECT 1 FROM translations WHERE code = $1', [req.params.code]);
      if (exists.rowCount === 0) return reply.code(404).send({ title: 'Not Found', detail: `translation '${req.params.code}' not found` });
      const r = await pool.query(
        `SELECT b.usfm, b.name_en, b.name_ar, b.testament, b.canon, b.book_order, b.chapter_count, b.book_group,
                COUNT(v.*) AS verse_count
           FROM books b
           LEFT JOIN verses v ON v.book = b.usfm AND v.translation = $1
           GROUP BY b.usfm, b.name_en, b.name_ar, b.testament, b.canon, b.book_order, b.chapter_count, b.book_group
           ORDER BY b.book_order`,
        [req.params.code],
      );
      return { translation: req.params.code, books: r.rows };
    },
  );
}
