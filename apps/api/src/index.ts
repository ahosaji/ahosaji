import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { env } from './env.js';
import { shutdownDb } from './db.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import { discoveryRoutes } from './routes/discovery.js';
import { bibleRoutes } from './routes/bible.js';
import { passageRoutes } from './routes/passages.js';
import { parallelRoutes } from './routes/parallel.js';
import { searchRoutes } from './routes/search.js';
import { graphqlRoutes } from './graphql/server.js';
import { mcpRoute } from './mcp/transport.js';
import { docsRoutes } from './routes/docs.js';

async function buildApp() {
  const app = Fastify({
    logger: { level: env.logLevel },
    disableRequestLogging: false,
  });

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

  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
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

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: env.port, host: env.host });
    app.log.info(`Ahosaji API listening on http://${env.host}:${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const close = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await shutdownDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
