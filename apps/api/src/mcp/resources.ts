/**
 * MCP resources — pinnable references inside Claude Desktop / ChatGPT.
 *
 * URI scheme: ahosaji://bible/<translation>/<usfm-ref>
 *   ahosaji://bible/en/JHN.3.16   single verse
 *   ahosaji://bible/en/JHN.3      whole chapter
 *   ahosaji://bible/en/books      list of books (resource template)
 */
import { pool } from '../db.js';
import { parseRef } from '../refs.js';

const URI_PATTERN = /^ahosaji:\/\/bible\/([a-z]{2,4})\/(.+)$/;

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'ahosaji://bible/{translation}/{ref}',
    name: 'Bible verse or chapter',
    description: 'Pin a verse (e.g. ahosaji://bible/en/JHN.3.16) or chapter (ahosaji://bible/en/JHN.3) as a referenceable artifact.',
    mimeType: 'application/json',
  },
];

export async function listResources(): Promise<Array<{ uri: string; name: string; mimeType: string }>> {
  // Surface a small starter set rather than every verse (would be huge).
  return [
    { uri: 'ahosaji://bible/en/JHN.3', name: 'John 3 (English English)', mimeType: 'application/json' },
    { uri: 'ahosaji://bible/ar/JHN.3', name: 'John 3 (Arabic Arabic)', mimeType: 'application/json' },
    { uri: 'ahosaji://bible/en/JHN.3.16', name: 'John 3:16 (English English)', mimeType: 'application/json' },
    { uri: 'ahosaji://bible/ar/JHN.3.16', name: 'John 3:16 (Arabic)', mimeType: 'application/json' },
    { uri: 'ahosaji://bible/en/TOB.1', name: 'Tobit 1 (English English)', mimeType: 'application/json' },
    { uri: 'ahosaji://bible/ar/TOB.1', name: 'Tobit 1 (Arabic)', mimeType: 'application/json' },
  ];
}

export async function readResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
  const m = uri.match(URI_PATTERN);
  if (!m) throw new Error(`unsupported URI: ${uri}`);
  const [, translation, payload] = m;

  // Verse: USFM.chapter.verse
  if (/^[A-Z0-9]{3}\.\d+\.\d+$/.test(payload!)) {
    const p = parseRef(payload!);
    if (!p) throw new Error('parse error');
    const r = await pool.query(
      `SELECT ref, text, structured FROM verses
         WHERE translation = $1 AND book = $2 AND chapter = $3 AND verse = $4`,
      [translation, p.book, p.chapter, p.verse],
    );
    if (r.rowCount === 0) throw new Error(`${payload} not found in ${translation}`);
    return { uri, mimeType: 'application/json', text: JSON.stringify(r.rows[0], null, 2) };
  }

  // Chapter: USFM.chapter
  const chapterMatch = payload!.match(/^([A-Z0-9]{3})\.(\d+)$/);
  if (chapterMatch) {
    const [, book, chapter] = chapterMatch;
    const r = await pool.query(
      `SELECT verse, ref, text FROM verses
         WHERE translation = $1 AND book = $2 AND chapter = $3 ORDER BY verse`,
      [translation, book, Number(chapter)],
    );
    return { uri, mimeType: 'application/json', text: JSON.stringify({ translation, book, chapter: Number(chapter), verses: r.rows }, null, 2) };
  }

  // Books listing
  if (payload === 'books') {
    const r = await pool.query(
      `SELECT usfm, name_en, name_ar, testament, canon FROM books ORDER BY book_order`,
    );
    return { uri, mimeType: 'application/json', text: JSON.stringify({ translation, books: r.rows }, null, 2) };
  }

  throw new Error(`unsupported resource path: ${payload}`);
}
