import { assertCorpus, type Corpus } from './snapshots.js';
export interface SqlClient { query(sql: string, values?: unknown[]): Promise<unknown>; release?(): void }
async function insert(client: SqlClient, table: string, columns: string[], rows: unknown[][], conflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 800) {
    const chunk = rows.slice(i, i + 800), values = chunk.flat();
    const tuples = chunk.map((_, r) => `(${columns.map((_, c) => `$${r * columns.length + c + 1}`).join(',')})`);
    await client.query(`INSERT INTO ${table}(${columns.join(', ')}) VALUES ${tuples.join(',')} ${conflict}`, values);
  }
}
export async function replacePostgres(prepare: () => Promise<Corpus>, open: () => Promise<SqlClient>): Promise<void> {
  const corpus = await prepare(); assertCorpus(corpus);
  // Materialize every row before the connection or transaction exists. JSON is preserved.
  const batches = corpus.snapshots.map(s => {
    const verses: unknown[][] = [], headings = new Map<string, unknown[]>();
    for (const c of s.chapters) {
      for (const v of c.verses) verses.push([c.translation, c.book, c.chapter, v.verse, v.text, JSON.stringify(v.structured)]);
      for (const h of c.headings) headings.set(`${c.chapter}:${h.beforeVerse}`, [c.translation, c.book, c.chapter, h.beforeVerse, h.text, h.level]);
    }
    return { snapshot: s, verses, headings: [...headings.values()] };
  });
  const client = await open(); let began = false;
  try {
    await client.query('BEGIN'); began = true;
    for (const [code, name, source, versification] of [['en', 'English', 'English', 'masoretic+rahlfs'], ['ar', 'Arabic', 'an Arabic source', 'vulgate']]) {
      await client.query('INSERT INTO translations(code,name,language,source,copyright,versification) VALUES ($1,$2,$1,$3,$4,$5) ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,language=EXCLUDED.language,source=EXCLUDED.source,copyright=EXCLUDED.copyright,versification=EXCLUDED.versification', [code, name, source, '', versification]);
    }
    for (const b of corpus.books) await insert(client, 'books', ['usfm','name_en','name_ar','testament','canon','book_order','chapter_count','book_group'], [[b.usfm,b.name_en,b.name_ar,b.testament,b.canon,b.book_order,b.chapter_count,b.book_group ?? null]], 'ON CONFLICT (usfm) DO UPDATE SET name_en=EXCLUDED.name_en,name_ar=EXCLUDED.name_ar,testament=EXCLUDED.testament,canon=EXCLUDED.canon,book_order=EXCLUDED.book_order,chapter_count=EXCLUDED.chapter_count,book_group=EXCLUDED.book_group');
    for (const { snapshot: s, verses, headings } of batches) {
      await client.query('DELETE FROM verses WHERE translation = $1 AND book = $2', [s.translation, s.usfm]);
      await client.query('DELETE FROM headings WHERE translation = $1 AND book = $2', [s.translation, s.usfm]);
      await insert(client, 'verses', ['translation','book','chapter','verse','text','structured'], verses, 'ON CONFLICT (translation,book,chapter,verse) DO UPDATE SET text=EXCLUDED.text,structured=EXCLUDED.structured');
      await insert(client, 'headings', ['translation','book','chapter','before_verse','text','level'], headings, 'ON CONFLICT (translation,book,chapter,before_verse) DO UPDATE SET text=EXCLUDED.text,level=EXCLUDED.level');
    }
    await insert(client, 'cross_refs', ['from_ref','to_ref'], corpus.crossRefs.map(r => [r.from,r.to]), 'ON CONFLICT DO NOTHING');
    await client.query('COMMIT'); began = false;
  } catch (error) {
    if (began) { try { await client.query('ROLLBACK'); } catch { /* retain the original failure */ } }
    throw error;
  } finally { client.release?.(); }
}
