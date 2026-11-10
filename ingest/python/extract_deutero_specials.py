"""Extract English Deuterocanonicals that need page-and-text-offset slicing
because the chapter content begins mid-page after a non-verse header.

  PS2 = Psalm 151
        page 1914 — slice from "Psalm 151" onwards (page also has tail of Ps 150)

  DAG = Daniel additions:
        ch 1 = Susanna (pages 3036-3038)
               slice from last "Susanna" header on p3036 (page also has Daniel intro + outline)
        ch 2 = Bel and the Serpent (pages 3073-3075)
               page 3073 starts directly with "Bel and the Serpent\\n1When..." — no slice needed

Page numbers + text-offset markers were discovered by manual inspection of
the English English PDF. They are stable for this PDF edition.

Writes:
  ingest/data/snapshots/en/PS2.json
  ingest/data/snapshots/en/DAG.json
"""
from __future__ import annotations
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_deutero_chapter import (  # type: ignore
    HEADER_RE, VERSE_MARKER_RE, split_verses, extract_headings, strip_page_headers,
)
import pymupdf  # type: ignore


from source_pdf import extraction_options
from completeness import write_book_snapshot, open_pdf_or_report
OUT_DIR = Path(__file__).parent.parent / "data" / "snapshots" / "en"


def fetch_pages(doc: pymupdf.Document, start_page: int, end_page: int) -> str:
    out = []
    for p in range(start_page - 1, end_page):
        out.append(doc.load_page(p).get_text("text"))
    return "\n".join(out)


def slice_from(text: str, marker: str, *, use_rfind: bool = False) -> str:
    """Slice `text` from the position of `marker` (inclusive of the line break
    after marker, so the next char is the chapter content's first verse)."""
    pos = text.rfind(marker) if use_rfind else text.find(marker)
    if pos < 0:
        raise RuntimeError(f"marker {marker!r} not found")
    after_marker = pos + len(marker)
    # Skip past the immediate newline after the marker
    while after_marker < len(text) and text[after_marker] in "\n\r ":
        after_marker += 1
    return text[after_marker:]


def build_chapter(text: str, usfm: str, chapter: int, max_verse: int) -> dict:
    cleaned = strip_page_headers(text)
    # Look for leading "1<space>" marker indicating the start of verse 1 of this chapter.
    leading = re.match(r"\s*1(?=\D)", cleaned)
    first_verse_text_starts_at = leading.end() if leading else 0
    verses_text, verse_offsets = split_verses(cleaned, max_verse, first_verse_text_starts_at)
    headings = extract_headings(cleaned, verse_offsets)
    return {
        "translation": "en",
        "source": "English-English",
        "book": usfm,
        "chapter": chapter,
        "verses": [
            {
                "ref": f"{usfm}.{chapter}.{vn}",
                "book": usfm,
                "chapter": chapter,
                "verse": vn,
                "text": re.sub(r"\s+", " ", text).strip(),
                "structured": {
                    "tokens": [{"text": re.sub(r"\s+", " ", text).strip(), "italic": False, "redLetter": False}],
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
        "headings": [{"beforeVerse": v, "text": h, "level": 2} for v, h in headings],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    args = extraction_options()
    doc = open_pdf_or_report(pymupdf.open, args.pdf, {'PS2': 1, 'DAG': 2}, allow_partial=args.allow_partial)
    chapters = {'PS2': {}, 'DAG': {}}; failures = {'PS2': [], 'DAG': []}
    specifications = [('PS2', 1, 1914, 1914, 'Psalm 151', 10),
                      ('DAG', 1, 3036, 3039, 'Susanna', 64),
                      ('DAG', 2, 3073, 3075, 'Bel and the Serpent', 42)]
    for book, chapter, start, end, marker, max_verse in specifications:
        try:
            text = slice_from(fetch_pages(doc, start, end), marker)
            # Preserve the original Susanna intro/header disambiguation.
            if book == 'DAG' and chapter == 1 and 'Susanna' in text[:1500]:
                text = slice_from(text, 'Susanna')
            chapters[book][chapter] = build_chapter(text, book, chapter, max_verse)
        except Exception as error:
            failures[book].append({'chapter': chapter, 'error': str(error)})
    codes = [write_book_snapshot(OUT_DIR / f'{book}.json', book, chapters[book], expected,
             allow_partial=args.allow_partial, failures=failures[book]) for book, expected in [('PS2', 1), ('DAG', 2)]]
    raise SystemExit(max(codes))


if __name__ == "__main__":
    main()
