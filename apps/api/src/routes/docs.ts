/**
 * Serve docs/api/ at /docs (Scalar viewer + openapi.yaml).
 * Public — no auth required so anyone can read the API docs.
 */
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const DOCS_DIR = resolve(import.meta.dirname, '../../../../docs/api');

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(fastifyStatic, {
    root: DOCS_DIR,
    prefix: '/docs/',
    decorateReply: false,
    // redirect: true makes fastify-static issue a 301 from /docs/sdk → /docs/sdk/
    // when the path resolves to a directory. Without this, sub-doc sites like
    // /docs/sdk (TypeDoc-generated) load index.html but with the wrong base
    // URL — relative <link href="assets/style.css"> resolves to /docs/assets/
    // instead of /docs/sdk/assets/, so all CSS/JS 404s and the page renders
    // unstyled.
    redirect: true,
  });

  // Bare /docs → /docs/index.html
  app.get('/docs', async (_req, reply) => reply.redirect('/docs/'));
}
