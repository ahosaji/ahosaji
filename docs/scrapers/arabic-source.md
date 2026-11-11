# Arabic scraper integration notes

**Source**: `${AR_BASE_URL}/Bibles/BibleSearch/showChapter.php?book=<id>&chapter=<n>`
**Implementation**: [`ingest/src/scrapers/arabicScraper.ts`](../../ingest/src/scrapers/arabicScraper.ts)
**Transport**: plain Node `fetch` (static HTML, no JS, no bot defenses observed)

Set `AR_BASE_URL` to the approved HTTP(S) source endpoint and set an appropriate `AR_USER_AGENT`. Missing, credential-bearing and placeholder URLs are rejected before fetching. Source permissions and dataset content are unchanged.

## URL pattern

`${AR_BASE_URL}/Bibles/BibleSearch/showChapter.php?book=53&chapter=3` returns John 3 in Arabic with full diacritics (tashkeel) preserved.

The `lang` param is silently ignored; the endpoint always returns Arabic. **an Arabic source does not have an English Bible.**

## Book numbering (an Arabic source URL scheme)

OT runs 1–49 with Deuterocanonicals interspersed in canonical Coptic order. NT starts at 50.

| `book=` | Name (Arabic) | Name (English) |
|---|---|---|
| 1 | سفر التكوين | Genesis |
| 4 | سفر العدد | Numbers |
| 14 | سفر أخبار الأيام الثاني | 2 Chronicles |
| 15 | سفر عزرا | Ezra |
| 16 | سفر نحميا | Nehemiah |
| **17** | **سفر طوبيا** | **Tobit** ★ Deutero |
| 18 | سفر يهوديت | Judith ★ Deutero |
| 19 | سفر أستير | Esther |
| 43 | سفر حبقوق | Habakkuk |
| 47 | سفر ملاخي | Malachi |
| 48 | سفر المكابيين الأول | 1 Maccabees ★ Deutero |
| 49 | سفر المكابيين الثاني | 2 Maccabees ★ Deutero |
| **50** | **إنجيل متى** | **Matthew** ← NT starts here |
| 51 | إنجيل مرقس | Mark |
| 52 | إنجيل لوقا | Luke |
| **53** | **إنجيل يوحنا** | **John** |

(The PDF filenames the user shared use a *different* numbering scheme — don't conflate.)

## HTML anchors

```html
<strong>
  <a class="verse-num" name="3-1" title="(يو 3: 1)" href="showVerses.php?book=53&chapter=3&vmin=1&vmax=1">1</a>
  <div id="bodytext" class="HColor1Div" style="display:inline" data-usfm="John.3.1">
    كَانَ إِنْسَانٌ مِنَ الْفَرِّيسِيِّينَ اسْمُهُ نِيقُودِيمُوسُ، رَئِيسٌ لِلْيَهُودِ.
  </div>
</strong>
<BR class="brShowHide">
```

### Key markers

| What | Selector | Notes |
|---|---|---|
| Verse div | `div.HColor1Div[data-usfm]` | `data-usfm="John.3.1"` is the gold-standard anchor (long-form English book name) |
| Section heading | `<h2>` (within page-content, not chrome) | "حديثه مع نيقوديموس", "شهادة يوحنا المعمدان للمسيح" |
| Page-chrome h2/h3 | various | Filter out (template placeholders contain `${...}`) |
| Verse-num anchor | `<a class="verse-num" name="3-1">` | Use as fallback to data-usfm |

## Cross-translation alignment with English (John 3 protocanonical)

Both translations independently report 36 verses with section headings before v1 and v22 — **strong publisher-convention alignment** at the verse-boundary level. The headings are different *texts* (Arabic vs English) but cover the same passages.

## Deuterocanonical caveat

For the same canonical book (e.g. Tobit), Arabic follows the **Vulgate** verse-counting tradition while English follows **Rahlfs Greek Septuagint**. They have different verse counts. See `docs/decisions.md` §7 and `ingest/data/shared/versification/README.md`.

## Politeness

- Plain HTTP, no API rate limit observed
- Use a browser User-Agent (set via `AR_USER_AGENT` env var)
- Suggested delay between requests: 500ms–1s
- Cache responses to `ingest/data/cache/arabic/book-<id>-chapter-<n>.html`
