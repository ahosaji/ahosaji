# Repository security and cleanup implementation plan

> For agentic workers: use focused implementation and independent spec/code review; keep changes isolated and verify behavior before integration.

Goal: implement the selected repository security and cleanup fixes without weakening CI, exposing credentials, or changing dataset/code licensing.

Architecture: preserve the REST/GraphQL/MCP contracts while sharing runtime validation, authentication and quota enforcement. Use existing Postgres for durable consumer usage, restrict expensive operations before database work, and validate complete ingestion inputs before changing stores. Keep runtime serving credentials separate from indexing and operator credentials.

Stack: Node 22, pnpm 9.12.0, TypeScript, Fastify, GraphQL Yoga, MCP SDK, PostgreSQL, Meilisearch, Python extraction tools, GitHub Actions.

Baseline: d676294 includes PR #1's checksum/SDK typing/bootstrap typing repairs. Public main remains 0e0d770. Existing production audit reports 130 vulnerabilities. The existing validator rejects 156 wrappers then crashes. These are the approved failures to repair; original checkout's untracked audit reports and REMAINING_ITEMS.md are preserved.

Owner steering (2026-11-10): keep code license and dataset permissions/content as-is. CLEAN-04 and CLEAN-05 are deferred, not completed. Preserve the shared doctl credential. Do not revoke or rotate unrelated credentials. Do not run destructive loaders against production.

## 1. Dependencies, runtime and GitHub controls

- [x] DEP-01: update compatible production dependencies and transitive resolutions; retain the audit gate and review any remaining advisory before choosing a major upgrade. Files: package.json, apps/api/package.json, ingest/package.json, packages/sdk-ts/package.json, pnpm-lock.yaml.
- [x] OPS-03: query Node's official release index, select the newest patched Node 22 release, align .nvmrc, .tool-versions, package engines and CI policy.
- [x] GH-01: enable secret scanning and push protection through repository API; read back both statuses.
- [x] GH-02: enable automated security fixes; add grouped weekly pnpm/GitHub Actions update configuration with reviewed PRs.
- [x] GH-03: pin checkout/setup-node/pnpm actions to verified upstream commit SHAs; explicitly grant contents: read. Preserve required check name `typecheck + audit`.
- [x] CI-01: add workspace tests and repaired corpus validation to CI; add secret scanning and a reviewed code-scanning workflow. CI Postgres service supplies an isolated test database for quota/migration integration tests.

Verification: `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @ahosaji/ingest validate`, `pnpm audit --prod --audit-level high`. No ignored audit failures or relaxed integrity checking.

## 2. API abuse limits, validation and quota parity

