import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('key issuance requires controlled output before database work', async () => {
  const module = await import('../src/cli/keys.js');
  assert.equal(typeof module.issueKey, 'function');
  let connected = false;
  await assert.rejects(module.issueKey({ command: 'create', email: 'owner@example.test', tier: 'admin' }, {
    connect: async () => { connected = true; throw new Error('must not connect'); },
  }, { isTTY: false, write: () => true }), /--output|terminal/i);
  assert.equal(connected, false);
});

test('key file is exclusive, private, and plaintext never reaches stdout', async () => {
  const { issueKey } = await import('../src/cli/keys.js');
  const dir = await mkdtemp(join(tmpdir(), 'ahosaji-key-'));
  const output = join(dir, 'key');
  const messages: string[] = [];
  let connects = 0;
  const pool = { connect: async () => {
    connects++;
    return { query: async (sql: string) => ({ rows: sql.includes('SELECT id') ? [{ id: 'consumer', tier: 'admin' }] : [{ id: 'key-id' }], rowCount: 1 }), release() {} };
  } };
  try {
    await issueKey({ command: 'create', email: 'owner@example.test', tier: 'admin', output }, pool, { isTTY: false, write: (text: string) => { messages.push(text); return true; } });
    const key = (await readFile(output, 'utf8')).trim();
    assert.match(key, /^ahk_[A-Za-z0-9_-]{43}$/);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(messages.join('').includes(key), false);
    await assert.rejects(issueKey({ command: 'create', email: 'owner@example.test', tier: 'admin', output }, pool, { isTTY: false, write: () => true }), /EEXIST/);
    assert.equal(connects, 1);
    await writeFile(join(dir, 'unrelated'), 'keep');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('failed issuance rolls back and removes its reserved key file', async () => {
  const { issueKey } = await import('../src/cli/keys.js');
  const dir = await mkdtemp(join(tmpdir(), 'ahosaji-key-fail-'));
  const output = join(dir, 'key');
  const queries: string[] = [];
  const pool = { connect: async () => ({
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO api_keys')) throw new Error('fixture write failure');
      return { rows: [{ id: 'consumer', tier: 'admin' }], rowCount: 1 };
    }, release() {},
  }) };
  try {
    await assert.rejects(issueKey({ command: 'create', email: 'owner@example.test', tier: 'admin', output }, pool, { isTTY: false, write: () => true }), /fixture write failure/);
    assert.ok(queries.includes('ROLLBACK'));
    await assert.rejects(stat(output), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
