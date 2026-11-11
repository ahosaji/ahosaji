import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChapter, validateSnapshot } from '../src/validate.js';

import { chapter } from './fixtures.js';

const identity = { translation: 'en', usfm: 'JHN', chapterCount: 2 };
const wrapper = () => ({ usfm: 'JHN', source: 'english', _provenance: { retained: true }, chapters: { '1': chapter(), '2': chapter('JHN', 2) } });

test('validates book wrappers and preserves the original chapter objects', () => {
  const raw = wrapper();
  const result = validateSnapshot('en/JHN.json', raw, identity);
  assert.equal(result.ok, true);
  assert.equal(result.stats.verseCount, 2);
  assert.equal(result.chapters[0], raw.chapters['1']);
});

test('rejects empty, unsupported, mismatched and malformed nested imports without throwing', () => {
  for (const raw of [{}, [], { usfm: 'JHN', source: 'english', chapters: {} },
    { ...wrapper(), usfm: 'GEN' }, { ...wrapper(), chapters: { '1': null } },
    { ...wrapper(), chapters: { '01': chapter(), '2': chapter('JHN', 2) } },
    { ...wrapper(), chapters: { '1': chapter('GEN'), '2': chapter('JHN', 2) } },
    { ...wrapper(), chapters: { '1': chapter('JHN', 1, 'ar'), '2': chapter('JHN', 2) } }]) {
    assert.equal(validateSnapshot('en/JHN.json', raw, identity).ok, false, JSON.stringify(raw));
  }
  for (const mutation of [
    (c: any) => { c.verses[0].structured.tokens = [null]; },
    (c: any) => { c.verses[0].structured.footnotes = [null]; },
    (c: any) => { c.verses[0].structured.crossRefs = [1]; },
    (c: any) => { c.verses[0].verse = 1.5; },
    (c: any) => { c.verses = []; },
  ]) {
    const c = chapter(); mutation(c);
    assert.equal(validateChapter('test', c).ok, false);
  }
});

test('missing coverage needs explicit partial mode and legacy chapters remain supported', () => {
  const raw = chapter();
  assert.equal(validateSnapshot('en/JHN.json', raw, identity).ok, false);
  const partial = validateSnapshot('en/JHN.json', raw, identity, { allowPartial: true });
  assert.equal(partial.ok, true);
  assert.match(partial.warnings.join('\n'), /missing chapters: 2/);
});

test('legacy absent italic is visible without mutating JSON, present nonboolean is invalid', () => {
  const c: any = chapter(); delete c.verses[0].structured.tokens[0].italic;
  const before = JSON.stringify(c), r = validateChapter('test', c);
  assert.equal(r.ok, true);
  assert.equal(r.warnings.filter(w => w.includes('legacy missing italic')).length, 1);
  assert.equal(JSON.stringify(c), before);
  c.verses[0].structured.tokens[0].italic = 'false';
  assert.equal(validateChapter('test', c).ok, false);
});

test('duplicate heading target keys and verse gaps are explicit warnings', () => {
  const c: any = chapter();
  c.headings = [{ beforeVerse: 1, text: 'First', level: 1 }, { beforeVerse: 1, text: 'Second', level: 2 }];
  c.verses.push({ ...structuredClone(c.verses[0]), ref: 'JHN.1.3', verse: 3 });
  const r = validateChapter('test', c);
  assert.equal(r.ok, true);
  assert.match(r.warnings.join('\n'), /duplicate heading target/);
  assert.match(r.warnings.join('\n'), /missing verse numbers: 2/);
});

test('file identity and wrapper source labels cannot contradict nested chapter identity', () => {
  assert.equal(validateSnapshot('ar/JHN.json', wrapper(), identity).ok, false);
  const raw = wrapper(); raw.source = 'arabic';
  assert.equal(validateSnapshot('en/JHN.json', raw, identity).ok, false);
});

test('adversarial JSON identity values return validation errors without implicit object coercion', () => {
  const values: unknown[] = [null, false, true, 0, 1.5, '', [], {}, { toString: null }, [{ toString: null }], { toString: { valueOf: null } }];
  for (const value of values) for (const target of ['chapter.book', 'chapter.chapter', 'verse.book', 'verse.chapter', 'verse.verse']) {
    const raw: any = chapter();
    const [scope, key] = target.split('.');
    (scope === 'chapter' ? raw : raw.verses[0])[key!] = JSON.parse(JSON.stringify(value));
    let result: ReturnType<typeof validateChapter> | undefined;
    assert.doesNotThrow(() => { result = validateChapter('adversarial JSON', raw); }, `${target}=${JSON.stringify(value)}`);
    assert.equal(result?.ok, false, `${target}=${JSON.stringify(value)}`);
    assert.ok(result!.errors.length > 0);
    let snapshot: ReturnType<typeof validateSnapshot> | undefined;
    assert.doesNotThrow(() => { snapshot = validateSnapshot('en/JHN.json', raw, identity); }, `legacy ${target}=${JSON.stringify(value)}`);
    assert.equal(snapshot?.ok, false);
  }
});
