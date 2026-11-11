# Operations

These are repository procedures, not a statement that production has been
reconfigured. Live firewall rules, proxy networks, scoped Meilisearch keys,
backup scheduling, off-host copies and production restore history must be
verified separately. No production database is needed for the tests below.

## Deployment order and credentials

Install the pinned Node and pnpm versions and run `pnpm install --frozen-lockfile`.
Use separate environment files for serving, migrations/key administration and
indexing. Never put an operator or indexing environment into the API process.

- Serving: `NODE_ENV=production`, `DATABASE_URL` for a runtime database role,
  `MEILISEARCH_HOST`, `MEILISEARCH_SEARCH_KEY`, `HOST`, `PORT` and the verified
  `TRUSTED_PROXY_CIDRS`. The production API refuses a Meilisearch master key.
- Migrations and explicit key issuance: `MIGRATION_DATABASE_URL` (preferred)
  or `DATABASE_URL`. These commands need no search credentials. Keep this
  privileged URL out of the serving environment.
- Indexing: its own database credentials and `MEILISEARCH_MASTER_KEY`; do not
  run a replacement loader against production as a deployment smoke test.

Apply migrations in a separate deployment step before starting the API:

```sh
pnpm --filter @ahosaji/api migrate
pnpm --filter @ahosaji/api start
```

The migration command only applies migrations. API startup never applies
migrations or creates credentials. The root `migrations/` directory is the sole SQL authority;
ship it with the application. Run operator commands from their package scripts
so Node loads the intended environment file. For a deployment with a separate
operator environment, invoke Node from `apps/api` with an explicit protected
environment file instead:

```sh
node --env-file=/etc/ahosaji/operator.env --import tsx src/cli/bootstrap.ts
```

An exclusive PostgreSQL advisory lock serializes cooperating runners. Each
pending migration and its tracking record run in one transaction. The runner
rejects unknown recorded versions and changed checksums; investigate these
errors instead of deleting tracking rows. Migration SQL must support execution
inside a transaction and must not manage its own transaction boundaries.

Legacy databases record `0001_init`, `0002_consumers_keys` and
`0003_book_order_numeric` without checksums. Their first run records the
checksum of the reviewed SQL without reapplying it. This is trust on first use,
not retrospective proof that the deployed schema matches the repository.
Review the old migration history and take a backup before that upgrade.
Subsequent edits to an applied migration fail checksum validation; write a new
migration instead. Keep backups and the previous application artifact before
an upgrade. Roll back application code only when it remains compatible with
the new schema; a database rollback requires a separately reviewed recovery
plan, not deleting rows from `schema_migrations`.

## Explicit API keys

Issue keys in a private operator terminal. Automation must choose a new file:

```sh
pnpm --filter @ahosaji/api keys:create -- --email operator@example.com --tier admin --output /secure/private/initial-api-key
```

The parent directory must already exist and should have mode `0700`. The CLI
creates the key file exclusively with mode `0600`; it refuses to overwrite an
existing file. Without `--output`, plaintext is allowed only on an interactive
terminal. Plaintext never appears in the file-mode status message. Store the
key in the intended secret manager and remove the local copy according to
your operator procedure. Avoid shell tracing, terminal recording and deploy
logs for key issuance. Existing consumers keep their existing tier.

If a historical bootstrap key was captured by logs, inspect that specific
key's use and revoke/replace it explicitly under the credential owner's
authorization. Ordinary migration/startup never rotates or recreates keys.

## Network and proxy boundary

Compose publishes PostgreSQL at `127.0.0.1:5433` and Meilisearch at
`127.0.0.1:7701`. For an API running in the same Docker network, remove both
`ports` entries entirely and use service DNS names and container ports. Keep
the host firewall restrictive as an independent control. Do not expose a
datastore port to make a remote administrator connection; use the approved
private network or tunnel.

For the host Caddy configuration, bind the API with `HOST=127.0.0.1 PORT=3001`.
Set `API_DOMAIN` in Caddy's own process environment to the actual public
hostname; the checked-in Caddyfile has no default hostname. Caddy does not
load the API's `.env` file. Validate before reloading:

