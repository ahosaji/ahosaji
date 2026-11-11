/**
 * Hand-rolled validator for the canonical Chapter shape.
 *
 * Returns a ValidationResult with errors[] (empty on success) and warnings[]
 * (non-fatal advisories). Used by Day 5 schema-convergence script.
 *
 * Why hand-rolled rather than zod: this is a one-off prototype-validation
 * tool; adding a runtime-validation dep is overkill until we wire up API-input
 * validation in v1.x.
 */

import type { Chapter, Verse, Heading, Token, Footnote } from './types/canonical.js';
import { basename, dirname } from 'node:path';

export interface ValidationResult {
  file: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    verseCount: number;
    headingCount: number;
    footnoteCount: number;
    italicTokenCount: number;
    redLetterTokenCount: number;
    totalChars: number;
  };
}

const TRANSLATIONS = new Set(['en', 'ar']);
const SOURCES_KNOWN = new Set(['english', 'arabic', 'source:English', 'an Arabic source', 'English', 'English-English']);
const USFM_PATTERN = /^[A-Z0-9]{3}$/;
const REF_PATTERN = /^[A-Z0-9]{3}\.\d+\.\d+$/;
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
// JSON inputs may shadow toString/valueOf. Diagnostics must never coerce their objects.
function formatValue(value: unknown): string {
  try { return JSON.stringify(value) ?? '[undefined]'; }
  catch { return '[unserializable value]'; }
}

