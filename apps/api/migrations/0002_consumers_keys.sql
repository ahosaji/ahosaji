-- 0002_consumers_keys.sql — API consumer + key storage.
-- Phase 2 places these tables behind the API itself; auth wiring lands in
-- the Fastify slice. Hashing uses argon2id at write time (in app code).

CREATE TABLE IF NOT EXISTS consumers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  organization  TEXT,
  tier          TEXT NOT NULL DEFAULT 'free'
                   CHECK (tier IN ('free', 'church', 'paid', 'admin')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id   UUID NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  label         TEXT,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_prefix_idx      ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS api_keys_consumer_idx    ON api_keys(consumer_id);

CREATE TABLE IF NOT EXISTS request_log (
  ts            TIMESTAMPTZ DEFAULT now(),
  consumer_id   UUID,
  endpoint      TEXT NOT NULL,
  status        INT,
  ms            INT
);
CREATE INDEX IF NOT EXISTS request_log_ts_idx ON request_log(ts);

INSERT INTO schema_migrations(version) VALUES ('0002_consumers_keys')
  ON CONFLICT DO NOTHING;
