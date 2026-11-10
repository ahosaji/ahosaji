import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { env } from './env.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin, { ingressLimitPlugin } from './plugins/rateLimit.js';
import { randomUUID } from 'node:crypto';
import type { Consumer, validateKey } from './auth.js';
import type { FastifyServerOptions } from 'fastify';
import { discoveryRoutes } from './routes/discovery.js';
import { bibleRoutes } from './routes/bible.js';
import { passageRoutes } from './routes/passages.js';
import { parallelRoutes } from './routes/parallel.js';
import { searchRoutes } from './routes/search.js';
import { graphqlRoutes } from './graphql/server.js';
import { mcpRoute } from './mcp/transport.js';
import { docsRoutes } from './routes/docs.js';

export async function buildApp(options: {
  authenticate?: typeof validateKey;
  consumeQuota?: (consumer: Consumer) => Promise<boolean>;
  trustedProxyCidrs?: string[];
  logger?: FastifyServerOptions['logger'];
} = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: env.logLevel, redact: ['req.headers.authorization'] },
    genReqId: () => randomUUID(),
    trustProxy: (options.trustedProxyCidrs ?? env.trustedProxyCidrs).length ? (options.trustedProxyCidrs ?? env.trustedProxyCidrs) : false,
    bodyLimit: 262_144, handlerTimeout: 15_000, requestTimeout: 15_000, connectionTimeout: 10_000, keepAliveTimeout: 5_000,
  });

  app.addHook('onRequest', async (req, reply) => { reply.header('x-request-id', req.id); });
  app.setErrorHandler((error, req, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    const status = typeof failure.statusCode === 'number' && failure.statusCode >= 400 && failure.statusCode < 500 ? failure.statusCode : 500;
    if (status === 500) req.log.error({ err: error }, 'request failed');
    reply.code(status).send({ title: status === 500 ? 'Internal Server Error' : 'Bad Request', status,
      detail: status === 500 ? 'internal error' : (failure.message ?? 'invalid request'), requestId: req.id });
  });
  await app.register(ingressLimitPlugin);
  await app.register(sensible);

  // Security headers. CSP is disabled because the Scalar/TypeDoc HTML served at
  // /docs loads inline scripts/styles that a default CSP would break; helmet
  // still sets HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS: this is a Bearer-token, public-data API with no cookies, so we reflect
  // any origin and disable credentials (no cookie/credential leakage risk).
  await app.register(cors, {
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  });

  await app.register(authPlugin, { authenticate: options.authenticate });
  await app.register(rateLimitPlugin, { consumeQuota: options.consumeQuota });
  await app.register(discoveryRoutes);
  await app.register(bibleRoutes);
  await app.register(passageRoutes);
  await app.register(parallelRoutes);
  await app.register(searchRoutes);
  await app.register(graphqlRoutes);
  await app.register(mcpRoute);
  await app.register(docsRoutes);

  // Default 404 + content-negotiation: return RFC 7807 problem+json
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: `route ${req.method} ${req.url} not found`,
    });
  });

  return app;
}
