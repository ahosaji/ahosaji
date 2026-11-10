import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/test';
process.env.MEILISEARCH_HOST = 'http://127.0.0.1:1';
process.env.MEILISEARCH_SEARCH_KEY = 'test-search';
const { pool } = await import('../src/db.js');
const { validateKey, generateKey, TIER_RATE_LIMITS } = await import('../src/auth.js');
const { resolveParallel } = await import('../src/lib/parallelService.js');
const { graphqlRoutes } = await import('../src/graphql/server.js');
const authPlugin = (await import('../src/plugins/auth.js')).default;
const rateLimitPlugin = (await import('../src/plugins/rateLimit.js')).default;
const { buildMcpServer } = await import('../src/mcp/server.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { searchRoutes } = await import('../src/routes/search.js');
const { bibleRoutes } = await import('../src/routes/bible.js');
const { parseRef } = await import('../src/refs.js');
const { getQueryClient } = await import('../src/lib/searchClient.js');

test('malformed keys never reach the auth database', async () => {
  const query = mock.method(pool, 'query', async () => ({ rows: [] }));
  try {
    for (const key of ['ahk_short_token_123', 'ahk_' + 'x'.repeat(10000), 'ahk_' + '!'.repeat(43)]) {
      assert.equal(await validateKey(key), null);
    }
    assert.equal(query.mock.callCount(), 0);
  } finally { query.mock.restore(); }
});

test('revocation and tier changes are effective on the next request', async () => {
  const key = generateKey();
  let revoked = false;
  let tier = 'free';
  const query = mock.method(pool, 'query', async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{ key_id: 'key', key_hash: key.hash, revoked_at: revoked ? new Date() : null, id: 'consumer', tier }] : [] }));
  try {
    assert.equal((await validateKey(key.plaintext))?.tier, 'free');
    tier = 'church';
    assert.equal((await validateKey(key.plaintext))?.tier, 'church');
    revoked = true;
    assert.equal(await validateKey(key.plaintext), null);
  } finally { query.mock.restore(); }
});

test('existing tier budgets remain unchanged', () => {
  assert.deepEqual(TIER_RATE_LIMITS.free, { perMinute: 60, perDay: 5000 });
  assert.deepEqual(TIER_RATE_LIMITS.church, { perMinute: 600, perDay: 200000 });
  assert.deepEqual(TIER_RATE_LIMITS.paid, { perMinute: 6000, perDay: Infinity });
  assert.deepEqual(TIER_RATE_LIMITS.admin, { perMinute: Infinity, perDay: Infinity });
});

test('shared parallel resolver deduplicates translations and bulk fetches identity', async () => {
  const queries: string[] = [];
  const database = { query: async (sql: string) => {
    queries.push(sql);
    return { rows: sql.includes('FROM translations') ? [{ code: 'en' }, { code: 'ar' }] : [] };
  } };
  const result = await resolveParallel(database as never, ['en', 'en', 'ar'], [{ book: 'JHN', chapter: 3, verse: 16 }]);
  assert.deepEqual(result[0]?.entries.map(e => e.translation), ['en', 'ar']);
  assert.equal(queries.filter(sql => sql.includes('FROM verses')).length, 1);
});

test('parallel rejects more than ten translations and 1000 expanded verses before identity fetch', async () => {
  const database = { query: async () => ({ rows: [] }) };
  await assert.rejects(resolveParallel(database as never, Array.from({ length: 11 }, (_, i) => `t${i}`), []), /10/);
  await assert.rejects(resolveParallel(database as never, ['en'], Array.from({ length: 1001 }, (_, i) => ({ book: 'PSA', chapter: i + 1, verse: 1 }))), /1000/);
});

test('Yoga rejects shallow alias amplification before execution', async () => {
  const app = Fastify();
  await app.register(graphqlRoutes);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/graphql', payload: { query: `{ ${Array.from({ length: 31 }, (_, i) => `a${i}: __typename`).join(' ')} }` } });
    assert.ok(response.json().errors, response.body);
    assert.match(response.body, /limit|complex|cost|alias/i);
  } finally { await app.close(); }
});

test('MCP optional authentication resolves once before shared consumer quota', async () => {
  const app = Fastify();
  let lookups = 0;
  const charged: string[] = [];
  await app.register(authPlugin, { authenticate: async () => { lookups++; return { id: 'c', tier: 'church', email: 'e', name: null }; } });
  await app.register(rateLimitPlugin, { consumeQuota: async (consumer: { id: string }) => { charged.push(consumer.id); return true; } });
  app.post('/v1/mcp', async req => ({ consumer: req.consumer?.id }));
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/mcp', headers: { authorization: `Bearer ${generateKey().plaintext}` }, payload: {} });
    assert.equal(response.json().consumer, 'c');
    assert.equal(lookups, 1);
    assert.deepEqual(charged, ['c']);
  } finally { await app.close(); }
});

