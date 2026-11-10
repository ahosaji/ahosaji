# Ahosaji — Coptic Orthodox Content API (v1)

> Historical architecture notebook. Dated status statements below are preserved as history, not current verification. Use [README.md](./README.md), [DEPLOY.md](./DEPLOY.md) and [security controls](./docs/security.md) for current commands and deployment requirements.
> **Naming note:** Project name set to `Ahosaji` — pure Coptic compound: **Aho** (ⲁϩⲟ — "treasure / storehouse") + **Saji** (ⲥⲁϫⲓ — "the Word, speech," the native Coptic counterpart to the Greek-borrowed *Logos*). Combined: *Treasure of the Word*. Perfect mission-fit: an API that is the digital treasury of the Coptic Orthodox Church's Word — Bible, Lectionary, Synaxarium, Agpeya, hymns, and (in time) commentary and patristics.
>
> **Domain availability:** Ahosaji is a coined compound; no prior usage expected. `.io`, `.dev`, `.app`, `.com`, `.org` should all be claimable. Run a registrar check before purchase.
>
> The choice does not affect any technical decision below.

---

## Implementation status (updated 2026-06-14)

**v1 Bible API built end-to-end** — ingestion, runtime (REST + GraphQL + MCP + search), API-key auth, OpenAPI + generated TS SDK, and versification mapping are all shipped and committed (HEAD `f8c9524`). **Not yet deployed**; a short list of verified known issues is open before ship (see `docs/roadmap.md` → *Known issues*).

| Milestone | Status | Notes |
|---|---|---|
| Days 1–6 — Data prototype (4-corner en/ar × proto/deutero) | ✅ done | canonical JSON shape + validator + Day 6 enrichment |
| Full ingestion ("Phase 1 redux") | ✅ done | 78 books × 2 translations, ~71k verses; full English + full an Arabic source + English Deutero (100% clean, 138/138 ch); MAN from Coptic Pascha liturgy |
| Versification mapping | ✅ done | 9 tables (TOB, JDT, SIR, WIS, 1MA, 2MA, ESG, PSA, PS2) + `prefer_aligned` anchor mode; DAG/BAR/3MA/MAN verified clean-aligning |
| Phase 2 — Runtime (Postgres + Meilisearch + Fastify) | ✅ done | docker-compose, migrations + loaders, REST routes, GraphQL Yoga, `/v1/search`, API-key auth + per-tier rate limits |
| Phase 3 — MCP transport | ✅ done | Streamable HTTP at `/v1/mcp`, 7 tools + resources + prompts (built inside `apps/api/src/mcp/`, not a separate `packages/mcp`) |
| OpenAPI 3.1 + Scalar + `@ahosaji/sdk` (TypeDoc) | ✅ done | spec at `docs/api/openapi.yaml`; docs at `/docs/` and `/docs/sdk/` |
| Deployment (droplet, domain, Cloudflare, CI/CD, backups) | ⬜ not started | — |

**Known issues open before ship** (verified read-only 2026-06-14): `apps/api` fails `tsc --noEmit` (7 errors in the `prefer_aligned` code); the versification index drops verses on N:1 reverse mappings; GraphQL/MCP `parallel` lack the versification mapping the REST route has; cross-refs only cover JHN.3. Full list in `docs/roadmap.md`.

See `docs/roadmap.md` for the full per-phase checklist; `docs/decisions.md` for ADR-style decision log; `docs/scrapers/` for per-source notes documenting the specific URL patterns, HTML anchors, and gotchas discovered during the prototype.

### Prototype findings worth knowing

