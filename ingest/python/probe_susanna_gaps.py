"""Investigate why Susanna verses 20, 41, 45, 53 don't match the verse-marker regex."""
from __future__ import annotations
import re
import pymupdf  # type: ignore
from source_pdf import configured_pdf

doc = pymupdf.open(configured_pdf())
text = '\n'.join(doc.load_page(p).get_text('text') for p in [3035, 3036, 3037, 3038])

for n in [20, 41, 45, 53]:
    pat = rf'\b{n}\D'
    matches = [(m.start(), m.group()) for m in re.finditer(pat, text)]
    print(f'\nv{n}: {len(matches)} candidates')
    for pos, g in matches[:3]:
        ctx = text[max(0, pos - 60):pos + 90].replace('\n', ' / ')
        print(f'  pos={pos}: ...{ctx}...')
