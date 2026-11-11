import { randomUUID } from 'node:crypto';
import type { Settings } from 'meilisearch';
import { normalizeArabic } from './arabic.js';
import { assertCorpus, type Corpus } from './snapshots.js';
import { isRecord } from '../validate.js';

interface TaskRef { taskUid: number }
interface SearchDoc { id: string; translation: string; ref: string; book: string; chapter: number; verse: number; book_name: string; testament: string; canon: string; book_group: string; book_order: number; text: string; normalized_text: string; heading: string | null }
interface SearchIndex {
  updateSettings(settings: Settings): Promise<TaskRef>; addDocuments(docs: SearchDoc[]): Promise<TaskRef>;
  getStats(): Promise<{ numberOfDocuments: number }>; getSettings(): Promise<Settings>;
}
export interface SearchClient {
  createIndex(name: string, options: { primaryKey: string }): Promise<TaskRef>;
  getIndex(name: string): Promise<unknown>; index(name: string): SearchIndex;
  swapIndexes(pairs: Array<{ indexes: string[] }>): Promise<TaskRef>;
  deleteIndex(name: string): Promise<TaskRef>;
  waitForTask(id: number, options?: { timeOutMs: number }): Promise<{ status: string; error?: unknown }>;
}
const ARABIC_STOPWORDS = ['ال','و','ف','ب','ل','ك','هو','هي','هم','أن','إن','أنا','أنت','هذا','هذه','ذلك','تلك','في','من','إلى','على','عن','مع'];
const ENGLISH_STOPWORDS = ['a','an','the','and','or','but','is','are','was','were','be','been','being','have','has','had','do','does','did','of','in','on','at','to','for','with','by','from','as','this','that','these','those','it','its'];
export function searchSettings(lang: string): Settings {
  return { searchableAttributes: ['text','normalized_text','heading','book_name'], filterableAttributes: ['book','testament','canon','book_group'], sortableAttributes: ['book_order','chapter','verse'], stopWords: lang === 'ar' ? ARABIC_STOPWORDS : ENGLISH_STOPWORDS,
    typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 6, twoTypos: 10 } } };
}
export async function requireTaskSuccess(client: SearchClient, task: TaskRef, operation: string): Promise<void> {
  const result = await client.waitForTask(task.taskUid, { timeOutMs: 120_000 });
  if (result.status !== 'succeeded') throw new Error(`${operation}: task ${task.taskUid} ${result.status}: ${JSON.stringify(result.error ?? null)}`);
}
const notFound = (error: unknown): boolean => isRecord(error) && isRecord(error.cause) && error.cause.code === 'index_not_found';
function sameSettings(actual: Settings, expected: Settings): boolean {
  for (const name of ['searchableAttributes','filterableAttributes','sortableAttributes','stopWords'] as const) {
    const a = actual[name], b = expected[name];
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (JSON.stringify(name === 'searchableAttributes' ? a : [...a].sort()) !== JSON.stringify(name === 'searchableAttributes' ? b : [...b].sort())) return false;
  }
  return actual.typoTolerance?.enabled === expected.typoTolerance?.enabled &&
    actual.typoTolerance?.minWordSizeForTypos?.oneTypo === 6 && actual.typoTolerance?.minWordSizeForTypos?.twoTypos === 10;
}
/** All staging work is verified before a single atomic swap publishes the run. */
export async function replaceSearchIndexes(corpus: Corpus, client: SearchClient, runId = randomUUID()): Promise<void> {
  assertCorpus(corpus);
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error('invalid staging run ID');
  const books = new Map(corpus.books.map(b => [b.usfm, b]));
  const buckets = new Map<string, SearchDoc[]>();
  for (const snapshot of corpus.snapshots) for (const c of snapshot.chapters) {
    const meta = books.get(c.book); if (!meta) throw new Error(`validation: unknown book ${c.book}`);
    const headings = new Map(c.headings.map(h => [h.beforeVerse, h.text]));
    const docs = buckets.get(c.translation) ?? []; buckets.set(c.translation, docs);
    for (const v of c.verses) docs.push({ id: `${c.translation}_${v.book}_${v.chapter}_${v.verse}`, translation: c.translation, ref: v.ref,
      book: v.book, chapter: v.chapter, verse: v.verse, book_name: c.translation === 'ar' ? meta.name_ar : meta.name_en,
      testament: meta.testament, canon: meta.canon, book_group: meta.book_group ?? '', book_order: meta.book_order,
      text: v.text, normalized_text: c.translation === 'ar' ? normalizeArabic(v.text) : v.text, heading: headings.get(v.verse) ?? null });
  }
  const owned: string[] = [], pairs: Array<{ indexes: string[] }> = [];
  let publicationAttempted = false;
  try {
    for (const [lang, docs] of buckets) {
      const live = `verses_${lang}`, staging = `${live}__build_${runId}`;
      await requireTaskSuccess(client, await client.createIndex(staging, { primaryKey: 'id' }), `create ${staging}`);
      owned.push(staging);
      const index = client.index(staging), settings = searchSettings(lang);
      await requireTaskSuccess(client, await index.updateSettings(settings), `settings ${staging}`);
      await requireTaskSuccess(client, await index.addDocuments(docs), `documents ${staging}`);
      const stats = await index.getStats();
      if (stats.numberOfDocuments !== docs.length) throw new Error(`${staging}: document count ${stats.numberOfDocuments} does not match ${docs.length}`);
      if (!sameSettings(await index.getSettings(), settings)) throw new Error(`${staging}: settings verification failed`);
      pairs.push({ indexes: [live, staging] });
    }
    // Bootstrap missing live names only after every replacement is ready.
    for (const { indexes: [live] } of pairs) {
      try { await client.getIndex(live!); } catch (error) {
        if (!notFound(error)) throw error;
        await requireTaskSuccess(client, await client.createIndex(live!, { primaryKey: 'id' }), `initialize ${live}`);
      }
    }
    publicationAttempted = true;
    await requireTaskSuccess(client, await client.swapIndexes(pairs), 'atomic index swap');
  } catch (error) {
    // A timed-out swap may still publish. Retain its staging/backup indexes for inspection.
    if (!publicationAttempted) for (const name of owned) {
      try { await requireTaskSuccess(client, await client.deleteIndex(name), `cleanup ${name}`); } catch (cleanup) { console.warn(`Staging cleanup failed for ${name}: ${String(cleanup)}`); }
    }
    throw error;
  }
  // After confirmed publication these staging names contain the previous indexes.
  for (const name of owned) await requireTaskSuccess(client, await client.deleteIndex(name), `cleanup ${name}`);
}
