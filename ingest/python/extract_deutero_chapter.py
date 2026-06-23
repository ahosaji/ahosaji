"""Extract a single chapter from the English PDF.

English Deuterocanonicals are typeset as continuous prose with inline integer
verse markers (e.g. '19But one of the men…'). The first verse of each chapter
has no inline number — it follows the chapter header (or, for the book's first
chapter, the integer '1' shared with the chapter heading).

Output: JSON to stdout matching the canonical shape in
   ingest/src/types/canonical.ts
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone
import pymupdf  # type: ignore


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--pdf", required=True, help="Absolute path to the English PDF")
    p.add_argument("--book-usfm", required=True, help="USFM book code, e.g. 'TOB'")
    p.add_argument("--chapter", type=int, required=True)
    p.add_argument(
        "--start-page", type=int, required=True,
        help="1-indexed PDF page where this chapter's content starts",
    )
    p.add_argument(
        "--end-page", type=int, required=True,
        help="1-indexed PDF page where this chapter's content ends (inclusive)",
    )
    p.add_argument(
        "--max-verse", type=int, required=True,
        help="Highest verse number expected in this chapter (sanity bound)",
    )
    return p.parse_args()


def extract_text(doc: pymupdf.Document, start_page: int, end_page: int) -> str:
    """Pages are 1-indexed in the CLI; PyMuPDF is 0-indexed."""
    chunks = []
    for p in range(start_page - 1, end_page):
        chunks.append(doc.load_page(p).get_text("text"))
    return "\n".join(chunks)


# Strip page-header artifacts: a standalone integer on its own line at the start
# of a page (the running chapter-number header). We don't strip mid-text.
HEADER_RE = re.compile(r"^\s*(\d+)\s*$", re.M)


def strip_page_headers(text: str) -> str:
    """Remove standalone-integer lines that are page-chrome (running chapter num).

    Conservative: only strip lines that are JUST a 1-2-digit number with nothing
    else. Real verse markers always abut text immediately, so they survive.
    """
    return HEADER_RE.sub("", text)


# Verse markers: integer immediately followed by a letter (cap OR lowercase
# for mid-sentence continuations like '20and', '41but'), opening quote, or
# space-then-letter. The high-water-mark check + max_verse cap in split_verses
# filter out narrative numbers ('30 sheep' won't pass the monotonicity test
# unless they fit the chapter's verse sequence).
VERSE_MARKER_RE = re.compile(
    r"(?<![A-Za-z])(?P<num>\d{1,3})(?=[A-Za-z“\"‘'])|(?<![A-Za-z])(?P<num2>\d{1,3})(?=\s[A-Za-z“\"‘'])"
)


def split_verses(
    text: str, max_verse: int, first_verse_text_starts_at: int
) -> tuple[dict[int, str], dict[int, int]]:
    """Split prose into verse → text map AND verse → start-offset map.

    Chapter-boundary detection: verse numbers in English are monotonically
    increasing within a chapter. If we ever see a verse number lower than the
    high-water-mark (and we already saw at least 2 markers), the next chapter
    has begun in our text window. Truncate before that marker.
    """
    positions: list[tuple[int, int, int]] = []  # (start, end, verse_num)
    high_water = 1  # verse 1 is implicit
    for m in VERSE_MARKER_RE.finditer(text):
        s = m.start()
        if s < first_verse_text_starts_at:
            continue
        num_str = m.group("num") or m.group("num2") or ""
        if not num_str:
            continue
        n = int(num_str)
        if not (2 <= n <= max_verse):
            continue
        if n <= high_water:
            # Next chapter has started — truncate text here.
            text = text[:s]
            break
        positions.append((s, m.end(), n))
        high_water = n

    verses: dict[int, str] = {}
    offsets: dict[int, int] = {}
    if not positions:
        verses[1] = text[first_verse_text_starts_at:].strip()
        offsets[1] = first_verse_text_starts_at
        return verses, offsets

    verses[1] = text[first_verse_text_starts_at: positions[0][0]].strip()
    offsets[1] = first_verse_text_starts_at

    for i, (start, end, n) in enumerate(positions):
        next_start = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        verses[n] = text[end:next_start].strip()
        offsets[n] = end

    return verses, offsets


# Detect section headings: short title-case lines with no terminal punctuation,
# sitting on their own line and not starting with a digit.
HEADING_RE = re.compile(
    r"(?m)^(?!\d)(?:[A-Z][\w''']*(?:\s+(?:[A-Z][\w''']*|of|the|to|and|in|for|with|a|an|on|at|by|from))*)\s*$"
)


def extract_headings(
    text: str, verse_offsets: dict[int, int]
) -> list[tuple[int, str]]:
    """Return [(beforeVerse, headingText), ...] in document order.

    A heading 'belongs to' the next verse whose marker comes after it.
    Headings beyond the last verse marker (i.e. bled-through from the next
    chapter) are dropped.
    """
    headings: list[tuple[int, str]] = []
    if not verse_offsets:
        return headings
    sorted_offsets = sorted(verse_offsets.items(), key=lambda kv: kv[1])
    last_offset = sorted_offsets[-1][1]

    for m in HEADING_RE.finditer(text):
        line = m.group(0).strip()
        if len(line) < 5 or len(line) > 80:
            continue
        if line.upper() == line and len(line.split()) < 3:
            continue
        head_start = m.start()
        if head_start >= last_offset:
            continue  # belongs to the next chapter that bled in
        next_v = None
        for verse_n, off in sorted_offsets:
            if off > head_start:
                next_v = verse_n
                break
        if next_v is not None:
            headings.append((next_v, line))
    return headings


def main() -> None:
    args = parse_args()
    doc = pymupdf.open(args.pdf)
    raw = extract_text(doc, args.start_page, args.end_page)
    cleaned = strip_page_headers(raw)

    # First-verse start: scan for a leading '1 ' marker; if absent, start at 0.
    leading = re.match(r"\s*1\s+", cleaned)
    first_verse_text_starts_at = leading.end() if leading else 0

    verses_text, verse_offsets = split_verses(cleaned, args.max_verse, first_verse_text_starts_at)
    headings = extract_headings(cleaned, verse_offsets)

    chapter = {
        "translation": "en",
        "source": "English-English",
        "book": args.book_usfm,
        "chapter": args.chapter,
        "verses": [
            {
                "ref": f"{args.book_usfm}.{args.chapter}.{vn}",
                "book": args.book_usfm,
                "chapter": args.chapter,
                "verse": vn,
                "text": re.sub(r"\s+", " ", text).strip(),
                "structured": {
                    "tokens": [
                        {"text": re.sub(r"\s+", " ", text).strip(), "italic": False, "redLetter": False}
                    ],
                    "footnotes": [],
                    "crossRefs": [],
                    "heading": next((h for v, h in headings if v == vn), None),
                    "paragraphStart": False,
                    "poetic": False,
                    "poeticLines": None,
                },
            }
            for vn, text in sorted(verses_text.items()) if text
        ],
        "headings": [
            {"beforeVerse": v, "text": h, "level": 2} for v, h in headings
        ],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }
    json.dump(chapter, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
