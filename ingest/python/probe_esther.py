"""Inspect English Esther chapter 1 to find Addition A labeling."""
from __future__ import annotations
import re
import pymupdf  # type: ignore
from source_pdf import configured_pdf

doc = pymupdf.open(configured_pdf())

# Esther home page in English TOC was at p1405. Find the actual chapter content pages.
home = doc.load_page(1404)
print('=== Esther home page (1405) ===')
print(home.get_text('text')[:300])

print('\n=== first 5 chapter nav-page targets ===')
goto = sorted(set(l['page'] + 1 for l in home.get_links() if l.get('kind') == pymupdf.LINK_GOTO and l.get('page', -1) > 1404))
print(f'  GOTOs: {goto[:5]} ... {goto[-5:]}')

# Read Esther ch 1 nav page (first goto)
nav = goto[0]
print(f'\n=== Esther ch 1 nav page (p{nav}) ===')
print(doc.load_page(nav - 1).get_text('text')[:300])

# Follow Esther ch 1's first verse link to find content
nav_page = doc.load_page(nav - 1)
content = None
for link in nav_page.get_links():
    if link.get('kind') == pymupdf.LINK_GOTO and link.get('page', -1) + 1 > nav:
        content = link.get('page') + 1
        break
print(f'\n=== Esther ch 1 content starts at p{content} ===')
text = doc.load_page(content - 1).get_text('text')
print(text[:1500])

# Also check the next 2 pages for "Addition A" / "Addition B" markers
print('\n=== Searching first 12 Esther content pages for "Addition" markers ===')
for p in range(content, content + 12):
    text = doc.load_page(p - 1).get_text('text')
    for m in re.finditer(r'Addition\s+[A-F]', text):
        ctx = text[max(0, m.start() - 60):m.end() + 100].replace('\n', ' / ')
        print(f'  p{p}: {ctx}')