test('consumer quota rejection prevents route execution', async () => {
  const app = Fastify();
  await app.register(authPlugin, { authenticate: async () => ({ id: 'c', tier: 'free', email: 'e', name: null }) });
  await app.register(rateLimitPlugin, { consumeQuota: async () => false });
  app.get('/v1/private', async () => ({ secret: 'route ran' }));
  try {
    const response = await app.inject({ url: '/v1/private', headers: { authorization: `Bearer ${generateKey().plaintext}` } });
    assert.equal(response.statusCode, 429);
  } finally { await app.close(); }
});

test('every MCP tool validates its advertised schema before backend work', async () => {
  let calls = 0;
  const query = mock.method(pool, 'query', async () => { calls++; return { rows: [] }; });
  const server = buildMcpServer({ consumer: { id: 'c', tier: 'free' } });
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      await assert.rejects(client.callTool({ name: tool.name, arguments: { unexpected: true } }), /invalid.*argument|invalid.*param/i);
    }
    for (const args of [
      { translations: [] },
      { translations: Array(11).fill('en'), ref: 'JHN.3.16' },
      { translations: [1], ref: 'JHN.3.16' },
      { translation: 'en', q: 'word', limit: '100' },
    ]) {
      const name = 'translations' in args ? 'get_parallel' : 'search_bible';
      await assert.rejects(client.callTool({ name, arguments: args }), /invalid.*argument/i);
    }
    await assert.rejects(client.callTool({ name: 'unknown', arguments: {} }), /unknown tool/);
    assert.equal(calls, 0);
  } finally { query.mock.restore(); await client.close(); await server.close(); }
});

test('REST rejects non-integer, infinite and out-of-range search pagination', async () => {
  const app = Fastify();
  await app.register(searchRoutes);
  try {
    for (const suffix of ['limit=NaN', 'limit=1.5', 'limit=101', 'page=Infinity', 'offset=-1', 'pageSize=0']) {
      const response = await app.inject(`/v1/search?q=word&translation=en&${suffix}`);
      assert.equal(response.statusCode, 400, response.body);
    }
  } finally { await app.close(); }
});

