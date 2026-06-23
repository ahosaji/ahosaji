"""Extract English Esther's six Greek additions (A–F) as a separate book ESG.

English Esther integrates the Septuagint additions inline using letter-suffixed
verse numbers (e.g. '1aIn the second year of the reign...' is Addition A's
first verse, inserted before EST 1:1). The standard English-derived en/EST.json
has only chapters 1-10 with whole-integer verses; this script pulls out the
letter-suffixed material as a sibling book ESG with 6 chapters (A=1..F=6),
with the section heading documenting the original insertion point in EST.

Page ranges discovered by manual probe of English Esther content (pages 1416-1433).

Output: ingest/data/snapshots/en/ESG.json with 6 chapters and ~107 verses.
"""
from __future__ import annotations
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf  # type: ignore

PDF_PATH = "/Users/youssef/personal/coptic-church-assets/source.pdf"
OUT_DIR = Path(__file__).parent.parent / "data" / "snapshots" / "en"

# Each Addition: (chapter_number, label, host_est_verse, page_range, prefix_digits)
# Prefix matches the host verse number; we collect 1a..1z (or 13a..13z, etc.)
# Addition D uses regular integer verse numbers in English English (not letter-suffixed),
# so it gets a special "regular" mode with a slice marker.
ADDITIONS = [
    {"ch": 1, "label": "A — Mordecai's Prophetic Dream", "host": "before EST.1.1",   "pages": (1416, 1417), "mode": "suffix", "prefix": "1"},
    {"ch": 2, "label": "B — King Artaxerxes' First Letter", "host": "after EST.3.13", "pages": (1421, 1422), "mode": "suffix", "prefix": "13"},
    {"ch": 3, "label": "C — Mordecai's & Esther's Prayers", "host": "after EST.4.17", "pages": (1423, 1425), "mode": "suffix", "prefix": "17"},
    {"ch": 4, "label": "D — Esther's Audience with the King", "host": "EST.5 in English",  "pages": (1425, 1426), "mode": "regular", "slice_from": "she took off the garments", "max_verse": 30},
    {"ch": 5, "label": "E — King Artaxerxes' Second Letter", "host": "after EST.8.12", "pages": (1429, 1430), "mode": "suffix", "prefix": "12"},
    {"ch": 6, "label": "F — Mordecai's Interpretation of the Dream", "host": "after EST.10.3", "pages": (1432, 1433), "mode": "suffix", "prefix": "3"},
]

# Pattern: digit prefix + lowercase letter (one or two-char) followed by text.
# E.g. '1aIn the second year', '17qO Lord', '12bWe see ourselves'
SUFFIX_VERSE_RE = re.compile(r"\b(\d{1,2})([a-z]{1,2})(?=[A-Za-z“\"‘'])")


def fetch_pages(doc: pymupdf.Document, start_page: int, end_page: int) -> str:
    return "\n".join(doc.load_page(p).get_text("text") for p in range(start_page - 1, end_page))


def extract_addition_regular(doc: pymupdf.Document, add: dict) -> dict:
    """Addition D path: regular integer verse markers, slice from a phrase."""
    sys.path.insert(0, str(Path(__file__).parent))
    from extract_deutero_chapter import VERSE_MARKER_RE, strip_page_headers, split_verses  # type: ignore
    text = fetch_pages(doc, add["pages"][0], add["pages"][1])
    pos = text.find(add["slice_from"])
    if pos < 0:
        print(f"  warn: slice marker {add['slice_from']!r} not found", file=sys.stderr)
        return {"translation": "en", "source": "English-English", "book": "ESG", "chapter": add["ch"],
                "verses": [], "headings": [], "fetchedAt": datetime.now(timezone.utc).isoformat()}
    sliced = text[pos:]
    cleaned = strip_page_headers(sliced)
    # No leading "1" marker — start from offset 0
    verses_text, _ = split_verses(cleaned, add["max_verse"], 0)
    verses = []
    for vn in sorted(verses_text.keys()):
        body = re.sub(r"\s+", " ", verses_text[vn]).strip()
        if not body:
            continue
        verses.append({
            "ref": f"ESG.{add['ch']}.{vn}", "book": "ESG",
            "chapter": add["ch"], "verse": vn, "text": body,
            "structured": {"tokens": [{"text": body, "italic": False, "redLetter": False}],
                           "footnotes": [], "crossRefs": [],
                           "heading": None, "paragraphStart": False, "poetic": False, "poeticLines": None},
        })
    return {"translation": "en", "source": "English-English", "book": "ESG",
            "chapter": add["ch"], "verses": verses,
            "headings": [{"beforeVerse": 1, "text": f"Addition {add['label']} ({add['host']})", "level": 2}],
            "fetchedAt": datetime.now(timezone.utc).isoformat()}


def extract_addition(doc: pymupdf.Document, add: dict) -> dict:
    if add.get("mode") == "regular":
        return extract_addition_regular(doc, add)

    text = fetch_pages(doc, add["pages"][0], add["pages"][1])

    # Find all letter-suffixed markers matching the addition's host prefix.
    matches = [
        (m.start(), m.end(), m.group(1), m.group(2))
        for m in SUFFIX_VERSE_RE.finditer(text)
        if m.group(1) == add["prefix"]
    ]
    if not matches:
        print(f"  warn: no letter-suffixed markers for Addition ch{add['ch']} ({add['label']})", file=sys.stderr)
        return {
            "translation": "en", "source": "English-English", "book": "ESG",
            "chapter": add["ch"], "verses": [], "headings": [],
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }

    # Build verses: each marker → text up to next marker
    verses = []
    sequential = 1
    for i, (start, end, prefix, suffix) in enumerate(matches):
        next_start = matches[i + 1][0] if i + 1 < len(matches) else len(text)
        body = text[end:next_start].strip()
        body = re.sub(r"\s+", " ", body)
        if not body:
            continue
        verse_label = f"{prefix}{suffix}"
        verses.append({
            "ref": f"ESG.{add['ch']}.{sequential}",
            "book": "ESG",
            "chapter": add["ch"],
            "verse": sequential,
            "text": body,
            "structured": {
                "tokens": [{"text": body, "italic": False, "redLetter": False}],
                "footnotes": [],
                "crossRefs": [],
                "heading": f"English label: {verse_label}" if sequential == 1 else None,
                "paragraphStart": False, "poetic": False, "poeticLines": None,
            },
        })
        sequential += 1

    return {
        "translation": "en", "source": "English-English", "book": "ESG",
        "chapter": add["ch"], "verses": verses,
        "headings": [{
            "beforeVerse": 1,
            "text": f"Addition {add['label']} ({add['host']})",
            "level": 2,
        }],
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    doc = pymupdf.open(PDF_PATH)
    chapters = {}
    print("Extracting English Esther additions A–F (ESG)...")
    for add in ADDITIONS:
        ch = extract_addition(doc, add)
        chapters[str(add["ch"])] = ch
        print(f"  ch {add['ch']} (Addition {add['label'][0]}): {len(ch['verses'])} verses")

    out = {"usfm": "ESG", "source": "deutero", "chapters": chapters}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "ESG.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(len(c["verses"]) for c in chapters.values())
    print(f"\n  ✓ ESG: 6 chapters / {total} verses → {out_path.relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
