import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  applyCrossRefs,
  applyRedLetter,
  deriveRedLetterVerses,
  type CrossRefSet,
} from '../enrich.js';
import type { Chapter } from '../types/canonical.js';

const SNAP_DIR = resolve(import.meta.dirname, '../../data/snapshots');
const CR_FILE = resolve(import.meta.dirname, '../../data/shared/crossrefs/JHN.3.json');

async function readChapter(path: string): Promise<Chapter> {
  return JSON.parse(await readFile(path, 'utf8')) as Chapter;
}

async function writeChapter(path: string, c: Chapter): Promise<void> {
  await writeFile(path, JSON.stringify(c, null, 2), 'utf8');
}

async function main(): Promise<void> {
  console.log('Day 6 enrichment for JHN 3 — red-letter (en→ar) + cross-references (both)\n');

  const enPath = resolve(SNAP_DIR, 'en/JHN.json');
  const arPath = resolve(SNAP_DIR, 'ar/JHN.json');
  const en = await readChapter(enPath);
  const ar = await readChapter(arPath);
  const crSet = JSON.parse(await readFile(CR_FILE, 'utf8')) as CrossRefSet;

  // Pass 1: red-letter en→ar (verse-level)
  const redLetterVerses = deriveRedLetterVerses(en);
  console.log(`Red-letter verses derived from en/JHN: [${[...redLetterVerses].join(', ')}]`);
  const rlResult = applyRedLetter(ar, redLetterVerses);
  console.log(`  → ar/JHN: ${rlResult.versesEnriched} verses marked, ${rlResult.tokensFlipped} tokens flipped`);

  // Pass 2: cross-references (both translations from same dataset)
  const enCr = applyCrossRefs(en, crSet);
  const arCr = applyCrossRefs(ar, crSet);
  console.log(`Cross-references applied (TSK):`);
  console.log(`  → en/JHN: ${enCr.versesEnriched} verses got ${enCr.refsAdded} new refs`);
  console.log(`  → ar/JHN: ${arCr.versesEnriched} verses got ${arCr.refsAdded} new refs`);

  await writeChapter(enPath, en);
  await writeChapter(arPath, ar);

  console.log('\n✓ wrote enriched ' + enPath);
  console.log('✓ wrote enriched ' + arPath);

  // Spot-check JHN.3.16
  console.log();
  for (const [label, c] of [['en', en], ['ar', ar]] as const) {
    const v = c.verses.find(x => x.verse === 16);
    if (!v) continue;
    const rl = v.structured.tokens.filter(t => t.redLetter).length;
    const tot = v.structured.tokens.length;
    console.log(`${label}/JHN.3.16: ${rl}/${tot} tokens red-letter, ${v.structured.crossRefs.length} crossRefs`);
    console.log(`  crossRefs: ${v.structured.crossRefs.join(', ')}`);
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
