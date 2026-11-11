# Security and cleanup status — 2026-11-10

This implements the selected review against `d676294`. Code licensing,
dataset permissions and dataset contents remain unchanged by the owner's
subsequent instruction. Local audit/questionnaire artifacts are not published
with the source changes.

## Selected items

| ID | Repository result |
| --- | --- |
| DEP-01 | Patched compatible dependencies, updated supported static/Zod versions, replaced the legacy Firecrawl SDK, removed open-ended overrides; production audit reports zero vulnerabilities. |
| API-01 | Coarse ingress throttling precedes auth lookup; strict key format and finite I/O budgets. |
| API-02 | Expanded GraphQL alias, field, fragment, depth and cost budgets run before resolvers. |
| API-03 | Shared bounded/deduplicated parallel queries and enforced MCP schemas. |
| API-04 | MCP and other authenticated requests use the same durable quota reservation. |
| API-05 | No automatic key issuance; explicit operator issuance uses a private new file or terminal. |
| API-06 | Explicit validated proxy CIDRs, rejecting blanket `/0` trust. |
| API-07 | Generic backend failures, correlation IDs and operator-side diagnostics. |
| HARD-01 | Finite quotas persist in Postgres; subsequent auth checks observe revocation/tier changes immediately. Existing unlimited dimensions remain unchanged. |
| DATA-01 | Wrapper-aware safe validation; all current corpus warnings remain explicit. |
| DATA-02 | Complete preflight before Postgres connection/replacement; invalid/empty input cannot be authorized by partial mode. |
| DATA-03 | Successful tasks and verified staging precede atomic search-index publication. |
| DATA-04 | Completeness manifests and nonzero default partial/failure exits, including bulk PDF-open failures. |
| OPS-01 | Recipe binds stores to loopback; container-only network guidance is documented. |
| OPS-02 | Production serving rejects master credentials and uses only a scoped query key. |
| OPS-03 | Node 22.23.4 pins and compatible package manager policy aligned with CI. |
| OPS-04 | Canonical root SQL, version/checksum tracking, serialization and legacy compatibility. |
| OPS-05 | Private backup/retention helpers and a real isolated fixture restore; live scheduling/off-host recovery still needs operator verification. |
| CI-01 | Behavior, PostgreSQL, Python, corpus, dependency and secret gates; CodeQL workflow added. |
| GH-01 | GitHub secret scanning and push protection enabled and read back. CI also detects Ahosaji-format keys. |
| GH-02 | Automated security updates enabled and read back; grouped dependency/action update PRs configured. |
| GH-03 | All action references pinned to verified vendor commits; explicit minimal workflow permissions. |
| CLEAN-01 | Personal absolute paths removed from current public source/docs; history is not rewritten. |
| CLEAN-02 | Portable PDF configuration, explicit source endpoints/version, corrected scripts and fail-fast validation. |
| CLEAN-03 | Current setup/security/operations documentation and regenerated SDK pages; historical design notes clearly labeled. |
| CLEAN-04 | Deferred by owner: source-data permissions/provenance review. No rights or content changes. |
| CLEAN-05 | Deferred by owner: code license policy remains as-is. |
| CLEAN-06 | Repository-owned ignores for environment variants, browser artifacts, reports and scrape manifests. |

## Verification

Local verification on the official checksum-verified Node 22.23.4 binary:

- Frozen install and all three workspace typechecks passed.
- 76 TypeScript tests passed, including PostgreSQL integration; zero failures
  and zero skips. Seven Python tests passed.
- All 156 snapshots and 2,686 chapters validate, with the same 703 explicit
  compatibility/editorial warnings. Dataset bytes and original root SQL
  migrations 0001–0003 are unchanged.
- Production dependency audit: zero reported vulnerabilities at verification
  time. This is advisory coverage, not proof of exhaustive exploit absence.
- Independent API, ingestion, operations and integration reviews completed;
  reported material gaps received regression tests and fixes.
- SDK generation and TypeDoc completed with zero errors. Six existing-style
  warnings concern internal types referenced by public documentation.
- GitHub YAML parses; current public candidate files contain no personal
  absolute paths or placeholder repository links.
- The custom API-key detector catches a valid-format mock without exposing it.
  Staged changes contain no detected secrets. The history scan identified an
  initial-commit SDK smoke fallback key, which was removed from current source.
  A read-only production key-table lookup found no matching hash. The precise
  historical occurrence is recorded in `.gitleaksignore`; the archived token
  must never be reused. This does not attest to other environments. New
  occurrences remain blocked. Hosted CI results are required before integration.

CodeQL initially flagged the optional MCP authentication header branch. Full
HTTP regressions confirm that anonymous discovery cannot invoke tools, read
resources or retrieve prompts, and malformed/invalid credentials cannot execute
protected routes. The alert was triaged as a false positive for intentional
public protocol discovery; the query remains enabled.

Migration tests use an isolated PostgreSQL 16 fixture. The backup helper and
network-isolated restore were exercised with one synthetic translation, book
and verse plus four migrations. Caddy validation succeeded with a configured
domain and failed when it was omitted. These checks do not attest to production
backups, retained logs, credential scopes or network controls.

## Integration and production boundary

The existing Coolify application tracks `main` with automatic deployment
enabled. Merging is therefore a production rollout, not merely a source update.
Before integration, coordinate the exact release and operator prerequisites:

1. Verify a production backup and its recovery procedure without putting
   credentials or private content in public artifacts.
2. Prepare a search-only key restricted to the intended verse indexes and
   remove master/indexing/migration credentials from the serving environment.
3. Apply canonical migrations through the separate operator connection,
   including `0004_api_usage`, before the new API serves requests.
4. Set the immediate trusted proxy CIDRs and private application/store
   networking to the actual deployment topology.
5. Use the pinned runtime, deploy the tested release, and run scoped REST,
   GraphQL, MCP, search and quota smoke checks with request-ID diagnostics.

No production variables, keys, logs, application code, databases, indexes or
firewall rules were changed by this repository implementation. Existing
historical bootstrap keys were not inspected or rotated. Keep a reviewed
rollback plan; do not merge into an automatic deployment before its environment
and migration prerequisites are ready.
