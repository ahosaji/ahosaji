# Roadmap

The current repository implements the Bible domain through REST, GraphQL and
MCP, including Arabic/English search, structured content and versification-aware
parallel queries. Lectionary, Synaxarium, Agpeya and additional domains remain
future work. [PLAN.md](../PLAN.md) retains the historical architecture notebook.

## Security and maintenance work (2026-11-10)

The hardening branch addresses early authentication throttling, bounded query
work, runtime MCP validation, durable finite quotas and immediate revocation,
explicit proxy boundaries, scoped search credentials, safe operator issuance,
tracked migrations, validated imports, staged search publication and observable
partial scraping. Existing paid/admin unlimited quota dimensions are preserved.

The required CI job now includes behavior tests and corpus validation alongside
typechecking, the production audit and secret scanning. CodeQL and pinned action
updates supplement it. Verification evidence and any remaining limitations are
recorded with the PR; this page does not claim a live rollout has happened.

## Remaining editorial/data work

The unchanged corpus validates with explicit compatibility/editorial warnings:
457 missing legacy italic flags, 125 heading mismatches, 118 duplicate heading
targets, two DAN/DAG coverage warnings and one SIR verse gap. Resolve these only
with source-aware review; do not fabricate or silently normalize source text.
Cross-reference coverage and additional domain ingestion remain separate work.

## Owner and operator decisions

- Code licensing and dataset permission/provenance review are deferred by the
  owner's current instruction. Existing rights, source labels and content remain
  unchanged.
- Verify live immediate proxy addresses, firewall/store publication and scoped
  search credentials during rollout.
- Verify the actual backup schedule, encrypted off-host retention and periodic
  restore history. Repository fixture tests establish the helper behavior only.
- Publication of the private workspace SDK to npm, additional language clients,
  richer metadata and future content domains remain separate release decisions.

Use [security controls](./security.md), [ingestion](./ingestion.md),
[deployment](../DEPLOY.md) and [operations](./operations.md) for current commands
and constraints. Old June backlog claims about plaintext auth caches,
identity-only GraphQL/MCP parallel responses and missing daily quotas are not
current implementation guidance.
