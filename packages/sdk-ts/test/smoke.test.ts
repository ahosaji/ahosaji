import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('SDK smoke fails before any request when its API key is missing', () => {
  for (const value of [undefined, '', '   ']) {
    const env = { ...process.env, AHOSAJI_BASE: 'http://127.0.0.1:1' };
    delete env.AHOSAJI_KEY;
    if (value !== undefined) env.AHOSAJI_KEY = value;
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/smoke.ts'], {
      cwd: new URL('..', import.meta.url), env, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /AHOSAJI_KEY is required/);
    assert.equal(result.stdout, '');
  }
});
