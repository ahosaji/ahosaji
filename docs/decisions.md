# Ahosaji — Key Decisions Log

> Historical decision log. Current runtime, credential and deployment instructions are in [DEPLOY.md](../DEPLOY.md) and [operations](./operations.md). Cost estimates and future-file references below are dated design notes.
Lightweight ADR-style record. Each entry has the date it was made, the decision, the alternatives considered, and the reason.

---

## 1. Project name: **Ahosaji** (ⲁϩⲟ ⲥⲁϫⲓ)

**Date**: 2026-04-30
**Decision**: Pure Coptic compound — *Aho* (treasure / storehouse) + *Saji* (the Word, native Coptic counterpart to the Greek-borrowed *Logos*). Combined: "Treasure of the Word."
**Alternatives considered**: Pirē (the Sun), Pishai (the dawning), Berri (the new), Onkh (life), Pharos (Lighthouse of Alexandria), Pericope, Agpeya, Theoryx, Keryx, Theoros, Theira.
**Why**: Mission fit (the API IS a treasury of the Coptic Orthodox textual heritage), pure Coptic origin (no Greek/Arabic borrowing), coined compound (no domain collisions expected), pronounceable.

## 2. Two translations in v1: `en` + `ar`

**Decision**: English (English protocanonical + English Deuterocanonical) and Arabic (Arabic via an Arabic source, full canon).
**Alternatives**: Single language. Adding Coptic. Adding NRSV/KJV.
**Why**: Coptic Orthodox diaspora is bilingual ar/en; Coptic-language Bible is liturgical-use rather than reading-study and would multiply work.

## 3. Identifier scheme: USFM 3-letter codes

**Decision**: `JHN`, `GEN`, `TOB`, `PS2`, `DAG`, `ESG`, etc. Industry standard from SIL/Bible societies.
**Alternatives**: OSIS, numeric ordinals, English/Arabic slugs.
**Why**: Stable, language-neutral, supported by every Bible tool. URLs read clean.

## 4. URL scheme: verbose nested + `/passages` endpoint

**Decision**: Canonical paths under `/v1/translations/:code/books/:usfm/chapters/:n/verses/:v`. Cross-chapter ranges via `/v1/passages`. Optional short aliases (`/v1/en/JHN/3/16`) 302-redirect to canonical.
**Alternatives**: Path-based dash ranges, single freeform `?ref=` param.
**Why**: Self-documenting, clean codegen, avoids single-chapter-book ambiguity.

## 5. Verse richness: Option 4 (dual-format)

**Decision**: Each verse returns both plain `text` and `structured` (tokens with red-letter/italic flags, footnotes, headings, paragraphs).
**Alternatives**: Plain text only; structural skeleton only.
**Why**: One-time ingestion cost, then any client (chatbot, study app, parallel reader) gets exactly what it needs.

## 6. Cross-translation enrichment scope

**Date**: 2026-05-01
**Decision**: Transfer only what's translation-independent. Specifically:
- ✅ **Red-letter** (Jesus' words) — verse-level mapping en→ar for protocanonical NT
- ✅ **Cross-references** — TSK-derived for protocanonical books
- ❌ **English italics** (added-words) — English-specific convention; Arabic adds different words
- ❌ **Footnotes** — each tradition has tradition-specific content
- ❌ **Heading invention/translation** — extract what each source already has; don't invent
**Why**: Red-letter is a property of the original Greek (who's speaking), not the translation. Italics and footnotes are translation-specific. Headings are publisher-editorial; transferring them across languages requires translation work that adds editorial layer risk.
**Note**: Deuterocanonicals get NO red-letter (Jesus not speaking in OT) and limited cross-refs (TSK doesn't cover them). Their enrichment comes later via lectionary domain (liturgical-use markers — *very* Coptic-relevant for Tobit/Wisdom/Sirach) and commentary domain (the editor).

## 7. Deuterocanonical English source: stay with English

**Date**: 2026-05-01
**Decision**: Keep English English Deuteros despite verse-count divergence with Arabic Arabic (TOB 1: 22 vs 25). Use per-book versification mapping tables for parallel queries.
**Alternatives considered**: Swap to another edition (matches Vulgate verse counts of Arabic).
**Why rejected swap**: another edition is significantly more archaic English (thee/thou, Latinisms, ~grade 12 reading age) — would create tonal whiplash with English protocanonical. another edition is also Catholic-affiliated, not Coptic Orthodox. English is the closest thing to a Coptic-Orthodox-aligned English Bible (the academy editorial, widely used in Coptic Orthodox diaspora).
**Cost of staying with English**: must curate versification mapping tables for ~7 Deutero books (Tobit, Judith, Sirach, Maccabees, Daniel additions, Esther additions). Deferred to v1.1.

## 8. Storage: self-hosted DigitalOcean

**Decision**: Single $12/mo droplet with Postgres + Meilisearch + Caddy + Node API in Docker Compose. Cloudflare free tier in front for CDN/TLS/DDoS/cache.
**Alternatives**: Vercel + Marketplace Postgres; AWS/GCP managed; DigitalOcean App Platform.
**Why**: Self-hosting fits user preference; Docker Compose keeps it portable; Cloudflare handles edge concerns; total cost ~$14/mo all-in.

## 9. Search engine: Meilisearch

**Decision**: Self-hosted Meilisearch. `SearchService` interface so Elasticsearch can swap in later.
**Alternatives**: Postgres FTS, Elasticsearch, Typesense.
**Why**: Bible corpus is tiny (~5MB per translation); Meilisearch handles Arabic tokenization well out of the box; single-binary ops (no JVM); fits on the $12/mo droplet alongside everything else.

## 10. Local dev environment: native Node, Docker only for services

**Decision**: Run Node + pnpm natively on the dev machine (via mise). Postgres + Meilisearch + Caddy run in Docker Compose. The same Dockerfile builds the API for prod deploy.
**Alternatives**: Full dev containerization (VS Code Dev Containers).
**Why**: macOS Docker bind-mount IO is 5–10× slower than native; native Node keeps `tsx` watch mode and TypeScript language server fast. Docker still owns the deploy pipeline.

## 11. API access: API keys required from day 1

**Decision**: Bearer-token API keys required for all non-discovery endpoints. Admin-issued in v1; self-serve signup deferred.
**Alternatives**: Fully public, public-with-optional-keys.
**Why**: License-compliance traceability (English redistribution); per-consumer rate-limit + analytics; revocability against abuse; soft-monetization path if ever needed.

## 12. MCP as third transport

**Decision**: `/v1/mcp` Streamable HTTP transport alongside REST and GraphQL. Bearer-token auth (same key store). Public discovery (tools/list, resources/list); gated invocation (tools/call, resources/read).
**Alternatives**: REST+GraphQL only; defer MCP to v1.1.
**Why**: MCP is the unified transport for Claude Desktop/Code/API, ChatGPT Connectors, Cursor, Windsurf, Continue, Cline. Adding it at design time means Ahosaji is a one-click data connector inside any AI surface.

## 13. PDF extractor: Python sidecar (PyMuPDF)

**Decision**: Python sidecar invoked via `child_process.spawn` for PDF parsing.
**Alternatives**: Pure-Node libraries (pdf-parse, pdfjs-dist).
**Why**: PyMuPDF handles structured PDF extraction meaningfully better than any Node library, especially for our use case (TOC bookmarks, page-text extraction with positional info, no-JS-environment-friendliness).
