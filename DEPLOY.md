# Deploy runbook — Ahosaji API

Concise production runbook. Assumes a single Linux host (e.g. a DigitalOcean
droplet) running Docker + Docker Compose, Node 22, pnpm 9, and Caddy.

> Manual TODOs (infra provisioning — **not** automated by this repo):
> - [ ] **Provision the DigitalOcean droplet** (Ubuntu LTS, ≥2 GB RAM).
>       Install Docker, Docker Compose, Node 22, pnpm 9, Caddy.
> - [ ] **Register / configure the domain** `ahosaji.dev` and point an
>       `A`/`AAAA` record for `api.ahosaji.dev` at the droplet's IP **before**
>       starting Caddy (ACME TLS validation needs working DNS).
> - [ ] Before going public, scrub copyrighted data per `NOTICE.md`.

---

## 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, MEILISEARCH_HOST, MEILISEARCH_MASTER_KEY,
# and (prod) MEILISEARCH_SEARCH_KEY. For prod, also set HOST=127.0.0.1 so the
# Fastify app binds loopback-only behind Caddy.
```

The API fails fast at startup if `DATABASE_URL`, `MEILISEARCH_HOST`, or
`MEILISEARCH_MASTER_KEY` are unset.

Infra container env:

```bash
cp infra/postgres.env.example      infra/postgres.env
cp infra/meilisearch.env.example   infra/meilisearch.env
# Edit both — use strong values in prod (do NOT keep the *-local-dev-only keys).
```

## 2. Start datastores (Postgres + Meilisearch)

```bash
docker compose -f infra/docker-compose.yml up -d
# Postgres → host port 5433, Meilisearch → host port 7701 (see docker-compose.yml).
# Wait for both healthchecks to report healthy:
docker compose -f infra/docker-compose.yml ps
```

## 3. Run database migrations

Migrations are plain SQL in `migrations/`, applied in order:

```bash
for f in migrations/0001_init.sql migrations/0002_consumers_keys.sql migrations/0003_book_order_numeric.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## 4. Load data

```bash
pnpm install --frozen-lockfile

# Postgres: translations, books, verses, versification, cross-refs.
pnpm --filter @ahosaji/ingest load:postgres

# Meilisearch: search index (uses MEILISEARCH_MASTER_KEY as the indexer key).
pnpm --filter @ahosaji/ingest load:meilisearch
```

> ⚠️ Only load data you are licensed to host. See `NOTICE.md` — the
> copyrighted English (English / English) snapshots are not redistributable.

## 5. Mint an admin API key

```bash
pnpm --filter @ahosaji/api keys:create -- --email you@example.com --tier admin
# Prints the plaintext key ONCE — save it now (only the hash + prefix are stored).
```

Tiers: `free | church | paid | admin`.

## 6. Provision a Meilisearch search-only key

The API query path should use a scoped **search-only** key, not the master key.
Create one against the running Meilisearch with the master key, then set it as
`MEILISEARCH_SEARCH_KEY` in `.env` (the app falls back to the master key only
when this is unset):

```bash
curl -s -X POST "$MEILISEARCH_HOST/keys" \
  -H "Authorization: Bearer $MEILISEARCH_MASTER_KEY" \
  -H 'Content-Type: application/json' \
  --data '{
    "description": "ahosaji API search-only",
    "actions": ["search"],
    "indexes": ["*"],
    "expiresAt": null
  }'
# Copy the returned "key" into MEILISEARCH_SEARCH_KEY in .env.
```

## 7. Boot the API behind Caddy

Run the Fastify app bound to loopback (`HOST=127.0.0.1 PORT=3001`):

```bash
pnpm --filter @ahosaji/api build
HOST=127.0.0.1 PORT=3001 pnpm --filter @ahosaji/api start
# (Run under a process manager — systemd / pm2 — in production.)
```

Then start Caddy (terminates TLS, proxies to 127.0.0.1:3001, adds security
headers):

```bash
caddy run --config infra/Caddyfile
```

## 8. Smoke-test

```bash
curl -s https://api.ahosaji.dev/v1/healthz   # {"status":"ok","db":"ok"}
curl -s https://api.ahosaji.dev/v1/info      # {"version":"0.1.0", ...}
```
