/**
 * Streamable HTTP MCP transport mounted on Fastify at POST /v1/mcp.
 *
 * Stateless mode (sessionIdGenerator: undefined) — each POST is independent.
 *
 * Auth: handled inline before forwarding to MCP. Public methods (introspection)
 * proceed without a consumer; content methods (tools/call etc.) reject when no
 * valid Bearer is present.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { validateKey, TIER_RATE_LIMITS } from '../auth.js';
import { ANON_PER_MINUTE } from '../plugins/rateLimit.js';
import { buildMcpServer, type McpAuthContext } from './server.js';

/**
 * Resolve the Bearer consumer for a request (or null). Used both by the
 * per-route rate-limit config (to pick the limit/key) and by the handler.
 * Relies on auth.ts's in-memory lookup cache so this isn't a double DB hit.
 */
async function resolveConsumer(req: FastifyRequest): Promise<{ id: string; tier: keyof typeof TIER_RATE_LIMITS } | null> {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const consumer = await validateKey(header.slice(7).trim());
    if (consumer) return { id: consumer.id, tier: consumer.tier };
  }
  return null;
}

export async function mcpRoute(app: FastifyInstance): Promise<void> {
  app.route({
    url: '/v1/mcp',
    method: ['POST', 'GET', 'DELETE'],
    // Rate-limited (not unlimited): anonymous introspection is capped by IP at
    // ANON_PER_MINUTE; authenticated calls get their tier's per-minute limit,
    // keyed by consumer.id. Auth is resolved here (cached) since the global
    // rate-limit preHandler runs before this route's inline auth.
    config: {
      rateLimit: {
        max: async (req: FastifyRequest) => {
          const c = await resolveConsumer(req);
          if (!c) return ANON_PER_MINUTE;
          const limit = TIER_RATE_LIMITS[c.tier].perMinute;
          return Number.isFinite(limit) ? limit : 1_000_000;
        },
        keyGenerator: async (req: FastifyRequest) => {
          const c = await resolveConsumer(req);
          return c?.id ?? req.ip;
        },
      },
    },
    handler: async (req: FastifyRequest, reply) => {
      // Resolve auth context once per request. Discovery methods don't strictly
      // need it; content methods will reject inside the server if absent.
      const authCtx: McpAuthContext = {};
      const consumer = await resolveConsumer(req);
      if (consumer) authCtx.consumer = { id: consumer.id, tier: consumer.tier };

      const server = buildMcpServer(authCtx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reply.raw.on('close', () => { void transport.close(); });

      try {
        await server.connect(transport);
        // Hand off to the SDK transport. It will write to reply.raw directly,
        // so we tell Fastify not to send anything itself via reply.hijack().
        reply.hijack();
        await transport.handleRequest(req.raw, reply.raw, req.body as Record<string, unknown> | undefined);
      } catch (err) {
        // Log the full error server-side; return a generic detail to the client
        // so internal error text isn't leaked to MCP callers.
        app.log.error(err, 'MCP transport error');
        if (!reply.sent) {
          reply.code(500).send({ title: 'Internal Server Error', detail: 'internal error' });
        }
      }
    },
  });
}
