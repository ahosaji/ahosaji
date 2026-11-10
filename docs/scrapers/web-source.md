# English scraper integration notes

**Source**: `${SOURCE_BASE_URL}/passage/?search=<book>+<chapter>&version=<version>`
**Implementation**: [`ingest/src/scrapers/webSource.ts`](../../ingest/src/scrapers/webSource.ts)
**Transport**: bounded direct `fetch` first, with an optional bounded Firecrawl v2 REST fallback. Configure `SOURCE_BASE_URL` and `SOURCE_VERSION`; no provider/version is assumed. The fallback key is sent only to `https://api.firecrawl.dev/v2/scrape`.

## URL pattern

`${SOURCE_BASE_URL}/passage/?search=John+3&version=${SOURCE_VERSION}`
- Use the **English book name** (`John`, `Matthew`, etc.), not the USFM code, in the search param.
- Spaces in book names: `1+Corinthians`, `Song+of+Solomon`.
- Use the exact provider version identifier configured in `SOURCE_VERSION`; do not infer it from the stored `en` language code.

## HTML anchors (as of 2026-04-30)

```html
<div class="passage-text">
  <div class="passage-content passage-class-0">
    <div class="version-English result-text-style-normal text-html">
      <h3><span id="..." class="text John-3-1">The New Birth</span></h3>
      <p class="chapter-1">
        <span class="text John-3-1">
          <span class="chapternum">3&nbsp;</span>
          There was a man of the Pharisees named Nicodemus...
        </span>
        <span class="text John-3-2">
          <sup class="versenum">2&nbsp;</sup>
          ...
        </span>
      </p>
    </div>
  </div>
</div>
```

### Key markers

| What | Selector | Notes |
|---|---|---|
| Verse anchor | `span.text` with class containing `<EnglishBookName>-<chapter>-<verse>` | USFM code does NOT appear in classes |
| Chapter number prefix | `<span class="chapternum">` | Skip during text extraction |
| Verse number | `<sup class="versenum">` | Skip during text extraction |
| Red-letter (Jesus) | `<span class="woj">` | "words of Jesus" |
| Translator-added words | `<i>` | English-italics convention |
| Section heading | `<h3>` inside `.passage-text` | Publisher-editorial |
| Footnote marker | `<sup class="footnote" data-fn="#fen-...">` | Use `data-fn` attribute, not the inner anchor href |
| Footnote bodies | `<div class="footnotes"><ol><li id="fen-...">` | Look up by `data-fn` value |
| Cross-references | `<sup class="crossreference" data-cr="#cen-...">` | Skip during text extraction |

## Gotchas (with fixes applied in the parser)

### 1. Heading wrapper spans look like verses
The first verse of each chapter is duplicated: once as a heading wrapper inside `<h3><span class="text John-3-1">…heading text…</span></h3>`, and once as the actual verse content in the next `<p>`. **Fix**: skip spans whose ancestor is `<h3>`.

### 2. Footnote anchor is in `data-fn`, not href
The `<a>` element inside `<sup class="footnote">` has a long absolute URL; the clean fragment anchor is in `data-fn` on the parent `<sup>`. **Fix**: read `data-fn` directly.

### 3. Cross-references and footnotes split tokens
Skipping inline `<sup>` markers introduces token boundaries that don't exist in the rendered text. **Fix**: merge adjacent same-style tokens after extraction, drop empty fragments.

## Cost

- 1 credit per chapter page
- Full English (66 books, ~1,189 chapters) = ~1,189 credits
- Free tier = 500 credits/month
- **Therefore**: full scrape requires either Hobby plan ($19/mo, 3,000 credits) or swap to plain `fetch` (the recommended path).

## Plain-fetch fallback (for Day 7+ full scrape)

source serves the same HTML to plain HTTP requests with a normal browser User-Agent. No JS required. No CAPTCHA observed at low rates. Recommended swap:
1. Try plain `fetch(url, { headers: { 'User-Agent': '<browser UA>' } })`
2. On 403/429, fall back to Firecrawl
3. 1–2 second delay between requests for politeness
4. Cache responses to `ingest/data/cache/source/<version>/<usfm>-<chapter>.html`
