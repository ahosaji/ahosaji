# Validating and importing content

Stored dataset contents and their licensing/permission policy are unchanged.
Use approved source endpoints and source files; the software does not establish
redistribution rights from a URL or a source label.

## Configuration

Set `SOURCE_BASE_URL` and `SOURCE_VERSION` for the English HTML integration,
`AR_BASE_URL` and an appropriate `AR_USER_AGENT` for the Arabic integration,
and `SOURCE_PDF_PATH` for PDF extraction. There are no machine-specific PDF or
provider URL defaults. `--pdf` overrides `SOURCE_PDF_PATH`, which overrides the
legacy `English_PDF_PATH` alias. `PYTHON_BIN` optionally selects the interpreter;
otherwise the project virtualenv or `python3` is used. PDF extraction needs
PyMuPDF in that interpreter; the configuration/completeness tests do not.

Direct English HTML fetching is bounded and attempted first. An optional
`FIRECRAWL_API_KEY` enables the official v2 scrape fallback. Its bearer key is
sent only to Firecrawl's fixed API endpoint, not the source page. Responses,
target status, byte limits and elapsed time are checked. Scraping errors do
not print provider bodies or keys.

## Validation and compatibility

```sh
pnpm validate
```

Validation accepts book wrappers and legacy individual chapter inputs, checks
identity and nested structure, and reports alignment using nested chapters.
Loading validates all input before connecting to a database or replacing data.
Unsupported roots, empty chapters, mismatched identities and invalid present
field types are errors.

The existing corpus has 156 book wrappers, 2,686 chapters and 71,588 verses.
The compatibility validator preserves 703 known warnings:

| Warning | Count |
| --- | ---: |
| Legacy missing `italic` flags | 457 |
| Heading consistency | 125 |
| Duplicate heading targets | 118 |
| DAN/DAG chapter coverage | 2 |
| English SIR 45 verse gap | 1 |

An absent legacy `italic` flag is a documented compatibility warning; a present
non-boolean flag is an error. This does not rewrite the source JSON or infer
missing text. Warnings remain visible in CI and should not be confused with
proof that the corpus is editorially complete. Source labels `arabic` and
`english` are internal identifiers, not permission records.

## Safe replacement

Run operator loaders with their separate indexing environment:

```sh
pnpm --filter @ahosaji/ingest load:postgres
pnpm --filter @ahosaji/ingest load:meilisearch
```

The default import requires the expected registry coverage. An intentional
partial import must pass `--allow-partial`; it still cannot accept malformed
or empty input. Review which books are being replaced before authorizing a
partial import. PostgreSQL replacement uses a transaction after complete
preflight. Meilisearch builds uniquely named staging indexes, checks every
task and verifies counts/settings, then publishes all languages in one atomic
swap. A failed build does not delete the live indexes.

Do not use a production replacement loader as a smoke test. Verify a backup
and rehearse with an isolated target first; see [operations](./operations.md).

## Completeness and resumable scraping

Bulk scrapers record requested, cached, completed, missing and failed units in
`ingest/data/.manifests/`. Incomplete work exits nonzero by default. Use
`--allow-partial` only for an intentional subset/resumable workflow, and retain
the manifest with the result. A successful process exit with that flag does
not claim the complete book was collected. Python bulk extraction also records
PDF-open/chapter failures and protects snapshot publication from invalid or
incomplete replacement input.

## Tests

```sh
pnpm --filter @ahosaji/ingest test
pnpm test:python
```

Tests use fixtures and fake I/O for malformed inputs, preflight-before-delete,
rollback, failed/canceled search tasks, staging/swap failures, partial scraper
runs and configuration precedence. They do not contact source providers or use
production credentials.
