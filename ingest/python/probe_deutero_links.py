"""Probe the English PDF more deeply: each navigation page has hyperlinks
that point to the *actual* verse content pages. Follow them.
"""
from __future__ import annotations
import sys
import pymupdf  # type: ignore

from source_pdf import configured_pdf
PDF_PATH = configured_pdf()

doc = pymupdf.open(PDF_PATH)

# Page 1332 is "Verses in Tobit Chapter 1" — find the link targets.
print("=== Links from 'Verses in Tobit Chapter 1' (PDF page 1332) ===")
page = doc.load_page(1332 - 1)  # 0-indexed
for link in page.get_links():
    kind = link.get("kind")
    page_to = link.get("page", -1)
    uri = link.get("uri", "")
    if kind == pymupdf.LINK_GOTO:
        print(f"  goto page {page_to + 1:5}  (kind=GOTO)")
    elif kind == pymupdf.LINK_URI:
        print(f"  uri {uri[:80]}")
    else:
        print(f"  kind={kind}, link={link}")

# Take the first link → that should be Tobit 1:1's actual content page.
print()
print("=== First three actual content pages from Tobit 1's nav page ===")
seen_pages = []
for link in page.get_links():
    if link.get("kind") == pymupdf.LINK_GOTO:
        p = link.get("page", -1)
        if p >= 0 and p not in seen_pages:
            seen_pages.append(p)
        if len(seen_pages) >= 3:
            break

for p in seen_pages:
    print(f"\n--- PDF page {p+1} ---")
    text = doc.load_page(p).get_text("text")
    print(text[:1500])
