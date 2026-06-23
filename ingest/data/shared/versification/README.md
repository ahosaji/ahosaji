# Versification mapping tables

## What this directory is for

The Ahosaji content API serves multiple translations of the same Bible. For most
books they align cleanly verse-by-verse, but a small number of books — primarily
the **Deuterocanonicals** and parts of **Psalms / Jeremiah / Malachi** — have
genuinely different verse counts and chapter structures depending on the source
text tradition the translation followed.

This is **not a bug in the parsers**. It is real divergence in the source texts:

| Source text tradition | Used by | Tobit 1 verse count |
|---|---|---|
| Vulgate (Latin, Jerome's translation through Latin) | Arabic source Arabic (Arabic source `ar`) | **25** |
| Rahlfs Greek Septuagint | English source (`en` Deuteros) | **22** |

When a parallel-translation query is made on a divergent passage, the API
needs a deterministic mapping so it can return the right material for each
side of the comparison.

## Decision

We **do not change source texts** to force alignment. The English English is
the Coptic-Orthodox-aligned English Deuterocanonical source; the Arabic source Arabic is the Coptic Orthodox standard Arabic Bible. Both stay.

Instead, **per-book versification mapping tables** live in this directory.
Each file is JSON of the form:

```json
{
  "book": "TOB",
  "translations": ["ar", "en"],
  "tradition": {
    "ar": "vulgate",
    "en": "rahlfs-lxx"
  },
  "mappings": [
    { "ar": "TOB.1.1", "en": "TOB.1.1" },
    { "ar": "TOB.1.2", "en": "TOB.1.2" },
    { "ar": "TOB.1.21", "en": "TOB.1.19" },
    { "ar": "TOB.1.22", "en": ["TOB.1.20", "TOB.1.21"] },
    { "ar": "TOB.1.23-25", "en": "TOB.1.22" }
  ]
}
```

A mapping can be one-to-one, one-to-many, many-to-one, or one-to-none (with
`"en": null` meaning "no English equivalent, Arabic-only verse").

## Books known to need mapping tables (v1.x scope)

- TOB (Tobit) — verified divergent in the prototype scrape
- JDT (Judith) — likely divergent, needs verification
- WIS (Wisdom of Solomon) — needs verification
- SIR (Sirach / Ben Sira) — likely divergent (chapter splits also differ)
- BAR (Baruch) — needs verification
- 1MA, 2MA, 3MA (Maccabees) — needs verification
- DAG (Daniel additions: Susanna, Bel & Dragon, Song of Three) — needs verification
- ESG (Esther additions) — known divergent in tradition
- PSA (Psalms) — known LXX vs Hebrew numbering split (PS2 = Psalm 151)

## What's NOT in scope here

Protocanonical books that align cleanly across both translations don't need
a mapping file — the parallel-query endpoint defaults to identity mapping
(`ar:JHN.3.16` ↔ `en:JHN.3.16`). Only divergent books require curation.

## Cadence

Mapping tables are curated **once per book**, manually, by referencing both
texts side-by-side. Deferred to v1.1 scope per the master `PLAN.md`. The
prototype validates the canonical-JSON shape works regardless.