export function validateChapter(file: string, raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = {
    verseCount: 0,
    headingCount: 0,
    footnoteCount: 0,
    italicTokenCount: 0,
    redLetterTokenCount: 0,
    totalChars: 0,
  };

  if (!isRecord(raw)) {
    return { file, ok: false, errors: ['root is not an object'], warnings, stats };
  }
  const c = raw as Partial<Chapter>;

  // Top-level required fields
  if (typeof c.translation !== 'string' || !TRANSLATIONS.has(c.translation)) {
    errors.push(`translation must be one of ${[...TRANSLATIONS].join(',')} (got ${formatValue(c.translation)})`);
  }
  if (typeof c.source !== 'string' || !c.source.trim()) {
    errors.push('source must be string');
  } else if (!SOURCES_KNOWN.has(c.source)) {
    warnings.push(`source "${c.source}" is not in the registered set ${[...SOURCES_KNOWN].join(', ')}`);
  }
  if (typeof c.book !== 'string' || !USFM_PATTERN.test(c.book)) {
    errors.push(`book must be a 3-char USFM code (got ${formatValue(c.book)})`);
  }
  if (typeof c.chapter !== 'number' || !Number.isSafeInteger(c.chapter) || c.chapter < 1) {
    errors.push(`chapter must be positive integer (got ${formatValue(c.chapter)})`);
  }
  if (typeof c.fetchedAt !== 'string' || isNaN(Date.parse(c.fetchedAt))) {
    errors.push(`fetchedAt must be ISO date string (got ${formatValue(c.fetchedAt)})`);
  }
  if (!Array.isArray(c.verses)) {
    errors.push('verses must be an array');
    return { file, ok: errors.length === 0, errors, warnings, stats };
  }
  if (!Array.isArray(c.headings)) {
    errors.push('headings must be an array');
  }
  if (c.verses.length === 0) errors.push('verses must be a non-empty array');

  const seenVerses = new Set<number>();
  let lastVerseNum = 0;
  for (let i = 0; i < c.verses.length; i++) {
    const v = c.verses[i] as Partial<Verse>;
    const where = `verses[${i}]`;
    if (!isRecord(v)) { errors.push(`${where} is not an object`); continue; }
    if (typeof v.ref !== 'string' || !REF_PATTERN.test(v.ref)) errors.push(`${where}.ref invalid: ${formatValue(v.ref)}`);
    if (v.book !== c.book) errors.push(`${where}.book=${formatValue(v.book)} mismatches chapter.book=${formatValue(c.book)}`);
    if (v.chapter !== c.chapter) errors.push(`${where}.chapter=${formatValue(v.chapter)} mismatches chapter.chapter=${formatValue(c.chapter)}`);
    if (typeof v.verse !== 'number' || !Number.isSafeInteger(v.verse) || v.verse < 1) errors.push(`${where}.verse must be positive integer`);
    if (typeof v.text !== 'string' || !v.text.trim()) errors.push(`${where}.text must be non-empty string`);
    if (typeof v.text === 'string') stats.totalChars += v.text.length;

    // Ref ↔ fields consistency
    if (typeof v.ref === 'string' && typeof v.book === 'string' && typeof v.chapter === 'number' && typeof v.verse === 'number') {
      const expected = `${v.book}.${v.chapter}.${v.verse}`;
      if (v.ref !== expected) errors.push(`${where}.ref="${v.ref}" doesn't match book.chapter.verse="${expected}"`);
    }

    // Verse ordering and uniqueness
    if (typeof v.verse === 'number') {
      if (seenVerses.has(v.verse)) errors.push(`${where}.verse=${v.verse} is a duplicate`);
      seenVerses.add(v.verse);
      if (v.verse < lastVerseNum) warnings.push(`${where}.verse=${v.verse} comes after ${lastVerseNum} (out of order)`);
      lastVerseNum = v.verse;
    }

    // structured
    const s = v.structured;
    if (!isRecord(s)) {
      errors.push(`${where}.structured must be an object`);
      continue;
    }
    if (!Array.isArray(s.tokens)) errors.push(`${where}.structured.tokens must be an array`);
    else {
      if (s.tokens.length === 0) errors.push(`${where}.structured.tokens must be non-empty`);
      for (let j = 0; j < s.tokens.length; j++) {
        const t = s.tokens[j] as Partial<Token>;
        const w = `${where}.structured.tokens[${j}]`;
        if (!isRecord(t)) { errors.push(`${w} must be an object`); continue; }
        if (typeof t.text !== 'string') errors.push(`${w}.text must be string`);
        if (!('italic' in t)) warnings.push(`${w}: legacy missing italic flag (unmarked style; source JSON preserved)`);
        else if (typeof t.italic !== 'boolean') errors.push(`${w}.italic must be boolean`);
        if (typeof t.redLetter !== 'boolean') errors.push(`${w}.redLetter must be boolean`);
        if (t.italic) stats.italicTokenCount++;
        if (t.redLetter) stats.redLetterTokenCount++;
      }
    }
    if (!Array.isArray(s.footnotes)) errors.push(`${where}.structured.footnotes must be an array`);
    else {
      for (let j = 0; j < s.footnotes.length; j++) {
        const f = s.footnotes[j] as Partial<Footnote>;
        const w = `${where}.structured.footnotes[${j}]`;
        if (!isRecord(f)) { errors.push(`${w} must be an object`); continue; }
        if (typeof f.marker !== 'string') errors.push(`${w}.marker must be string`);
        if (typeof f.text !== 'string') errors.push(`${w}.text must be string`);
        stats.footnoteCount++;
      }
    }
    if (!Array.isArray(s.crossRefs) || !s.crossRefs.every(x => typeof x === 'string')) errors.push(`${where}.structured.crossRefs must be a string array`);
    if (s.heading !== null && typeof s.heading !== 'string') errors.push(`${where}.structured.heading must be string|null`);
    if (typeof s.paragraphStart !== 'boolean') errors.push(`${where}.structured.paragraphStart must be boolean`);
    if (typeof s.poetic !== 'boolean') errors.push(`${where}.structured.poetic must be boolean`);
    if (s.poeticLines !== null && (!Array.isArray(s.poeticLines) || !s.poeticLines.every(x => typeof x === 'string'))) errors.push(`${where}.structured.poeticLines must be string[]|null`);
  }
  stats.verseCount = c.verses.length;
  let expected = 1;
  const gaps: string[] = [];
  for (const n of [...seenVerses].filter(n => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b)) {
    if (n > expected) gaps.push(n === expected + 1 ? String(expected) : `${expected}-${n - 1}`);
    expected = n + 1;
  }
  if (gaps.length) warnings.push(`missing verse numbers: ${gaps.join(', ')}`);

  // Headings cross-check
  if (Array.isArray(c.headings)) {
    const targets = new Set<number>();
    stats.headingCount = c.headings.length;
    for (let i = 0; i < c.headings.length; i++) {
      const h = c.headings[i] as Partial<Heading>;
      const where = `headings[${i}]`;
      if (!isRecord(h)) { errors.push(`${where} is not an object`); continue; }
      if (typeof h.beforeVerse !== 'number' || !Number.isSafeInteger(h.beforeVerse) || h.beforeVerse < 1) errors.push(`${where}.beforeVerse must be positive integer`);
      if (typeof h.text !== 'string' || h.text.length === 0) errors.push(`${where}.text must be non-empty string`);
      if (typeof h.level !== 'number' || !Number.isSafeInteger(h.level) || h.level < 1) errors.push(`${where}.level must be positive integer`);
      if (typeof h.beforeVerse === 'number') {
        if (targets.has(h.beforeVerse)) warnings.push(`${where}: duplicate heading target before verse ${h.beforeVerse}; stores with one heading per verse retain the last heading`);
        targets.add(h.beforeVerse);
      }
      if (typeof h.beforeVerse === 'number' && !seenVerses.has(h.beforeVerse)) {
        errors.push(`${where}.beforeVerse=${h.beforeVerse} doesn't reference any extracted verse`);
      }
      // Cross-check: heading-on-verse should also appear as that verse's structured.heading
      if (typeof h.beforeVerse === 'number' && typeof h.text === 'string') {
        const v = (c.verses ?? []).find(vv => vv?.verse === h.beforeVerse);
        if (v && v.structured?.heading !== h.text) {
          warnings.push(`headings[${i}] (before v${h.beforeVerse}: "${h.text}") doesn't match verses[].structured.heading (got: ${formatValue(v.structured?.heading)})`);
        }
      }
    }
  }

  return { file, ok: errors.length === 0, errors, warnings, stats };
}

