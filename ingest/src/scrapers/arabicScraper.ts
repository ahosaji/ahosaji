import { load } from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import { env } from '../env.js';
import { sourceEndpoint } from '../lib/config.js';
import type { Chapter, Heading, Verse, Token, Footnote } from '../types/canonical.js';

// pnpm/cheerio domhandler version conflict workaround.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export interface ArabicSourceOpts {
  bookId: number;        // an Arabic source numeric book ID, e.g. 53 = John
  bookUsfm: string;      // 'JHN'
  chapter: number;
}

export async function scrapeArabicSourceChapter(opts: ArabicSourceOpts): Promise<Chapter> {
  const endpoint = sourceEndpoint(env.arabicScraperBaseUrl, 'Bibles/BibleSearch/showChapter.php');
  endpoint.searchParams.set('book', String(opts.bookId));
  endpoint.searchParams.set('chapter', String(opts.chapter));
  const url = endpoint.href;
  console.log(`  → fetching ${url}`);

  const ua = env.arabicScraperUserAgent || 'Mozilla/5.0';
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  if (!res.ok) {
    throw new Error(`an Arabic source fetch failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  if (!html || html.length < 1000) {
    throw new Error(`an Arabic source returned suspiciously short HTML (${html.length} bytes)`);
  }

  const $ = load(html);
  const chapter = parseArabicSourceChapter($, opts);
  if (chapter.verses.length === 0) {
    throw new Error(
      `No verses parsed from book=${opts.bookId} chapter=${opts.chapter}. ` +
      `an Arabic source HTML may have changed or the book/chapter is wrong.`,
    );
  }
  return chapter;
}

function parseArabicSourceChapter($: CheerioAPI, opts: ArabicSourceOpts): Chapter {
  // Verse divs use data-usfm="John.3.16" (long-form English book name + chapter + verse).
  // We trust the data-usfm anchor over the URL params.
  const verses: Verse[] = [];
  const seen = new Set<number>();

  $('div.HColor1Div[data-usfm]').each((_, el) => {
    const usfm = $(el).attr('data-usfm') ?? '';
    const m = usfm.match(/^([A-Za-z0-9]+)\.(\d+)\.(\d+)$/);
    if (!m) return;
    const ch = Number(m[2]);
    const vn = Number(m[3]);
    if (ch !== opts.chapter) return;
    if (seen.has(vn)) return;
    seen.add(vn);

    const tokens = collectTokens($, $(el));
    const merged = mergeAdjacentTokens(tokens);
    const text = merged.map(t => t.text).join('').replace(/\s+/g, ' ').trim();

    verses.push({
      ref: `${opts.bookUsfm}.${opts.chapter}.${vn}`,
      book: opts.bookUsfm,
      chapter: opts.chapter,
      verse: vn,
      text,
      structured: {
        tokens: merged,
        footnotes: [],         // an Arabic source footnotes deferred (per-verse <a> links to tafsir)
        crossRefs: [],
        heading: null,         // filled in below
        paragraphStart: false,
        poetic: false,
        poeticLines: null,
      },
    });
  });

  verses.sort((a, b) => a.verse - b.verse);

  // Headings: <h2> tags within the main passage area precede the verse they apply to.
  // Map each h2 to the nearest following verse via document order using its index.
  const headings: Heading[] = [];
  const verseDivs = $('div.HColor1Div[data-usfm]').toArray();
  const verseOrder = new Map<unknown, number>();
  verseDivs.forEach((vEl, i) => verseOrder.set(vEl, i));

  $('h2').each((_, hEl) => {
    const text = $(hEl).text().trim();
    if (!text) return;
    // Skip page-chrome h2s by checking for too-short or template-like content.
    if (text.length < 3 || text.includes('${')) return;
    // Find the next verse div in document order.
    const $next = $(hEl).nextAll('strong, br').addBack().nextAll().find('div.HColor1Div[data-usfm]').first();
    let matchedVerse: number | null = null;
    if ($next.length > 0) {
      const nextUsfm = $next.attr('data-usfm') ?? '';
      const nm = nextUsfm.match(/^[A-Za-z0-9]+\.(\d+)\.(\d+)$/);
      if (nm && Number(nm[1]) === opts.chapter) {
        matchedVerse = Number(nm[2]);
      }
    }
    // Fallback: walk forward through all subsequent elements.
    if (matchedVerse === null) {
      const allAfter = $(hEl).nextAll().find('div.HColor1Div[data-usfm]').first();
      const nextUsfm = allAfter.attr('data-usfm') ?? '';
      const nm = nextUsfm.match(/^[A-Za-z0-9]+\.(\d+)\.(\d+)$/);
      if (nm && Number(nm[1]) === opts.chapter) {
        matchedVerse = Number(nm[2]);
      }
    }
    if (matchedVerse === null) return;
    headings.push({ beforeVerse: matchedVerse, text, level: 2 });
  });

  // Attach headings to their verses.
  for (const h of headings) {
    const v = verses.find(x => x.verse === h.beforeVerse);
    if (v) v.structured.heading = h.text;
  }

  return {
    translation: 'ar',
    source: 'an Arabic source',
    book: opts.bookUsfm,
    chapter: opts.chapter,
    verses,
    headings,
    fetchedAt: new Date().toISOString(),
  };
}

function collectTokens($: CheerioAPI, $verse: Cheerio<AnyNode>): Token[] {
  const tokens: Token[] = [];
  // Arabic an Arabic source doesn't use <i> for added words or red-letter, so we just
  // walk text nodes and skip nested links/buttons that aren't part of verse content.
  function walk($node: Cheerio<AnyNode>): void {
    $node.contents().each((_, n) => {
      if (n.type === 'text') {
        const text = n.data ?? '';
        if (!text) return;
        tokens.push({ text, italic: false, redLetter: false });
        return;
      }
      if (n.type !== 'tag') return;
      const tag = (n.tagName ?? '').toLowerCase();
      // Skip footnote links / interpretation buttons / image popups inside verse div.
      if (tag === 'a' && ((n.attribs?.['class'] ?? '').includes('verse-num'))) return;
      if (tag === 'sup') return;
      if (tag === 'script' || tag === 'style') return;
      walk($(n));
    });
  }
  walk($verse);
  return tokens;
}

function mergeAdjacentTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    const last = out[out.length - 1];
    if (last && last.italic === t.italic && last.redLetter === t.redLetter) {
      last.text += t.text;
    } else {
      out.push({ ...t });
    }
  }
  if (out.length > 0) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, '');
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, '');
  }
  return out.filter(t => t.text.length > 0);
}
