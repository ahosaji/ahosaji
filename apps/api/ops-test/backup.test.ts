import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = fileURLToPath(new URL('../../../infra/scripts/', import.meta.url));

test('restore waits for final TCP readiness rather than the temporary initialization socket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ahosaji-readiness-test-'));
  const dump = join(dir, 'fixture.dump');
  const log = join(dir, 'docker.log');
  const readyFile = join(dir, 'final-server-ready');
  const attemptsFile = join(dir, 'tcp-attempts');
  const fakeBin = join(dir, 'docker');
  const bytes = Buffer.from('PGDMP-readiness-fixture');
  await writeFile(dump, bytes);
  await writeFile(`${dump}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  fixture.dump\n`);
  await writeFile(fakeBin, `#!/usr/bin/env python3
import json, os, pathlib, sys
args=sys.argv[1:]
ready=pathlib.Path(os.environ['DOCKER_FINAL_READY'])
attempts=pathlib.Path(os.environ['DOCKER_TCP_ATTEMPTS'])
with open(os.environ['DOCKER_TEST_LOG'], 'a') as out: out.write(json.dumps(args)+'\\n')
if 'pg_isready' in args:
    if '--host' not in args:
        sys.exit(0)  # The temporary initdb server accepts Unix sockets before final startup.
    assert args[args.index('--host')+1] == '127.0.0.1'
    count=int(attempts.read_text()) if attempts.exists() else 0
    attempts.write_text(str(count+1))
    if count == 0: sys.exit(1)
    ready.touch()
elif 'pg_restore' in args:
    if not ready.exists():
        print('temporary initialization server closed the connection', file=sys.stderr)
        sys.exit(1)
elif 'psql' in args:
    print('{"translations":1,"books":1,"verses":1,"migrations":4}')
`);
  await chmod(fakeBin, 0o700);
  try {
    const result = spawnSync('bash', [join(scripts, 'restore-rehearsal.sh'), dump], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DOCKER_TEST_LOG: log, DOCKER_FINAL_READY: readyFile, DOCKER_TCP_ATTEMPTS: attemptsFile },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(attemptsFile, 'utf8'), '2');
    assert.match(result.stdout, /"restore":\s*"passed"/);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
    const probes = calls.filter(args => args.includes('pg_isready'));
    assert.equal(probes.length, 2);
    assert.ok(probes.every(args => args.includes('--host')));
    assert.ok(calls.some(args => args[0] === 'rm' && args.includes('--force')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('backup permissions, checksum and retention preserve unrelated files; rehearsal is isolated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ahosaji-backup-test-'));
  const fakeBin = join(dir, 'docker');
  const log = join(dir, 'docker.log');
  await writeFile(fakeBin, `#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]
with open(os.environ['DOCKER_TEST_LOG'], 'a') as out: out.write(json.dumps(args)+'\\n')
if 'pg_dump' in ' '.join(args): sys.stdout.buffer.write(b'PGDMP-fixture')
elif 'run' in args and '--detach' in args: print('isolated-container')
elif 'psql' in args: print('{"translations":1,"books":1,"verses":1,"migrations":4}')
`);
  await chmod(fakeBin, 0o700);
  const backupDir = join(dir, 'backups');
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, DOCKER_TEST_LOG: log };
  const run = (script: string, args: string[]) => spawnSync('bash', [join(scripts, script), ...args], { env, encoding: 'utf8' });
  try {
    const first = run('backup-postgres.sh', ['--container', 'fixture-postgres', '--directory', backupDir, '--keep', '1']);
    assert.equal(first.status, 0, first.stderr);
    const firstDump = (await readdir(backupDir)).find(file => file.endsWith('.dump'))!;
    assert.equal((await stat(join(backupDir, firstDump))).mode & 0o777, 0o600);
    assert.equal((await stat(backupDir)).mode & 0o777, 0o700);
    const digest = createHash('sha256').update(await readFile(join(backupDir, firstDump))).digest('hex');
    assert.equal(await readFile(join(backupDir, `${firstDump}.sha256`), 'utf8'), `${digest}  ${firstDump}\n`);
    await writeFile(join(backupDir, 'unrelated.dump'), 'keep');
    const second = run('backup-postgres.sh', ['--container', 'fixture-postgres', '--directory', backupDir, '--keep', '1']);
    assert.equal(second.status, 0, second.stderr);
    const files = await readdir(backupDir);
    assert.ok(files.includes('unrelated.dump'));
    const own = files.filter(file => /^ahosaji-.*\.dump$/.test(file));
    assert.equal(own.length, 1);
    const drill = run('restore-rehearsal.sh', [join(backupDir, own[0]!)]);
    assert.equal(drill.status, 0, drill.stderr);
    assert.match(drill.stdout, /"verses":\s*1/);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
    const start = calls.find(args => args.includes('--detach'))!;
    assert.equal(start[start.indexOf('--network') + 1], 'none');
    assert.ok(start.includes('--tmpfs'));
    assert.ok(!start.some(value => value === '--publish' || value === '--volume' || value === '--env-file'));
    assert.ok(calls.some(args => args[0] === 'rm' && args.includes('--force')));
    await writeFile(join(backupDir, own[0]!), 'tampered');
    const failed = run('restore-rehearsal.sh', [join(backupDir, own[0]!)]);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /checksum/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
