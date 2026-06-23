# Ahosaji — Roadmap

**Vision**: Coptic Orthodox content API. Bible, Lectionary, Synaxarium, Agpeya — exposed via REST, GraphQL, and MCP for AI agents.

**Status (2026-06-14)**: the v1 **Bible API is built end-to-end** — full ingestion + REST/GraphQL/MCP/search + API-key auth + OpenAPI/generated SDK + versification mapping, all shipped and committed (HEAD `f8c9524`). **Not yet deployed.** A short list of verified known issues is open before ship — see [Known issues](#known-issues--cleanup-backlog) at the bottom.

> **Reconciliation note (2026-06-14):** the checkboxes below were re-derived from git reality, not the original day-by-day plan. The plan numbered the work "Days 1–6 → Phase 2 (runtime) → Phase 3 (MCP)"; git actually delivered the same scope as "Days 1–6 → full ingestion ('Phase 1 redux') → Phase 2 slices 1–9 (runtime, MCP included) → versification mappings + `prefer_aligned`." One structural drift: MCP was built **inside `apps/api/src/mcp/`**, not as a separate `packages/mcp` workspace.

---

## Days 1–6 — Prototype (data side de-risked) ✅

- [x] **Day 1** — Monorepo skeleton (pnpm workspaces, TypeScript, ingest package)
- [x] **Day 2** — source English scraper (`en/JHN.json` 36v + headings + red-letter + footnotes)
- [x] **Day 3** — an Arabic source Arabic scraper (`ar/JHN.json` 36v + diacritics)
- [x] **Day 4 / 4.5** — English Deutero PDF extractor + an Arabic source Arabic Deutero (`TOB`)
- [x] **Day 5** — Canonical-shape validator + versification decision
- [x] **Day 6** — Cross-translation enrichment (red-letter en→ar + TSK cross-refs); `enrich.ts` foundation built

**Result**: four-corner matrix proven (en/ar × proto/deutero); canonical-JSON shape stable; the TOB ar=25v vs en=22v divergence surfaced and handled by per-book mapping tables.

---

## Full-scale ingestion ✅

- [x] source full English: 66 books, plain `fetch` (zero Firecrawl credits)
- [x] an Arabic source full coverage: full Coptic Orthodox canon (incl. Deuteros and Psalm 151)
- [x] English Deutero coverage: all books extracted, iterated to **100% clean (138/138 chapters)**
  - [x] PS2 (Psalm 151), DAG (Susanna/Bel/Song of Three), ESG (Esther additions) closed
  - [x] MAN (Prayer of Manasseh) — absent from the English PDF; sourced from the Coptic Pascha liturgy
- [x] **78 books × 2 translations (~71k verses)** — full bidirectional snapshot coverage (78 en + 78 ar, no orphans)
- [x] Versification mapping tables for divergent Deuteros — **9 tables**: TOB, JDT, SIR, WIS, 1MA, 2MA, ESG, PSA, PS2
  - [x] DAG, BAR, 3MA, MAN verified to **align cleanly** (identical ar/en verse counts) → no table needed
- [ ] Per-chapter audit diff (scraped text vs source PDF) — **not run**
- [ ] Cross-references at scale — only `JHN.3` ingested so far (see Known issues)

---

## Phase 2 — Runtime (Postgres + Meilisearch + Fastify) ✅

- [x] `infra/docker-compose.yml` — Postgres 16 + Meilisearch v1.10
- [x] Migrations `0001`–`0003`; Postgres loader + Meilisearch loader (books / verses / headings / cross_refs)
- [x] `apps/api` Fastify server; discovery (`/v1/healthz`, `/v1/info`, `/v1/translations*`)
- [x] REST routes: bible reads, `/v1/bible/passages`, `/v1/parallel` (+ `?prefer_aligned=1` anchor mode)
- [x] GraphQL Yoga at `/v1/graphql` (mirrors REST)
- [x] Meilisearch index + `/v1/search` (Arabic tashkeel-normalized, dual pagination, filters)
- [x] API-key auth (argon2id, prefix lookup) + per-tier rate limiting (free / church / paid / admin)
- [x] OpenAPI 3.1 spec + Scalar reference at `/docs/` + generated `@ahosaji/sdk` + TypeDoc at `/docs/sdk/`

---

## Phase 3 — MCP transport ✅

- [x] Streamable HTTP transport mounted at `/v1/mcp` (stateless) — **built inside `apps/api/src/mcp/`**, not a separate `packages/mcp`
- [x] 7 Bible tools: `list_translations`, `list_books`, `get_verse`, `get_chapter`, `get_passage`, `get_parallel`, `search_bible`
- [x] `ahosaji://bible/...` resource scheme + 3 prompt templates
- [x] Introspection public; `tools/call` / `resources/read` / `prompts/get` Bearer-gated
- [ ] e2e SDK-client test + Claude Desktop manual probe — not yet automated

---

## Phase 4 — Future domains (v1.1+) ⬜ — next major scope

- [ ] Lectionary (Katameros) — daily readings by Coptic + Gregorian calendar
- [ ] Synaxarium — saints' calendar + commemorations
- [ ] Agpeya — book of hours
- [ ] Commentary corpus — the editor, English study notes
- [ ] Liturgical-use markers on Deutero verses (rich Coptic relevance)
- [ ] OAuth 2.1 for MCP transport
- [ ] Self-serve API key signup

Reserved future URL prefixes already return `501 {available: v1.1}`: `/v1/lectionary`, `/v1/synaxarium`, `/v1/agpeya`, `/v1/commentary`, `/v1/hymns`, `/v1/today`.

---

## Deployment ⬜ — not started

- [ ] DigitalOcean droplet ($12/mo) provisioned
- [ ] Domain registered (e.g. `ahosaji.dev`)
- [ ] Cloudflare in front (free tier)
- [ ] CI/CD via GitHub Actions (must gate on `pnpm -r typecheck`)
- [ ] Backup strategy (DO snapshots + nightly `pg_dump` to Spaces)
- [ ] Publish `@ahosaji/sdk` to npm (currently `private`)

---

## Known issues / cleanup backlog

Verified by a read-only audit on **2026-06-14** (no code changed). These are the gap between "git HEAD" and "shippable v1".

### Blockers (before ship)
- [ ] **`apps/api` fails `tsc --noEmit`** — 7 type errors in `lib/versification.ts:103` + `routes/parallel.ts` (139/143/188/189/202/231), introduced by the `prefer_aligned` commit `f8c9524`. `ingest` and `sdk-ts` typecheck clean.
- [ ] **Versification index drops verses on N:1 reverse mappings** (`lib/versification.ts:78-87`). When two source refs map to the same target (e.g. ar `JDT.4.16` and `JDT.4.17` both → en `JDT.4.15`), the reverse lookup silently returns only one. Affects JDT ch4, 1MA ch1. Fix = accumulate entries per ref (array), not overwrite.

### Correctness / parity
- [ ] **GraphQL & MCP `parallel` are identity-only** — versification mapping + `prefer_aligned` exist only in the REST route (`routes/parallel.ts`). A Deutero parallel returns `present:false` via GraphQL/MCP where REST surfaces a mapped equivalent. Factor mapping into a shared service used by all three transports.
- [ ] **`routes/bible.ts:110-111` mutates raw `structured` JSONB** — assigning onto a `null`/array value throws an unhandled 500. Build a guarded new object (mirror the MCP spread).
- [ ] **`SIR.json` maps a non-existent chapter 52** (13 `null` entries `SIR.52.1-13`) — both SIR snapshots stop at ch51. Either the ar SIR snapshot is **missing a Vulgate-only ch52 doxology** (real data gap) or the entries are spurious. Reconcile.

### Robustness / hygiene
- [ ] Meilisearch filter values are quote-stripped, not escaped/validated (`search.ts`, `graphql/resolvers.ts`, `mcp/tools.ts`) — centralize escaping, validate enum filters.
- [ ] `perDay` rate limits are defined but never enforced (`plugins/rateLimit.ts`, `auth.ts`).
- [ ] Auth lookup cache is unbounded and keyed by the plaintext token (`auth.ts`) — bound it and key by sha256.
- [ ] Cross-references near-empty: only `crossrefs/JHN.3.json` (~0.07% of chapters). Ingest the public-domain openbible.info TSK CSV before `load:postgres`.
- [ ] Stale comments: `bible.ts:2-4` "auth not yet wired" (auth IS global), `parallel.ts:6-10` "versification lands in v1.1" (it's implemented).
- [ ] Pre-release placeholders: `version 0.0.0`, `github.com/yourname/ahosaji`, `api.ahosaji.example`, `license: TBD`.
- [ ] `books.json` comment says "73-book" (actually 78); deutero source-flags understate actual coverage.

### Verified good (no action)
Auth is globally enforced (the stale comment notwithstanding); all SQL is parameterized (no injection); migrations `0001`–`0003` are consistent with every loader/route/GraphQL/MCP query; 78/78 en+ar snapshots are real content with no orphans; the 9 versification tables are valid and schema-conformant.
