/**
 * Shared parallel-resolution service.
 *
 * Owns the cross-translation resolution logic so REST (routes/parallel.ts),
 * GraphQL (graphql/resolvers.ts) and MCP (mcp/tools.ts) all behave identically:
 *   - identity match (same USFM ref) wins by default;
 *   - versification mapping (mapRef) fills in absent verses, and in
 *     `preferAligned` mode OVERRIDES identity for non-anchor translations;
 *   - verses with an explicit null mapping surface as present:false plus a
 *     mapping_note ("no equivalent in this translation");
 *   - mapped entries carry mapped_to (the equivalent ref(s) used).
 *
 * Each transport keeps its own response SHAPE; only the resolution lives here.
 */
import type { Pool } from 'pg';
import type { ParsedRef } from '../refs.js';
import { mapRef } from './versification.js';

export interface FetchedVerse {
  translation: string;
  text: string;
  structured: unknown;
  ref: string;
}

/**
 * Per-translation resolved entry. `mappedTo`/`mappingNote` are only present
 * when versification mapping was consulted; transports that don't expose them
 * (MCP) simply ignore them.
 */
export interface ResolvedEntry {
  translation: string;
  present: boolean;
  text: string | null;
  /** single structured object, array of them (N:1 join), or null. */
  structured: unknown;
  mappedTo?: string[];
  mappingNote?: string;
}

export interface ResolvedRef {
  ref: string;
  entries: ResolvedEntry[];
}

const refStr = (p: ParsedRef): string => `${p.book}.${p.chapter}.${p.verse}`;

/** First-pass identity-mapped fetch: one query per translation. */
async function fetchIdentity(
  pool: Pool,
  translations: string[],
  refStrings: string[],
): Promise<Map<string, FetchedVerse[]>> {
  const result = new Map<string, FetchedVerse[]>();
  if (refStrings.length === 0) {
    for (const t of translations) result.set(t, []);
    return result;
  }
  for (const t of translations) {
    const r = await pool.query(
      `SELECT translation, ref, text, structured
         FROM verses
         WHERE translation = $1 AND ref = ANY($2::text[])
         ORDER BY ref`,
      [t, refStrings],
    );
    result.set(t, r.rows as FetchedVerse[]);
  }
  return result;
}

/**
 * Resolve the requested target refs across the given translations.
 *
 * @param preferAligned when true, the FIRST translation is the anchor and
 *   every other translation shows the mapped equivalent of the anchor's verse.
 */
export async function resolveParallel(
  pool: Pool,
  translations: string[],
  targetRefs: ParsedRef[],
  preferAligned = false,
): Promise<ResolvedRef[]> {
  const refStrings = targetRefs.map(refStr);
  const fetched = await fetchIdentity(pool, translations, refStrings);

  const anchor = translations[0];
  const has = (code: string, ref: string): boolean =>
    fetched.get(code)?.some(x => x.ref === ref) ?? false;

  // Second pass: collect refs to fetch via versification mapping.
  const fallbackNeeded = new Map<string, Set<string>>();
  const addNeeded = (code: string, ref: string): void => {
    let set = fallbackNeeded.get(code);
    if (!set) {
      set = new Set();
      fallbackNeeded.set(code, set);
    }
    set.add(ref);
  };

  for (const p of targetRefs) {
    const ref = refStr(p);
    if (preferAligned && anchor && has(anchor, ref)) {
      // Anchor mode: every non-anchor translation gets the mapped equivalent.
      for (const code of translations) {
        if (code === anchor) continue;
        const mapped = mapRef(ref, anchor, code);
        if (mapped && mapped.length > 0) for (const m of mapped) addNeeded(code, m);
      }
      continue;
    }
    // Default mode: only fill in absent verses.
    for (const code of translations) {
      if (has(code, ref)) continue;
      for (const otherCode of translations) {
        if (otherCode === code) continue;
        if (!has(otherCode, ref)) continue;
        const mapped = mapRef(ref, otherCode, code);
        // Prefetch only the refs the resolver will actually want. A null
        // result (no table / ref not in table) is NOT a usable mapping, so
        // keep scanning other translations rather than stopping here.
        if (mapped === null) continue;
        if (mapped.length > 0) for (const m of mapped) addNeeded(code, m);
        break;
      }
    }
  }

  // Fetch the mapped fallback refs.
  const mappedFetched = new Map<string, Map<string, FetchedVerse>>();
  for (const [code, refs] of fallbackNeeded) {
    const r = await pool.query(
      `SELECT translation, ref, text, structured
         FROM verses
         WHERE translation = $1 AND ref = ANY($2::text[])`,
      [code, Array.from(refs)],
    );
    const map = new Map<string, FetchedVerse>();
    for (const row of r.rows as FetchedVerse[]) map.set(row.ref, row);
    mappedFetched.set(code, map);
  }

  const joinStructured = (rows: FetchedVerse[]): unknown =>
    rows.length === 1 ? rows[0]!.structured : rows.map(r => r.structured);

  return targetRefs.map(p => {
    const ref = refStr(p);
    const entries: ResolvedEntry[] = translations.map(code => {
      // preferAligned: for non-anchor translations the mapping table OVERRIDES
      // identity even when this translation has the queried ref directly.
      if (preferAligned && anchor && code !== anchor && has(anchor, ref)) {
        const mapped = mapRef(ref, anchor, code);
        if (mapped && mapped.length === 0) {
          return {
            translation: code, present: false, text: null, structured: null,
            mappedTo: [], mappingNote: 'no equivalent in this translation',
          };
        }
        if (mapped && mapped.length > 0) {
          const rows = mapped
            .map(m => mappedFetched.get(code)?.get(m))
            .filter((r): r is FetchedVerse => r !== undefined);
          if (rows.length > 0) {
            return {
              translation: code, present: true,
              text: rows.map(r => r.text).join(' '),
              structured: joinStructured(rows),
              mappedTo: mapped,
            };
          }
        }
        // No mapping entry → fall through to identity (table silent on ref).
      }

      const v = fetched.get(code)?.find(x => x.ref === ref);
      if (v) return { translation: code, present: true, text: v.text, structured: v.structured };

      // Default-mode mapped fallback for a missing ref.
      for (const otherCode of translations) {
        if (otherCode === code) continue;
        if (!has(otherCode, ref)) continue;
        const mapped = mapRef(ref, otherCode, code);
        if (mapped === null) continue;
        if (mapped.length === 0) {
          return {
            translation: code, present: false, text: null, structured: null,
            mappedTo: [], mappingNote: 'no equivalent in this translation',
          };
        }
        const rows = mapped
          .map(m => mappedFetched.get(code)?.get(m))
          .filter((r): r is FetchedVerse => r !== undefined);
        if (rows.length > 0) {
          return {
            translation: code, present: true,
            text: rows.map(r => r.text).join(' '),
            structured: joinStructured(rows),
            mappedTo: mapped,
          };
        }
      }
      return { translation: code, present: false, text: null, structured: null };
    });
    return { ref, entries };
  });
}
