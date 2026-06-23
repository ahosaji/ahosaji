"""Scrape an entire English Deuterocanonical book and emit a multi-chapter snapshot.

Strategy:
  1. Look up the book's TOC entry → chapter-list nav page.
  2. From the nav page, follow GOTO links to find the start page of each chapter.
  3. For each chapter, extract a generous page-range window. Use the
     verse-monotonicity trick (already in extract_deutero_chapter.py) to
     auto-truncate at the next chapter boundary.

Output (stdout):
  { "usfm": "TOB", "source": "deutero", "chapters": { "<n>": Chapter, ... } }
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf  # type: ignore

# Reuse helpers from the per-chapter script
sys.path.insert(0, str(Path(__file__).parent))
from extract_deutero_chapter import (  # type: ignore
    HEADER_RE, VERSE_MARKER_RE, split_verses, extract_headings, strip_page_headers,
)


# Book name → search terms used to match the TOC entry
# Precise TOC matchers: each book gets a list of substring tests where the
# match is rejected if any *exclusion* term also appears (avoids "Wisdom of
# Solomon" vs "Wisdom of Sirach" collisions).
BOOK_TOC_RULES = {
    "TOB": {"include": ["tobit"], "exclude": []},
    "JDT": {"include": ["judith"], "exclude": []},
    "WIS": {"include": ["wisdom of solomon"], "exclude": []},
    "SIR": {"include": ["wisdom of sirach", "sirach"], "exclude": []},
    "BAR": {"include": ["baruch"], "exclude": []},
    "1MA": {"include": ["1 maccabees"], "exclude": []},
    "2MA": {"include": ["2 maccabees"], "exclude": []},
    "3MA": {"include": ["3 maccabees"], "exclude": []},
    "MAN": {"include": ["prayer of manasseh"], "exclude": []},
    # PS2 (Psalm 151), DAG (Susanna + Bel), ESG (Esther additions A-F):
    # KNOWN COVERAGE GAPS in this English English PDF.
    #   - PS2: Psalm 151 exists in English Rahlfs Psalms but the chapter-list nav
    #     page contains many non-content GOTOs that contaminate the position-
    #     based "last chapter" heuristic. Needs targeted page-range investigation.
    #   - DAG: Susanna + Bel in English Daniel are non-numerically labeled chapters
    #     bracketing the standard 12. The "first/last position" heuristic landed
    #     on intro/back-matter pages instead. Needs per-link label inspection.
    #   - ESG: Esther additions A-F are inline within Esther chapters; needs
    #     sub-chapter parsing.
    #   - MAN: distinctive prayer text not found anywhere in this PDF; not in
    #     this English edition. Source from KJV Apocrypha / NRSV-CE in v1.x.
    # All four are tracked in docs/roadmap.md as v1.x cleanup items.
}


def find_book_chapter_list_page(doc: pymupdf.Document, usfm: str) -> int | None:
    """Find the PDF page (1-indexed) of the book's home / chapter-list page."""
    rules = BOOK_TOC_RULES.get(usfm)
    if not rules:
        return None
    includes: list[str] = rules["include"]
    excludes: list[str] = rules["exclude"]
    toc = doc.get_toc()
    candidates = []
    for level, title, page in toc:
        tl = title.lower()
        if any(e in tl for e in excludes):
            continue
        if any(inc in tl for inc in includes):
            candidates.append((level, title, page))
    if not candidates:
        return None
    candidates.sort(key=lambda c: len(c[1]))
    return candidates[0][2]


def chapter_starts_from_nav_page(doc: pymupdf.Document, nav_page: int) -> list[int]:
    """Read the GOTO link targets from the nav page; dedup; preserve order."""
    page = doc.load_page(nav_page - 1)  # 0-indexed
    seen = set()
    starts = []
    for link in page.get_links():
        if link.get("kind") == pymupdf.LINK_GOTO:
            p = link.get("page", -1)
            if p < 0 or p in seen:
                continue
            # Filter: only forward-pointing GOTOs (not back-to-OT, back-to-TOC)
            if p < nav_page - 5:  # earlier pages = nav back-links
                continue
            seen.add(p)
            starts.append(p + 1)  # convert to 1-indexed
    return sorted(starts)


