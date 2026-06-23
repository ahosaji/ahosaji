import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractDeuteroChapter } from '../scrapers/deuteroScraper.js';

async function main(): Promise<void> {
  console.log('Extracting Tobit 1 (English) from PDF...');

  const chapter = await extractDeuteroChapter({
    bookUsfm: 'TOB',
    chapter: 1,
    startPage: 1346,    // PyMuPDF probe confirmed 'This is the book of Tobit' begins here
    endPage: 1347,      // chapter 1 verses 19-22 spill onto p1347 before chapter 2 starts
    maxVerse: 22,       // English Tobit 1 has 22 verses
  });

  const outDir = resolve(import.meta.dirname, '../../data/snapshots/en');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'TOB.json');
  await writeFile(outFile, JSON.stringify(chapter, null, 2), 'utf8');

  console.log(`✓ wrote ${outFile}\n`);
  console.log('Summary:');
  console.log(`  verses:   ${chapter.verses.length} (expected 22)`);
  console.log(`  headings: ${chapter.headings.length}`);
  console.log();

  const v1 = chapter.verses.find(v => v.verse === 1);
  if (v1) {
    console.log('TOB 1:1');
    console.log(`  text: ${v1.text.slice(0, 200)}${v1.text.length > 200 ? '…' : ''}`);
  }
  const v22 = chapter.verses.find(v => v.verse === 22);
  if (v22) {
    console.log();
    console.log('TOB 1:22');
    console.log(`  text: ${v22.text.slice(0, 200)}${v22.text.length > 200 ? '…' : ''}`);
  }
  if (chapter.headings.length > 0) {
    console.log();
    console.log('Headings detected:');
    for (const h of chapter.headings) {
      console.log(`  before v${h.beforeVerse}: ${h.text}`);
    }
  }

  // Coverage check
  const got = new Set(chapter.verses.map(v => v.verse));
  const missing: number[] = [];
  for (let i = 1; i <= 22; i++) if (!got.has(i)) missing.push(i);
  if (missing.length > 0) {
    console.log();
    console.log(`⚠  Missing verses: ${missing.join(', ')}`);
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