export interface SnapshotIdentity { translation: string; usfm: string; chapterCount?: number }
export interface ValidationOptions { allowPartial?: boolean }
export interface SnapshotValidation extends ValidationResult { chapters: Chapter[] }

/** Validate every record, without filtering malformed chapters or rewriting provenance. */
export function validateSnapshot(file: string, raw: unknown, identity: SnapshotIdentity, options: ValidationOptions = {}): SnapshotValidation {
  const errors: string[] = [], warnings: string[] = [], chapters: Chapter[] = [];
  const stats = { verseCount: 0, headingCount: 0, footnoteCount: 0, italicTokenCount: 0, redLetterTokenCount: 0, totalChars: 0 };
  const result = (): SnapshotValidation => ({ file, ok: errors.length === 0, errors, warnings, chapters, stats });
  if (!TRANSLATIONS.has(identity.translation) || !USFM_PATTERN.test(identity.usfm)) errors.push('invalid file translation/book identity');
  if (file.endsWith('.json') && (basename(file, '.json') !== identity.usfm || basename(dirname(file)) !== identity.translation)) errors.push('file path does not match translation/book identity');
  if (!isRecord(raw)) { errors.push('snapshot root must be an object'); return result(); }
  let records: Array<[string, unknown]>;
  if ('chapters' in raw) {
    if (raw.usfm !== identity.usfm) errors.push('wrapper.usfm does not match file identity');
    if (typeof raw.source !== 'string' || !raw.source.trim()) errors.push('wrapper.source must be a non-empty string');
    if (!isRecord(raw.chapters) || !Object.keys(raw.chapters).length) { errors.push('chapters must be a non-empty object'); return result(); }
    records = Object.entries(raw.chapters);
  } else if ('verses' in raw) records = [[typeof raw.chapter === 'number' ? String(raw.chapter) : '[invalid chapter]', raw]];
  else { errors.push('unsupported snapshot: expected book chapters or a chapter record'); return result(); }
  const seen = new Set<number>();
  for (const [key, chapter] of records) {
    const at = `chapters[${JSON.stringify(key)}]`;
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key))) errors.push(`${at}: invalid chapter key`);
    if (isRecord(chapter)) {
      if (chapter.chapter !== Number(key)) errors.push(`${at}: key does not match chapter.chapter`);
      if (chapter.book !== identity.usfm) errors.push(`${at}: book does not match file identity`);
      if (chapter.translation !== identity.translation) errors.push(`${at}: translation does not match file identity`);
      if ((raw.source === 'arabic' || raw.source === 'english') && chapter.source !== raw.source) errors.push(`${at}: source does not match wrapper source identity`);
      if (typeof chapter.chapter === 'number') { if (seen.has(chapter.chapter)) errors.push(`${at}: duplicate chapter`); seen.add(chapter.chapter); }
    }
    const r = validateChapter(`${file}#${key}`, chapter);
    errors.push(...r.errors.map(e => `${at}: ${e}`)); warnings.push(...r.warnings.map(w => `${at}: ${w}`));
    for (const k of Object.keys(stats) as Array<keyof typeof stats>) stats[k] += r.stats[k];
    if (r.ok) chapters.push(chapter as Chapter);
  }
  if (identity.chapterCount !== undefined) {
    const missing: number[] = [];
    for (let n = 1; n <= identity.chapterCount; n++) if (!seen.has(n)) missing.push(n);
    const extra = [...seen].filter(n => n > identity.chapterCount!);
    if (extra.length) errors.push(`chapters exceed registry coverage: ${extra.join(', ')}`);
    if (missing.length) {
      const message = `missing chapters: ${missing.join(', ')} (registry expects ${identity.chapterCount})`;
      const danielSplit = identity.usfm === 'DAN' && identity.chapterCount === 14 && seen.size === 12 && missing.join(',') === '13,14';
      if (danielSplit) warnings.push(`${message}; existing Daniel additions are stored separately as DAG`);
      else if (options.allowPartial) warnings.push(`${message}; explicit partial import`);
      else errors.push(message);
    }
  }
  chapters.sort((a, b) => a.chapter - b.chapter);
  return result();
}
