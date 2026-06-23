# Ahosaji

**Treasure of the Word** (Coptic: ⲁϩⲟ ⲥⲁϫⲓ) — Coptic Orthodox content API.

Bible (Arabic + English), Lectionary (Katameros), Synaxarium, Agpeya — exposed via REST, GraphQL, and MCP for AI agents.

See [`PLAN.md`](./PLAN.md) for architecture and roadmap.

## Local development

Prerequisites:

- Node 22 LTS (use [`mise`](https://mise.jdx.dev) or `nvm` — version pinned in `.tool-versions` / `.nvmrc`)
- pnpm 9+ (installed via mise from `.tool-versions`, or `corepack enable`)
- Python 3.13 (used by the English PDF extractor sidecar; later)

```sh
# Install Node + pnpm + Python via mise (one-shot)
mise install

# Install workspace dependencies
pnpm install

# Copy env template and fill in your secrets
cp .env.example .env
$EDITOR .env

# Run the ingest workspace placeholder
pnpm --filter @ahosaji/ingest dev
```

## Workspace layout

This is a pnpm monorepo. v1 ships the Bible domain end-to-end; future domain packages (lectionary, synaxarium, agpeya) and deployment land in v1.1. See `PLAN.md` and `docs/roadmap.md`.

```
ahosaji/
├── ingest/          # data ingestion (scrapers, English PyMuPDF sidecar, Postgres/Meili loaders, validator)
├── apps/api/        # Fastify server — REST + GraphQL + MCP, API-key auth, /docs (Scalar + TypeDoc)
├── packages/sdk-ts/ # @ahosaji/sdk — OpenAPI-generated TypeScript client
├── migrations/      # Postgres schema (0001–0003)
└── infra/           # docker-compose for Postgres + Meilisearch
```
