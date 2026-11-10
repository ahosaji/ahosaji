# Deploying Ahosaji

This runbook describes the hardened repository. It does not claim that an
existing production instance has been upgraded. Source-data permissions and
code licensing remain unchanged; their review is deferred by the owner.

## 1. Prepare an isolated release

Install the pinned Node 22.23.4 and pnpm 9.12.0. Run the frozen install,
typechecks, tests, Python tests, corpus validation and production audit from
[README.md](./README.md). Ship root `migrations/` and `docs/api/` with the release.
Keep local `.env`, browser artifacts, review reports and credentials out of the
release artifact. The repository does not currently provide an API Dockerfile;
use an explicitly configured process manager/container build for your platform.

## 2. Separate credentials

Use the production templates as an inventory, not live credentials:

- [.env.api.example](./.env.api.example): serving database role, search-only key,
  host/port, mode and exact trusted proxy CIDRs.
- [.env.ingest.example](./.env.ingest.example): authorized indexing/loading role
  and Meilisearch master credential; only run in the operator environment.
- Migration/key operator: `MIGRATION_DATABASE_URL` (or its own `DATABASE_URL`),
  separate from the serving process. No Meilisearch credential is needed.

The production API requires `NODE_ENV=production`, `DATABASE_URL`,
`MEILISEARCH_HOST` and `MEILISEARCH_SEARCH_KEY`. It refuses a serving environment
containing `MEILISEARCH_MASTER_KEY`. Remove old master/indexing/migration secrets
from the API's service variables before enabling the new release. Do not ship a
combined local-development `.env` to production.

Create a search-only key using an authorized private operator channel, with
`actions: ["search"]` and `indexes: ["verses_en", "verses_ar"]`. Keep master
credentials and returned secrets out of shell tracing, logs and request URLs.
For a host deployment, bind the API to loopback and trust only the actual
immediate proxy. For container ingress, use its verified internal network.

## 3. Isolate stores and verify recovery

The local Compose recipe publishes only `127.0.0.1:5433` and
`127.0.0.1:7701`; use strong operator-provided credentials outside local
fixtures. On a shared container network, remove host ports and use service DNS
names instead. Keep independent firewall controls.

Before an upgrade, take an authorized PostgreSQL backup and rehearse it in the
isolated restore helper. [Operations](./docs/operations.md) documents restrictive
permissions, checksum/retention rules, a no-network restore container and
rollback considerations. Verify the actual production schedule, encrypted
off-host copy and retention; the fixture rehearsal does not attest to these.

## 4. Apply tracked migrations explicitly

From `apps/api`, with only the operator environment:

```sh
node --env-file=/etc/ahosaji/operator.env --import tsx src/cli/bootstrap.ts
```

For local development, `pnpm --filter @ahosaji/api migrate` loads the optional
root `.env`. Root `migrations/` is the sole authority. The runner serializes
with a PostgreSQL advisory lock, skips recorded versions, and records new SQL
and checksums transactionally. Do not alter applied SQL or delete migration
records to bypass an error. Legacy checksum backfill is trust on first use;
review the existing migration history and backup before that first upgrade.

Migration `0004_api_usage` must exist before serving authenticated requests.
It supplies shared finite UTC minute/day quota counters. Existing API keys and
tier budgets are retained. Startup never issues a replacement admin key.

## 5. Load only validated, approved content

Loading is a separate authorized replacement operation, not an upgrade smoke
test. Use the protected indexing environment and follow
[ingestion](./docs/ingestion.md). Validate all data before connecting to the
replacement target. Use `--allow-partial` only after reviewing the exact book
replacement scope; it never allows malformed or empty content.

The PostgreSQL loader preflights all inputs then uses a transaction. The search
loader builds verified staging indexes and publishes languages with one atomic
swap. Keep the prior release and a recovery plan; do not repair a failed import
by disabling validation or ignoring failed tasks.

## 6. Start serving and the proxy

For a host process, from `apps/api`:

```sh
node --env-file=/etc/ahosaji/api.env --import tsx src/index.ts
```

That file should supply `HOST=127.0.0.1`, `PORT=3001`, the scoped query credential
and verified trusted proxy CIDRs. Migrations were already applied separately;
there is no privileged prestart step. Supervise the process with your platform's
service manager and configure restart/log retention.

Set `API_DOMAIN` in Caddy's own environment to the actual public hostname and
verify its DNS and certificate prerequisites. Caddy does not load the API env:

```sh
caddy validate --config infra/Caddyfile --adapter caddyfile
caddy run --config infra/Caddyfile
```

See [operations](./docs/operations.md) for proxy/CDN trust boundaries. Do not use
`trustProxy: true` or expose the API directly to make forwarded headers work.

## 7. Verify the release

Use the actual deployed HTTPS base URL:

```sh
curl --fail "$API_BASE_URL/v1/healthz"
curl --fail "$API_BASE_URL/v1/info"
```

Use a scoped test consumer privately to verify authorized REST, GraphQL and MCP
content, quota parity, ordinary parallel/search queries and generic errors.
Check that rejected over-budget calls do no resolver work. Review service logs
using request IDs without copying credentials into public reports. Confirm
actual ports, proxy addresses, search-key scopes, backup age and rollback
readiness. Neither a passing GitHub check nor this runbook replaces those live
checks. Production rollout is separate from merging a repository change.
