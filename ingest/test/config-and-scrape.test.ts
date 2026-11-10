import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIngestConfig, sourceEndpoint } from '../src/lib/config.js';
import { collectChapters, completenessExitCode, collectBooks } from '../src/lib/scrapeRun.js';
import { chapter } from './fixtures.js';

test('PDF configuration prefers SOURCE_PDF_PATH and retains the legacy alias', () => {
  assert.equal(parseIngestConfig({ SOURCE_PDF_PATH: '/new.pdf', English_PDF_PATH: '/old.pdf' }).deuteroPdfPath, '/new.pdf');
  assert.equal(parseIngestConfig({ English_PDF_PATH: '/old.pdf' }).deuteroPdfPath, '/old.pdf');
  assert.equal(parseIngestConfig({}).deuteroPdfPath, '');
});

test('source endpoints require explicitly configured valid HTTP(S) URLs', () => {
  for (const value of ['', 'not a URL', 'file:///tmp/source', 'https://user:pass@host.test', 'https://example.org']) assert.throws(() => sourceEndpoint(value, 'passage/'));
  assert.equal(sourceEndpoint('https://texts.test/base/', 'passage/').href, 'https://texts.test/base/passage/');
  assert.throws(() => parseIngestConfig({ AR_BASE_URL: 'bad' }));
});

test('chapter failure manifests include cached, successful, failed and missing work', async () => {
  const result = await collectChapters({ book: 'JHN', translation: 'en', expected: [1,2,3], requested: [1,2,3], cached: { 1: chapter() },
    scrape: async n => { if (n === 3) throw new Error('source unavailable'); return chapter('JHN', n); } });
  assert.deepEqual(result.manifest.cached, [1]); assert.deepEqual(result.manifest.succeeded, [2]);
  assert.deepEqual(result.manifest.missing, [3]); assert.deepEqual(result.manifest.failed, [{ chapter: 3, error: 'source unavailable' }]);
  assert.equal(completenessExitCode(result.manifest), 1); assert.equal(completenessExitCode(result.manifest, true), 0);
});

test('invalid scraped identity is a failed chapter and an invalid cache never skips work', async () => {
  const result = await collectChapters({ book: 'JHN', translation: 'en', expected: [1], requested: [1], cached: {}, scrape: async () => chapter('GEN') });
  assert.equal(result.manifest.complete, false); assert.equal(Object.keys(result.chapters).length, 0);
  await assert.rejects(collectChapters({ book: 'JHN', translation: 'en', expected: [1], requested: [1], cached: { 1: chapter('GEN') }, scrape: async () => chapter() }), /cached/);
});

test('book aggregation records spawn failures and child nonzero statuses', async () => {
  const result = await collectBooks(['JHN','GEN','EXO'], async book => { if (book === 'GEN') throw new Error('spawn failed'); return book === 'EXO' ? 1 : 0; });
  assert.deepEqual(result.succeeded, ['JHN']); assert.equal(result.failed.length, 2);
  assert.equal(completenessExitCode(result), 1); assert.equal(completenessExitCode(result, true), 0);
});
