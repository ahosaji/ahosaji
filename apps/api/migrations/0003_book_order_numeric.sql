-- 0003_book_order_numeric.sql — allow decimal book_order so we can interleave
-- 3 Maccabees and Prayer of Manasseh between 2 Maccabees (49) and Matthew (50)
-- without renumbering the rest.

ALTER TABLE books
  ALTER COLUMN book_order TYPE NUMERIC(6, 2)
  USING book_order::NUMERIC(6, 2);

INSERT INTO schema_migrations(version) VALUES ('0003_book_order_numeric')
  ON CONFLICT DO NOTHING;
