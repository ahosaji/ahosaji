import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scrapesourceChapter } from '../scrapers/webSource.js';

async function main(): Promise<void> {
  console.log('Scraping John 3 (English) from source via Firecrawl...');

  const chapter = await scrapesourceChapter({
    version: 'English',
    bookName: 'John',
    bookUsfm: 'JHN',
    chapter: 3,
  });

  const outDir = resolve(import.meta.dirname, '../../data/snapshots/en');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'JHN.json');
  await writeFile(outFile, JSON.stringify(chapter, null, 2), 'utf8');

  let italicCount = 0;
  let redLetterCount = 0;
  let footnoteCount = 0;
  for (const v of chapter.verses) {
    italicCount += v.structured.tokens.filter(t => t.italic).length;
    redLetterCount += v.structured.tokens.filter(t => t.redLetter).length;
    footnoteCount += v.structured.footnotes.length;
  }

  console.log(`✓ wrote ${outFile}\n`);
  console.log('Summary:');
  console.log(`  verses:                ${chapter.verses.length}`);
  console.log(`  headings:              ${chapter.headings.length}`);
  console.log(`  italic tokens (added): ${italicCount}`);
  console.log(`  red-letter tokens:     ${redLetterCount}`);
  console.log(`  footnotes:             ${footnoteCount}\n`);

  const v16 = chapter.verses.find(v => v.verse === 16);
  if (v16) {
    const rl = v16.structured.tokens.filter(t => t.redLetter).length;
    console.log('JHN 3:16');
    console.log(`  text: "${v16.text}"`);
    console.log(`  red-letter tokens: ${rl}`);
  }

  const v1 = chapter.verses.find(v => v.verse === 1);
  if (v1) {
    console.log();
    console.log('JHN 3:1');
    console.log(`  heading: ${v1.structured.heading ?? '(none)'}`);
    console.log(`  text: "${v1.text}"`);
  }

  if (chapter.headings.length > 0) {
    console.log();
    console.log('All headings:');
    for (const h of chapter.headings) {
      console.log(`  before v${h.beforeVerse}: "${h.text}"`);
    }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
