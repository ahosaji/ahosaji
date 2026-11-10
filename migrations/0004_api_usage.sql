-- A single row per consumer keeps quota storage bounded and both reservations atomic.
-- All windows are fixed UTC minute/day starts, independent of connection timezone.
CREATE TABLE api_usage (
  consumer_id uuid PRIMARY KEY REFERENCES consumers(id) ON DELETE CASCADE,
  minute_start timestamptz NOT NULL,
  minute_count integer NOT NULL CHECK (minute_count > 0),
  day_start timestamptz NOT NULL,
  day_count integer NOT NULL CHECK (day_count > 0)
);
