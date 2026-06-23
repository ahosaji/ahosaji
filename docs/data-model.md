# Ahosaji — Canonical JSON Data Model

The canonical shape that every ingestion source must produce. Defined by [`ingest/src/types/canonical.ts`](../ingest/src/types/canonical.ts) and validated by [`ingest/src/validate.ts`](../ingest/src/validate.ts).

## Top level: `Chapter`

```ts
{
  translation: 'en' | 'ar';
  source: 'source:English' | 'an Arabic source' | 'English';
  book: 'JHN' | 'TOB' | ...;       // USFM 3-letter
  chapter: 3;
  verses: Verse[];                  // sorted ascending by .verse
  headings: Heading[];              // each maps to a verse via beforeVerse
  fetchedAt: '2026-04-30T21:14:00Z' // ISO timestamp
}
```

## `Verse`

```ts
{
  ref: 'JHN.3.16';                  // book.chapter.verse, validates against pattern
  book: 'JHN';
  chapter: 3;
  verse: 16;
  text: 'For God so loved...';      // plain rendering, derived from tokens
  structured: VerseStructured;
}
```

## `VerseStructured`

```ts
{
  tokens: Token[];                  // walk in order to reconstruct rich text
  footnotes: Footnote[];            // per-verse, with markers and bodies
  crossRefs: string[];              // refs like 'ROM.5.8' (translation-independent)
  heading: string | null;           // section heading that precedes this verse, if any
  paragraphStart: boolean;          // true if a new paragraph begins at this verse
  poetic: boolean;                  // true for poetry sections (Psalms, Proverbs)
  poeticLines: string[] | null;     // pre-split poetic line breaks
}
```

## `Token`

```ts
{
  text: 'For God so loved the world';
  italic: boolean;                  // English's added-for-clarity convention
  redLetter: boolean;               // words of Jesus
}
```

For Arabic, `italic` is always `false` (the convention doesn't apply). `redLetter` is set via cross-translation enrichment from the English source where applicable.

## `Footnote` and `Heading`

```ts
type Footnote = { marker: string; text: string };
type Heading = { beforeVerse: number; text: string; level: number };
```

## Cross-translation guarantees

| Field | Same across translations? |
|---|---|
| `book` (USFM) | ✅ Yes |
| `chapter`, `verse` | ⚠ Mostly — diverges in some Deuteros (TOB), some Psalms, Jeremiah, Malachi |
| `text` content | ❌ No (different translations) |
| `structured.heading` | ❌ No (publishers chose differently) |
| `structured.tokens[].redLetter` | ✅ Yes (property of original Greek) — when transferred via enrichment |
| `structured.tokens[].italic` | ❌ No (English-only convention) |
| `structured.footnotes` | ❌ No (translation-specific) |
| `structured.crossRefs` | ✅ Yes (translation-independent, from TSK or similar) |

## Versification mapping

When `chapter`/`verse` diverge across translations, [`ingest/data/shared/versification/`](../ingest/data/shared/versification/) holds per-book mapping tables that the parallel-query endpoint consults. See that directory's README.

## Validation

`pnpm validate` runs `ingest/src/scripts/validate-all.ts` which:
- Walks `ingest/data/snapshots/{ar,en}/*.json`
- Validates each against the `Chapter` shape (structural + cross-field consistency)
- Reports cross-translation alignment per book (✓ aligned vs ⚠ DIVERGENT)
- Exits non-zero on any failure