test('Yoga bounds multiple operations, expanded fragments, depth and weighted backend cost', async () => {
  let calls = 0;
  const query = mock.method(pool, 'query', async () => { calls++; return { rows: [] }; });
  const app = Fastify();
  await app.register(graphqlRoutes);
  const fragments = Array.from({ length: 10 }, (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`).join(' ') + ' fragment F10 on Query { __typename }';
  const queries = [
    'query A { __typename } query B { __typename }',
    `query { ...F0 } ${fragments}`,
    `{ ${Array.from({ length: 11 }, (_, i) => `a${i}: chapter(translation:"en",usfm:"JHN",chapter:3){book}`).join(' ')} }`,
    `{ ${Array.from({ length: 11 }, (_, i) => `a${i}: translation(code:"en"){code}`).join(' ')} }`,
    `{ __type(name:"Query") { ${'ofType { '.repeat(13)} name ${'}'.repeat(13)} } }`,
  ];
  try {
    for (const query of queries) {
      const response = await app.inject({ method: 'POST', url: '/v1/graphql', payload: { query, operationName: query.startsWith('query A') ? 'A' : undefined } });
      assert.match(response.body, /limit/i, response.body);
      assert.ok(response.json().errors);
    }
    assert.equal(calls, 0);
  } finally { query.mock.restore(); await app.close(); }
});

test('GraphQL backend failures are generic and include a request ID', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('database password=secret'); });
  const app = Fastify({ genReqId: () => 'graphql-test-request' });
  await app.register(graphqlRoutes);
  try {
    const response = await app.inject({ method: 'POST', url: '/v1/graphql', payload: { query: '{translations{code}}' } });
    assert.doesNotMatch(response.body, /password|secret/);
    assert.equal(response.json().errors[0].extensions.requestId, 'graphql-test-request');
  } finally { query.mock.restore(); await app.close(); }
});

test('MCP anonymous discovery remains public while content is gated', async () => {
  const server = buildMcpServer({});
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    assert.ok((await client.listTools()).tools.length > 0);
    await assert.rejects(client.callTool({ name: 'list_translations', arguments: {} }), /requires Authorization/);
  } finally { await client.close(); await server.close(); }
});

test('Bible numeric inputs and USFM refs reject invalid database integers', async () => {
  let calls = 0;
  const query = mock.method(pool, 'query', async () => { calls++; return { rows: [], rowCount: 0 }; });
  const app = Fastify();
  await app.register(bibleRoutes);
  try {
    for (const ref of ['JHN.0.1', 'JHN.3.0', `JHN.${'9'.repeat(400)}.1`, 'JHN.2147483648.1']) assert.equal(parseRef(ref), null);
    for (const path of ['NaN/verses?from=1&to=2', '3/verses?from=-1&to=2', '3/verses?from=1&to=2147483648', '0/verses/1', '3/verses/-1']) {
      assert.equal((await app.inject(`/v1/bible/translations/en/books/JHN/chapters/${path}`)).statusCode, 400);
    }
    assert.equal(calls, 0);
  } finally { query.mock.restore(); await app.close(); }
});

test('GraphQL and MCP parallel share known-code validation, deduplication and bounded ranges', async () => {
  let expanded = 1;
  const queries: string[] = [];
  const query = mock.method(pool, 'query', async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM translations')) return { rows: [{ code: 'en' }] };
    if (sql.includes('SELECT DISTINCT')) return { rows: Array.from({ length: expanded }, (_, i) => ({ chapter: 1, verse: i + 1 })) };
    return { rows: [] };
  });
  const app = Fastify();
  await app.register(graphqlRoutes);
  const server = buildMcpServer({ consumer: { id: 'c', tier: 'free' } });
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const valid = await app.inject({ method: 'POST', url: '/v1/graphql', payload: { query: '{parallel(translations:["en","en"],ref:"JHN.3.16"){refs{ref translations{translation present}}}}' } });
    assert.equal(valid.json().errors, undefined, valid.body);
    assert.deepEqual(valid.json().data.parallel.refs[0].translations, [{ translation: 'en', present: false }]);
    const mcp = await client.callTool({ name: 'get_parallel', arguments: { translations: ['en', 'en'], ref: 'JHN.3.16' } });
    assert.equal(JSON.parse((mcp.content as { text: string }[])[0]!.text).refs[0].translations.length, 1);
    const unknown = await app.inject({ method: 'POST', url: '/v1/graphql', payload: { query: '{parallel(translations:["unknown"],ref:"JHN.3.16"){refs{ref}}}' } });
    assert.match(unknown.body, /unknown translation/);
    await assert.rejects(client.callTool({ name: 'get_parallel', arguments: { translations: ['unknown'], ref: 'JHN.3.16' } }), /unknown translation/);
    expanded = 1001;
    await assert.rejects(client.callTool({ name: 'get_parallel', arguments: { translations: ['en'], start: 'PSA.1.1', end: 'PSA.150.6' } }), /1000/);
    assert.ok(queries.some(sql => sql.includes('SELECT DISTINCT') && sql.includes('LIMIT 1001')));
  } finally { query.mock.restore(); await client.close(); await server.close(); await app.close(); }
});

test('REST search and MCP backend errors hide details and preserve request IDs in logs', async () => {
  const details = new Error('internal backend password=secret');
  const index = mock.method(getQueryClient(), 'index', () => ({ search: async () => { throw details; } }));
  const database = mock.method(pool, 'query', async () => { throw details; });
  const app = Fastify({ genReqId: () => 'search-request' });
  await app.register(searchRoutes);
  const logged: unknown[] = [];
  const server = buildMcpServer({ consumer: { id: 'c', tier: 'free' }, requestId: 'mcp-request', logError: error => logged.push(error) });
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    const response = await app.inject('/v1/search?q=word&translation=en');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().requestId, 'search-request');
    assert.doesNotMatch(response.body, /password|secret/);
    await server.connect(serverTransport); await client.connect(clientTransport);
    await assert.rejects(client.callTool({ name: 'list_translations', arguments: {} }), error => /mcp-request/.test(String(error)) && !/password|secret/.test(String(error)));
    assert.equal(logged[0], details);
  } finally { index.mock.restore(); database.mock.restore(); await app.close(); await client.close(); await server.close(); }
});

test('MCP prompt and resource numeric inputs reject invalid integers before SQL', async () => {
  let calls = 0;
  const query = mock.method(pool, 'query', async () => { calls++; return { rows: [], rowCount: 0 }; });
  const server = buildMcpServer({ consumer: { id: 'c', tier: 'free' } });
  const client = new Client({ name: 'test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    for (const window of ['Infinity', 'NaN', '-1', '1.5', '1001']) {
      await assert.rejects(client.getPrompt({ name: 'verse_in_context', arguments: { translation: 'en', ref: 'JHN.3.16', window } }), /invalid.*window/i);
    }
    await assert.rejects(client.readResource({ uri: 'ahosaji://bible/en/JHN.2147483648' }), /invalid.*chapter/i);
    assert.equal(calls, 0);
  } finally { query.mock.restore(); await client.close(); await server.close(); }
});