def chapter_starts_for_book(doc: pymupdf.Document, usfm: str) -> list[int]:
    """Find the actual content-page start for each chapter of the book.

    Two-hop:
      1. Book home page (from TOC) → forward GOTO links → per-chapter nav pages
      2. Each per-chapter nav page → first forward GOTO link → content page

    The first hop's targets are nav pages (one per chapter), not content. The
    second hop finds the actual chapter-1-verse-1 content page.

    Special cases:
      - PS2: take ONLY the last chapter of Psalms (= Psalm 151 in English LXX)
      - DAG: take ONLY non-numeric chapter labels from Daniel
        (Susanna + Bel and the Serpent)
    """
    home_page = find_book_chapter_list_page(doc, usfm)
    if home_page is None:
        return []
    chapter_nav_pages = chapter_starts_from_nav_page(doc, home_page)
    # First forward GOTO from each chapter-nav page = content start of that chapter.
    content_starts: list[int] = []
    for nav in chapter_nav_pages:
        if nav < 1 or nav > doc.page_count:
            continue
        page = doc.load_page(nav - 1)
        # Take the first GOTO that's forward from this nav page (i.e., past the
        # next-likely-nav-page boundary). Verse links generally point forward.
        for link in page.get_links():
            if link.get("kind") == pymupdf.LINK_GOTO:
                p = link.get("page", -1)
                if p < 0:
                    continue
                p1 = p + 1
                if p1 > nav:  # forward only
                    content_starts.append(p1)
                    break
    # Dedup while preserving order, then sort to be safe.
    seen = set()
    out = []
    for p in content_starts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return sorted(out)


def extract_text_pages(doc: pymupdf.Document, start_page: int, end_page: int) -> str:
    out = []
    for p in range(start_page - 1, min(end_page, doc.page_count)):
        out.append(doc.load_page(p).get_text("text"))
    return "\n".join(out)


def extract_chapter(doc: pymupdf.Document, usfm: str, chapter: int,
                    start_page: int, end_page: int, max_verse: int) -> dict:
    raw = extract_text_pages(doc, start_page, end_page)
    cleaned = strip_page_headers(raw)
    leading = re.match(r"\s*1\s+", cleaned) if chapter == 1 else None
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--usfm", required=True)
    ap.add_argument("--max-chapters", type=int, required=True,
                    help="exact chapter count for this book (prevents phantom chapters from extra nav links)")
    ap.add_argument("--max-verses-per-chapter", type=int, default=200,
                    help="upper bound for verse markers per chapter")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    starts = chapter_starts_for_book(doc, args.usfm)
    if not starts:
        print(f"ERROR: could not find {args.usfm} in TOC", file=sys.stderr)
        sys.exit(2)

    # Each chapter spans from its start page to the next chapter's start - 1.
    # For the last chapter, give a generous buffer (book is usually < 10 pages
    # extra). The monotonicity trick truncates excess content cleanly.
    # Cap to the canonical chapter count (extra nav links → phantom chapters).
    starts = starts[: args.max_chapters]

    chapters: dict[str, dict] = {}
    for i, start_page in enumerate(starts):
        chapter = i + 1
        if i + 1 < len(starts):
            # Include the next chapter's start page too — chapter content can
            # spill into the same page as the next chapter's beginning. The
            # monotonicity trick truncates at the next chapter's first verse.
            end_page = starts[i + 1]
        else:
            end_page = start_page + 12  # last-chapter buffer
        end_page = max(end_page, start_page)
        try:
            ch = extract_chapter(doc, args.usfm, chapter, start_page,
                                  end_page, args.max_verses_per_chapter)
            if not ch["verses"]:
                print(f"  warn: {args.usfm} ch {chapter} extracted 0 verses (pages {start_page}..{end_page})", file=sys.stderr)
                continue
            chapters[str(chapter)] = ch
            print(f"  {args.usfm} ch {chapter}: {len(ch['verses'])} verses (pages {start_page}..{end_page})", file=sys.stderr)
        except Exception as err:
            print(f"  FAIL {args.usfm} ch {chapter}: {err}", file=sys.stderr)

    output = {
        "usfm": args.usfm,
        "source": "deutero",
        "chapters": chapters,
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
