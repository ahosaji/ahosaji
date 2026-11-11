import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/test';
process.env.MEILISEARCH_HOST = 'http://127.0.0.1:1';
process.env.MEILISEARCH_SEARCH_KEY = 'test-search';
const { consumeConsumerQuota } = await import('../src/lib/quota.js');
const consumer = { id: randomUUID(), tier: 'free' as const, email: 'test@example.invalid', name: null };

test('admin has no consumer quota database reservation', async () => {
  assert.equal(await consumeConsumerQuota({ ...consumer, tier: 'admin' }, { query: async () => { throw new Error('must not query'); } } as never), true);
});

test('Postgres quota is atomic across workers, durable, UTC-based and tier-aware', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `quota_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const options = `-c search_path=${schema},pg_catalog -c timezone=Pacific/Honolulu`;
  const first = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options, max: 5 });
  const second = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options, max: 5 });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await first.query('CREATE TABLE consumers (id uuid PRIMARY KEY)');
    await first.query('INSERT INTO consumers VALUES ($1)', [consumer.id]);
    await first.query(await readFile(new URL('../../../migrations/0004_api_usage.sql', import.meta.url), 'utf8'));
    const seed = async (minute: number, day: number) => {
      await first.query(`INSERT INTO api_usage VALUES ($1,
        date_trunc('minute', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', $2,
        date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', $3)
        ON CONFLICT (consumer_id) DO UPDATE SET minute_start = EXCLUDED.minute_start,
        minute_count = EXCLUDED.minute_count, day_start = EXCLUDED.day_start, day_count = EXCLUDED.day_count`, [consumer.id, minute, day]);
    };
    await seed(59, 100);
    const minute = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeConsumerQuota(consumer, i % 2 ? first : second)));
    assert.equal(minute.filter(Boolean).length, 1);
    assert.deepEqual((await first.query('SELECT minute_count, day_count FROM api_usage')).rows[0], { minute_count: 60, day_count: 101 });
    const restarted = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options, max: 1 });
    try { assert.equal(await consumeConsumerQuota(consumer, restarted), false); } finally { await restarted.end(); }
    assert.equal(await consumeConsumerQuota({ ...consumer, tier: 'church' }, second), true);
    await seed(10, 4999);
    const day = await Promise.all(Array.from({ length: 20 }, (_, i) => consumeConsumerQuota(consumer, i % 2 ? first : second)));
    assert.equal(day.filter(Boolean).length, 1);
    assert.deepEqual((await first.query('SELECT minute_count, day_count FROM api_usage')).rows[0], { minute_count: 11, day_count: 5000 });
    await first.query("UPDATE api_usage SET minute_start = minute_start - interval '1 minute', day_start = day_start - interval '1 day'");
    assert.equal(await consumeConsumerQuota(consumer, second), true);
    assert.deepEqual((await first.query('SELECT minute_count, day_count FROM api_usage')).rows[0], { minute_count: 1, day_count: 1 });
    await seed(1, 9999999);
    assert.equal(await consumeConsumerQuota({ ...consumer, tier: 'paid' }, second), true);
    // An older statement waiting across a window boundary must never reset a newer counter.
    await seed(60, 100);
    await first.query("UPDATE api_usage SET minute_start = minute_start + interval '1 minute'");
    assert.equal(await consumeConsumerQuota(consumer, second), false);
  } finally {
    await first.end(); await second.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
