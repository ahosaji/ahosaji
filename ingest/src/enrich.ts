/**
 * Cross-translation enrichment helpers.
 *
 * Two passes for v0:
 *   1. Red-letter transfer en→ar (verse-level): if a verse has any red-letter
 *      content in the source translation, mark the entire verse red-letter in
 *      the target. Verse-level rather than sub-verse because Arabic word order
 *      diverges enough from English that proportional offset mapping is lossy.
 *   2. Cross-references applied to both translations from a shared dataset.
 *
 * Limitations (documented for honest disclosure):
 *   - Verse-level red-letter slightly over-marks in verses with mixed
 *     speaker/narrator content (e.g. "Jesus answered and said" + actual quote);
 *     the entire Arabic verse including the narrative introducer becomes red.
 *   - Sub-verse precision deferred to v1.1 if needed.
 */

import type { Chapter, Verse } from './types/canonical.js';

export interface CrossRefEntry {
  from: string;     // 'JHN.3.16'
  to: string[];     // ['ROM.5.8', '1JN.4.9']
}

export interface CrossRefSet {
  tradition: string;        // 'TSK'
  refs: CrossRefEntry[];
}

/**
 * Build a verse → "any-red-letter" map from a source chapter.
 * Returns Set<verseNumber> of verses with at least one red-letter token.
 */
export function deriveRedLetterVerses(source: Chapter): Set<number> {
  const result = new Set<number>();
  for (const v of source.verses) {
    if (v.structured.tokens.some(t => t.redLetter)) {
      result.add(v.verse);
    }
  }
  return result;
}

/**
 * Apply red-letter at verse-level to a target chapter, in place.
 * Each verse marked is given a single red-letter token spanning its full text.
 * Already-tokenized verses are kept (only sets all tokens to redLetter=true).
 */
export function applyRedLetter(target: Chapter, redLetterVerses: Set<number>): {
  versesEnriched: number;
  tokensFlipped: number;
} {
  let versesEnriched = 0;
  let tokensFlipped = 0;
  for (const v of target.verses) {
    if (!redLetterVerses.has(v.verse)) continue;
    versesEnriched++;
    for (const t of v.structured.tokens) {
      if (!t.redLetter) {
        t.redLetter = true;
        tokensFlipped++;
      }
    }
  }
  return { versesEnriched, tokensFlipped };
}

/**
 * Apply cross-references to a chapter, in place. Translation-independent —
 * runs identically against en and ar snapshots of the same book/chapter.
 */
export function applyCrossRefs(target: Chapter, set: CrossRefSet): {
  versesEnriched: number;
  refsAdded: number;
} {
  let versesEnriched = 0;
  let refsAdded = 0;
  const byVerse = new Map<number, string[]>();
  for (const entry of set.refs) {
    const m = entry.from.match(/^([A-Z0-9]{3})\.(\d+)\.(\d+)$/);
    if (!m) continue;
    if (m[1] !== target.book || Number(m[2]) !== target.chapter) continue;
    const vn = Number(m[3]);
    const merged = [...(byVerse.get(vn) ?? []), ...entry.to];
    byVerse.set(vn, merged);
  }
  for (const v of target.verses) {
    const adds = byVerse.get(v.verse);
    if (!adds || adds.length === 0) continue;
    const existing = new Set(v.structured.crossRefs);
    let beforeCount = existing.size;
    for (const r of adds) existing.add(r);
    v.structured.crossRefs = [...existing];
    if (existing.size > beforeCount) {
      versesEnriched++;
      refsAdded += existing.size - beforeCount;
    }
  }
  return { versesEnriched, refsAdded };
}
