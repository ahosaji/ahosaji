"""Probe the English PDF to find Tobit's page range.

Strategy:
1. Try TOC via doc.get_toc() — if it has bookmarks for 'Tobit', use them.
2. Otherwise, scan pages for the literal 'TOBIT' header.
"""
from __future__ import annotations
import sys
import pymupdf  # type: ignore

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/youssef/personal/coptic-church-assets/source.pdf"

doc = pymupdf.open(PDF_PATH)
print(f"Total pages: {doc.page_count}")
print(f"Has TOC: ", end="")
toc = doc.get_toc()
print("yes" if toc else "no", f"({len(toc)} entries)")

if toc:
    print("First 30 TOC entries:")
    for level, title, page in toc[:30]:
        print(f"  L{level} p{page:5} {'  ' * level}{title}")
    print("\nSearching TOC for 'Tobit'/'TOBIT':")
    for level, title, page in toc:
        if "tobit" in title.lower():
            print(f"  L{level} p{page:5} {title}")
else:
    print("No TOC; falling back to page-text scan for 'TOBIT'.")
    # Scan in a band where Tobit likely lives (rough estimate: 30%-40% in)
    start = int(doc.page_count * 0.30)
    end = int(doc.page_count * 0.45)
    print(f"Scanning pages {start}..{end} for 'TOBIT':")
    for i in range(start, end):
        text = doc.load_page(i).get_text("text", flags=0)
        if "TOBIT" in text.upper():
            preview = text.strip()[:120].replace("\n", " ")
            print(f"  p{i+1:5}: {preview}")
            if i > start + 10:  # stop after a few hits
                break
