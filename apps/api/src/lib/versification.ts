/**
 * Versification mapping tables.
 *
 * Loads per-book JSON tables from ingest/data/shared/versification/ at module
 * init and exposes mapRef() to resolve cross-translation reference mappings
 * for divergent Deuterocanonicals (TOB, JDT, SIR, MAC, etc.).
 *
 * Schema (per ingest/data/shared/versification/README.md):
 *   {
 *     "book": "TOB",
 *     "translations": ["ar", "en"],
 *     "tradition": { "ar": "vulgate", "en": "rahlfs-lxx" },
 *     "mappings": [
 *       { "ar": "TOB.1.1",     "en": "TOB.1.1" },             // 1:1
 *       { "ar": "TOB.1.21",    "en": "TOB.1.19" },            // 1:1
 *       { "ar": "TOB.1.22",    "en": ["TOB.1.20","TOB.1.21"]},// 1:N
 *       { "ar": "TOB.1.23-25", "en": "TOB.1.22" },            // N:1 (range)
 *       { "ar": "TOB.1.26",    "en": null }                   // ar-only verse
 *     ]
 *   }
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

interface MappingEntry {
  [translation: string]: string | string[] | null;
}

interface MappingTable {
  book: string;
  translations: string[];
  tradition: Record<string, string>;
  mappings: MappingEntry[];
}

const VERSIFICATION_DIR = resolve(
  import.meta.dirname,
  '../../../../ingest/data/shared/versification',
);

// In-memory index built from the JSON tables.
// Outer key: book (USFM). Inner: translation → ref → mapping entries.
// The value is an ARRAY of entries: when two source refs map to the same
// target ref (N:1, e.g. ar JDT.4.16 and JDT.4.17 both → en JDT.4.15), the
// reverse lookup must accumulate BOTH entries instead of overwriting.
const tableIndex = new Map<string, Map<string, Map<string, MappingEntry[]>>>();

function expandRange(ref: string): string[] {
  // "TOB.1.23-25" → ["TOB.1.23", "TOB.1.24", "TOB.1.25"]
  const m = /^([A-Z0-9]+)\.(\d+)\.(\d+)-(\d+)$/.exec(ref);
  if (!m) return [ref];
  const [, book, chapter, from, to] = m;
  const result: string[] = [];
  for (let v = Number(from); v <= Number(to); v++) {
    result.push(`${book}.${chapter}.${v}`);
  }
  return result;
}

function loadTables(): void {
  let files: string[] = [];
  try {
    files = readdirSync(VERSIFICATION_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return;
  }

  for (const file of files) {
    const path = resolve(VERSIFICATION_DIR, file);
    let table: MappingTable;
    try {
      table = JSON.parse(readFileSync(path, 'utf-8')) as MappingTable;
    } catch (err) {
      console.warn(`[versification] failed to parse ${file}: ${(err as Error).message}`);
      continue;
    }

    const bookIndex = new Map<string, Map<string, MappingEntry[]>>();
    for (const t of table.translations) bookIndex.set(t, new Map());

    for (const entry of table.mappings) {
      for (const code of table.translations) {
        const refOrRange = entry[code];
        if (typeof refOrRange !== 'string') continue;
        const codeIndex = bookIndex.get(code);
        if (!codeIndex) continue;
        for (const expanded of expandRange(refOrRange)) {
          // Accumulate (don't overwrite): an N:1 mapping means several source
          // refs all resolve to the same ref here, so multiple entries can
          // legitimately key off the same expanded ref.
          const list = codeIndex.get(expanded);
          if (list) list.push(entry);
          else codeIndex.set(expanded, [entry]);
        }
      }
    }
    tableIndex.set(table.book, bookIndex);
  }
}

loadTables();

/**
 * Resolve a reference in `fromCode` translation to its equivalent ref(s) in
 * `toCode`. Returns:
 *   - string[] of one or more equivalent refs (1:1 returns 1 ref; 1:N returns N)
 *   - empty array if the ref is mapped to null (no equivalent in toCode)
 *   - null if no mapping table exists or the ref is not in the table
 *     (caller should fall back to identity mapping)
 */
export function mapRef(ref: string, fromCode: string, toCode: string): string[] | null {
  const book = ref.split('.')[0];
  if (!book) return null;
  const bookTable = tableIndex.get(book);
  if (!bookTable) return null;

  const fromIndex = bookTable.get(fromCode);
  if (!fromIndex) return null;

  const entries = fromIndex.get(ref);
  if (!entries || entries.length === 0) return null;

  // Aggregate the mapped targets across every entry keyed off this ref. With
  // N:1 reverse mappings, `ref` can be the target of multiple source entries
  // (e.g. ar JDT.4.15 → BOTH en→ar JDT.4.16 and JDT.4.17), so we must union
  // all of them. `null` targets contribute no refs but still count as a known
  // (explicitly-empty) mapping, so the result stays a [] rather than null.
  const seen = new Set<string>();
  let sawMapping = false;
  for (const entry of entries) {
    const target = entry[toCode];
    if (target === undefined) continue;
    sawMapping = true;
    if (target === null) continue;
    const expanded = typeof target === 'string' ? expandRange(target) : target.flatMap(expandRange);
    for (const r of expanded) seen.add(r);
  }
  if (!sawMapping) return null;
  return Array.from(seen);
}

export function hasTable(book: string): boolean {
  return tableIndex.has(book);
}

export function listMappedBooks(): string[] {
  return Array.from(tableIndex.keys()).sort();
}
