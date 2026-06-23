"""Debug verse and heading offset detection for Tobit 1."""
import re
import pymupdf  # type: ignore

doc = pymupdf.open('/Users/youssef/personal/coptic-church-assets/source.pdf')
text = '\n'.join(doc.load_page(p).get_text('text') for p in range(1345, 1347))
text = re.sub(r'^\s*(\d+)\s*$', '', text, flags=re.M)

i = text.find('The Charitable Tobit Becomes Blind')
print(f'Heading index: {i}')

VERSE_MARKER_RE = re.compile(
    r"(?P<num>\d{1,3})(?=[A-Z“\"‘'])|(?P<num2>\d{1,3})(?=\s[A-Z“\"‘'])"
)
positions = []
for m in VERSE_MARKER_RE.finditer(text):
    n = int(m.group('num') or m.group('num2'))
    if 2 <= n <= 22:
        positions.append((m.start(), m.end(), n))

print(f'Total verse markers found: {len(positions)}')
print('Last 5 markers (offset, verse#, snippet):')
for s, e, n in positions[-5:]:
    print(f'  v{n:3} start={s:5} end={e:5}  {text[s:s+50]!r}')

print(f'\nlast verse marker offset (pos[-1].start): {positions[-1][0] if positions else "—"}')
print(f'heading offset:                          {i}')
print(f'heading > last_marker?                   {i > positions[-1][0] if positions else "n/a"}')