Files: apps/api/src/auth.ts, plugins/auth.ts, plugins/rateLimit.ts, index.ts, env.ts, db.ts, graphql/server.ts, graphql/resolvers.ts, mcp/server.ts, mcp/transport.ts, mcp/tools.ts, routes/parallel.ts, routes/search.ts, lib/parallelService.ts; new focused security helpers and apps/api/test/*.test.ts; new root migrations/0004_api_usage.sql.

- [x] API-01: test invalid-key bursts before implementing a coarse onRequest IP limiter; apply it before key lookup. Validate the generated key format. Set finite connection/query budgets and avoid unbounded lookup queues.
- [x] API-02: reject over-budget GraphQL documents before execution, including shallow aliases and expanded fragment work. Depth alone is insufficient. Publish operation limits and exercise real schema/resolvers with stub I/O.
- [x] API-03: enforce one shared parallel input contract: known/deduplicated translation codes, maximum 10 translations and at most 1000 expanded verses. Enforce tool JSON schemas at runtime before any MCP handler. Test invalid types, over-limit arrays, duplicate lists and range expansion. Batch identity queries where feasible.
- [x] API-04: resolve optional MCP authentication into request consumer before shared quota hooks; keep anonymous introspection public and content authenticated.
- [x] HARD-01: store finite per-consumer minute/day counters atomically in Postgres, expire by defined UTC windows and revalidate keys so revocation/tier changes do not retain a positive global cache. Test cross-instance counters and revocation; document request-based metering.
- [x] API-06: configure exact trusted proxy addresses/CIDRs through validated environment settings, never blanket trust. Test forwarded IP spoofing outside the trust boundary and client isolation within it. Preserve safe direct deployment defaults.
- [x] API-07: generic client-facing backend failures with correlation IDs and detailed server-side logs. Reject malformed numeric/query input before backend work.
- [x] OPS-02: production API accepts only a scoped search key and does not retain a master key in exported runtime configuration. Development fallback is explicit. All three transports use one query-client helper.

Test pattern: `node --import tsx --test test/*.test.ts`; use dependency injection for auth/quota/backend boundaries, Fastify.inject and Yoga.fetch for actual request hooks. PostgreSQL-backed tests use only TEST_DATABASE_URL and an isolated schema/database; never import the user's local environment.

## 3. Explicit bootstrap and tracked migrations

Files: apps/api/src/cli/bootstrap.ts, cli/keys.ts, new migration runner/helpers and tests, apps/api/package.json, root migrations/; remove duplicate apps/api/migrations after canonical runner is verified.

- [x] API-05: prestart/migrate only applies migrations; it never creates or prints an API key. Keep issuance an explicit operator command with controlled output, not ordinary deployment logs. Test migration-only startup never invokes issuance.
- [x] OPS-04: root migrations is the sole authority. Run unapplied versions under an advisory lock/transaction and validate version checksums where practical. Test fresh database, repeat run and concurrent run. Existing recorded 0001–0003 must not be reapplied destructively.

## 4. Data validation and safe replacement

Files: ingest/src/validate.ts, scripts/validate-all.ts, scripts/load-postgres.ts, scripts/load-meilisearch.ts, shared focused helpers and ingest/test/*.test.ts.

- [x] DATA-01: support book wrappers and chapter records; validate wrapper/file identity, chapter coverage and required structure. Alignment reports operate on nested chapters. Distinguish genuine corpus warnings from invalid import shape.
- [x] DATA-02: parse and validate every input before opening the replacement transaction. Empty/unsupported input fails before any DELETE; intentional partial/empty imports require explicit separate options. Test valid JSON `{}`, missing chapters, mismatched identity and no-mutation failure.
- [x] DATA-03: treat non-succeeded tasks as failures. Build temporary indexes, validate counts/settings, atomically swap only after all indexing succeeds, and remove only known staging artifacts. Preserve existing index on failure. Test failed/canceled tasks and failed swaps with a fake client; integration tests may use a local ephemeral service only.
- [x] DATA-04: collect scraper failures, emit a completeness manifest and exit nonzero for partial work by default. An explicit allow-partial option supports intentional manual workflows. Test aggregator behavior and preserve failed chapter information.

## 5. Portable configuration and public hygiene

Files: .env.example, ingest/src/env.ts, ingest/package.json, ingest/python/*.py, scraper sources, .gitignore, docs/scrapers/*.

- [x] CLEAN-01: one SOURCE_PDF_PATH/--pdf interface; remove all machine-specific path defaults in tracked code/docs. Do not run a blanket replacement over data or lockfile hashes.
- [x] CLEAN-02: repair PDF variable aliases, fail clearly for missing/invalid source URLs, use explicit configured source endpoints instead of bogus defaults, and point package scripts at existing files. Preserve source identity rather than inventing providers.
- [x] CLEAN-06: repository-owned ignores for .playwright-mcp/, reports/, local decisions and worktrees while keeping deliberate public fixtures trackable.

Verification: run a tracked-file personal-path scan, script-target existence check, environment parser tests and Python syntax compilation. Do not rewrite history for a non-secret local path; existing public history remains documented.

## 6. Deployment isolation and operations

Files: infra/docker-compose.yml, infra/Caddyfile, new backup/restore helpers, DEPLOY.md, docs/operations.md.

- [x] OPS-01: bind published local datastore ports to 127.0.0.1; document container-only networking and require an explicit API domain in Caddy environment settings.
- [x] OPS-05: provide restrictive-permission backup artifacts, retention, checksum/integrity verification and a restore rehearsal targeting a separate database. Read-only inspect existing Ahosaji backup metadata/topology where available; do not claim a restore passed without running it in isolation.
- [x] Document production follow-through: exact proxy CIDRs, scoped query credentials, separate migration credentials, migration-before-serve ordering and rollback. No live production configuration mutation until the concrete change is reviewable and its prerequisites are verified.

## 7. Documentation and generated SDK

- [x] CLEAN-03: refresh README, DEPLOY, roadmap and security policy around final behavior; replace placeholder repo links and make canonical public domain configurable. Regenerate TypeDoc/OpenAPI client artifacts from corrected sources with errors enabled. Preserve code license policy and dataset content as instructed.
- [x] Update contribution verification commands, limits, quota semantics and credential lifecycle. Separate historical planning notes from current operational instructions.
- [x] Record status of every selected ID in the completion report, with CLEAN-04/05 explicitly deferred and any unverified live controls explicitly identified.

## 8. Review and integration

- [x] Run focused failing regression tests before behavior changes; run each focused suite after implementation.
- [x] Independent spec review, then code quality review, addressing material issues before integration.
- [x] Full frozen install, typecheck, behavioral tests, validation, production audit, secret scan and diff checks.
- [ ] Push a dedicated protected PR including PR #1's existing repairs; update descriptions to final scope. Do not bypass required checks. Keep local questionnaire/reports out of commits.
- [ ] Verify fresh GitHub check results and settings. Prepare any live deployment follow-through as concrete, separately reviewable operations; keep licensing deferrals explicit.
