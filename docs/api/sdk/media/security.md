# Security controls and request limits

This describes the repository implementation. It does not attest that a live
deployment has received these changes or that external firewall, proxy and
backup controls have been verified.

## Credentials and trust boundary

Production serving requires `MEILISEARCH_SEARCH_KEY` and rejects an environment
containing `MEILISEARCH_MASTER_KEY`. Scope the query key to `verses_en` and
`verses_ar` with search-only permission. Indexing uses a separate environment.
Local development can explicitly enable the master-key fallback; see the local
template. Operator migration/key commands use a separate database connection
and never require search credentials.

API keys contain 32 random bytes. Only their SHA-256 hashes and lookup prefixes
are stored. Every authenticated request rechecks the database, so a completed
revocation or tier change takes effect on subsequent authentication checks.
Already-running requests are not retrospectively canceled. Ordinary startup
does not create keys, apply migrations or print credentials. See
[operations](./operations.md) for explicit issuance and historical log handling.

`TRUSTED_PROXY_CIDRS` is empty by default. Set only the immediate trusted proxy
addresses/CIDRs, and prevent direct public access to the application port.
Forwarding headers from other peers do not determine client identity. A host
Caddy deployment normally trusts only its loopback connection; a container/CDN
deployment needs its own verified boundary.

## Metering and operation budgets

An ingress limiter runs before authentication/database lookups: 10,000 requests
per IP per minute, with a bounded 10,000-entry memory store. This coarse ceiling
is separate from consumer quotas and is process-local. Anonymous traffic is
limited to 30 requests per IP per minute. Network/edge controls remain necessary
for distributed traffic and connection floods.

Finite authenticated quotas are reserved atomically in PostgreSQL and survive
process restarts and multiple API workers. They count authenticated HTTP
requests, including authenticated MCP discovery. Minute windows and daily
windows are fixed UTC calendar boundaries. Rejected quota reservations spend
neither window.

| Tier | Requests/minute | Requests/day |
| --- | ---: | ---: |
| free | 60 | 5,000 |
| church | 600 | 200,000 |
| paid | 6,000 | Unlimited |
| admin | Unlimited | Unlimited |

Unlimited quota dimensions do not bypass input or per-operation work limits.
These existing business-tier policies are preserved.

| Surface | Limit |
| --- | --- |
| HTTP JSON body | 256 KiB |
| GraphQL | One operation/document; 30 aliases; 500 expanded fields; 500 fragment expansions; depth 12; cost 10,000 |
| GraphQL root weights | parallel 5,000; translation(s), passage, chapter and verses 1,000; search 100; other fields 1 |
| Parallel query | 1–10 input translation entries, known codes, deduplicated result columns, at most 1,000 expanded references |
| Search pagination | page size/limit 1–100, page 1–1,000, offset 0–100,000 |
| MCP passage prompt | window 0–1,000 |

GraphQL fragment reuse is counted before resolver work. Every MCP tool's JSON
schema is validated before its handler runs; schema descriptions alone are not
the enforcement mechanism. Numeric references must fit positive PostgreSQL
integers. Excessive parallel ranges are rejected rather than truncated.

Serving has independent deadlines: 15-second request/handler budgets,
10-second connection timeout, 5-second keepalive, a 10-connection PostgreSQL
pool, 2-second database acquisition, 5-second statements, 6-second query wait
and 5-second search calls. The hijacked MCP response has its own 15-second
deadline. Cancellation of arbitrary asynchronous work is cooperative; these
budgets limit individual resources rather than promising instantaneous global
cancellation.

Backend failures return generic messages with request IDs. Detailed diagnostic
errors stay in operator logs; inbound authorization headers are redacted. Do
not place sensitive data in URL query parameters or share raw logs publicly.

## Repository checks

The required `typecheck + audit` job performs a frozen install, workspace
typechecks, security/ingestion/operator tests, Python tests, complete snapshot
validation, the production dependency audit and a redacted Gitleaks scan of
reachable Git history. CI uses a disposable PostgreSQL service for integration
tests; local runs without `TEST_DATABASE_URL` explicitly skip those tests.

CodeQL provides additional static analysis. All workflow actions are pinned
to reviewed commit SHAs. Dependabot prepares dependency and action updates;
updates still require review and passing checks. GitHub secret scanning and
push protection are enabled. A scan without matches is not proof that no
credential exists; revoke any actual exposure before treating cleanup as done.

Main requires pull requests, an up-to-date required check and resolved
conversations, including administrators. Force pushes and branch deletion are
blocked. Approval count remains zero for the sole collaborator; adding human
reviewers is a separate repository governance decision.
