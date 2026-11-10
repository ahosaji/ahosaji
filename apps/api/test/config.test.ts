import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/test';
process.env.MEILISEARCH_HOST = 'http://127.0.0.1:1';
process.env.MEILISEARCH_SEARCH_KEY = 'test-search';
const config = await import('../src/env.js');

test('production serving environment requires a scoped key and never exports master material', () => {
  assert.equal(typeof config.loadEnv, 'function');
  const source = { NODE_ENV: 'production', DATABASE_URL: 'postgres://test', MEILISEARCH_HOST: 'http://search', MEILISEARCH_SEARCH_KEY: 'scoped' };
  assert.equal(config.loadEnv(source).meilisearchSearchKey, 'scoped');
  assert.equal('meilisearchMasterKey' in config.loadEnv(source), false);
  assert.throws(() => config.loadEnv({ ...source, MEILISEARCH_MASTER_KEY: 'master' }), /master/i);
  assert.throws(() => config.loadEnv({ ...source, MEILISEARCH_SEARCH_KEY: undefined }), /SEARCH_KEY/);
});

test('proxy trust accepts only explicit validated CIDRs', () => {
  assert.equal(typeof config.loadEnv, 'function');
  const source = { DATABASE_URL: 'postgres://test', MEILISEARCH_HOST: 'http://search', MEILISEARCH_SEARCH_KEY: 'scoped' };
  assert.deepEqual(config.loadEnv(source).trustedProxyCidrs, []);
  assert.deepEqual(config.loadEnv({ ...source, TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128' }).trustedProxyCidrs, ['127.0.0.1/32', '::1/128']);
  for (const value of ['true', '*', 'example.com/24', '10.0.0.0/33', '::1/129', '0.0.0.0/0', '::/0', '127.0.0.1/00']) {
    assert.throws(() => config.loadEnv({ ...source, TRUSTED_PROXY_CIDRS: value }), /CIDR/);
  }
});

test('development master-key fallback requires an explicit development flag', () => {
  const source = { NODE_ENV: 'development', DATABASE_URL: 'postgres://test', MEILISEARCH_HOST: 'http://search', MEILISEARCH_MASTER_KEY: 'development-master' };
  assert.throws(() => config.loadEnv(source), /SEARCH_KEY|MASTER_KEY/);
  const serving = config.loadEnv({ ...source, ALLOW_MEILISEARCH_MASTER_KEY_FALLBACK: 'true' });
  assert.equal(serving.meilisearchSearchKey, 'development-master');
  assert.equal('meilisearchMasterKey' in serving, false);
});

test('master credentials are rejected in every mode except explicit development fallback', () => {
  const source = { DATABASE_URL: 'postgres://test', MEILISEARCH_HOST: 'http://search', MEILISEARCH_SEARCH_KEY: 'scoped', MEILISEARCH_MASTER_KEY: 'master' };
  for (const NODE_ENV of [undefined, 'production', 'test', 'staging', 'unknown', 'development']) {
    assert.throws(() => config.loadEnv({ ...source, NODE_ENV }), /MASTER_KEY/, `mode ${NODE_ENV}`);
  }
  for (const NODE_ENV of ['production', 'test', 'staging']) {
    assert.throws(() => config.loadEnv({ ...source, NODE_ENV, ALLOW_MEILISEARCH_MASTER_KEY_FALLBACK: 'true' }), /MASTER_KEY/);
  }
  const serving = config.loadEnv({ ...source, NODE_ENV: 'development', ALLOW_MEILISEARCH_MASTER_KEY_FALLBACK: 'true' });
  assert.equal(serving.meilisearchSearchKey, 'scoped');
  assert.equal('meilisearchMasterKey' in serving, false);
});
