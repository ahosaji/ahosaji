# Cross-references (`crossrefs/`)

This directory holds verse-level cross-reference data. The Postgres loader
(`ingest/src/scripts/load-postgres.ts`, function `loadCrossRefs`) globs
**every `*.json` file** in this directory and loads all of them — there is
no hardcoded file list, so adding a new file here is enough to ingest it.

## File format

Each file is a JSON object:

```json
{
  "comment": "free-text provenance note (optional)",
  "tradition": "TSK",
  "refs": [
    { "from": "JHN.3.16", "to": ["ROM.5.8", "1JN.4.9", "1JN.4.10"] },
    { "from": "JHN.3.5",  "to": ["EZK.36.25", "MRK.16.16"] }
  ]
}
```

- `refs` — array of cross-reference groups (required). Other top-level keys
  (`comment`, `tradition`, …) are ignored by the loader.
- `from` — USFM verse id (`BOOK.CHAPTER.VERSE`) the reference originates from.
- `to` — array of USFM verse ids the `from` verse points to.

The loader flattens each `{ from, to: [a, b] }` into individual
`{ from, to: a }`, `{ from, to: b }` edges.

File naming is conventional (`JHN.3.json` = a per-chapter slice). Any name
ending in `.json` works; per-book (`JHN.json`) or per-chapter slices are both
fine.

## Importing the full openbible.info TSK dataset (deferred)

Currently only `JHN.3.json` (a hand-curated sample) ships here. The full
Treasury of Scripture Knowledge cross-reference set (~340,000 references) is
published as a **public-domain CSV** by openbible.info:

  https://www.openbible.info/labs/cross-references/

To import it later (not done yet — intentionally deferred to avoid bundling a
large dataset):

1. Download `cross_references.txt` (TSV: `From Verse`, `To Verse`, `Votes`).
2. Map each reference from openbible's `Book.C.V` notation to our USFM ids
   (e.g. `Gen.1.1` → `GEN.1.1`) using `books.json`.
3. Optionally filter by `Votes` to keep the strongest references.
4. Emit per-book or per-chapter JSON files in this directory using the format
   above (e.g. `GEN.json`, `JHN.3.json`).
5. Re-run `pnpm --filter @ahosaji/ingest load:postgres` — the loader will pick
   up the new files automatically.

The CSV itself is **not** committed to this repo (keep the data directory
small; the transform is a one-off build step).
