# English extraction — known limits and recommended path forward

**Status as of 2026-05-04 (evening).** Generic fix shipped:
`extract_deutero_book_v2.py`, two iterations. The 47 originally-suspect
chapters dropped to **3** (94% reduction). Per-book targeted extractors
are no longer needed for the bulk case.

The 3 remaining holdouts are all English editorial choices (chapters that
genuinely start at v2 in the English edition — TOB ch14, SIR ch11,
SIR ch28 — where the publisher attached what would have been v1 to
the previous chapter).

## Generic fix that worked

`ingest/python/extract_deutero_book_v2.py` — uses verse-number-drop detection
on the cleaned whole-book text stream:

  1. Walk the per-book TOC nav to get the chapter-1 content page (and the
     last chapter content page) for the page-window. Existing
     `chapter_starts_for_book` works for this.
  2. `strip_page_headers` removes standalone-integer page chrome.
  3. Find every inline verse marker (existing `VERSE_MARKER_RE`).
     A verse-number drop with high-water ≥ 3 and new n ≤ 4 is a chapter
     boundary at the next chapter's v2 marker.
  4. For ch1, only accept the FIRST inline marker if `n == 2` — this
     filters date-like noise from the English book introduction essay
     (`(135-105 BC)` matched as `n=105` was the canonical false positive).
  5. For each chapter's v1, slice `[prev_v_max_marker_end, this_v2_marker)`
     and find v1 start via heuristic: last chapter heading > last paragraph
     break > last sentence boundary.

### Verse counts (recovered)

| Book | Old verses | New verses | Δ      |
|------|------------|------------|--------|
| TOB  | 149        | 247        | +98    |
| JDT  | 173        | 340        | +167   |
| WIS  | 109        | 417        | +308   |
| SIR  | 525        | 1373       | +848   |
| 1MA  | 250        | 900        | +650   |
| 2MA  | 167        | 487        | +320   |
| 3MA  | 53         | 161        | +108   |
| **total** | **1426** | **3925** | **+2499** |

All chapter counts match the books.json registry (no missing chapters).

## Iteration 3 — 100% clean (138/138)

After re-probing the 2 "English editorial" holdouts (TOB 14, SIR 28), it
turned out neither was editorial — both had the same heading-between-v1-and-v2
pattern as SIR 11. The bug was twofold:

