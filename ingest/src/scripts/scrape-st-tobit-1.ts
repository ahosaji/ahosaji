import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scrapeArabicSourceChapter } from '../scrapers/arabicScraper.js';

async function main(): Promise<void> {
  console.log('Scraping Tobit 1 (Arabic, Arabic — an Arabic source Deuterocanonical)...');

  const chapter = await scrapeArabicSourceChapter({
    bookId: 17,         // an Arabic source numbering: 17 = طوبيا (Tobit)
    bookUsfm: 'TOB',
    chapter: 1,
  });

  const outDir = resolve(import.meta.dirname, '../../data/snapshots/ar');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'TOB.json');
  await writeFile(outFile, JSON.stringify(chapter, null, 2), 'utf8');

  console.log(`✓ wrote ${outFile}\n`);
  console.log('Summary:');
  console.log(`  verses:   ${chapter.verses.length}`);
  console.log(`  headings: ${chapter.headings.length}`);

  let diacriticCount = 0;
  let totalChars = 0;
  for (const v of chapter.verses) {
    for (const c of v.text) {
      const cp = c.codePointAt(0) ?? 0;
      if ((cp >= 0x064B && cp <= 0x065F) || cp === 0x0670) diacriticCount++;
      totalChars++;
    }
  }
  console.log(`  total chars: ${totalChars}`);
  console.log(`  diacritics:  ${diacriticCount} (${((diacriticCount / totalChars) * 100).toFixed(1)}% of chars)`);
  console.log();

  const v1 = chapter.verses.find(v => v.verse === 1);
  if (v1) {
    console.log('TOB 1:1');
    console.log(`  text: ${v1.text}`);
  }
  if (chapter.headings.length > 0) {
    console.log();
    console.log('Headings:');
    for (const h of chapter.headings) {
      console.log(`  before v${h.beforeVerse}: ${h.text}`);
    }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
