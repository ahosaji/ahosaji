/**
 * Canonical JSON shape that every ingestion source (source English,
 * an Arabic source Arabic, English PDF) must conform to. Validated by `validate.ts`
 * once at least two sources are wired up.
 */

export interface Token {
  text: string;
  italic: boolean;
  redLetter: boolean;
}

export interface Footnote {
  marker: string;
  text: string;
}

export interface VerseStructured {
  tokens: Token[];
  footnotes: Footnote[];
  crossRefs: string[];
  heading: string | null;
  paragraphStart: boolean;
  poetic: boolean;
  poeticLines: string[] | null;
}

export interface Verse {
  ref: string;          // 'JHN.3.16'
  book: string;         // USFM 3-letter code
  chapter: number;
  verse: number;
  text: string;         // plain rendering, derived from tokens
  structured: VerseStructured;
}

export interface Heading {
  beforeVerse: number;
  text: string;
  level: number;        // 1 = major, 2 = section
}

export interface Chapter {
  translation: string;  // 'en' | 'ar'
  source: string;       // 'source:English' | 'an Arabic source' | 'English'
  book: string;         // USFM
  chapter: number;
  verses: Verse[];
  headings: Heading[];
  fetchedAt: string;    // ISO timestamp
}
