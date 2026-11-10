/** Build and verify replacements, then publish every language in one atomic index swap. */
import { MeiliSearch } from 'meilisearch';
import { env } from '../env.js';
import { readCorpus, defaultCorpusPaths, printWarnings, assertCorpus } from '../lib/snapshots.js';
import { replaceSearchIndexes } from '../lib/searchImport.js';
async function main(): Promise<void> {
  if (process.argv.slice(2).some(a => a !== '--allow-partial')) throw new Error('Supported option: --allow-partial (never permits empty/invalid snapshots)');
  const corpus = await readCorpus({ ...defaultCorpusPaths, allowPartial: process.argv.includes('--allow-partial') });
  printWarnings(corpus); assertCorpus(corpus);
  if (!env.meilisearchHost || !env.meilisearchMasterKey) throw new Error('MEILISEARCH_HOST and MEILISEARCH_MASTER_KEY are required for indexing');
  await replaceSearchIndexes(corpus, new MeiliSearch({ host: env.meilisearchHost, apiKey: env.meilisearchMasterKey }));
  console.log('Validated search replacement published');
}
main().catch(error => { console.error('FAILED:', error); process.exitCode = 1; });
