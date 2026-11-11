import type { Pool } from 'pg';
import { pool } from '../db.js';
import { TIER_RATE_LIMITS, type Consumer } from '../auth.js';

/** One atomic UPSERT locks the consumer row and reserves both fixed UTC windows. */
export async function consumeConsumerQuota(consumer: Consumer, database: Pick<Pool, 'query'> = pool): Promise<boolean> {
  const { perMinute, perDay } = TIER_RATE_LIMITS[consumer.tier];
  if (!Number.isFinite(perMinute) && !Number.isFinite(perDay)) return true;
  const result = await database.query(`
    INSERT INTO api_usage AS usage (consumer_id, minute_start, minute_count, day_start, day_count)
    VALUES ($1, date_trunc('minute', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 1,
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 1)
    ON CONFLICT (consumer_id) DO UPDATE SET
      minute_start = GREATEST(usage.minute_start, EXCLUDED.minute_start),
      minute_count = CASE WHEN usage.minute_start >= EXCLUDED.minute_start THEN usage.minute_count + 1 ELSE 1 END,
      day_start = GREATEST(usage.day_start, EXCLUDED.day_start),
      day_count = CASE WHEN usage.day_start >= EXCLUDED.day_start THEN usage.day_count + 1 ELSE 1 END
    WHERE ($2::integer IS NULL OR (CASE WHEN usage.minute_start >= EXCLUDED.minute_start THEN usage.minute_count ELSE 0 END) < $2)
      AND ($3::integer IS NULL OR (CASE WHEN usage.day_start >= EXCLUDED.day_start THEN usage.day_count ELSE 0 END) < $3)
    RETURNING consumer_id`, [consumer.id, Number.isFinite(perMinute) ? perMinute : null, Number.isFinite(perDay) ? perDay : null]);
  return result.rows.length === 1;
}
