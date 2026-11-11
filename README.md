# Ahosaji

**Treasure of the Word** (Coptic: ⲁϩⲟ ⲥⲁϫⲓ) — a Coptic Orthodox content API.

The Bible domain exposes Arabic and English content through REST, GraphQL and
MCP, with full-text search, structured verses and versification-aware parallel
queries. Lectionary, Synaxarium and Agpeya remain future domains.

## Local development

The copy commands below are for a new checkout. For an existing `.env`, merge
the new settings from the template rather than overwriting your private values.

Use the pinned Node **22.23.4**, pnpm **9.12.0**, and Python from
[.tool-versions](./.tool-versions). Python/PyMuPDF are needed for PDF extraction;
the ordinary regression suite does not need the source PDF or provider keys.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
cp infra/postgres.env.example infra/postgres.env
cp infra/meilisearch.env.example infra/meilisearch.env
# Review the local-only configuration before starting services.
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @ahosaji/api migrate
pnpm validate
pnpm --filter @ahosaji/ingest load:postgres
pnpm --filter @ahosaji/ingest load:meilisearch
pnpm --filter @ahosaji/api dev
```

The example datastore credentials are for isolated local development only.
Ports are published on loopback. Loading replaces selected content, so review
[validation and ingestion](./docs/ingestion.md) before importing elsewhere.
Source scraping additionally requires explicit approved endpoints/version and
PDF configuration; there are no personal-path or provider defaults.

Startup does not mint API keys or apply migrations. Issue a key explicitly in
a private operator terminal, or use a new protected output file for automation:

```sh
pnpm --filter @ahosaji/api keys:create -- --email you@example.com --tier free --output /private/key-file
```

The parent directory must already exist and be private. The command creates
that file exclusively with mode 0600; never place keys in deploy logs or Git.

## Verification

```sh
pnpm -r typecheck
pnpm test
pnpm test:python
pnpm validate
pnpm audit --prod --audit-level high
```

PostgreSQL integration tests run only with an explicitly isolated
`TEST_DATABASE_URL`; otherwise they report skips. CI supplies its own disposable
database. The validator preserves existing compatibility/editorial warnings and
does not rewrite the corpus.

## API and deployment

Local discovery begins at `http://127.0.0.1:3001/v1/info`; API reference and SDK
pages are under `/docs/`. Configure the deployed base URL explicitly in clients.
See [SDK usage](./packages/sdk-ts/README.md), [security controls and limits](./docs/security.md),
[deployment](./DEPLOY.md), and [operations/restore](./docs/operations.md).

Production serving requires a search-only Meilisearch key and rejects a master
key. Apply migrations separately before serving and configure the exact trusted
proxy boundary. A repository check passing does not establish live deployment,
backup or firewall status.

## Workspace

- `apps/api/`: Fastify REST, GraphQL and MCP serving, operator commands and tests.
- `ingest/`: configured scrapers, validation, safe loaders and extraction tools.
- `migrations/`: canonical tracked PostgreSQL migrations.
- `packages/sdk-ts/`: generated TypeScript REST client and SDK documentation.
- `infra/`: isolated datastore recipe, Caddy and backup/restore helpers.

[Roadmap](./docs/roadmap.md) describes current work. [PLAN.md](./PLAN.md) and
[decisions](./docs/decisions.md) retain historical design context. Code licensing
and source-data permissions/content are unchanged; their review is deferred by
the owner.

## Community

Join [Discussions](https://github.com/ahosaji/ahosaji/discussions) for questions
and ideas, or [report an issue](https://github.com/ahosaji/ahosaji/issues/new/choose).
Read [Contributing](./CONTRIBUTING.md), [Code of Conduct](./CODE_OF_CONDUCT.md),
[Support](./SUPPORT.md) and [Security Policy](./SECURITY.md). Report vulnerabilities
privately rather than including credentials or exploit details in public issues.
