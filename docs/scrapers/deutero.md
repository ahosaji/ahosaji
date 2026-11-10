# English Deuterocanonicals PDF extractor notes

**Source**: Explicit `--pdf` argument or `SOURCE_PDF_PATH`. `English_PDF_PATH` remains a compatibility alias. There is no machine-specific default.
**Implementation**: [`ingest/src/scrapers/deuteroScraper.ts`](../../ingest/src/scrapers/deuteroScraper.ts) (Node) + [`ingest/python/extract_deutero_chapter.py`](../../ingest/python/extract_deutero_chapter.py) (Python sidecar)
**Transport**: PyMuPDF via `child_process.spawn`

## PDF structure

The English PDF is **12,301 pages** but ~1/3 of those are navigation indexes, not content:
- Page 7: top-level Table of Contents
- Pages 1330–1344 (Tobit example): per-chapter index pages with hyperlinks
- Pages 1345+: Author/intro page, then actual content

Each navigation page is just a list of clickable verse numbers. Following the link reveals the actual content page. **TOC bookmarks (`doc.get_toc()`) point to chapter index pages, not content pages.** To find actual content:

1. Read the chapter index page's links (`page.get_links()`)
2. Filter for `LINK_GOTO` kind
3. The destination page numbers are the actual content pages

## Tobit example

| PDF page | What's there |
|---|---|
| 1330 | "TOBIT" — book home |
| 1331 | "Chapters in Tobit" with links to 1..14 |
| 1332 | "Verses in Tobit Chapter 1" — links to verses 1..22 |
| 1333..1344 | "Verses in Tobit Chapter 2"..."Chapter 14" |
| 1345 | Author / Date / Major Themes intro |
| **1346** | **Tobit 1:1 starts here**: "1 This is the book of the words of Tobit..." |
| 1347 | Tobit 1:19–22 + chapter 2 begins |
| 1348+ | Continued |

## Verse marker convention

Verses are marked by **inline integers immediately followed by a capital letter or quote**:

- `19But one of the men of Nineveh...`
- `20All of my possessions...`
- `21But not even fifty days...`
- `2"O Lord, You are righteous...`

The first verse of each chapter has **no inline marker** — except for the book's first chapter, which uses `1 ` before the text (where the `1` doubles as both chapter and verse marker).

## Chapter-boundary trick

When extracting from a page range, multiple chapters can share a page (e.g., page 1347 has Tobit 1:19–22 *and* Tobit 2:1–10). To prevent contamination, the parser tracks a **verse-number high-water mark**: when a detected verse number drops below the prior maximum, the next chapter has begun and we truncate the text at that point.

```python
high_water = 1
for marker in markers:
    n = marker.verse_number
    if n <= high_water:
        text = text[:marker.start]   # next chapter has begun
        break
    high_water = n
```

This is what the parser does. It correctly stops Tobit chapter 1 extraction even when chapter 2's `2`, `3`, `4`, etc. appear later on the same page.

## Heading detection

Headings are **standalone title-case lines** without terminal punctuation. Filtered to:
- Length 5..80 chars
- Not all-caps single-word lines (those are likely page-chrome)
- Position must be before the last detected verse marker (otherwise it belongs to the next chapter that bled in)

## What we don't extract yet

- **Footnotes**: English uses `†` markers in text and study notes elsewhere; we capture the `†` characters in the verse text but don't yet link to the actual study note bodies. This is a Day 6+ extension.
- **Liturgical-use markers** (`ω` per the English intro): not extracted yet. These will become the foundation of liturgical-use markers in the lectionary domain.
- **Italics / red-letter**: English does use these in the NT portion (which we're not extracting from this PDF — NT comes from source English). For Deuteros, no red-letter applies.

## Per-book page-range probe (for Day 7+ full scrape)

To find the start page of any Deutero book, follow the same pattern as Tobit:

1. `doc.get_toc()` → search entries for the book name
2. The matching entry's `page` field is the **chapter list** page (e.g. Tobit → 1330)
3. Page after the chapter list + intro is content start (typically chapter-list-page + 16 = content start, but not always)
4. **Or** follow the chapter-1 link from the chapter list page's first GOTO link

Build a lookup table once, store in `ingest/data/shared/deutero-page-ranges.json`, then per-chapter extraction is a constant-time lookup.

## Cost

- Free (one local PDF, no network calls)
- ~12 books × avg 8 chapters × ~3 seconds per extraction ≈ <5 minutes total for full Deutero scrape