1. The slice for chapter N ended at chapter N+1's v2 marker, so
   chapter N+1's v1 text leaked into chapter N's `v_max`. (E.g. TOB
   ch13 v18 contained "Then Tobit ceased giving thanks. Tobit's
   Final Words" — 14:1 narrative + ch14 heading.)

2. The "last heading wins" v1-anchor heuristic skipped past v1 when
   a section heading sat between v1 and v2.

Fixes applied:

- Refactor extract_book to compute v1_starts in a first pass, then
  build slices `[this_v1_start, next_v1_start)` in a second pass.
  This keeps next-chapter content out of this chapter's v_max.
- Add SLICE_OVERRIDES for TOB 14 and SIR 28 pinning their v1 phrases.
- Trim heading text out of verse bodies — extract_headings already
  reports them as separate metadata; leaving them in the verse body
  would render them twice.

**Final state: 138/138 chapters clean. 100%.** Total 4007 verses
across the 7 English Deutero books (was 1426 baseline; +2581 recovered).

## Iteration 2 — fix for chapter-number-fused-to-v1 typesetting

WIS ch13, 1MA ch16, and 3MA ch6 turned out to be the same bug, not
three separate ones. English sometimes typesets a chapter's v1 with
the chapter number fused to the verse text — `"13 For all men…"`,
`"16 Then John…"`, `"6 Now there was a certain man…"`. PyMuPDF extracts
that "13" / "16" / "6" as plain text, where it then matches
`VERSE_MARKER_RE` and gets misread as a verse-N marker — pinning the
splitter to a fake `vmax = N` and consuming everything as that one
verse.

Fix: when assembling each chapter's slice, strip a leading
`<chapter_number>\s+` prefix if it matches the chapter we're processing.
That collapses `"13 For all men…"` to `"For all men…"`, and the
splitter then correctly emits v1.

After this fix, **only 3 chapters remain suspect** — and they are all
genuinely English-editorial v1-shifts, not extraction bugs:

| Chapter | Symptom | Why |
|---|---|---|
| TOB ch14 | 14v vmin=2 vmax=15 | English ch13 v18 = "Then Tobit ceased giving thanks" — that line is Greek-LXX Tobit 14:1 in standard versification. English attached it to ch13 instead. |
| SIR ch11 | 31v vmin=2 vmax=32 | English attached SIR 11:1 ("The wisdom of a humble man will lift up his head…") to ch10 v31. |
| SIR ch28 | 25v vmin=2 vmax=26 | Same pattern — SIR 28:1 attached to ch27 v30. |

These are faithful to the English source and should NOT be "fixed" —
they should be documented in the versification mapping table when
curated (task #4), where the en→ar mapping will note that
`ar:SIR.11.1 ↔ en:SIR.10.31[tail]`.

---

## Original investigation (kept for archeology)

Two architectural attempts that didn't work; useful context if a future
contributor wonders why we did it the way we did.

## What's broken

47 chapters across 7 English Deuterocanonical books extract incorrectly today:

| Book | Suspect chapters |
|---|---|
| TOB | 3 |
| JDT | 2 |
| WIS | 11 |
| SIR | 21 |
| 1MA | 4 |
| 2MA | 3 |
| 3MA | 3 |

The pattern is consistent: an affected chapter has either `vmin > 1` (the
chapter's first N verses are missing) or its verse range spans nearly the
entire book's verse-numbering (`vmax > 50` for a chapter that should have
≤ 25 verses), meaning multiple chapters' content collapsed into one slice.

## Why the obvious fixes don't work

### Attempt 1: Use the chapter label on each nav page

English's per-chapter nav pages are titled "Verses in `<Book>` Chapter N", so we
can read N directly instead of trusting the home-page GOTO ordering. **This
fixes chapter mis-labeling** (e.g. the BAR `Introduction` masquerading as
ch1, the JUDITH home masquerading as TOB ch15). Implemented and reverted —
the chapter assignment improves but the underlying per-chapter content is
still wrong because of the deeper layout issue below.

### Attempt 2: Use standalone-integer page-running-headers as chapter markers

English Deuteros put a standalone integer on each page (the running
chapter-number header). Within a book's text stream, these line up
monotonically (`2`, `3`, …, `chMax`). Tempting to slice by them.

**Why it fails**: the running header marks the page's *ending* chapter, not
where that chapter begins. A page whose header reads `3` may contain:

  - the tail of ch1 (e.g. `…sought by the king…`)
  - all of ch2
  - ch3 verses 1–10

…in that order, with no intra-page chapter markers. So slicing the text at
the `3` marker gives back the *middle* of ch3, not the start. The verses
the splitter finds will be `11`, `12`, `13`… (the inline markers that
happen to land on this page), and ch3 v1–10 disappear into the
preceding-chapter slice.

This is exactly what the audit reports: `TOB ch3: 4v vmin=11 vmax=14`,
`TOB ch6: 6v vmin=18 vmax=23`, etc.

### Attempt 3: Take the union of the previous page's tail + this page's head

Plausible but expensive: it forces a per-chapter manual cut-line because
ch2 also lives on that previous page, and there's no programmatic signal
to distinguish ch1's last line from ch2's first line in a continuous-prose
typesetting.

## What does work: per-book targeted extractors

`ingest/python/extract_deutero_baruch.py` is the demonstrator. For each
chapter:

  1. Hard-coded page window (typically the chapter's start page through
     the next chapter's start page).
  2. Hard-coded `slice_from` phrase that uniquely identifies v1 of the
     chapter in the English text. This is needed because v1 has no
     inline number marker.
  3. Hard-coded `end_marker` phrase that identifies where the next
     chapter begins, so trailing content (next-chapter heading + v1
     prose) is truncated cleanly.

`extract_deutero_specials.py` follows the same pattern for PS2/DAG.

This is **manual scholarly curation, not parsing**. About 10–15 minutes
per chapter to (a) read the chapter in English, (b) lift the v1 phrase,
(c) verify the extraction by spot-checking the first and last verse.

## Estimate to fix all 7 books

  - TOB: 14 chapters
  - JDT: 16 chapters
  - WIS: 19 chapters
  - SIR: 51 chapters
  - 1MA: 16 chapters
  - 2MA: 15 chapters
  - 3MA: 7 chapters

Total: **138 chapters × ~12 min = ~28 hours of focused curation**.

The cost is real because English Greek Septuagint Tobit (etc.) uses a
versification distinct from KJV Apocrypha / NRSV-CE. Slice phrases can't
be lifted from a public reference — they have to come from the actual English
English text.

## What's NOT broken (and shouldn't be re-touched)

  - **BAR** — fixed by `extract_deutero_baruch.py` (commit `03dcf76`). 6
    chapters / 214 verses, matches Arabic exactly.
  - **PS2, DAG** — `extract_deutero_specials.py`. Targeted page-range slicing.
  - **ESG** — `extract_deutero_esther_additions.py`. Letter-suffixed verse
    extraction for English's inline Greek-Esther additions A–F.
  - **MAN** — sourced from Fr. the editor's parish edition
    (`en/MAN.json` is hand-written; English lacks it entirely).

## Decision

Per-book extractors are correct but expensive. Three honest paths:

1. **Power through.** Curate all 7 books as a focused multi-session effort.
   Budget ≈ 4 working days. Highest-quality outcome, unblocks task #4
   (versification mapping). Best done as one continuous pass.

2. **Triage by user impact.** Curate only the chapters that v1.0 consumers
   actually hit. Tobit and Maccabees are most cited in Coptic liturgy;
   Sirach is most cited in commentary. ≈ 1 day for TOB + 1MA + 2MA + a
   selection of SIR chapters.

3. **Defer to v1.1.** Ship v1 with the broken chapters explicitly listed in
   the API's `/v1/info` response under a `known_gaps` field, so consumers
   can degrade gracefully. Lowest engineering cost; least Coptic-textual
   integrity. (The MAN fix demonstrated we can source the right text from
   Coptic Orthodox publications if and when we want to.)

The Arabic side (an Arabic source) is unaffected by all this — `ar/<USFM>.json`
files are correct. The damage is English-side only.

## Versification mapping (task #4) is blocked

Mapping ar↔en across divergent Deuteros depends on having a clean en
side first. Curating mapping tables against the broken extractions would
just bake in the bugs. Resume #4 only after the affected books' en
extractions are correct.

A separate finding from this investigation: **TOB-style divergence**
between Arabic Arabic (Vulgate Latin lineage) and English
English (Rahlfs Greek Septuagint) is not pure renumbering — they're
different *recensions* of the same book. Compare:

  - en `TOB.1.1`: "This is the book of the words of Tobit, the son of
    Tobiel…" (autobiographical first-person)
  - ar `TOB.1.1`: "كَانَ طُوبِيَّا وَهُوَ مِنْ سِبْطِ نَفْتَالِي…"
    ("Tobiah was from the tribe of Naphtali…", third-person narrative)

The two languages are translating different Greek manuscript families
(Sinaiticus vs Vaticanus). Mapping tables for these books will be
best-effort scholarly approximation, not arithmetic — flag this in the
v1.1 plan when scoping.
