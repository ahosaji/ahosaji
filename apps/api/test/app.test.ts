import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/test';
process.env.MEILISEARCH_HOST = 'http://127.0.0.1:1';
process.env.MEILISEARCH_SEARCH_KEY = 'test-search';
const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { generateKey } = await import('../src/auth.js');
const { ingressLimitPlugin, INGRESS_PER_MINUTE } = await import('../src/plugins/rateLimit.js');
const { mcpRoute } = await import('../src/mcp/transport.js');
const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

test('coarse IP limiter stops unauthorized traffic before further auth lookups', async () => {
  const app = Fastify();
  await app.register(ingressLimitPlugin);
  let lookups = 0;
  app.addHook('preHandler', async (_req, reply) => { lookups++; return reply.code(401).send({}); });
  app.get('/private', () => ({}));
  try {
    for (let i = 0; i < INGRESS_PER_MINUTE; i++) assert.equal((await app.inject('/private')).statusCode, 401);
    assert.equal((await app.inject('/private')).statusCode, 429);
    assert.equal(lookups, INGRESS_PER_MINUTE);
  } finally { await app.close(); }
});

test('proxy policy ignores spoofed forwarding and accepts configured proxy hops', async () => {
  for (const trustedProxyCidrs of [[], ['127.0.0.1/32']]) {
    const app = await buildApp({ logger: false, trustedProxyCidrs });
    app.get('/docs/ip', req => ({ ip: req.ip }));
    try {
      const response = await app.inject({ url: '/docs/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } });
      assert.equal(response.json().ip, trustedProxyCidrs.length ? '203.0.113.9' : '127.0.0.1');
      const spoof = await app.inject({ url: '/docs/ip', remoteAddress: '192.0.2.1', headers: { 'x-forwarded-for': '203.0.113.9' } });
      assert.equal(spoof.json().ip, '192.0.2.1');
    } finally { await app.close(); }
  }
});

test('backend exceptions are generic and correlated by server request ID', async () => {
  const app = await buildApp({ logger: false });
  app.get('/docs/failure', () => { throw new Error('postgres password=secret internal query'); });
  try {
    const response = await app.inject('/docs/failure');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().detail, 'internal error');
    assert.equal(response.json().requestId, response.headers['x-request-id']);
    assert.doesNotMatch(response.body, /password|postgres|secret/);
  } finally { await app.close(); }
});

test('requests have a finite application deadline in addition to receive and database budgets', async () => {
  const app = await buildApp({ logger: false });
  try {
    assert.ok(app.initialConfig.handlerTimeout > 0 && app.initialConfig.handlerTimeout <= 15000);
    assert.ok(app.initialConfig.requestTimeout > 0);
    assert.ok(pool.options.connectionTimeoutMillis && pool.options.connectionTimeoutMillis <= 2000);
    assert.ok(pool.options.statement_timeout && Number(pool.options.statement_timeout) <= 5000);
  } finally { await app.close(); }
});

test('REST parallel uses deduplicated codes and bounded shared expansion', async () => {
  const queries: string[] = [];
  const query = mock.method(pool, 'query', async (sql: string) => {
    queries.push(sql);
    return { rows: sql.includes('FROM translations') ? [{ code: 'en' }] : [] };
  });
  const app = await buildApp({ logger: false, authenticate: async () => ({ id: 'c', tier: 'admin', email: 'e', name: null }), consumeQuota: async () => true });
  try {
    const headers = { authorization: `Bearer ${generateKey().plaintext}` };
    const duplicate = await app.inject({ url: '/v1/parallel?translations=en,en&ref=JHN.3.16', headers });
    assert.deepEqual(duplicate.json().meta.translations, ['en']);
    const range = await app.inject({ url: '/v1/parallel?translations=en&start=PSA.1.1&end=PSA.150.6', headers });
    assert.equal(range.statusCode, 200);
    assert.ok(queries.some(sql => sql.includes('SELECT DISTINCT') && sql.includes('LIMIT 1001')));
  } finally { query.mock.restore(); await app.close(); }
});

test('MCP transport owns a finite deadline after hijacking the response', async () => {
  const handle = mock.method(StreamableHTTPServerTransport.prototype, 'handleRequest', async () => new Promise<void>(() => {}));
  const app = Fastify({ genReqId: () => 'mcp-deadline' });
  await app.register(mcpRoute, { requestTimeoutMs: 10 });
  try {
    const response = await Promise.race([
      app.inject({ method: 'POST', url: '/v1/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }),
      new Promise<undefined>(resolve => setTimeout(resolve, 100)),
    ]);
    assert.ok(response, 'MCP response exceeded its deadline');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.data.requestId, 'mcp-deadline');
  } finally { handle.mock.restore(); await app.close(); }
});

test('MCP transport failures finish the hijacked response with a generic correlated error', async () => {
  const handle = mock.method(StreamableHTTPServerTransport.prototype, 'handleRequest', async () => { throw new Error('internal password=secret'); });
  const app = Fastify({ genReqId: () => 'mcp-failure' });
  await app.register(mcpRoute, { requestTimeoutMs: 1000 });
  try {
    const response = await Promise.race([
      app.inject({ method: 'POST', url: '/v1/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }),
      new Promise<undefined>(resolve => setTimeout(resolve, 100)),
    ]);
    assert.ok(response, 'transport exception left response open');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.data.requestId, 'mcp-failure');
    assert.doesNotMatch(response.body, /password|secret/);
  } finally { handle.mock.restore(); await app.close(); }
});
