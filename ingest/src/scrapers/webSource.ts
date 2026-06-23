import FirecrawlApp from '@mendable/firecrawl-js';
import { load } from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import { env } from '../env.js';
import type { Chapter, Heading, Verse, Token, Footnote } from '../types/canonical.js';

// Cheerio's bundled domhandler types conflict with the root one under pnpm.
// Use `any` for node types — runtime checks (`n.type === 'text'`, etc.) preserve safety.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

export interface sourceOpts {
  version: string;       // source version code, e.g. 'English'
  bookName: string;      // source book name, e.g. 'John'
  bookUsfm: string;      // 'JHN'
  chapter: number;
}

const PLAIN_FETCH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export async function scrapesourceChapter(opts: sourceOpts): Promise<Chapter> {
  const url = `https://www.source.com/passage/?search=${encodeURIComponent(`${opts.bookName} ${opts.chapter}`)}&version=${opts.version}`;
  console.log(`  → fetching ${url}`);

  let html = '';
  // Try plain fetch first (free).
  try {
    const r = await fetch(url, { headers: { 'User-Agent': PLAIN_FETCH_UA } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
    if (html.length < 10000 || !html.includes('passage-content')) {
      throw new Error(`suspicious response (${html.length} bytes, no passage-content marker) — likely bot defense`);
    }
  } catch (plainErr) {
    // Fall back to Firecrawl if plain fetch failed (403/429/blocked).
    if (!env.firecrawlApiKey) throw plainErr;
    console.log(`    plain fetch failed (${plainErr instanceof Error ? plainErr.message : 'unknown'}); falling back to Firecrawl…`);
    const fc = new FirecrawlApp({ apiKey: env.firecrawlApiKey });
    const res = await fc.scrapeUrl(url, { formats: ['rawHtml'] });
    if (!res.success) throw new Error(`Firecrawl also failed: ${'error' in res ? res.error : 'unknown'}`);
    html = (res as { rawHtml?: string }).rawHtml ?? '';
    if (!html) throw new Error('Firecrawl returned empty rawHtml');
  }

  const $ = load(html);
  const chapter = parsesourceChapter($, opts);
  if (chapter.verses.length === 0) {
    throw new Error(
      `No verses parsed from ${opts.bookName} ${opts.chapter} (${opts.version}). ` +
      `Possible: source HTML changed, or version code/book name wrong.`,
    );
  }
  return chapter;
}

function parsesourceChapter($: CheerioAPI, opts: sourceOpts): Chapter {
  // source uses abbreviated book names in span class anchors:
  //   text Matt-1-1, text John-3-16, text Rev-22-21, etc.
  // We don't care about the prefix (book is implicit from URL), only the
  // chapter and verse parts. Match any prefix-<chapter>-<verse>.
  const verseClassPattern = new RegExp(`\\btext\\s+[A-Za-z0-9]+-${opts.chapter}-(\\d+)\\b`);
  const footnoteBodies = collectFootnoteBodies($);
  const headings = collectHeadings($, opts, verseClassPattern);

  const seen = new Set<number>();
  const verses: Verse[] = [];

  $('span.text').each((_, el) => {
    // Skip spans nested inside an h3 — those are heading wrappers, not verses.
    if ($(el).parents('h3').length > 0) return;
    const cls = $(el).attr('class') ?? '';
    const m = cls.match(verseClassPattern);
    if (!m) return;
    const vn = Number(m[1]);
    if (seen.has(vn)) return;       // multi-paragraph verse: take first span (v0 simplification)
    seen.add(vn);

    const { tokens, footnotes } = collectVerseTokens($, $(el), footnoteBodies);
    const merged = mergeAdjacentTokens(tokens);
    const text = merged.map(t => t.text).join('').replace(/\s+/g, ' ').trim();
    const heading = headings.find(h => h.beforeVerse === vn)?.text ?? null;

    verses.push({
      ref: `${opts.bookUsfm}.${opts.chapter}.${vn}`,
      book: opts.bookUsfm,
      chapter: opts.chapter,
      verse: vn,
      text,
      structured: {
        tokens: merged,
        footnotes,
        crossRefs: [],
        heading,
        paragraphStart: false,    // TODO: detect <p> boundaries in Day 5 schema-convergence
        poetic: false,            // not used for John (prose); TODO for Psalms
        poeticLines: null,
      },
    });
  });

  verses.sort((a, b) => a.verse - b.verse);

  return {
    translation: 'en',
    source: `source:${opts.version}`,
    book: opts.bookUsfm,
    chapter: opts.chapter,
    verses,
    headings,
    fetchedAt: new Date().toISOString(),
  };
}

function collectFootnoteBodies($: CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $('div.footnotes ol li').each((_, li) => {
    const id = $(li).attr('id');
    if (!id) return;
    const text = $(li).clone().find('a, sup').remove().end().text().trim();
    map.set(id, text);
  });
  return map;
}

function collectHeadings(
  $: CheerioAPI,
  opts: sourceOpts,
  verseClassPattern: RegExp,
): Heading[] {
  const headings: Heading[] = [];
  $('.passage-text h3').each((_, h) => {
    const text = $(h).text().trim();
    if (!text) return;
    const next = $(h)
      .nextAll()
      .find(`span.text[class*="-${opts.chapter}-"]`)
      .first();
    const cls = next.attr('class') ?? '';
    const m = cls.match(verseClassPattern);
    if (!m) return;
    headings.push({ beforeVerse: Number(m[1]), text, level: 2 });
  });
  return headings;
}

interface VerseExtraction {
  tokens: Token[];
  footnotes: Footnote[];
}

function collectVerseTokens(
  $: CheerioAPI,
  $verse: Cheerio<AnyNode>,
  footnoteBodies: Map<string, string>,
): VerseExtraction {
  const tokens: Token[] = [];
  const footnotes: Footnote[] = [];
  const stack: { italic: boolean; redLetter: boolean }[] = [
    { italic: false, redLetter: false },
  ];

  function walk($node: Cheerio<AnyNode>): void {
    $node.contents().each((_, n) => {
      // Text node
      if (n.type === 'text') {
        const text = n.data ?? '';
        if (!text) return;
        const top = stack[stack.length - 1]!;
        tokens.push({ text, italic: top.italic, redLetter: top.redLetter });
        return;
      }
      // Tag node
      if (n.type !== 'tag') return;

      const tag = n.tagName.toLowerCase();
      const cls = n.attribs?.['class'] ?? '';
      const classes = cls.split(/\s+/);

      // Skip versenum/chapternum/cross-ref sups; capture footnotes before skipping.
      if (tag === 'sup') {
        if (classes.includes('versenum') || classes.includes('chapternum')) return;
        if (classes.includes('crossreference')) return;
        if (classes.includes('footnote')) {
          const dataFn: string = (n.attribs?.['data-fn'] as string | undefined) ?? '';
          const fnId = dataFn.replace(/^#/, '');
          const $sup = $(n);
          const marker =
            $sup.find('.footnote-letter').first().text().trim() ||
            $sup.text().replace(/[\[\]]/g, '').trim() ||
            (fnId.match(/[a-z]$/)?.[0] ?? '');
          const body = footnoteBodies.get(fnId);
          if (body) footnotes.push({ marker, text: body });
          return;
        }
      }
      if (classes.includes('chapternum')) return;

      const top = stack[stack.length - 1]!;
      const next = {
        italic: top.italic || tag === 'i' || tag === 'em',
        redLetter: top.redLetter || classes.includes('woj'),
      };
      stack.push(next);
      walk($(n));
      stack.pop();
    });
  }

  walk($verse);
  return { tokens, footnotes };
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
