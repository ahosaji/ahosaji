"""Extract English Baruch (5 chapters) + Epistle of Jeremiah (as ch 6).

The generic English scrape misnumbered Baruch's chapters because the home
page's GOTOs include both the per-chapter verse-list nav pages AND the
Introduction nav, and they aren't ordered by chapter number in the PDF.
On top of that, English English treats the Epistle of Jeremiah as a separate
book — but the Coptic Orthodox / Vulgate Arabic canon (and our books.json
registry) packages it as Baruch chapter 6.

This script side-steps both problems by hardcoding per-chapter slice
phrases discovered via PDF probing, then running the standard
verse-monotonicity splitter on each sliced window.

Output: ingest/data/snapshots/en/BAR.json
"""
from __future__ import annotations
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf  # type: ignore

sys.path.insert(0, str(Path(__file__).parent))
from extract_deutero_chapter import (  # type: ignore
    split_verses, extract_headings, strip_page_headers,
)

PDF_PATH = "/Users/youssef/personal/coptic-church-assets/source.pdf"
OUT_PATH = Path(__file__).parent.parent / "data" / "snapshots" / "en" / "BAR.json"

# Each chapter: pages span (1-indexed inclusive) + slice phrase that marks the
# implicit verse-1 start (verse 1 has no numeric marker in English). Verse 2's
# inline "2" marker anchors the rest via the standard split_verses logic.
CHAPTERS = [
    {
        "ch": 1,
        "pages": (2853, 2855),
        "slice_from": "Now these are the words of the book written by Baruch",
        "max_verse": 22,
        # ch1 v22 abuts ch2 v1 with no verse marker between, since ch2 v1 has
        # the implicit-1 convention. Truncate at ch2's known v1 phrase
        # (include leading curly quote to avoid dangling punctuation).
        "end_marker": "‘So the Lord confirmed His word which He proclaimed",
    },
    {
        "ch": 2,
        "pages": (2854, 2857),
        # Curly opening quote in PDF: "‘So the Lord confirmed His word..."
        "slice_from": "So the Lord confirmed His word which He proclaimed",
        "max_verse": 35,
        "end_marker": "‘O Lord Almighty, the God of Israel, a soul in straits",
    },
    {
        "ch": 3,
        "pages": (2856, 2858),
        "slice_from": "O Lord Almighty, the God of Israel, a soul in straits",
        "max_verse": 38,
        # ch3 v38 ("...lived among men.") flows straight into ch4's heading
        # "Wisdom and the Law of God" + implicit v1, with no verse marker.
        "end_marker": "Wisdom and the Law of God",
    },
    {
        "ch": 4,
        "pages": (2858, 2860),
        "slice_from": "She is the book of the commandments of God and the law",
        "max_verse": 38,
        # ch4 ends; ch5 begins with "Take Heart, O Jerusalem" heading + v1.
        "end_marker": "O Jerusalem, take off the garment of your sorrow",
    },
    {
        "ch": 5,
        "pages": (2860, 2862),
        "slice_from": "O Jerusalem, take off the garment of your sorrow",
        "max_verse": 9,
        # ch5 ends; next page is Lamentations home with header "LAMENTATIONS".
        "end_marker": "LAMENTATIONS",
    },
    {
        # English labels this as a separate book "Epistle of Jeremiah" at p2884+.
        # We pack it as BAR ch 6 to match Coptic Orthodox / Vulgate convention
        # used by our books.json registry and the Arabic Arabic source text.
        "ch": 6,
        "pages": (2886, 2891),
        "slice_from": "The copy of an epistle Jeremiah sent",
        "max_verse": 73,
        # ch6 ends; next page is Ezekiel home with header "EZEKIEL".
        "end_marker": "EZEKIEL",
    },
]


def extract_chapter(doc: pymupdf.Document, spec: dict) -> dict:
    start, end = spec["pages"]
    raw = "\n".join(doc.load_page(p).get_text("text") for p in range(start - 1, end))
    cleaned = strip_page_headers(raw)
    pos = cleaned.find(spec["slice_from"])
    if pos < 0:
        print(f"  warn: BAR ch{spec['ch']} slice phrase not found", file=sys.stderr)
        return {
            "translation": "en", "source": "English-English", "book": "BAR",
            "chapter": spec["ch"], "verses": [], "headings": [],
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
    sliced = cleaned[pos:]
    end_marker = spec.get("end_marker")
    if end_marker:
        end_pos = sliced.find(end_marker, len(spec["slice_from"]))
        if end_pos > 0:
            sliced = sliced[:end_pos]
    verses_text, verse_offsets = split_verses(sliced, spec["max_verse"], 0)
    headings = extract_headings(sliced, verse_offsets)

    verses = []
    for vn in sorted(verses_text.keys()):
        body = re.sub(r"\s+", " ", verses_text[vn]).strip()
        if not body:
            continue
        verses.append({
            "ref": f"BAR.{spec['ch']}.{vn}",
            "book": "BAR",
            "chapter": spec["ch"],
            "verse": vn,
            "text": body,
            "structured": {
                "tokens": [{"text": body, "italic": False, "redLetter": False}],
                "footnotes": [],
                "crossRefs": [],
                "heading": next((h for v, h in headings if v == vn), None),
                "paragraphStart": False,
                "poetic": False,
                "poeticLines": None,
            },
        })

    return {
        "translation": "en",
        "source": "English-English",
        "book": "BAR",
        "chapter": spec["ch"],
        "verses": verses,
        "headings": [{"beforeVerse": v, "text": h, "level": 2} for v, h in headings],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    doc = pymupdf.open(PDF_PATH)
    chapters = {}
    print("Extracting English Baruch (5 ch) + Epistle of Jeremiah (as ch 6)...")
    for spec in CHAPTERS:
        ch = extract_chapter(doc, spec)
        chapters[str(spec["ch"])] = ch
        print(f"  ch {spec['ch']}: {len(ch['verses'])} verses (pages {spec['pages'][0]}..{spec['pages'][1]})")

    out = {"usfm": "BAR", "source": "deutero", "chapters": chapters}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(c["verses"]) for c in chapters.values())
    print(f"\n  wrote {total} verses across {len(chapters)} chapters → {OUT_PATH.relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
