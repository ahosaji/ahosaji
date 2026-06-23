import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scrapeArabicSourceChapter } from '../scrapers/arabicScraper.js';

async function main(): Promise<void> {
  console.log('Scraping John 3 (Arabic, Arabic) from an Arabic source...');

  const chapter = await scrapeArabicSourceChapter({
    bookId: 53,         // an Arabic source numbering: 50=Matt, 51=Mark, 52=Luke, 53=John
    bookUsfm: 'JHN',
    chapter: 3,
  });

  const outDir = resolve(import.meta.dirname, '../../data/snapshots/ar');
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'JHN.json');
  await writeFile(outFile, JSON.stringify(chapter, null, 2), 'utf8');

  console.log(`✓ wrote ${outFile}\n`);
  console.log('Summary:');
  console.log(`  verses:      ${chapter.verses.length}`);
  console.log(`  headings:    ${chapter.headings.length}`);

  // Diacritic check: count tashkeel marks (U+064B–U+065F, U+0670)
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

  const v16 = chapter.verses.find(v => v.verse === 16);
  if (v16) {
    console.log('JHN 3:16');
    console.log(`  text: ${v16.text}`);
  }
  const v1 = chapter.verses.find(v => v.verse === 1);
  if (v1) {
    console.log();
    console.log('JHN 3:1');
    console.log(`  heading: ${v1.structured.heading ?? '(none)'}`);
    console.log(`  text: ${v1.text}`);
  }

  if (chapter.headings.length > 0) {
    console.log();
    console.log('All headings:');
    for (const h of chapter.headings) {
      console.log(`  before v${h.beforeVerse}: ${h.text}`);
    }
  }
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
