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


PDF_PATH = "/Users/youssef/personal/coptic-church-assets/source.pdf"
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


def write_book(usfm: str, chapters: dict[int, dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = {"usfm": usfm, "source": "deutero", "chapters": {str(n): c for n, c in chapters.items()}}
    out_path = OUT_DIR / f"{usfm}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    total_v = sum(len(c.get("verses", [])) for c in chapters.values())
    print(f"  ✓ {usfm}: {len(chapters)} chapter(s), {total_v} verses → {out_path.relative_to(Path.cwd())}")


def main() -> None:
    doc = pymupdf.open(PDF_PATH)

    print("Extracting English Deuterocanonical specials (PS2 + DAG)...\n")

    # PS2 = Psalm 151 — page 1914, slice from "Psalm 151" header
    print("PS2 (Psalm 151):")
    ps2_text = fetch_pages(doc, 1914, 1914)
    ps2_text = slice_from(ps2_text, "Psalm 151")
    ps2_ch1 = build_chapter(ps2_text, "PS2", 1, max_verse=10)
    write_book("PS2", {1: ps2_ch1})

    # DAG ch 1 = Susanna — pages 3036-3039 (text spills onto p3039 before
    # Daniel ch 1 starts mid-page). The verse-monotonicity truncation in
    # build_chapter cuts off when Daniel 1:1 appears.
    print("\nDAG (Daniel additions):")
    sus_text = fetch_pages(doc, 3036, 3039)
    sus_text = slice_from(sus_text, "Susanna", use_rfind=False)
    # Slice TWICE — first "Susanna" is in the Daniel intro outline, real header is after
    sus_text2 = slice_from(sus_text, "Susanna", use_rfind=False) if "Susanna" in sus_text[:1500] else sus_text
    dag_susanna = build_chapter(sus_text2, "DAG", 1, max_verse=64)

    # DAG ch 2 = Bel and the Serpent — pages 3073-3075, slice from header
    bel_text = fetch_pages(doc, 3073, 3075)
    bel_text = slice_from(bel_text, "Bel and the Serpent")
    dag_bel = build_chapter(bel_text, "DAG", 2, max_verse=42)

    write_book("DAG", {1: dag_susanna, 2: dag_bel})


if __name__ == "__main__":
    main()
