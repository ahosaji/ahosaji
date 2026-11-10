import assert from 'node:assert/strict';
import test from 'node:test';
import { scrapeFirecrawlRawHtml, fetchSourceHtml, MAX_HTML_RESPONSE_BYTES } from '../src/lib/firecrawl.js';

const target = 'https://texts.test/passage/?search=John+3&version=English';
const key = 'test-key-never-live';
const success = (html = '<html>raw page</html>') => Response.json({ success: true, data: { rawHtml: html, metadata: { statusCode: 200 } } });

test('Firecrawl sends the documented v2 REST request and reads nested data.rawHtml', async () => {
  const fake: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.firecrawl.dev/v2/scrape');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`);
    assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), { url: target, formats: ['rawHtml'], onlyMainContent: false, timeout: 60000 });
    assert.ok(init?.signal instanceof AbortSignal);
    return success();
  };
  assert.equal(await scrapeFirecrawlRawHtml(target, key, { fetchImpl: fake }), '<html>raw page</html>');
});

test('API failures, invalid JSON and absent raw HTML produce generic errors without provider details', async () => {
  for (const response of [new Response(`rejected ${key}`, { status: 401 }), Response.json({ success: false, error: `rejected ${key}` }),
    new Response(`bad JSON ${key}`), Response.json({ success: true, rawHtml: '<html>old flattened shape</html>' }),
    Response.json({ success: true, data: { rawHtml: '' } }), Response.json({ success: true, data: { rawHtml: 42 } })]) {
    await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => response }), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /Firecrawl/); assert.equal(error.message.includes(key), false); return true;
    });
  }
});

test('Firecrawl target error statuses cannot be mistaken for successful passage HTML', async () => {
  await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => Response.json({ success: true, data: { rawHtml: '<html>not found</html>', metadata: { statusCode: 404, error: key } } }) }), /Firecrawl target page failed/);
  assert.equal(await scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => Response.json({ success: true, data: { rawHtml: '<html>cached</html>', metadata: { statusCode: 304 } } }) }), '<html>cached</html>');
});

test('timeouts abort a pending request and do not disclose fetch errors', async () => {
  let signal: AbortSignal | null = null;
  const fake: typeof fetch = async (_, init) => {
    signal = init?.signal ?? null;
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error(key)), { once: true }));
  };
  await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: fake, timeoutMs: 10 }), /Firecrawl request timed out/);
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => { throw new Error(key); } }), /^Error: Firecrawl request failed$/);
});

test('the response limit applies to streamed bytes and cancels oversized/stalled bodies', async () => {
  let canceled = false;
  const tooLarge = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_HTML_RESPONSE_BYTES + 1)); }, cancel() { canceled = true; } }));
  await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => tooLarge }), /response exceeds/);
  assert.equal(canceled, true);
  let stalledCanceled = false;
  const stalled = new Response(new ReadableStream({ cancel() { stalledCanceled = true; } }));
  await assert.rejects(scrapeFirecrawlRawHtml(target, key, { fetchImpl: async () => stalled, timeoutMs: 10 }), /timed out/);
  assert.equal(stalledCanceled, true);
});

test('invalid target configuration or missing keys fail before fetching', async () => {
  let calls = 0; const fake: typeof fetch = async () => { calls++; return success(); };
  for (const url of ['file:///private/secret', 'https://user:pass@texts.test', 'https://example.org']) await assert.rejects(scrapeFirecrawlRawHtml(url, key, { fetchImpl: fake }));
  await assert.rejects(scrapeFirecrawlRawHtml(target, '', { fetchImpl: fake }));
  assert.equal(calls, 0);
});

test('plain fetch remains first and never receives the Firecrawl credential', async () => {
  const html = '<div class="passage-content">' + 'x'.repeat(10000) + '</div>';
  let calls = 0;
  const fake: typeof fetch = async (input, init) => { calls++; assert.equal(input, target); assert.equal(new Headers(init?.headers).has('authorization'), false); return new Response(html); };
  assert.equal(await fetchSourceHtml(target, key, { fetchImpl: fake }), html);
  assert.equal(calls, 1);
});

test('blocked or suspicious plain responses fall back once using the same source URL', async () => {
  for (const plain of [new Response('blocked', { status: 403 }), new Response('bot defense')]) {
    let calls = 0;
    const fake: typeof fetch = async (input, init) => {
      if (++calls === 1) { assert.equal(input, target); assert.equal(new Headers(init?.headers).has('authorization'), false); return plain; }
      assert.equal(JSON.parse(String(init?.body)).url, target); return success();
    };
    assert.equal(await fetchSourceHtml(target, key, { fetchImpl: fake }), '<html>raw page</html>');
    assert.equal(calls, 2);
  }
});

test('plain failure without an API key does not contact Firecrawl', async () => {
  let calls = 0;
  await assert.rejects(fetchSourceHtml(target, '', { fetchImpl: async () => { calls++; return new Response('blocked', { status: 403 }); } }), /Source/);
  assert.equal(calls, 1);
});
