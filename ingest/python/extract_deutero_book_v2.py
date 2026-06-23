"""Extract an English Deutero book using verse-number-drop chapter detection.

Replaces the page-window strategy in scrape_deutero_book.py for the books
where chapter content bleeds across pages with no clean per-page chapter
markers.

Strategy:
  1. Pull the whole-book text window via the existing TOC/GOTO walk
     (chapter_starts_for_book → first chapter content page through last).
  2. strip_page_headers removes standalone-integer running headers.
  3. Find all inline verse markers in order. A verse-number drop (n
     <= prior high-water-mark, where n is small and prior was >= 3)
     is a chapter boundary at the next chapter's v2 marker.
  4. Each chapter's content = [prev_chapter_v_max_marker_end, this_v2_marker].
     For the v1 leading prefix, trim heuristically:
       a. If a title-case standalone line appears, treat it as the
          chapter heading and trim everything before it.
       b. Else split at the last paragraph break (\\n\\n).
       c. Else split at the last sentence terminator (".†", ".\"", or
          ". " followed by capital letter or quote).
       d. Fallback: keep the slice as-is (will look slightly off on v1).
  5. Per-chapter overrides: SLICE_OVERRIDES[usfm][ch] = explicit slice
     phrase, used when the heuristic fails.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf  # type: ignore

sys.path.insert(0, str(Path(__file__).parent))
from extract_deutero_chapter import (  # type: ignore
    VERSE_MARKER_RE, split_verses, extract_headings, strip_page_headers,
)
from scrape_deutero_book import (  # type: ignore
    chapter_starts_for_book, extract_text_pages,
)


SLICE_OVERRIDES: dict[str, dict[int, str]] = {
    # Each entry pins v1 of a chapter to its actual start phrase, used when
    # the heuristic gets misled by an intervening section heading or by English
    # English's tendency to attach v1 narrative bridges to the previous chapter.
    "TOB": {
        # English attaches "Then Tobit ceased giving thanks" to ch13 v18, but in
        # standard Greek LXX (and KJV/NRSV) traditions this line is 14:1.
        # Reclaim it as ch14 v1.
        14: "Then Tobit ceased giving thanks",
    },
    "SIR": {
        # Section heading "Outward Appearances" sits between v1 and v2.
        11: "The wisdom of a humble man will exalt his head",
        # Same pattern with section heading "Showing Mercy".
        28: "He who seeks rev",  # PyMuPDF inserts a space inside "revenge"
    },
}


# English study notes / commentary insert prose between Bible verses, and that
# prose contains references like "Hebrews 11", "Heb 12:1", "2 Maccabees",
# "167 BC", "Ps 104:15" — each contains an integer that VERSE_MARKER_RE
# matches. Reject markers whose surrounding context shows they're cross-refs.
#
# IMPORTANT: keep this conservative. Section headings like "Solomon's Love
# of Wisdom" placed right before a verse marker would otherwise false-match
# "Wisdom" as a Bible book reference and silently drop legitimate verses.
# We rely on these signals (any one is sufficient):
#
#   1. Marker is followed by ":<digit>" (Bible reference form like "11:1").
#   2. Marker is followed by " BC" / " AD" / " CE" / " BCE" (date).
#   3. Marker is followed by " <BookName>" where BookName is a numbered-prefix
#      book ("1 Maccabees", "2 Maccabees", "1 Samuel", etc.).
#   4. Marker is preceded by a SHORT-FORM book abbreviation immediately before
#      it (e.g. "Heb 12", "Ps 104", "Mt 5"). These are unambiguous cross-ref
#      shorthand that almost never appears in chapter/section headings.
#
# We deliberately do NOT match against full-form book names like "Hebrews",
# "Wisdom", "Sirach" preceded by space — those overlap with section headings
# (e.g. "Wisdom of Solomon\n1Wisdom..." — the "1" there is the chapter label,
# not a cross-ref). The colon and "X Maccabees" rules catch real prose
# references in the English study notes (which always include verse:colon or
# numbered-book form when citing Maccabean passages).
SHORT_BOOK_ABBREV_PRECEDED_RE = re.compile(
    r"\b(?:Gen|Ex|Lev|Num|Deut|Josh|Judg|Ruth|Sam|Kgs|Chr|Ezra|Neh|Esth|Job|Ps|"
    r"Prov|Eccl|Song|Isa|Jer|Lam|Ezek|Dan|Hos|Joel|Amos|Obad|Jon|Mic|Nah|Hab|"
    r"Zeph|Hag|Zech|Mal|Matt|Mt|Mk|Lk|Jn|Acts|Rom|Cor|Gal|Eph|Phil|Col|Thess|"
    r"Tim|Tit|Phlm|Heb|Jas|Pet|Rev|Tob|Jdt|Wis|Sir|Bar|Macc|Hebrews|Tobit|Judith|"
    r"Wisdom|Sirach|Baruch|Maccabees|Genesis|Exodus|Leviticus|Numbers|Deuteronomy|"
    r"Joshua|Judges|Samuel|Kings|Chronicles|Esther|Psalms?|Proverbs|Ecclesiastes|"
    r"Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Obadiah|Jonah|Micah|"
    r"Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|"
    r"Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|"
    r"Thessalonians|Timothy|Titus|Philemon|James|Peter|Revelation)[ \t]+$"
)
NUMBERED_BOOK_FOLLOWED_RE = re.compile(
    r"^\s*(?:Macc|Maccabees|Sam|Samuel|Kgs|Kings|Chr|Chronicles|Cor|Corinthians|"
    r"Thess|Thessalonians|Tim|Timothy|Pet|Peter|Jn|John)\b"
)
DATE_SUFFIX_RE = re.compile(r"^\s*(?:BC|AD|B\.C\.|A\.D\.|CE|BCE)\b")
COLON_VERSE_RE = re.compile(r"^\s*[:.]\s*\d")


def is_cross_reference(cleaned: str, m: re.Match) -> bool:
    """Detect when a digit-match is part of a Bible reference, not a verse marker."""
    s, e = m.start(), m.end()
    n_str = m.group("num") or m.group("num2") or ""
    n = int(n_str) if n_str.isdigit() else 0

    # Look at 30 chars before for a book name + horizontal space (same line as
    # the digit). Newline-separated means it's heading-then-verse, not a ref.
    before = cleaned[max(0, s - 30):s]
    if SHORT_BOOK_ABBREV_PRECEDED_RE.search(before):
        return True

    after = cleaned[e:e + 25]
    # "1 Maccabees", "2 Samuel" etc. — only when n is 1/2/3 (a real book number).
    # Without this guard, "37Timothy" or "6John" gets falsely rejected because
    # Timothy and John are both Bible books AND characters in 1 Maccabees.
    if n in (1, 2, 3) and NUMBERED_BOOK_FOLLOWED_RE.match(after):
        return True
    if DATE_SUFFIX_RE.match(after):
        return True
    if COLON_VERSE_RE.match(after):
        return True
    return False


def mask_cross_references(text: str) -> str:
    """Replace digits inside cross-references with placeholder characters so
    split_verses won't match them as verse markers. The character count is
    preserved so verse-position offsets remain valid downstream."""
    out = list(text)
    for m in VERSE_MARKER_RE.finditer(text):
        if is_cross_reference(text, m):
            n_str = m.group("num") or m.group("num2") or ""
            for i in range(m.start(), m.start() + len(n_str)):
                out[i] = "X"
    return "".join(out)


def detect_chapter_v2_positions(cleaned: str, max_chapters: int) -> list[tuple[int, int, int]]:
    """Return [(chapter, v2_offset, prev_marker_end)] in cleaned text.

    prev_marker_end = the END position of the LAST verse marker that
    belongs to the PREVIOUS chapter. The text between prev_marker_end
    and v2_offset contains: previous chapter's last-verse tail +
    (optional heading) + this chapter's v1.

    For ch1, the v2 marker is the FIRST inline marker whose value is
    exactly 2 — this filters out date-like noise from the English book
    introduction essay (e.g. "(135-105 BC)" matched as n=105).

    Markers that look like Bible cross-references in study-note prose
    (e.g. "Hebrews 11", "2 Maccabees 7:42", "167 BC") are skipped.
    """
    boundaries: list[tuple[int, int, int]] = []
    high_water = 1
    chapter = 1
    last_marker_end = 0
    for m in VERSE_MARKER_RE.finditer(cleaned):
        n_str = m.group("num") or m.group("num2") or ""
        if not n_str:
            continue
        n = int(n_str)
        if n < 1 or n > 200:
            continue

        if is_cross_reference(cleaned, m):
            continue

        # Until ch1's v2 is anchored, accept ONLY n==2 (real verse 2). This
        # rejects all the noise integers in the book introduction essay.
        if not boundaries:
            if n != 2:
                continue
            boundaries.append((1, m.start(), 0))
            high_water = 2
            last_marker_end = m.end()
            continue

        if n <= high_water:
            if chapter < max_chapters and high_water >= 3 and n <= 4:
                chapter += 1
                boundaries.append((chapter, m.start(), last_marker_end))
                high_water = n
                last_marker_end = m.end()
            continue
        high_water = n
        last_marker_end = m.end()
    return boundaries


# A chapter heading: title-case line, length 5..80, not all caps if single word.
HEADING_RE = re.compile(r"^[A-Z][\w'‘’]*(?:\s+(?:[A-Z][\w'‘’]*|of|the|to|and|in|for|with|a|an|on|at|by|from|but))*\s*$", re.M)
PARA_BREAK_RE = re.compile(r"\n\s*\n")
SENTENCE_END_RE = re.compile(r"[.!?][”’\"'`†‡]?\s+(?=[A-Z“‘\"'])")


def find_chapter_v1_start(text: str) -> int:
    """Within a chapter's [prev_marker_end, this_v2) window, find where v1 starts.

    The window contains: previous chapter's last-verse tail + optional
    heading + this chapter's v1 prose. We need to skip the tail.

    Tries in order:
      1. LAST chapter heading in the window — v1 starts right after.
      2. LAST paragraph break (\\n\\n) in the window — v1 starts after.
      3. LAST sentence boundary (.+space+capital) — v1 starts after.
      4. Fallback: keep window as-is (split_verses will see the full text).
    """
    # 1. Heading: LAST title-case standalone line in the window.
    last_heading_end = -1
    for m in HEADING_RE.finditer(text):
        line = m.group(0).strip()
        if len(line) < 5 or len(line) > 80:
            continue
        if line.upper() == line and len(line.split()) < 3:
            continue
        last_heading_end = m.end()
    if last_heading_end >= 0:
        return last_heading_end

    # 2. Paragraph break — LAST one in the window
    last_para_end = -1
    for m in PARA_BREAK_RE.finditer(text):
        last_para_end = m.end()
    if last_para_end >= 0:
        return last_para_end

    # 3. Sentence boundary — LAST one
    last_sent_end = -1
    for m in SENTENCE_END_RE.finditer(text):
        last_sent_end = m.end()
    if last_sent_end >= 0:
        return last_sent_end

    return 0


def extract_book(doc: pymupdf.Document, usfm: str, max_chapters: int,
                 max_verse: int = 200, end_marker: str | None = None) -> dict:
    starts = chapter_starts_for_book(doc, usfm)
    if not starts:
        raise RuntimeError(f"could not find {usfm} in TOC")
    starts = sorted(starts)
    book_start = starts[0]
    book_end = (starts[min(max_chapters, len(starts)) - 1] if len(starts) >= 1 else book_start) + 14
    raw = extract_text_pages(doc, book_start, book_end)
    cleaned = strip_page_headers(raw)

    # Cap at end_marker (next-book heading like "JUDITH") to avoid bleed-over
    if end_marker:
        ep = cleaned.find(end_marker)
        if ep > 0:
            cleaned = cleaned[:ep]

    # Mask cross-reference numbers in study-note prose ("Hebrews 11", "2
    # Maccabees", "167 BC") so neither chapter detection nor split_verses
    # mistakes them for verse markers. Length-preserving so offsets stay valid.
    cleaned = mask_cross_references(cleaned)

    boundaries = detect_chapter_v2_positions(cleaned, max_chapters)
    if not boundaries:
        raise RuntimeError(f"no chapter boundaries detected for {usfm}")

    overrides = SLICE_OVERRIDES.get(usfm, {})

    # Pass 1: compute v1_start for every chapter (so we can use the next
    # chapter's v1_start as THIS chapter's slice end — keeping next-chapter
    # bleed out of this chapter's v_max).
    v1_starts: list[int] = []
    for i, (ch, v2_off, prev_marker_end) in enumerate(boundaries):
        if ch in overrides:
            phrase = overrides[ch]
            phrase_pos = cleaned.find(phrase, prev_marker_end, v2_off + 200)
            if phrase_pos < 0:
                print(f"  warn: {usfm} ch{ch} override phrase {phrase!r} not found", file=sys.stderr)
                v1_start = prev_marker_end + find_chapter_v1_start(cleaned[prev_marker_end:v2_off])
            else:
                v1_start = phrase_pos
        elif i == 0:
            window = cleaned[0:v2_off]
            v1_start = find_chapter_v1_start(window)
        else:
            window = cleaned[prev_marker_end:v2_off]
            v1_start = prev_marker_end + find_chapter_v1_start(window)
        v1_starts.append(v1_start)

    # Pass 2: build per-chapter slices [this_v1_start, next_v1_start).
    chapters: dict[str, dict] = {}
    for i, (ch, v2_off, prev_marker_end) in enumerate(boundaries):
        v1_start = v1_starts[i]
        slice_end = v1_starts[i + 1] if i + 1 < len(v1_starts) else len(cleaned)
        slice_text = cleaned[v1_start:slice_end]

        # If the slice begins with the chapter number fused to v1 text
        # (e.g. WIS 13 typesets ch13 v1 as "13 For all men…"), strip the
        # leading digits so split_verses doesn't misread them as a verse
        # marker. Only strip when the leading number EXACTLY matches the
        # chapter number — otherwise it could be a real verse marker.
        ch_str = str(ch)
        leading = re.match(rf"\s*{re.escape(ch_str)}\s*(?=[A-Za-z])", slice_text)
        if leading:
            slice_text = slice_text[leading.end():]

        verses_text, verse_offsets = split_verses(slice_text, max_verse, 0)
        headings = extract_headings(slice_text, verse_offsets)

        # Trim heading text out of the verse bodies it bleeds into. extract_headings
        # already detected and reported these as separate metadata; leaving them
        # in the verse text would render them twice (once as `heading`, once
        # appended to the verse body).
        for _, heading_text in headings:
            for vn, body in list(verses_text.items()):
                if heading_text in body:
                    verses_text[vn] = body.replace(heading_text, "", 1)

        verses = []
        for vn in sorted(verses_text.keys()):
            body = re.sub(r"\s+", " ", verses_text[vn]).strip()
            if not body:
                continue
            verses.append({
                "ref": f"{usfm}.{ch}.{vn}",
                "book": usfm, "chapter": ch, "verse": vn,
                "text": body,
                "structured": {
                    "tokens": [{"text": body, "italic": False, "redLetter": False}],
                    "footnotes": [], "crossRefs": [],
                    "heading": next((h for v, h in headings if v == vn), None),
                    "paragraphStart": False, "poetic": False, "poeticLines": None,
                },
            })

        chapters[str(ch)] = {
            "translation": "en", "source": "English-English", "book": usfm, "chapter": ch,
            "verses": verses,
            "headings": [{"beforeVerse": v, "text": h, "level": 2} for v, h in headings],
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }

    return {"usfm": usfm, "source": "deutero", "chapters": chapters}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--usfm", required=True)
    ap.add_argument("--max-chapters", type=int, required=True)
    ap.add_argument("--max-verses-per-chapter", type=int, default=200)
    ap.add_argument("--end-marker", default=None,
                    help="phrase that marks the start of the next book (e.g. 'JUDITH')")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    out = extract_book(doc, args.usfm, args.max_chapters,
                       args.max_verses_per_chapter, args.end_marker)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print(file=sys.stderr)
    for k in sorted(out["chapters"].keys(), key=int):
        ch = out["chapters"][k]
        vs = ch["verses"]
        nums = [v["verse"] for v in vs]
        print(f"  {args.usfm} ch{k}: {len(vs)} verses  vmin={min(nums) if nums else '-'}  vmax={max(nums) if nums else '-'}", file=sys.stderr)


if __name__ == "__main__":
    main()
