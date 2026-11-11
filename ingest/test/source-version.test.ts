import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIngestConfig, requireSourceVersion } from '../src/lib/config.js';
import { scrapesourceChapter } from '../src/scrapers/webSource.js';

test('SOURCE_VERSION stays optional for unrelated ingestion commands but is required on English HTTP use', async () => {
  assert.equal(parseIngestConfig({}).sourceVersion, '');
  assert.equal(requireSourceVersion(' fixture-v1 '), 'fixture-v1');
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error('must not fetch'); };
  for (const version of ['', '   ', 'has spaces', 'bad&query', 'bad/path', 'x'.repeat(65)]) {
    assert.throws(() => requireSourceVersion(version), /SOURCE_VERSION/);
    await assert.rejects(scrapesourceChapter({ version, bookName: 'John', bookUsfm: 'JHN', chapter: 1 }, {
      baseUrl: 'https://texts.test', firecrawlApiKey: '', fetchImpl,
    }), /SOURCE_VERSION/);
  }
  assert.equal(calls, 0);
});

test('the configured provider version reaches the request while the internal English source label stays stable', async () => {
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('version'), 'fixture-v1');
    return new Response('<div class="passage-content"><span class="text John-1-1">Example verse.</span></div><!--' + 'x'.repeat(10000) + '-->');
  };
  const config = parseIngestConfig({ SOURCE_VERSION: 'fixture-v1' });
  const chapter = await scrapesourceChapter({ version: config.sourceVersion, bookName: 'John', bookUsfm: 'JHN', chapter: 1 }, {
    baseUrl: 'https://texts.test', firecrawlApiKey: '', fetchImpl,
  });
  assert.equal(chapter.source, 'english');
  assert.equal(chapter.verses[0]?.text, 'Example verse.');
});
