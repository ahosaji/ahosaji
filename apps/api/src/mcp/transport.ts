/**
 * Streamable HTTP MCP transport mounted on Fastify at POST /v1/mcp.
 *
 * Stateless mode (sessionIdGenerator: undefined) — each POST is independent.
 *
 * Auth: the shared auth hook resolves an optional consumer before quota hooks.
 * Public introspection proceeds anonymously; content methods reject when no
 * valid consumer is attached.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildMcpServer, type McpAuthContext } from './server.js';

export async function mcpRoute(app: FastifyInstance, options: { requestTimeoutMs?: number } = {}): Promise<void> {
  app.route({
    url: '/v1/mcp',
    method: ['POST', 'GET', 'DELETE'],
    handler: async (req: FastifyRequest, reply) => {
      const authCtx: McpAuthContext = {
        ...(req.consumer ? { consumer: { id: req.consumer.id, tier: req.consumer.tier } } : {}),
        requestId: req.id, logError: err => req.log.error({ err }, 'MCP backend error'),
      };
      reply.raw.setHeader('x-request-id', req.id);
      const server = buildMcpServer(authCtx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const sendTransportError = (status: number, message: string): void => {
        if (reply.raw.headersSent) { reply.raw.destroy(); return; }
        reply.raw.writeHead(status, { 'content-type': 'application/json', 'x-request-id': req.id });
        const body = req.body as { id?: unknown } | undefined;
        const id = typeof body?.id === 'number' || typeof body?.id === 'string' ? body.id : null;
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', id, error: {
          code: -32603, message, data: { requestId: req.id },
        } }));
      };
      // Fastify clears its application timer on hijack, so the SDK transport
      // owns a separate deadline for its raw response lifecycle.
      const timer = setTimeout(() => {
        req.log.error({ requestId: req.id }, 'MCP request deadline exceeded');
        sendTransportError(503, 'request timed out');
        void server.close().catch(err => req.log.error({ err }, 'MCP close error'));
      }, options.requestTimeoutMs ?? 15_000);
      const clearDeadline = () => clearTimeout(timer);
      reply.raw.once('finish', clearDeadline);
      reply.raw.once('close', () => {
        clearDeadline();
        void server.close().catch(err => req.log.error({ err }, 'MCP close error'));
      });

      try {
        await server.connect(transport);
        // Hand off to the SDK transport. It will write to reply.raw directly,
        // so we tell Fastify not to send anything itself via reply.hijack().
        reply.hijack();
        await transport.handleRequest(req.raw, reply.raw, req.body as Record<string, unknown> | undefined);
      } catch (err) {
        // Log the full error server-side; return a generic detail to the client
        // so internal error text isn't leaked to MCP callers.
        req.log.error({ err }, 'MCP transport error');
        clearDeadline();
        sendTransportError(500, 'internal error');
      }
    },
  });
}
