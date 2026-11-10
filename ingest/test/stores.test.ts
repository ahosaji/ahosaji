import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCorpus } from '../src/lib/snapshots.js';
import { replacePostgres } from '../src/lib/postgresImport.js';
import { replaceSearchIndexes } from '../src/lib/searchImport.js';
import { chapter } from './fixtures.js';

async function fixture(raw: unknown, run: (paths: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ahosaji-ingest-test-'));
  try {
    await mkdir(join(root, 'en')); await mkdir(join(root, 'ar')); await mkdir(join(root, 'refs'));
    const booksPath = join(root, 'books.json');
    await writeFile(booksPath, JSON.stringify({ books: [{ usfm: 'JHN', name_en: 'John', name_ar: 'John', testament: 'NT', canon: 'protocanonical', book_order: 1, chapter_count: 1 }] }));
    await writeFile(join(root, 'en/JHN.json'), JSON.stringify(raw));
    await writeFile(join(root, 'ar/JHN.json'), JSON.stringify(chapter('JHN', 1, 'ar')));
    await run({ snapshotsRoot: root, booksPath, crossrefsRoot: join(root, 'refs') });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('complete preflight rejects malformed or empty input before opening the database', async () => {
  for (const raw of [{}, { usfm: 'JHN', source: 'english', chapters: {} }, chapter('GEN')]) await fixture(raw, async paths => {
    let opened = false;
    await assert.rejects(replacePostgres(() => readCorpus(paths), async () => { opened = true; throw new Error('must not open'); }), /validation/i);
    assert.equal(opened, false);
  });
});

test('Postgres rolls back replacement when an insertion fails', async () => {
  await fixture(chapter(), async paths => {
    const queries: string[] = [];
    await assert.rejects(replacePostgres(() => readCorpus(paths), async () => ({
      query: async (sql: string) => { queries.push(sql); if (sql.startsWith('INSERT INTO verses')) throw new Error('insertion failed'); },
    })), /insertion failed/);
    assert.ok(queries.includes('BEGIN')); assert.ok(queries.some(q => q.startsWith('DELETE FROM verses')));
    assert.equal(queries.at(-1), 'ROLLBACK'); assert.equal(queries.includes('COMMIT'), false);
  });
});

class FakeSearch {
  events: string[] = []; statuses = new Map<number, string>(); next = 1;
  documents = new Map<string, any[]>(); settings = new Map<string, any>(); live = new Set(['verses_en', 'verses_ar']);
  fail?: string; mismatch = false;
  task(label: string) { this.events.push(label); const id = this.next++; this.statuses.set(id, label === this.fail ? 'failed' : 'succeeded'); return { taskUid: id }; }
  async waitForTask(id: number) { return { status: this.statuses.get(id)!, error: { message: 'fake failure' } }; }
  async createIndex(name: string) { return this.task('create:' + name.split('__')[0]); }
  async getIndex(name: string) { if (!this.live.has(name)) throw { cause: { code: 'index_not_found' } }; return {}; }
  index(name: string) { return {
    updateSettings: async (s: any) => { this.settings.set(name, s); return this.task('settings:' + name.split('__')[0]); },
    addDocuments: async (docs: any[]) => { this.documents.set(name, docs); return this.task('documents:' + name.split('__')[0]); },
    getSettings: async () => this.settings.get(name),
    getStats: async () => ({ numberOfDocuments: this.mismatch ? 999 : this.documents.get(name)!.length }),
  }; }
  async swapIndexes(pairs: Array<{ indexes: string[] }>) { this.events.push('swap-pairs:' + pairs.length); return this.task('swap'); }
  async deleteIndex(name: string) { return this.task('delete:' + name); }
}

test('search builds both indexes before one atomic publication and only cleans known staging names', async () => {
  await fixture(chapter(), async paths => {
    const client = new FakeSearch(); await replaceSearchIndexes(await readCorpus(paths), client, 'test');
    assert.equal(client.events.filter(x => x === 'swap').length, 1);
    assert.ok(client.events.indexOf('documents:verses_ar') < client.events.indexOf('swap'));
    assert.ok(client.events.indexOf('documents:verses_en') < client.events.indexOf('swap'));
    assert.ok(client.events.includes('swap-pairs:2'));
    assert.ok(client.events.filter(x => x.startsWith('delete:')).every(x => x.includes('__build_test')));
  });
});

for (const failed of ['create:verses_en', 'settings:verses_en', 'documents:verses_ar', 'swap']) test(`search preserves existing indexes when ${failed} fails`, async () => {
  await fixture(chapter(), async paths => {
    const client = new FakeSearch(); client.fail = failed;
    await assert.rejects(replaceSearchIndexes(await readCorpus(paths), client, 'test'), /failed/);
    assert.equal(client.events.some(e => e === 'delete:verses_en' || e === 'delete:verses_ar'), false);
    if (failed !== 'swap') assert.equal(client.events.includes('swap'), false);
  });
});

test('search refuses mismatched staging counts and canceled tasks', async () => {
  await fixture(chapter(), async paths => {
    const corpus = await readCorpus(paths), client = new FakeSearch(); client.mismatch = true;
    await assert.rejects(replaceSearchIndexes(corpus, client, 'test'), /count/);
    assert.equal(client.events.includes('swap'), false);
    const canceled = new FakeSearch(); canceled.waitForTask = async () => ({ status: 'canceled', error: { message: 'canceled' } });
    await assert.rejects(replaceSearchIndexes(corpus, canceled, 'test'), /canceled/);
  });
});

test('search leaves staging from a failed creation untouched and checks settings before swapping', async () => {
  await fixture(chapter(), async paths => {
    const corpus = await readCorpus(paths), creation = new FakeSearch(); creation.fail = 'create:verses_ar';
    await assert.rejects(replaceSearchIndexes(corpus, creation, 'test'));
    assert.equal(creation.events.some(e => e === 'delete:verses_ar__build_test'), false);
    const settings = new FakeSearch();
    const original = settings.index.bind(settings);
    settings.index = name => ({ ...original(name), getSettings: async () => ({ searchableAttributes: [] }) });
    await assert.rejects(replaceSearchIndexes(corpus, settings, 'test'), /settings verification/);
    assert.equal(settings.events.includes('swap'), false);
  });
});

test('invalid corpus cannot start any search task', async () => {
  await fixture({}, async paths => {
    const client = new FakeSearch();
    await assert.rejects(replaceSearchIndexes(await readCorpus(paths), client, 'test'), /validation/i);
    assert.deepEqual(client.events, []);
  });
});
