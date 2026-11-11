import { readCorpus, assertCorpus, printWarnings } from '../lib/snapshots.js';
async function main(): Promise<void> {
  const corpus = await readCorpus();
  for (const s of corpus.snapshots) console.log(`${s.ok ? 'PASS' : 'FAIL'} ${s.translation}/${s.usfm}: chapters=${s.chapters.length} verses=${s.stats.verseCount} headings=${s.stats.headingCount}`);
  printWarnings(corpus);
  console.log('Cross-translation alignment (informational; source texts are preserved):');
  for (const book of corpus.books) {
    const counts = corpus.snapshots.filter(s => s.usfm === book.usfm).map(s => ({ translation: s.translation, chapters: s.chapters.length, verses: s.stats.verseCount }));
    const aligned = new Set(counts.map(s => s.verses)).size === 1;
    console.log(`${book.usfm}: ${aligned ? 'aligned' : 'DIVERGENT'} ${counts.map(s => `${s.translation}=${s.verses}v/${s.chapters}ch`).join(' ')}`);
  }
  for (const error of corpus.errors) console.error(`ERROR: ${error}`);
  assertCorpus(corpus);
  console.log(`Validated ${corpus.snapshots.length} snapshots, ${corpus.snapshots.reduce((n, s) => n + s.chapters.length, 0)} chapters; ${corpus.warnings.length} explicit warnings`);
}
main().catch(error => { console.error('FAILED:', error); process.exitCode = 1; });
