import assert from 'node:assert/strict';
import test from 'node:test';
import { readCorpus, assertCorpus } from '../src/lib/snapshots.js';

test('all 156 stored book snapshots validate with explicit existing corpus warnings', async () => {
  const corpus = await readCorpus(); assertCorpus(corpus);
  assert.equal(corpus.snapshots.length, 156);
  assert.equal(corpus.snapshots.reduce((n, s) => n + s.chapters.length, 0), 2686);
  assert.equal(corpus.snapshots.reduce((n, s) => n + s.stats.verseCount, 0), 71588);
  const legacy = Object.fromEntries(corpus.snapshots.map(s => [`${s.translation}/${s.usfm}`, s.warnings.filter(w => w.includes('legacy missing italic')).length]).filter(([, count]) => Number(count) > 0));
  assert.deepEqual(legacy, { 'ar/3MA': 227, 'ar/DAG': 106, 'ar/ESG': 108, 'ar/MAN': 16 });
  assert.equal(corpus.warnings.filter(w => w.includes('duplicate heading target')).length, 118);
  assert.equal(corpus.warnings.filter(w => w.includes('missing verse numbers')).length, 1);
  assert.equal(corpus.warnings.filter(w => w.includes('separately as DAG')).length, 2);
});
