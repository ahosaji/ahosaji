/**
 * USFM-style ref parsing and ordering helpers.
 *
 * A ref is "USFM.chapter.verse" e.g. "JHN.3.16". Comparison uses book_order
 * from the books table when crossing books — but for v1 we restrict ranges
 * to single-book passages, so a tuple compare on (chapter, verse) is enough.
 */

export interface ParsedRef {
  book: string;
  chapter: number;
  verse: number;
}

const REF_PATTERN = /^([A-Z0-9]{3})\.(\d+)\.(\d+)$/;

export function parseRef(ref: string): ParsedRef | null {
  const m = ref.match(REF_PATTERN);
  if (!m) return null;
  return { book: m[1]!, chapter: Number(m[2]), verse: Number(m[3]) };
}

export function compareRef(a: ParsedRef, b: ParsedRef): number {
  if (a.book !== b.book) return a.book.localeCompare(b.book);
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}
