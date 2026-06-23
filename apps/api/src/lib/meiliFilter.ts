/**
 * Safe Meilisearch filter builder.
 *
 * Meilisearch filter expressions are a string DSL; building them by raw string
 * interpolation lets a caller inject filter operators / boolean logic (e.g.
 * `x" OR book = "y`). This module validates structured filter inputs and
 * escapes any remaining string values so the resulting expression only ever
 * contains the field/value the caller intended.
 */

// USFM book codes are short uppercase alphanumerics (e.g. JHN, 1CO, GEN, PS2).
const USFM_BOOK_RE = /^[A-Z0-9]+$/;

// Closed allowlists for the low-cardinality enum-style facets.
const TESTAMENTS = new Set(['OT', 'NT']);
const CANONS = new Set(['protocanonical', 'deuterocanonical']);
// book_group values present in the corpus (source: ingest/data/shared/books.json).
const BOOK_GROUPS = new Set([
  'Pentateuch',
  'Historical',
  'Wisdom',
  'Major Prophets',
  'Minor Prophets',
  'Gospels',
  'Pauline',
  'Catholic',
  'Apocalyptic',
]);

export interface MeiliFilterInput {
  book?: string;
  testament?: string;
  canon?: string;
  bookGroup?: string;
}

/** Escape a value for use inside a double-quoted Meilisearch string literal. */
function escapeValue(v: string): string {
  // Backslash first, then the double-quote that delimits the literal.
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build a validated Meilisearch filter expression from structured inputs.
 *
 * - `book` must match USFM `[A-Z0-9]+` — otherwise rejected (throws).
 * - `testament` / `canon` / `bookGroup` must be in their allowlists — else rejected.
 * Any value that passes validation is still escaped defensively.
 *
 * @throws Error on an invalid value so the route can return a 400.
 * Returns `undefined` when no filters are supplied.
 */
export function buildMeiliFilter(input: MeiliFilterInput): string | undefined {
  const clauses: string[] = [];

  if (input.book !== undefined && input.book !== '') {
    if (!USFM_BOOK_RE.test(input.book)) {
      throw new Error(`invalid book filter (expected USFM code [A-Z0-9]+): ${input.book}`);
    }
    clauses.push(`book = "${escapeValue(input.book)}"`);
  }

  if (input.testament !== undefined && input.testament !== '') {
    if (!TESTAMENTS.has(input.testament)) {
      throw new Error(`invalid testament filter: ${input.testament}`);
    }
    clauses.push(`testament = "${escapeValue(input.testament)}"`);
  }

  if (input.canon !== undefined && input.canon !== '') {
    if (!CANONS.has(input.canon)) {
      throw new Error(`invalid canon filter: ${input.canon}`);
    }
    clauses.push(`canon = "${escapeValue(input.canon)}"`);
  }

  if (input.bookGroup !== undefined && input.bookGroup !== '') {
    if (!BOOK_GROUPS.has(input.bookGroup)) {
      throw new Error(`invalid bookGroup filter: ${input.bookGroup}`);
    }
    clauses.push(`book_group = "${escapeValue(input.bookGroup)}"`);
  }

  return clauses.length ? clauses.join(' AND ') : undefined;
}
