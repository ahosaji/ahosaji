/**
 * MCP prompt templates. Each prompt fetches data via the same SQL/Meilisearch
 * the tools use, then returns a fully-materialized prompt the LLM can act on.
 *
 * Prompts don't call the LLM themselves — they just produce text the LLM
 * receives as the user's prompt.
 */
import { pool } from '../db.js';
import { parseRef } from '../refs.js';

export const PROMPTS = [
  {
    name: 'explain_passage',
    description: 'Fetch a passage and template a study prompt asking for explanation in Coptic Orthodox context.',
    arguments: [
      { name: 'translation', description: 'Translation code (en|ar)', required: true },
      { name: 'ref', description: 'USFM ref (e.g. JHN.3.16)', required: true },
    ],
  },
  {
    name: 'compare_translations',
    description: 'Fetch the same verse in English and Arabic and template a comparison prompt.',
    arguments: [
      { name: 'ref', description: 'USFM ref (e.g. JHN.3.16)', required: true },
    ],
  },
  {
    name: 'verse_in_context',
    description: 'Fetch a verse + a window of surrounding verses and template a context-aware study prompt.',
    arguments: [
      { name: 'translation', description: 'Translation code', required: true },
      { name: 'ref', description: 'USFM ref', required: true },
      { name: 'window', description: 'Number of verses before/after to include (default 5)', required: false },
    ],
  },
];

export async function getPrompt(
  name: string,
  args: Record<string, string>,
): Promise<{ messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> }> {
  if (name === 'explain_passage') {
    const p = parseRef(args.ref ?? '');
    if (!p) throw new Error('invalid ref');
    const r = await pool.query(
      `SELECT text FROM verses WHERE translation = $1 AND book = $2 AND chapter = $3 AND verse = $4`,
      [args.translation, p.book, p.chapter, p.verse],
    );
    if (r.rowCount === 0) throw new Error(`${args.ref} not found in ${args.translation}`);
    const text = r.rows[0].text as string;
    const prompt = `Please explain the following Bible passage in the context of Coptic Orthodox Christianity, drawing on patristic tradition where applicable.\n\n${args.ref} (${args.translation}):\n"${text}"\n\nFocus on the theological meaning, liturgical use, and Patristic interpretation.`;
    return { messages: [{ role: 'user', content: { type: 'text', text: prompt } }] };
  }

  if (name === 'compare_translations') {
    const p = parseRef(args.ref ?? '');
    if (!p) throw new Error('invalid ref');
    const r = await pool.query(
      `SELECT translation, text FROM verses
         WHERE ref = $1 AND translation IN ('en', 'ar')`,
      [args.ref],
    );
    if (r.rowCount === 0) throw new Error(`${args.ref} not found in any translation`);
    const en = r.rows.find((row: { translation: string }) => row.translation === 'en')?.text ?? '(not present)';
    const ar = r.rows.find((row: { translation: string }) => row.translation === 'ar')?.text ?? '(not present)';
    const prompt = `Compare the English (English) and Arabic (Arabic) renderings of ${args.ref}. Highlight any meaningful nuances in the Coptic Orthodox reading tradition.\n\nEnglish:\n"${en}"\n\nArabic:\n${ar}`;
    return { messages: [{ role: 'user', content: { type: 'text', text: prompt } }] };
  }

  if (name === 'verse_in_context') {
    const p = parseRef(args.ref ?? '');
    if (!p) throw new Error('invalid ref');
    const window = Number(args.window ?? 5);
    const r = await pool.query(
      `SELECT verse, ref, text FROM verses
         WHERE translation = $1 AND book = $2 AND chapter = $3
           AND verse BETWEEN $4 AND $5
         ORDER BY verse`,
      [args.translation, p.book, p.chapter, Math.max(1, p.verse - window), p.verse + window],
    );
    if (r.rowCount === 0) throw new Error(`window around ${args.ref} returned no verses`);
    const lines = r.rows.map((row: { ref: string; verse: number; text: string }) => {
      const arrow = row.verse === p.verse ? ' →' : '  ';
      return `${arrow} ${row.ref}: ${row.text}`;
    });
    const prompt = `Read the following passage and explain how the highlighted verse (→) is illuminated by its surrounding context. Use Coptic Orthodox patristic perspective where applicable.\n\n${lines.join('\n')}`;
    return { messages: [{ role: 'user', content: { type: 'text', text: prompt } }] };
  }

  throw new Error(`unknown prompt: ${name}`);
}
