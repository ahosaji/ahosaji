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
const SOURCES_KNOWN = new Set(['source:English', 'an Arabic source', 'English']);
const USFM_PATTERN = /^[A-Z0-9]{3}$/;
const REF_PATTERN = /^[A-Z0-9]{3}\.\d+\.\d+$/;

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

  if (typeof raw !== 'object' || raw === null) {
    return { file, ok: false, errors: ['root is not an object'], warnings, stats };
  }
  const c = raw as Partial<Chapter>;

  // Top-level required fields
  if (typeof c.translation !== 'string' || !TRANSLATIONS.has(c.translation)) {
    errors.push(`translation must be one of ${[...TRANSLATIONS].join(',')} (got ${JSON.stringify(c.translation)})`);
  }
  if (typeof c.source !== 'string') {
    errors.push('source must be string');
  } else if (!SOURCES_KNOWN.has(c.source)) {
    warnings.push(`source "${c.source}" is not in the registered set ${[...SOURCES_KNOWN].join(', ')}`);
  }
  if (typeof c.book !== 'string' || !USFM_PATTERN.test(c.book)) {
    errors.push(`book must be a 3-char USFM code (got ${JSON.stringify(c.book)})`);
  }
  if (typeof c.chapter !== 'number' || !Number.isInteger(c.chapter) || c.chapter < 1) {
    errors.push(`chapter must be positive integer (got ${JSON.stringify(c.chapter)})`);
  }
  if (typeof c.fetchedAt !== 'string' || isNaN(Date.parse(c.fetchedAt))) {
    errors.push(`fetchedAt must be ISO date string (got ${JSON.stringify(c.fetchedAt)})`);
  }
  if (!Array.isArray(c.verses)) {
    errors.push('verses must be an array');
    return { file, ok: errors.length === 0, errors, warnings, stats };
  }
  if (!Array.isArray(c.headings)) {
    errors.push('headings must be an array');
  }

  const seenVerses = new Set<number>();
  let lastVerseNum = 0;
  for (let i = 0; i < c.verses.length; i++) {
    const v = c.verses[i] as Partial<Verse>;
    const where = `verses[${i}]`;
    if (typeof v !== 'object' || v === null) { errors.push(`${where} is not an object`); continue; }
    if (typeof v.ref !== 'string' || !REF_PATTERN.test(v.ref)) errors.push(`${where}.ref invalid: ${JSON.stringify(v.ref)}`);
    if (v.book !== c.book) errors.push(`${where}.book="${v.book}" mismatches chapter.book="${c.book}"`);
    if (v.chapter !== c.chapter) errors.push(`${where}.chapter=${v.chapter} mismatches chapter.chapter=${c.chapter}`);
    if (typeof v.verse !== 'number' || v.verse < 1) errors.push(`${where}.verse must be positive integer`);
    if (typeof v.text !== 'string' || v.text.length === 0) errors.push(`${where}.text must be non-empty string`);
    if (typeof v.text === 'string') stats.totalChars += v.text.length;

    // Ref ↔ fields consistency
    if (typeof v.ref === 'string') {
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
    if (typeof s !== 'object' || s === null) {
      errors.push(`${where}.structured must be an object`);
      continue;
    }
    if (!Array.isArray(s.tokens)) errors.push(`${where}.structured.tokens must be an array`);
    else {
      for (let j = 0; j < s.tokens.length; j++) {
        const t = s.tokens[j] as Partial<Token>;
        const w = `${where}.structured.tokens[${j}]`;
        if (typeof t.text !== 'string') errors.push(`${w}.text must be string`);
        if (typeof t.italic !== 'boolean') errors.push(`${w}.italic must be boolean`);
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
        if (typeof f.marker !== 'string') errors.push(`${w}.marker must be string`);
        if (typeof f.text !== 'string') errors.push(`${w}.text must be string`);
        stats.footnoteCount++;
      }
    }
    if (!Array.isArray(s.crossRefs)) errors.push(`${where}.structured.crossRefs must be an array`);
    if (s.heading !== null && typeof s.heading !== 'string') errors.push(`${where}.structured.heading must be string|null`);
    if (typeof s.paragraphStart !== 'boolean') errors.push(`${where}.structured.paragraphStart must be boolean`);
    if (typeof s.poetic !== 'boolean') errors.push(`${where}.structured.poetic must be boolean`);
    if (s.poeticLines !== null && !Array.isArray(s.poeticLines)) errors.push(`${where}.structured.poeticLines must be array|null`);
  }
  stats.verseCount = c.verses.length;

  // Headings cross-check
  if (Array.isArray(c.headings)) {
    stats.headingCount = c.headings.length;
    for (let i = 0; i < c.headings.length; i++) {
      const h = c.headings[i] as Partial<Heading>;
      const where = `headings[${i}]`;
      if (typeof h !== 'object' || h === null) { errors.push(`${where} is not an object`); continue; }
      if (typeof h.beforeVerse !== 'number' || h.beforeVerse < 1) errors.push(`${where}.beforeVerse must be positive integer`);
      if (typeof h.text !== 'string' || h.text.length === 0) errors.push(`${where}.text must be non-empty string`);
      if (typeof h.level !== 'number' || h.level < 1) errors.push(`${where}.level must be positive integer`);
      if (typeof h.beforeVerse === 'number' && !seenVerses.has(h.beforeVerse)) {
        errors.push(`${where}.beforeVerse=${h.beforeVerse} doesn't reference any extracted verse`);
      }
      // Cross-check: heading-on-verse should also appear as that verse's structured.heading
      if (typeof h.beforeVerse === 'number' && typeof h.text === 'string') {
        const v = (c.verses ?? []).find(vv => vv?.verse === h.beforeVerse);
        if (v && v.structured?.heading !== h.text) {
          warnings.push(`headings[${i}] (before v${h.beforeVerse}: "${h.text}") doesn't match verses[].structured.heading (got: ${JSON.stringify(v.structured?.heading)})`);
        }
      }
    }
  }

  return { file, ok: errors.length === 0, errors, warnings, stats };
}
