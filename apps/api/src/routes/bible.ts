/**
 * Bible-domain routes. All under /v1/bible/. Auth is applied globally by the
 * app-level auth plugin, so these handlers run only for authenticated requests.
 */
import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { isPositiveDatabaseInteger } from '../refs.js';

interface ChapterParams { code: string; usfm: string; n: string; }
interface VerseParams extends ChapterParams { v: string; }
interface VerseRangeQuery { from?: string; to?: string; }

export async function bibleRoutes(app: FastifyInstance): Promise<void> {
  // Whole chapter (verses + headings)
  app.get<{ Params: ChapterParams }>(
    '/v1/bible/translations/:code/books/:usfm/chapters/:n',
    async (req, reply) => {
      const { code, usfm } = req.params;
      const chapter = Number(req.params.n);
      if (!isPositiveDatabaseInteger(chapter)) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'chapter must be positive integer' });
      }

      const versesQ = await pool.query(
        `SELECT verse, ref, text, structured
           FROM verses
           WHERE translation = $1 AND book = $2 AND chapter = $3
           ORDER BY verse`,
        [code, usfm, chapter],
      );
      if (versesQ.rowCount === 0) {
        return reply.code(404).send({ title: 'Not Found', detail: `${usfm} ${chapter} not found in ${code}` });
      }
      const headingsQ = await pool.query(
        `SELECT before_verse AS "beforeVerse", text, level
           FROM headings
           WHERE translation = $1 AND book = $2 AND chapter = $3
           ORDER BY before_verse`,
        [code, usfm, chapter],
      );

      return {
        translation: code,
        book: usfm,
        chapter,
        verses: versesQ.rows,
        headings: headingsQ.rows,
        meta: { count: versesQ.rowCount, headings: headingsQ.rowCount },
      };
    },
  );

  // Single verse OR verse range within chapter (?from=&to=)
  app.get<{ Params: ChapterParams; Querystring: VerseRangeQuery }>(
    '/v1/bible/translations/:code/books/:usfm/chapters/:n/verses',
    async (req, reply) => {
      const { code, usfm } = req.params;
      const chapter = Number(req.params.n);
      const from = req.query.from ? Number(req.query.from) : null;
      const to = req.query.to ? Number(req.query.to) : null;

      if (from === null || to === null) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'from and to query params required (use /verses/:v for a single verse)' });
      }
      if (!isPositiveDatabaseInteger(chapter) || !isPositiveDatabaseInteger(from) || !isPositiveDatabaseInteger(to) || from > to) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'from/to must be integers and from <= to' });
      }

      const r = await pool.query(
        `SELECT verse, ref, text, structured
           FROM verses
           WHERE translation = $1 AND book = $2 AND chapter = $3
             AND verse BETWEEN $4 AND $5
           ORDER BY verse`,
        [code, usfm, chapter, from, to],
      );
      if (r.rowCount === 0) {
        return reply.code(404).send({ title: 'Not Found', detail: `${usfm} ${chapter}:${from}-${to} returned no verses in ${code}` });
      }
      return {
        translation: code, book: usfm, chapter, from, to,
        verses: r.rows,
        meta: { count: r.rowCount },
      };
    },
  );

  app.get<{ Params: VerseParams }>(
    '/v1/bible/translations/:code/books/:usfm/chapters/:n/verses/:v',
    async (req, reply) => {
      const { code, usfm } = req.params;
      const chapter = Number(req.params.n);
      const verse = Number(req.params.v);
      if (!isPositiveDatabaseInteger(chapter) || !isPositiveDatabaseInteger(verse)) {
        return reply.code(400).send({ title: 'Bad Request', detail: 'chapter and verse must be integers' });
      }

      const r = await pool.query(
        `SELECT v.verse, v.ref, v.text, v.structured,
                array(SELECT to_ref FROM cross_refs WHERE from_ref = v.ref ORDER BY to_ref) AS cross_refs_db
           FROM verses v
           WHERE v.translation = $1 AND v.book = $2 AND v.chapter = $3 AND v.verse = $4`,
        [code, usfm, chapter, verse],
      );
      const row = r.rows[0];
      if (!row) {
        return reply.code(404).send({ title: 'Not Found', detail: `${usfm}.${chapter}.${verse} not found in ${code}` });
      }
      // structured.crossRefs already comes from JSONB; cross_refs_db is the
      // canonical relational source. Prefer relational at API layer. Build a
      // guarded copy rather than mutating the raw JSONB: a null/array value
      // would otherwise throw when we assign crossRefs (mirrors the safe MCP
      // spread in mcp/tools.ts).
      const rawStructured = row.structured;
      const baseStructured =
        rawStructured && typeof rawStructured === 'object' && !Array.isArray(rawStructured)
          ? rawStructured
          : {};
      const structured = { ...baseStructured, crossRefs: row.cross_refs_db ?? [] };
      return {
        translation: code,
        ref: row.ref,
        book: usfm,
        chapter,
        verse,
        text: row.text,
        structured,
      };
    },
  );
}