- **an Arabic source URL numbering** is its own scheme (NT starts at 50; Tobit = `book=17`). Distinct from PDF filename numbering. Mapped in `docs/scrapers/arabic.md`.
- **source anchors verses by English book name** (`John-3-1`), *not* by USFM code. Heading wrappers (`<h3><span class="text John-3-1">…`) need filtering. Footnotes use the `data-fn` attribute, not `<a href>`.
- **English PDF is structurally unusual**: 12,301 pages = navigation indexes + content pages. TOC bookmarks point to nav, not content. Tobit content begins at p1346. Verse markers are inline integers (`19But`, `20All`) — chapter boundaries are detected via verse-number monotonicity (when verse N drops below the high-water-mark, the next chapter has bled in → truncate).
- **Tobit verse-count divergence (ar=25 vs en=22)** is real, not a parser bug. Arabic Arabic follows the Vulgate; English follows the Rahlfs Greek Septuagint. Solution: per-book versification mapping tables (see `ingest/data/shared/versification/README.md`). **Decision logged: stay with English English Deuteros despite divergence**, because the alternatives (another edition) are too archaic and not Coptic-Orthodox-affiliated.
- **an Arabic source has no English Bible** — `lang=en` is silently ignored. So we cannot unify on a single source.
- **Cross-translation enrichment scope** locked: red-letter (verse-level en→ar) + cross-references (TSK, translation-independent) only. English-style italics are English-specific; footnotes are translation-specific; cross-language heading translation is out of scope. Deuterocanonicals receive *no* red-letter (Jesus not speaking in OT) and limited cross-refs (TSK doesn't cover them) — their richer enrichment comes via the future lectionary domain (liturgical-use markers, *very* Coptic-relevant for Tobit/Wisdom/Sirach).
- **Firecrawl budget reality**: free tier (500 credits/mo) is insufficient for full English scrape (~1,189 chapter pages). Plan: **swap to plain `fetch` for full scrape** (source is mostly static HTML; Firecrawl's JS-rendering / IP-rotation is overkill); fall back to Firecrawl only on 403/429.

---

## Context

The vision: bring the Coptic Orthodox Church into the modern AI era by exposing the Church's textual heritage — Bible, Lectionary (Katameros), Synaxarium, Agpeya (book of hours), and (later) commentary, hymns, and patristics — through a single, well-designed, self-hosted API. v1 ships the Bible domain end-to-end and lays the architectural foundation (monorepo, shared infrastructure, shared auth, shared search) for the other domains to plug in cleanly.

**v1 scope:**
- Two Bible translations exposed:
  - **`ar`** — an Arabic source (Arabic Arabic Bible, full canon including Deuterocanonicals, with Coptic Orthodox versification — split files for Esther/Daniel additions and Psalm 151).
  - **`en`** — English (the publisher, licensed) for the 66 protocanonical books + English (English) for the Deuterocanonicals only.
- Verse / chapter / book / range / cross-translation parallel queries.
- First-class full-text search in Arabic (with diacritic / alif normalization) and English.
- Both REST and GraphQL surfaces, sharing a single resolver/service layer.
- API keys required from day 1 (license-compliance traceability + per-consumer rate-limit + analytics).
- Self-hosted on DigitalOcean.
- **MCP server** — Streamable HTTP transport at `/v1/mcp`, exposing the Bible domain as Tools, Resources, and Prompts. Compatible with Claude Desktop / Code / API, ChatGPT (Connectors), Cursor, Windsurf, Continue, Cline. Lets Ahosaji be a one-click data connector inside any major AI surface without each client hand-rolling a REST/GraphQL integration.

**Future v1.x / v2 domains** — schema and URL prefixes are reserved now so they're not a breaking change later:
- `/v1/lectionary` — Katameros: which readings on which day, by Coptic and Gregorian calendars
- `/v1/synaxarium` — saints' calendar, daily commemorations, lives, hymns
- `/v1/agpeya` — the seven daily prayer hours, scripture and prayers
- `/v1/commentary` — the editor, English study notes, etc.
- `/v1/hymns` — Coptic hymnology (Tasbeha, Psalmody, Theotokias, Difnar)
- `/v1/today` — composite "what is today" endpoint

The user holds all source-material licenses; this plan ignores licensing logistics and focuses on technical implementation.

---

## High-level architecture

```
                           ┌───────────────────────┐
                           │   Cloudflare (free)   │
                           │  CDN · TLS · WAF · RL │
                           └──────────┬────────────┘
                                      │
                           ┌──────────▼────────────┐
                           │   DigitalOcean Droplet │
                           │   ($12/mo, 2GB RAM)    │
                           │                        │
                           │  ┌─Caddy (reverse-proxy + auto-TLS)
                           │  │
                           │  ├─Node API (Fastify, TypeScript)
                           │  │   • REST     /v1/...
                           │  │   • GraphQL  /v1/graphql
                           │  │   • MCP      /v1/mcp       (Streamable HTTP)
                           │  │   • Auth middleware (API keys, shared)
                           │  │
                           │  ├─Postgres 16  (canonical content, api_keys)
                           │  └─Meilisearch (full-text search index)
                           └────────────────────────┘

      Ingestion (run locally / CI, then loaded to droplet):
        scrape an Arabic source HTML  ─┐
        parse English USFM       ─┼─► canonical JSON ─► Postgres ─► Meilisearch
        extract English Deuteros  ─┘
```

**Stack lock-in:**
- Runtime: Node 22 LTS + Fastify + TypeScript + GraphQL Yoga
- DB: Postgres 16
- Search: Meilisearch (with `SearchService` interface so Elasticsearch swap is contained)
- MCP: `@modelcontextprotocol/sdk` (TypeScript), Streamable HTTP transport
- Reverse-proxy/TLS: Caddy
- Edge: Cloudflare (free tier — caching, rate-limit, DDoS, TLS)
- Backups: DO weekly snapshots ($1.20/mo) + nightly `pg_dump` to DO Spaces
- Repo: pnpm monorepo (workspaces) — lets future domains land as new packages without rewiring

**Monthly cost target:** ~$14/mo all-in.

---

## Repository structure (pnpm monorepo)

The monorepo packages are organized around the future domains, even though only `bible` is fully implemented in v1. Sharing code between domains (auth, search, refs, infra) is the whole point of this layout.

```
ahosaji/
├── pnpm-workspace.yaml
├── package.json                  # root scripts: build, test, lint, ingest
├── tsconfig.base.json
├── README.md
│
├── apps/
│   └── api/                      # the deployed Fastify app — composes domain packages
│       ├── src/
│       │   ├── index.ts          # Fastify bootstrap, registers all domain routes
│       │   ├── config.ts         # env config
│       │   ├── plugins/
│       │   │   ├── auth.ts       # @ahosaji/shared/auth wired in
│       │   │   ├── rateLimit.ts
│       │   │   ├── cors.ts
│       │   │   └── errors.ts     # RFC 7807 problem+json
│       │   ├── routes/
│       │   │   ├── bible.ts      # mounts @ahosaji/bible/routes under /v1/bible
│       │   │   ├── lectionary.ts # stub: 501 in v1, real in v1.1
│       │   │   ├── synaxarium.ts # stub: 501 in v1
│       │   │   ├── agpeya.ts     # stub: 501 in v1
│       │   │   ├── parallel.ts   # /v1/parallel (Bible-only in v1)
│       │   │   ├── search.ts     # cross-domain search dispatcher
│       │   │   ├── today.ts      # stub: 501 in v1
│       │   │   ├── mcp.ts        # mounts @ahosaji/mcp transport at /v1/mcp
│       │   │   └── admin.ts      # POST /v1/admin/* (admin-key gated)
│       │   └── graphql/
│       │       ├── server.ts     # Yoga, schema-stitched from domain packages
│       │       └── schema.ts     # composition root
│       ├── test/
│       │   ├── integration/      # full-stack e2e
│       │   └── unit/
│       └── package.json
│
├── packages/
│   ├── shared/                   # cross-domain primitives — depended on by every domain
│   │   ├── src/
│   │   │   ├── auth/
│   │   │   │   ├── apiKeys.ts    # validate, hash, lookup, LRU cache
│   │   │   │   └── tiers.ts      # tier definitions, rate-limit budgets
│   │   │   ├── db/
│   │   │   │   ├── pool.ts       # singleton pg pool
│   │   │   │   └── tx.ts
│   │   │   ├── search/
│   │   │   │   ├── SearchService.ts        # interface
│   │   │   │   ├── MeilisearchService.ts   # impl
│   │   │   │   └── ElasticsearchService.ts # future, NOT in v1
│   │   │   ├── refs/
│   │   │   │   ├── usfm.ts       # USFM book code registry, canonical order
│   │   │   │   └── parse.ts      # parse "JHN.3.16-18", "PSA 23:1-6"
│   │   │   ├── lang/
│   │   │   │   ├── arabic.ts     # tashkeel/alif normalization, ta-marbuta handling
│   │   │   │   └── english.ts
│   │   │   ├── http/
│   │   │   │   └── errors.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── bible/                    # ★ THE V1 DOMAIN
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   │   ├── types.ts      # Verse, Chapter, Book, Translation, ParallelEntry, ...
│   │   │   │   └── service.ts    # business logic — used by REST, GraphQL, AND MCP
│   │   │   ├── db/
│   │   │   │   ├── queries.ts    # parameterized SQL (typed via pg-types or kysely)
│   │   │   │   └── migrations/   # references migrations/ at repo root
│   │   │   ├── routes/
│   │   │   │   ├── translations.ts
│   │   │   │   ├── books.ts
│   │   │   │   ├── chapters.ts
│   │   │   │   ├── verses.ts
│   │   │   │   ├── passages.ts
│   │   │   │   └── aliases.ts    # short paths /v1/bible/:code/:usfm/:c[/:v] → 302
│   │   │   ├── graphql/
│   │   │   │   ├── schema.ts     # SDL strings
│   │   │   │   └── resolvers.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── mcp/                      # MCP server adapter — depends on shared/* and each domain
│   │   ├── src/
│   │   │   ├── server.ts         # builds an MCP Server, registers tools/resources/prompts
│   │   │   ├── transport.ts      # Streamable HTTP transport, mounted into Fastify
│   │   │   ├── auth.ts           # bearer-token bridge to shared/auth/apiKeys
│   │   │   ├── tools/
│   │   │   │   ├── bible.ts      # tool definitions → call @ahosaji/bible service.ts
│   │   │   │   └── search.ts     # cross-domain search dispatcher
│   │   │   ├── resources/
│   │   │   │   └── bible.ts      # ahosaji://bible/<translation>/<ref> URI scheme
│   │   │   ├── prompts/
│   │   │   │   └── bible.ts      # explain_passage, compare_translations, verse_in_context
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── lectionary/               # v1.1 — package skeleton in v1, stub routes
│   │   └── src/index.ts
│   │
│   ├── synaxarium/               # v1.1 — skeleton
│   │   └── src/index.ts
│   │
│   ├── agpeya/                   # v1.1 — skeleton
│   │   └── src/index.ts
│   │
│   └── coptic-calendar/          # shared utility — Coptic ↔ Gregorian date conversion (used by lectionary, synaxarium, today)
│       └── src/index.ts          # implemented in v1.1 alongside first calendar-aware domain
│
├── ingest/
│   ├── src/
│   │   ├── bible/
│   │   │   ├── scrapers/
│   │   │   │   ├── arabicScraper.ts    # HTML scraper (an arabic source)
│   │   │   │   ├── english.ts       # USFM parser (licensed dump)
│   │   │   │   └── deuteroScraper.ts # English PDF extractor
│   │   │   ├── normalize/
│   │   │   │   ├── canonical.ts  # → canonical-JSON shape
│   │   │   │   ├── crossRefs.ts  # join open cross-ref dataset
│   │   │   │   └── redLetter.ts  # apply red-letter ranges
│   │   │   ├── load/
│   │   │   │   ├── postgres.ts   # idempotent upsert
│   │   │   │   └── meilisearch.ts# reindex
│   │   │   └── audit/
│   │   │       └── pdfDiff.ts    # diffs structured source vs PDF text
│   │   └── shared/
│   │       └── http.ts           # polite scrape: rate-limit, retries, cache
│   ├── data/
│   │   ├── snapshots/            # versioned canonical JSON, committed
│   │   │   ├── ar/               # one file per book
│   │   │   └── en/
│   │   └── shared/
│   │       ├── books.json        # USFM registry, canonical order, chapter counts
│   │       ├── crossrefs.json
│   │       └── redletter.json
│   └── package.json
│
├── migrations/                   # Postgres migrations (sql files, language-agnostic)
│   ├── 0001_init.sql
│   ├── 0002_consumers_keys.sql
│   ├── 0003_indexes.sql
│   └── 0004_translations_books_verses.sql
│
├── infra/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   ├── meilisearch.env.example
│   ├── postgres.env.example
│   ├── api.env.example
│   └── cloudflare/
│       └── rate-limit-rules.md   # documented rules to apply via dashboard
│
├── docs/
│   ├── openapi.yaml              # generated/maintained OpenAPI 3.1 spec
│   ├── graphql-schema.graphql    # composed schema export
│   ├── data-model.md
│   ├── ingestion-runbook.md
│   ├── usfm-mapping.md           # which USFM code maps to which an Arabic source file / English book
│   └── adr/                      # architecture decision records
│       ├── 0001-monorepo.md
│       ├── 0002-meilisearch.md
│       └── 0003-api-keys-required.md
│
└── .github/workflows/
    ├── ci.yml                    # test + typecheck + lint
    └── deploy.yml                # ssh deploy to droplet
```

**Why monorepo from day 1 (recap):** each future domain (lectionary, synaxarium, agpeya) shares auth, DB pool, search service, ref-parsing, USFM registry, and Coptic-calendar logic. A monorepo keeps these as code-level imports (not network calls), enables atomic refactors across domains, and ships as a single deploy. Workspace package boundaries also document what is reusable vs. domain-specific without enforcing hard service splits.

---

## Data model (Postgres)

Canonical, immutable, read-only for v1 Bible domain. Future domains add their own tables (e.g. `lectionary_days`, `synaxarium_entries`) and reference these via FK on `verse_ref`.

```sql
-- Translations
CREATE TABLE translations (
  code        TEXT PRIMARY KEY,    -- 'ar' | 'en'
  name        TEXT NOT NULL,
  language    TEXT NOT NULL,       -- 'ar' | 'en'
  source      TEXT NOT NULL,       -- 'an Arabic source' | 'English'
  copyright   TEXT,
  versification TEXT NOT NULL      -- 'lxx' | 'masoretic' | 'mixed'
);

-- Books (registry — same rows for both translations)
CREATE TABLE books (
  usfm        TEXT PRIMARY KEY,    -- 'GEN', 'JHN', 'TOB', 'PS2', 'DAG', ...
  name_en     TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  testament   TEXT NOT NULL,       -- 'OT' | 'NT'
  canon       TEXT NOT NULL,       -- 'protocanonical' | 'deuterocanonical'
  book_order  INT NOT NULL,
  chapter_count INT NOT NULL,
  book_group  TEXT                 -- 'Pentateuch','Wisdom','Gospels','Pauline','Catholic',...
);

-- Verses (~31k per translation × 2 translations ≈ 62k rows)
CREATE TABLE verses (
  translation TEXT REFERENCES translations(code),
  book        TEXT REFERENCES books(usfm),
  chapter     INT NOT NULL,
  verse       INT NOT NULL,
  ref         TEXT GENERATED ALWAYS AS (book || '.' || chapter || '.' || verse) STORED,
  text        TEXT NOT NULL,                  -- plain rendering
  structured  JSONB NOT NULL,                 -- tokens, redLetter, italic, footnotes, heading, paragraphStart, poetic, poeticLines, crossRefs
  PRIMARY KEY (translation, book, chapter, verse)
);
CREATE INDEX verses_ref_idx ON verses(ref);
CREATE INDEX verses_book_chapter_idx ON verses(translation, book, chapter);

-- Section headings (denormalized for fast chapter rendering)
CREATE TABLE headings (
  translation TEXT,
  book        TEXT,
  chapter     INT,
  before_verse INT,
  text        TEXT NOT NULL,
  level       INT NOT NULL DEFAULT 2,   -- 1 = major, 2 = section
  PRIMARY KEY (translation, book, chapter, before_verse)
);

-- Cross-references (translation-independent)
CREATE TABLE cross_refs (
  from_ref    TEXT NOT NULL,
  to_ref      TEXT NOT NULL,
  PRIMARY KEY (from_ref, to_ref)
);

-- API keys (lives in `shared`, used by every future domain)
CREATE TABLE consumers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  organization TEXT,
  tier        TEXT NOT NULL DEFAULT 'free', -- 'free' | 'church' | 'paid' | 'admin'
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id UUID REFERENCES consumers(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL,        -- argon2id(key)
  prefix      TEXT NOT NULL,        -- first 8 chars of plaintext, for lookup
  label       TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX api_keys_prefix_idx ON api_keys(prefix);

-- Usage log (lightweight; rotate to Spaces monthly)
CREATE TABLE request_log (
  ts          TIMESTAMPTZ DEFAULT now(),
  consumer_id UUID,
  endpoint    TEXT,
  status      INT,
  ms          INT
);
```

**Verse `structured` JSONB shape:**
```json
{
  "tokens": [
    { "text": "The LORD ", "italic": false, "redLetter": false },
    { "text": "is", "italic": true, "redLetter": false },
    { "text": " my shepherd; I shall not want.", "italic": false }
  ],
  "footnotes": [{ "marker": "a", "text": "Or 'Yahweh'" }],
  "crossRefs": ["PSA.80.1"],
  "heading": null,
  "paragraphStart": true,
  "poetic": true,
  "poeticLines": ["The LORD is my shepherd;", "I shall not want."]
}
```
For `ar` translation, `italic` is omitted (English-specific convention). All other fields apply.

---

## API surface — REST

Versioned under `/v1/`. JSON only. All responses include `meta` (translation, ref, timing). Errors follow RFC 7807 problem+json. All Bible reading routes nest under `/v1/bible/`.

### Discovery (public, no auth)
- `GET /v1/translations` — list `[{code, name, language, source, ...}]`
- `GET /v1/translations/:code` — translation details + book counts
- `GET /v1/translations/:code/books` — list books with chapter counts, testament, canon
- `GET /v1/healthz` — liveness
- `GET /v1/info` — version, build sha, supported domains

### Bible domain (auth required)
**Reading (canonical paths):**
- `GET /v1/bible/translations/:code/books/:usfm` — whole book (paginated by chapter via `?chapter=N` for very large books)
- `GET /v1/bible/translations/:code/books/:usfm/chapters/:n` — whole chapter, includes headings
- `GET /v1/bible/translations/:code/books/:usfm/chapters/:n/verses/:v` — single verse
- `GET /v1/bible/translations/:code/books/:usfm/chapters/:n/verses?from=:a&to=:b` — verse range within chapter

**Cross-chapter ranges:**
- `GET /v1/bible/passages?translation=:code&start=:ref&end=:ref` — e.g. `start=JHN.3.16&end=JHN.4.2`

**Parallel (multi-translation, v1 first-class):**
- `GET /v1/parallel?translations=en,ar&ref=JHN.3.16` (Bible-domain-only in v1; URL-stable for future cross-domain parallel)
- `GET /v1/parallel?translations=en,ar&start=PSA.23.1&end=PSA.23.6`
- Response includes `present: bool` per translation per ref (e.g. `PSA.151` → `en.present=false`).

**Search (Meilisearch-backed):**
- `GET /v1/search?q=:query&domain=bible&translation=:code` — required `q`, required `translation` for Bible
- Filters: `?book=JHN`, `?testament=NT`, `?canon=protocanonical`, `?bookGroup=Gospels`
- Pagination: `?limit=20&offset=0`
- Response: hits with `ref`, `text`, `score`, `_formatted` (highlighted), pagination meta
- Arabic search: `q` is normalized server-side (tashkeel removed, alif unified) before hitting Meilisearch

### Reserved future domains (return 501 with `{ "domain": "...", "available": "v1.1" }` in v1)
- `/v1/lectionary/...`
- `/v1/synaxarium/...`
- `/v1/agpeya/...`
- `/v1/today`
- `/v1/commentary/...`
- `/v1/hymns/...`

### Short aliases (convenience; 302 → canonical)
- `GET /v1/bible/:code/:usfm/:chapter` → 302
- `GET /v1/bible/:code/:usfm/:chapter/:verse` → 302
- `GET /v1/bible/:code/:usfm/:chapter/:from-:to` → 302

### Admin (key-gated, `tier=admin`)
- `POST /v1/admin/reindex` — kick a Meilisearch reindex
- `POST /v1/admin/cache/purge` — invalidate Cloudflare cache via API
- `POST /v1/admin/keys` — issue a key
- `DELETE /v1/admin/keys/:id` — revoke

### Auth
All non-discovery endpoints require `Authorization: Bearer <api-key>`. Discovery endpoints are public so client apps can populate dropdowns without auth.

---

## API surface — GraphQL

Single endpoint `POST /v1/graphql`. Schema composed from each domain package's `graphql/` exports.

```graphql
type Query {
  translations: [Translation!]!
  translation(code: ID!): Translation
  book(translation: ID!, usfm: ID!): Book
  chapter(translation: ID!, usfm: ID!, chapter: Int!): Chapter
  verse(translation: ID!, usfm: ID!, chapter: Int!, verse: Int!): Verse
  verses(translation: ID!, usfm: ID!, chapter: Int!, from: Int!, to: Int!): [Verse!]!
  passage(translation: ID!, start: String!, end: String!): Passage!
  parallel(translations: [ID!]!, ref: String, start: String, end: String): ParallelResult!
  search(domain: SearchDomain!, translation: ID, q: String!, filters: SearchFilters, limit: Int = 20, offset: Int = 0): SearchResult!
}

enum SearchDomain { BIBLE LECTIONARY SYNAXARIUM AGPEYA }   # v1 supports BIBLE only

type Translation {
  code: ID!
  name: String!
  language: String!
  source: String!
  versification: String!
  books: [BookSummary!]!
}

type Book {
  usfm: ID!
  nameEn: String!
  nameAr: String!
  testament: String!
  canon: String!
  bookGroup: String
  chapterCount: Int!
  chapters: [Chapter!]!
}

type Chapter {
  usfm: ID!
  number: Int!
  verses: [Verse!]!
  headings: [Heading!]!
}

type Verse {
  ref: String!
  book: ID!
  chapter: Int!
  verse: Int!
  text: String!
  structured: VerseStructured!
}

type VerseStructured {
  tokens: [Token!]!
  footnotes: [Footnote!]!
  crossRefs: [String!]!
  heading: String
  paragraphStart: Boolean!
  poetic: Boolean!
  poeticLines: [String!]
}
type Token { text: String!, italic: Boolean!, redLetter: Boolean! }
type Footnote { marker: String!, text: String! }
type Heading { beforeVerse: Int!, text: String!, level: Int! }

type Passage {
  translation: ID!
  start: String!
  end: String!
  verses: [Verse!]!
}

type ParallelEntry {
  translation: ID!
  present: Boolean!
  text: String
  structured: VerseStructured
}
type ParallelVerse { ref: String!, translations: [ParallelEntry!]! }
type ParallelResult { refs: [ParallelVerse!]! }

input SearchFilters {
  book: ID
  testament: String
  canon: String
  bookGroup: String
}
type SearchHit {
  ref: String!
  text: String!
  formatted: String!
  score: Float!
  verse: Verse!
}
type SearchResult { hits: [SearchHit!]!, total: Int!, query: String! }
```

**Server**: GraphQL Yoga on top of the same Fastify app. Resolvers call the same `service.ts` per domain that the REST routes use — single source of truth for business logic.

---

## API surface — MCP

**Endpoint.** `POST /v1/mcp` (Streamable HTTP). The same Fastify app exposes it; the transport is a thin wrapper that bridges Fastify request/response to the MCP SDK's `StreamableHTTPServerTransport`. Stateful sessions use the SDK's session-id mechanism; stateless single-shot calls work too.

**Discovery vs. invocation (locked).** Public-discoverable: `initialize`, `tools/list`, `resources/list`, `resources/templates/list`, and `prompts/list` are reachable **without** a bearer token. All other methods that return content — `tools/call`, `resources/read`, `prompts/get` — require a valid bearer key and 401 otherwise. This mirrors the existing REST design (discovery routes public, content routes gated). Anonymous discovery is rate-limited at the Cloudflare edge (e.g. 30 req/min per IP) since it has no API-key tier to attribute to.

**Auth.** `Authorization: Bearer <api-key>` — exactly the same key store as REST/GraphQL. The MCP `auth.ts` calls the existing `shared/auth/apiKeys.validate(...)` function. No second user store. Discovery methods skip the validate call entirely; invocation methods require it.

For v1 we deliberately ship bearer-token only (not full OAuth 2.1). Claude Desktop, Claude Code, ChatGPT Connectors, and Cursor all support bearer-style remote MCP today; OAuth 2.1 with dynamic client registration is a v1.1 add (deferred to keep v1 scope tight).

**Tools (v1, Bible domain only):**

| Tool name              | Args                                                          | Returns                                  |
|------------------------|---------------------------------------------------------------|------------------------------------------|
| `list_translations`    | —                                                             | `Translation[]`                          |
| `list_books`           | `translation`                                                 | `BookSummary[]`                          |
| `get_verse`            | `translation, ref` (USFM e.g. `JHN.3.16`)                     | `Verse`                                  |
| `get_chapter`          | `translation, book, chapter`                                  | `Chapter` (verses + headings)            |
| `get_passage`          | `translation, start, end` (USFM refs)                         | `Passage`                                |
| `get_parallel`         | `translations[], ref` OR `translations[], start, end`         | `ParallelResult` with `present` per ref  |
| `search_bible`         | `q, translation, filters?, limit?, offset?`                   | `SearchHit[]` with highlighted snippets  |

Each tool's handler is a 3–5 line wrapper that calls the existing `@ahosaji/bible` service. No new business logic.

**Resources.** URI scheme `ahosaji://bible/<translation>/<usfm-ref>`:
- `ahosaji://bible/en/JHN.3.16` → single verse
- `ahosaji://bible/en/PSA.23` → whole chapter
- `ahosaji://bible/en/books` → list of books (resource template)

This lets Claude Desktop / ChatGPT pin a verse or chapter as a referenceable artifact in a conversation.

**Prompts (parameterized templates):**
- `explain_passage(translation, ref)` — fetches the passage and templates a study prompt.
- `compare_translations(ref)` — fetches Arabic + English in parallel and asks the model to compare.
- `verse_in_context(translation, ref, window=5)` — fetches surrounding verses and asks for context.

Prompts are pure templates — they call the same service to produce the materialized prompt text and return it. They do not call the LLM themselves.

**Reserved for future domains** — `get_lectionary_today`, `get_synaxarium_today`, `get_agpeya_hour`, etc. land alongside their domain in v1.1; the MCP package is structured so each domain registers its own tools/resources/prompts via a `MCPDomainModule` interface.

---

## Ingestion pipeline (Bible domain v1)

Idempotent, run-locally-or-CI, produces versioned snapshots in `ingest/data/snapshots/` that are committed to the repo. Future domains follow the same pattern under `ingest/src/<domain>/`.

### Phase A — `ar` (an Arabic source HTML) ✅ implemented
- Crawler hits `${AR_BASE_URL}/Bibles/BibleSearch/showChapter.php?book=<id>&chapter=<n>`
- an Arabic source numbering (discovered): OT 1–49 (Deuteros interspersed: 17=Tobit, 18=Judith, 48=1 Macc, 49=2 Macc), NT starts at 50 (50=Matt, 53=John). Full table in `docs/scrapers/arabic.md`.
- Plain Node `fetch` with browser User-Agent (`AR_USER_AGENT` env). No JS, no bot defenses observed.
- Verse anchor: `<div class="HColor1Div" data-usfm="John.3.16">` — `data-usfm` is the gold-standard reference (long-form English book name).
- Section headings: `<h2>` tags within passage area (filter out chrome and template placeholders).
- Polite scraping: 500ms–1s inter-request delay, on-disk HTML cache to `ingest/data/cache/arabic/`.
- Outputs `ingest/data/snapshots/ar/<USFM>.json`.
- Audit pass: per-chapter diff between scraped HTML text and corresponding PDF (the `*.pdf` files the user already has).

### Phase B — `en` protocanonical (source English scrape) ✅ implemented — full English (66 books) scraped via plain `fetch`
- Input: source HTML at `${SOURCE_BASE_URL}/passage/?search=<EnglishBookName>+<chapter>&version=English`
- **Discovery**: source anchors verses by *English book name* (`John-3-1`), not USFM. Heading wrappers (`<h3><span class="text John-3-1">…`) need filtering. Footnote markers carry `data-fn="#fen-..."` on the `<sup>` (use the attribute, not the inner anchor href).
- Preserves: red-letter (`<span class="woj">`), italics (`<i>` for English translator-added words), footnotes (`<sup class="footnote">` linked to `<div class="footnotes">`), section headings (`<h3>` inside `.passage-text`), paragraph structure.
- **Transport for prototype**: Firecrawl SDK (1 credit/page).
- **Transport for full scrape**: plain Node `fetch` with browser User-Agent + 1–2s delay (done — Firecrawl was not needed for the full English run); fall back to Firecrawl only on 403/429.
- Outputs `ingest/data/snapshots/en/<USFM>.json` for the 66 protocanonical books.
- (Future: if a licensed English USFM dump becomes available, swap to `usfm-grammar` for richer markup — but source scrape captures ~85% of the structural richness in practice.)

### Phase C — `en` Deuterocanonicals (English) ✅ implemented — all Deutero books extracted (iterated to 100% clean, 138/138 chapters)
- Input: explicitly configured English PDF at `SOURCE_PDF_PATH` (`English_PDF_PATH` is a compatibility alias).
- **Discovery**: English PDF is 12,301 pages = nav indexes + content. TOC bookmarks point to chapter-list nav pages, not content. Tobit content actually starts at p1346. Per-chapter content can span multiple pages and bleed into the next chapter on the same page.
- **Verse markers**: inline integers immediately followed by capital letter or quote (`19But`, `20All`, `2"O Lord`). First verse of each chapter has no marker (chapter heading implicitly serves).
- **Chapter-boundary trick**: track high-water-mark verse number; when a detected verse number drops below it, the next chapter has bled in — truncate.
- **Section headings**: standalone title-case lines (length 5–80, not all-caps single-word). Filter out headings beyond the last detected verse to avoid attributing next-chapter headings.
- **Per-book page-range lookup**: build once via `doc.get_toc()` + chapter-1 link target; store in `ingest/data/shared/deutero-page-ranges.json`. Day 7+ work.
- Implementation: PyMuPDF Python sidecar (`ingest/python/extract_deutero_chapter.py`) called via `child_process.spawn` from `ingest/src/scrapers/deuteroScraper.ts`.
- Outputs `ingest/data/snapshots/en/<USFM>.json` for: TOB ✅, JDT, WIS, SIR, BAR, 1MA, 2MA, 3MA, MAN, PS2, DAG, ESG.

### Phase D — Shared metadata ✅ implemented (per Day 6 enrichment)
- **Cross-references**: hand-curated TSK sample at `ingest/data/shared/crossrefs/JHN.3.json` for the prototype; pull full OpenBible.info dataset (~340k cross-refs, public domain CSV) for full scrape. Translation-independent — applied identically to `en` and `ar` snapshots of the same book.
- **Red-letter ranges**: derived at runtime from source-scraped `<span class="woj">` markers (per-verse map). Verse-level transfer en→ar is enough for v1; sub-verse precision deferred to v1.1 (Arabic word order divergence makes proportional offset mapping lossy).
- **Versification mapping tables** ✅ done: per-book JSON at `ingest/data/shared/versification/<USFM>.json` for 9 divergent Deuteros (TOB, JDT, SIR, WIS, 1MA, 2MA, ESG, PSA, PS2). DAG/BAR/3MA/MAN verified clean-aligning (no table). Protocanonical books default to identity mapping. Consumed by `/v1/parallel` (incl. `?prefer_aligned=1` anchor mode). *(Known issue: the loader's reverse index drops N:1 mappings — see `docs/roadmap.md`.)*
- **USFM book registry** ✅ built: `ingest/data/shared/books.json` (78 books with order, testament, canon, chapter counts per tradition, bookGroup). *(Note: the file's own top comment still says "73-book" — cosmetic, see roadmap.)*
- **Enrichment limitation logged**: English's italics-for-added-words and tradition-specific footnotes are *not* transferable across translations (English-specific convention; Arabic adds different words for Arabic-syntax clarity). Headings stay per-source (each publisher's own).

### Phase E — Load
- `pnpm ingest:bible:postgres` — wipes & re-loads `verses`, `headings`, `cross_refs`, `books`, `translations` from snapshots in a single transaction
- `pnpm ingest:bible:meilisearch` — recreates `verses_ar` and `verses_en` indexes; bulk-imports normalized search docs

### Re-ingest cadence
- Manual trigger only. Source texts are stable. CI runs the snapshot diff on every PR to catch accidental drift; only the load step needs to be triggered against prod.

---

## Search architecture

### Indexes (v1)
- `verses_ar` and `verses_en` — separate so language-specific tokenizers and ranking apply
- (Future v1.1+: `lectionary_*`, `synaxarium_*`, `commentary_*` — same `SearchService` interface, dispatched by `domain` param)

### Document shape
```json
{
  "id": "ar:JHN.3.16",
  "translation": "ar",
  "domain": "bible",
  "ref": "JHN.3.16",
  "book": "JHN",
  "book_name": "يوحنا",
  "chapter": 3,
  "verse": 16,
  "testament": "NT",
  "canon": "protocanonical",
  "book_group": "Gospels",
  "book_order": 50,
  "text": "لأنّه هكذا أحبّ اللهُ العالم...",
  "normalized_text": "لانه هكذا احب الله العالم...",
  "heading": "حديث المسيح مع نيقوديموس"
}
```

### Settings
- `searchableAttributes`: `["text", "normalized_text", "heading"]`
- `filterableAttributes`: `["book", "testament", "canon", "book_group", "domain"]`
- `sortableAttributes`: `["book_order", "chapter", "verse"]`
- Typo tolerance: defaults (1 typo for ≥5 chars, 2 for ≥9)

### Query flow
1. API receives `q` and `domain` (and `translation` for Bible)
2. If language is Arabic, normalize `q` (strip tashkeel, unify alif) → `q_norm`
3. Hit Meilisearch with both `q` (against `text`) and `q_norm` (against `normalized_text`) via multi-search; merge via Meilisearch's `searchableAttributes` weighting
4. Highlight via `_formatted` with `<em>` tags
5. Hydrate hits with full domain object from Postgres for `structured` data

### `SearchService` interface
```ts
interface SearchService {
  search(opts: {
    domain: 'bible' | 'lectionary' | 'synaxarium' | 'agpeya' | 'commentary';
    translation?: 'ar' | 'en';
    q: string;
    filters?: Record<string, string>;
    limit?: number;
    offset?: number;
    fuzzy?: boolean;
  }): Promise<{ hits: SearchHit[]; total: number }>;
  reindex(domain: string, translation?: string): Promise<void>;
}
```
Implemented by `MeilisearchService` in v1; `ElasticsearchService` is a future swap with no client breakage.

---

## Auth & rate limiting

### Issuance
- v1 issuance is admin-only (manual). User runs `pnpm cli keys:create --email a@b.com --tier free`. Returns plaintext key once; only argon2id hash + prefix stored.
- A self-serve signup endpoint is *designed* but deferred to v1.1.

### Validation
- Middleware on every non-discovery route: parse `Authorization: Bearer <key>`, lookup by `prefix`, verify hash, attach `consumer` to request.
- Cache key→consumer in-process LRU (5-min TTL) to avoid hot-path DB hits.

### Rate limits (per-consumer, per-tier)
| Tier   | Limit                        |
|--------|------------------------------|
| free   | 60 req/min, 5 000/day        |
| church | 600 req/min, 200 000/day     |
| paid   | 6 000 req/min, no daily cap  |
| admin  | unlimited                    |

Implemented via `@fastify/rate-limit` with a Postgres-backed counter table. Returns `429` with `Retry-After`.

### Cloudflare layer
A second rate-limit at the edge per IP (300 req/min anonymous on discovery routes) catches abuse before it reaches origin. Rules documented in `infra/cloudflare/rate-limit-rules.md`.

### MCP transport
The MCP endpoint accepts the same bearer API keys. Per-tier rate limits apply to the underlying tool calls (each tool invocation is one request). MCP tool calls bypass Cloudflare edge-cache because they are POSTs; cache-friendliness lives at the REST layer. Anonymous MCP discovery (`tools/list`, `resources/list`, `prompts/list`) is allowed but rate-limited at the edge to 30 req/min per IP.

---

## Self-host infra (DigitalOcean)

### `infra/docker-compose.yml`
```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file: postgres.env
    volumes: [pgdata:/var/lib/postgresql/data, ./backups:/backups]
    restart: unless-stopped

  meilisearch:
    image: getmeili/meilisearch:v1.10
    env_file: meilisearch.env
    volumes: [meilidata:/meili_data]
    restart: unless-stopped

  api:
    build: ../apps/api
    env_file: api.env
    depends_on: [postgres, meilisearch]
    restart: unless-stopped

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddydata:/data
      - caddyconfig:/config
    restart: unless-stopped

volumes:
  pgdata: {}
  meilidata: {}
  caddydata: {}
  caddyconfig: {}
```

### `infra/Caddyfile`
```
api.ahosaji.example {
  encode zstd gzip
  reverse_proxy api:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
  }
}
```

### Cloudflare config (applied via dashboard, documented in repo)
- DNS A record `api.ahosaji.example` → droplet IP, proxied (orange cloud)
- Cache rule: `Cache Everything` for `GET /v1/translations*`, `GET /v1/bible/.../verses*`, `GET /v1/bible/.../chapters*`, `GET /v1/bible/passages*`, `GET /v1/parallel*` with 24h edge TTL, `Vary: Authorization`
- Page rule: bypass cache for `/v1/admin/*`, `/v1/search*`, and `/v1/mcp` (POSTs aren't cached anyway, but documented explicitly)
- Rate limit rule: 300 req/min/IP on `/v1/*`; tighter 30 req/min/IP on anonymous MCP discovery requests

### Backup strategy
- DO weekly snapshot (whole droplet)
- `pg_dump` nightly cron → DO Spaces, 30-day retention
- Meilisearch index NOT backed up — rebuildable in <2 min from Postgres via `ingest:bible:meilisearch`

---

## Verification — end-to-end

### 1. Local dev stack up
```bash
cd infra && docker compose up -d
pnpm install
pnpm -w ingest:bible:postgres && pnpm -w ingest:bible:meilisearch
pnpm -w --filter @ahosaji/api dev
```
- All three services healthy: `docker compose ps`
- Postgres: 73 books × 2 translations of verses
- Meilisearch dashboard at `:7700` shows two indexes with expected document counts

### 2. REST smoke tests (`apps/api/test/integration/`)
```bash
pnpm cli keys:create --email test@local --tier admin   # capture API_KEY
curl "http://localhost:3000/v1/translations"                                                                       # 200, public
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/bible/translations/en/books/JHN/chapters/3/verses/16"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/bible/passages?translation=en&start=JHN.3.16&end=JHN.4.2"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/parallel?translations=en,ar&ref=PSA.23.1"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/parallel?translations=en,ar&ref=PSA.151.1"      # en.present=false
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/search?q=shepherd&domain=bible&translation=en"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/search?q=الراعي&domain=bible&translation=ar"
curl -H "Authorization: Bearer $API_KEY" "http://localhost:3000/v1/lectionary/days/2026-05-13"                     # 501, future
```

### 3. GraphQL parity test
- For each REST query above, run the equivalent GraphQL query via Yoga's playground at `/v1/graphql`
- Assert response shapes match REST (modulo GraphQL field-selection)

### 3a. MCP smoke tests
From the repo root, run `pnpm --filter @ahosaji/mcp test:e2e` — uses the official MCP SDK client to:
- **Anonymous probe**: connect with no bearer → `tools/list` returns 7 Bible tools; `tools/call get_verse` returns 401.
- **Authenticated session**: initialize against `http://localhost:3000/v1/mcp` with a test bearer key.
- Call `get_verse({translation:"en", ref:"JHN.3.16"})` → assert text matches REST.
- Call `get_parallel({translations:["en","ar"], ref:"PSA.151.1"})` → assert `en.present === false`.
- List resources → expect `ahosaji://bible/...` template.
- Read `ahosaji://bible/en/JHN.3.16` → assert content matches the tool result.
- Get prompt `explain_passage({translation:"en", ref:"JHN.3.16"})` → assert template materialized.

**Manual client probe** (one-time, documented in `docs/mcp-client-setup.md`): connect Claude Desktop's "Add MCP server" with `https://api.ahosaji.example/v1/mcp` + bearer key, verify tools appear and `get_verse` returns the right text.

### 4. Auth & rate-limit tests
- 401 without `Authorization` (on auth-required routes)
- 401 with invalid key
- 401 with revoked key
- 429 after exceeding per-tier rate limit
- Discovery endpoints work without auth

### 5. Search quality tests (`apps/api/test/search/`)
- Diacritic-insensitive Arabic: `q=الراعي` and `q=الرَّاعِي` both return `PSA.23.1` in top 5
- Typo tolerance: `q=shephred` returns shepherd verses
- Filters: `?book=JHN` restricts to John

### 6. Production deploy
- Push to `main` → GH Action SSH-deploys to droplet, runs migrations, restarts api container
- DNS proxied through Cloudflare
- Curl live URL with prod API key
- Verify Cloudflare caching: 2nd request returns `cf-cache-status: HIT`

### 7. Backup/restore drill
- Trigger `pg_dump` manually
- Spin up fresh empty droplet, restore from latest dump, point staging DNS, re-run smoke tests

---

## Out of scope for v1 (designed-for, deferred)

- Self-serve API key signup UI (admin-issuance only in v1)
- Lectionary domain (Katameros) — package skeleton in v1, real implementation v1.1
- Synaxarium domain — same
- Agpeya (book of hours) domain — same
- Commentary corpus (the editor, English study notes)
- **Versification mapping tables for divergent Deuteros** (TOB, JDT, SIR, MAC, DAG, ESG, PSA) — strategy locked, curation deferred to v1.1; ~half-day per book
- **Sub-verse-precision red-letter** for Arabic (verse-level transfer is implemented in v1; sub-verse alignment across English↔Arabic word-order divergence deferred)
- LXX↔Hebrew Psalm number mapping for "deep" parallel queries
- Audio (Coptic chant, English/Arabic narration) — separate service
- Webhook subscriptions for "verse-of-the-day" pushes
- Embeddings/semantic search (would motivate Elasticsearch swap)
- Federated search across commentary + Bible
- Patristic citation extraction
- AI-assisted study aids (the "AI and stuff" of the original vision — a deliberate v2+ direction)
- MCP OAuth 2.1 with dynamic client registration — bearer-only in v1; v1.1 add
- MCP server-initiated notifications / sampling — no domain need yet
- Per-tool MCP rate-limit policies distinct from REST tier limits
- Liturgical-use markers on Deutero verses (extract from English's `ω` markers + Katameros prescription) — natural fit for the lectionary domain in v1.1
