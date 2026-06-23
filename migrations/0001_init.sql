-- 0001_init.sql — initial schema for Bible domain v1.
-- Idempotent: every CREATE uses IF NOT EXISTS so re-runs are safe in dev.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- Translations
CREATE TABLE IF NOT EXISTS translations (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  language      TEXT NOT NULL,
  source        TEXT NOT NULL,
  copyright     TEXT,
  versification TEXT NOT NULL
);

-- Books (registry — same rows for both translations)
CREATE TABLE IF NOT EXISTS books (
  usfm           TEXT PRIMARY KEY,
  name_en        TEXT NOT NULL,
  name_ar        TEXT NOT NULL,
  testament      TEXT NOT NULL,
  canon          TEXT NOT NULL,
  book_order     INT  NOT NULL,
  chapter_count  INT  NOT NULL,
  book_group     TEXT
);

-- Verses (canonical content)
CREATE TABLE IF NOT EXISTS verses (
  translation TEXT NOT NULL REFERENCES translations(code),
  book        TEXT NOT NULL REFERENCES books(usfm),
  chapter     INT  NOT NULL,
  verse       INT  NOT NULL,
  ref         TEXT GENERATED ALWAYS AS (book || '.' || chapter || '.' || verse) STORED,
  text        TEXT NOT NULL,
  structured  JSONB NOT NULL,
  PRIMARY KEY (translation, book, chapter, verse)
);
CREATE INDEX IF NOT EXISTS verses_ref_idx           ON verses(ref);
CREATE INDEX IF NOT EXISTS verses_book_chapter_idx  ON verses(translation, book, chapter);

-- Section headings
CREATE TABLE IF NOT EXISTS headings (
  translation  TEXT NOT NULL,
  book         TEXT NOT NULL,
  chapter      INT  NOT NULL,
  before_verse INT  NOT NULL,
  text         TEXT NOT NULL,
  level        INT  NOT NULL DEFAULT 2,
  PRIMARY KEY (translation, book, chapter, before_verse)
);

-- Cross-references (translation-independent)
CREATE TABLE IF NOT EXISTS cross_refs (
  from_ref TEXT NOT NULL,
  to_ref   TEXT NOT NULL,
  PRIMARY KEY (from_ref, to_ref)
);
CREATE INDEX IF NOT EXISTS cross_refs_from_idx ON cross_refs(from_ref);

-- Migration bookkeeping
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('0001_init')
  ON CONFLICT DO NOTHING;
