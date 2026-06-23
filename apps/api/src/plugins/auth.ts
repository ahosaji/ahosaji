/**
 * Bearer-token auth Fastify plugin.
 *
 * Public route patterns (skip auth):
 *   - /v1/healthz
 *   - /v1/info
 *   - /v1/translations           (and exactly /v1/translations/:code, .../books)
 *
 * Everything else under /v1/* requires Authorization: Bearer <api-key>.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { validateKey, type Consumer } from '../auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    consumer?: Consumer;
  }
}

const PUBLIC_PATTERNS: RegExp[] = [
  /^\/v1\/healthz\/?$/,
  /^\/v1\/info\/?$/,
  /^\/v1\/translations\/?$/,
  /^\/v1\/translations\/[^/]+\/?$/,
  /^\/v1\/translations\/[^/]+\/books\/?$/,
  /^\/v1\/mcp\/?$/,   // MCP transport handles its own per-method auth (discovery public, content gated)
  /^\/docs(\/.*)?$/,  // OpenAPI / Scalar reference: public docs
];

function isPublic(url: string): boolean {
  // strip query string
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATTERNS.some(p => p.test(path));
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    if (isPublic(req.url)) return;

    const header = req.headers['authorization'];
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return reply.code(401).send({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Authorization: Bearer <api-key> header is required',
      });
    }
    const key = header.slice('Bearer '.length).trim();
    const consumer = await validateKey(key);
    if (!consumer) {
      return reply.code(401).send({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'invalid or revoked API key',
      });
    }
    req.consumer = consumer;
  });
};

export default fp(authPlugin, { name: 'ahosaji-auth' });
