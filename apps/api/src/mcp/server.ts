/**
 * MCP server — composes tools/resources/prompts.
 *
 * Auth model:
 *   - initialize, tools/list, resources/list, resources/templates/list,
 *     prompts/list  → public (anyone can introspect)
 *   - tools/call, resources/read, prompts/get → require Bearer key
 *
 * Each request handler that returns content checks for an attached
 * consumer (set by the route-level authenticator before forwarding to MCP).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from './tools.js';
import { listResources, RESOURCE_TEMPLATES, readResource } from './resources.js';
import { PROMPTS, getPrompt } from './prompts.js';

export interface McpAuthContext {
  consumer?: { id: string; tier: string };
}

export function buildMcpServer(authCtx: McpAuthContext): Server {
  const server = new Server(
    { name: 'ahosaji', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // --- Tools ------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!authCtx.consumer) {
      throw new Error('tools/call requires Authorization: Bearer <api-key>');
    }
    const tool = TOOLS.find(t => t.name === request.params.name);
    if (!tool) throw new Error(`unknown tool: ${request.params.name}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.handler as any)(request.params.arguments ?? {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  // --- Resources --------------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await listResources(),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES,
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (!authCtx.consumer) {
      throw new Error('resources/read requires Authorization: Bearer <api-key>');
    }
    const r = await readResource(request.params.uri);
    return { contents: [r] };
  });

  // --- Prompts ----------------------------------------------------------
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (!authCtx.consumer) {
      throw new Error('prompts/get requires Authorization: Bearer <api-key>');
    }
    return await getPrompt(request.params.name, request.params.arguments ?? {});
  });

  return server;
}
