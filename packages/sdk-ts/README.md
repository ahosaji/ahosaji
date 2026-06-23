# @ahosaji/sdk — TypeScript client

Typed TypeScript client for the Ahosaji content API. Auto-generated from
[`docs/api/openapi.yaml`](../../docs/api/openapi.yaml) using
[`openapi-typescript-codegen`](https://github.com/ferdikoomen/openapi-typescript-codegen).

## What it gives you

- **A typed client class** (`AhosajiClient`) with one method per documented
  REST endpoint (discovery, bible, parallel, search).
- **Typed request/response models** — every schema in the OpenAPI spec lands as
  a TypeScript interface (`Verse`, `Chapter`, `ParallelEntry`, `SearchResult`,
  etc.). Including the recently added `mapped_to` and `mapping_note` fields on
  `ParallelEntry` for versification-aware queries.
- **Built-in bearer-token auth** via the `TOKEN` constructor option.
- **fetch-based** — runs in Node 18+, Bun, Deno, and the browser. No runtime
  dependencies beyond standard fetch.

## Install

This SDK is currently an **internal monorepo workspace package**. It is NOT
published to npm yet. From within this repo, depend on it via pnpm workspace
linking:

```jsonc
// some-other-package/package.json
{
  "dependencies": {
    "@ahosaji/sdk": "workspace:*"
  }
}
```

Publishing to npm is tracked under "future SDK packaging" — see issues / future
work.

## Quickstart

```ts
import { AhosajiClient } from '@ahosaji/sdk';

const client = new AhosajiClient({
  BASE: 'http://localhost:3001',         // or your deployed URL
  TOKEN: 'ahk_your_api_key_here',        // omit for public discovery routes
});

// 1. Discovery (public — TOKEN not required for these)
const translations = await client.discovery.getV1Translations();
//                          → { translations: [{ code, name, language, ... }] }

const books = await client.discovery.getV1TranslationsBooks({ code: 'en' });
//                          → { books: [{ usfm, name_en, name_ar, ... }] }

// 2. Single verse
const v = await client.bible.getV1BibleTranslationsBooksChaptersVerses1({
  code: 'en', usfm: 'JHN', n: 3, v: 16,
});
//   → { ref: 'JHN.3.16', text: 'For God so loved...', structured: { ... } }

// 3. Whole chapter (verses + section headings)
const chapter = await client.bible.getV1BibleTranslationsBooksChapters({
  code: 'en', usfm: 'JHN', n: 3,
});

// 4. Verse range within a chapter
const range = await client.bible.getV1BibleTranslationsBooksChaptersVerses({
  code: 'en', usfm: 'JHN', n: 3, from: 16, to: 21,
});

// 5. Cross-chapter passage
const passage = await client.bible.getV1BiblePassages({
  translation: 'en', start: 'JHN.3.16', end: 'JHN.4.2',
});

// 6. Cross-translation parallel — the signature feature
const parallel = await client.bible.getV1Parallel({
  translations: 'en,ar', ref: 'TOB.1.25',
});
for (const r of parallel.refs ?? []) {
  for (const t of r.translations) {
    console.log(`${r.ref}/${t.translation}: present=${t.present}`);
    if (t.mapped_to?.length) {
      console.log(`  resolved via versification mapping ← ${t.mapped_to}`);
    }
    if (t.mapping_note) {
      console.log(`  no equivalent: ${t.mapping_note}`);
    }
  }
}

// 7. Full-text search (Arabic queries are diacritic-normalized server-side)
const hits = await client.search.getV1Search({
  q: 'born again', translation: 'en', limit: 10,
});
```

## Versification-aware parallel queries

For Deuterocanonical books with divergent verse-numbering between Arabic source Arabic (Vulgate-derived) and English English (Greek LXX), the API
auto-applies versification mapping when one translation is missing a verse
the other has. The response signals this with two optional fields on each
`ParallelEntry`:

```ts
interface ParallelEntry {
  translation: string;
  present: boolean;
  text: string | null;
  structured: VerseStructured | null;

  // Set when the verse was resolved via the mapping table rather than
  // identity. Lists the source ref(s) in this translation whose content
  // was returned. Absent when identity matched directly.
  mapped_to?: string[] | null;

  // Set when the mapping table marks this verse as having no equivalent
  // in this translation (e.g. a Vulgate-only verse with no Greek-LXX
  // counterpart). Co-occurs with present:false and mapped_to:[].
  mapping_note?: string | null;
}
```

Examples:
- `parallel(?ref=TOB.1.25)` returns `en.mapped_to=['TOB.1.22']` because the
  Vulgate's TOB.1.25 corresponds to the LXX's TOB.1.22.
- `parallel(?ref=SIR.1.34)` returns `en.present=false, mapping_note='no
  equivalent in this translation'` because SIR 1:34b is a Vulgate-only verse.

## Regenerate after API changes

The generated code is checked in, so consumers don't need codegen tooling.
After a route or schema change in `docs/api/openapi.yaml`, regenerate from the
repo root:

```bash
pnpm --filter @ahosaji/sdk generate
```

## Smoke test against a live API

```bash
AHOSAJI_KEY=ahk_... AHOSAJI_BASE=http://localhost:3001 \
  pnpm --filter @ahosaji/sdk smoke
```

Exercises discovery, single verse, search, and two versification-mapping
cases (one shifted, one null-mapped) and prints the responses.
