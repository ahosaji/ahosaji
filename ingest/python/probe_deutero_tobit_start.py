"""Find the start of Tobit chapter 1 actual content."""
from __future__ import annotations
import sys
import pymupdf  # type: ignore

from source_pdf import configured_pdf
PDF_PATH = configured_pdf()
doc = pymupdf.open(PDF_PATH)

# Page 1347 already shows v19-22, then chapter 2 begins. Walk backward to find
# where Tobit 1:1 starts.
for p in range(1340, 1349):
    text = doc.load_page(p).get_text("text")
    head = text.strip()[:200].replace("\n", "  ")
    print(f"--- p{p+1} (length {len(text)}) ---")
    print(head)
    print()