```sh
API_DOMAIN=api.example.com caddy validate --config infra/Caddyfile --adapter caddyfile
```

Access logs go to stdout; arrange rotation/retention in the service manager.
For host Caddy forwarding over IPv4 loopback, the API's immediate trusted
proxy is `TRUSTED_PROXY_CIDRS=127.0.0.1/32`. Include `::1/128` only when that
path is used. For container ingress, enumerate the actual ingress address or
CIDR visible to the API. An empty list preserves direct-client behavior.
Never use a blanket trusted-proxy switch or broad internet CIDRs. If a CDN
precedes Caddy, establish and validate Caddy's CDN trust boundary separately;
do not assume forwarding headers from arbitrary peers are authentic.

## PostgreSQL backups and restore rehearsal

The helpers require Docker, the PostgreSQL 16 image and Python 3 on a Unix
host. They do not need host PostgreSQL clients or database passwords in command
arguments. Run them as the account authorized to access the source container.

```sh
# Default source: this repository's Compose postgres service.
bash infra/scripts/backup-postgres.sh --directory /secure/ahosaji-backups --keep 30

# Explicit source for a disposable test fixture or an approved container.
bash infra/scripts/backup-postgres.sh --container ahosaji-postgres --directory /secure/ahosaji-backups --keep 30

# Pass one completed dump path; there is deliberately no target database URL.
bash infra/scripts/restore-rehearsal.sh /secure/ahosaji-backups/ahosaji-<timestamp>-<id>.dump
```

Backups use `pg_dump` custom format with ownership/ACL restoration disabled.
The source database/user come from the container's `POSTGRES_DB` and
`POSTGRES_USER` (PostgreSQL defaults apply when absent). The helper creates a
mode-`0700` directory and mode-`0600` files under a restrictive umask. Existing
backup directories must already be owned by the operator and mode `0700`.
An advisory file lock prevents overlapping helper runs. A dump is complete
only after its SHA-256 sidecar is finalized; incomplete temporary artifacts
are cleaned up on failure. Archive listing is checked before finalization.

Retention keeps the newest `--keep` completed helper-named dump/checksum
pairs by modification time. This is a count of backups, not a number of days.
Unrelated files, unpaired dumps and symlinks are excluded. Retention is local;
schedule it explicitly, arrange encrypted off-host copies with their own
retention, and monitor command failures and backup age. A directory mounted
into the source database container is unnecessary and is no longer configured.
Meilisearch indexes can be rebuilt using the validated ingestion workflow;
these helpers cover PostgreSQL only, not credentials or infrastructure state.

The rehearsal checks the checksum before starting a new container. It uses
`--network none`, no published ports, a tmpfs PostgreSQL directory and fresh
test-only credentials. It mounts no production volumes or environment files.
Restore uses `--exit-on-error --single-transaction`; the helper reports the
restored translation, book, verse and migration counts and then removes the
container. Compare counts and application smoke checks with the intended
backup baseline. A successful archive listing or checksum alone is not a
successful restore. Large databases need enough memory for the tmpfs drill;
use a separately reviewed isolated staging recovery plan if they do not fit.

## Verification and recorded scope

Run the operator regression suite from `apps/api`:

```sh
node --import tsx --test ops-test/*.test.ts
TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/isolated_test_db node --import tsx --test ops-test/*.test.ts
```

Database tests create and drop unique schemas in `TEST_DATABASE_URL`; never
point it at production. Without that variable, integration coverage is skipped
and must not be reported as passing. Script tests use a fake Docker executable
for permissions, checksum, retention and network-isolation assertions; a real
isolated rehearsal remains necessary.

On 2026-11-10 the helper was exercised against a disposable PostgreSQL 16
container containing one synthetic translation, book and verse and four
applied migrations. The separate network-isolated restore reported those
counts successfully. This verifies the fixture workflow, not production
backups, off-host recovery, scheduling or infrastructure controls. Code
licensing and dataset permissions/content remain unchanged; CLEAN-04 and
CLEAN-05 are deferred.
