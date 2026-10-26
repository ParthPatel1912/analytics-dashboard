import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join, sep } from 'node:path';
import { Client } from 'pg';
import assert from 'node:assert/strict';
if (process.platform !== 'win32')
  throw new Error(
    'This optional downloaded binary harness is for Windows. Use TEST_DATABASE_URL with npm run test:postgres on other platforms.',
  );
const root = process.cwd();
const binaries = resolve(
  '.audit/postgres-runtime/node_modules/@embedded-postgres/windows-x64/native/bin',
);
const directory = resolve('.audit', `pg-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const socket = createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let child;
try {
  const init = spawnSync(
    join(binaries, 'initdb.exe'),
    ['-D', directory, '-U', 'audit', '-A', 'trust', '--encoding=UTF8', '--no-locale'],
    { windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(init.status, 0, init.stderr || String(init.error || 'initdb failed'));
  child = spawn(
    join(binaries, 'postgres.exe'),
    ['-D', directory, '-h', '127.0.0.1', '-p', String(port)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let logs = '';
  child.stdout.on('data', (b) => {
    logs += b;
  });
  child.stderr.on('data', (b) => {
    logs += b;
  });
  const url = `postgres://audit@127.0.0.1:${port}/postgres`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 500 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      ready = true;
      break;
    } catch {
    } finally {
      await client.end().catch(() => {});
    }
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  const version = spawnSync(join(binaries, 'postgres.exe'), ['--version'], {
    windowsHide: true,
    encoding: 'utf8',
  });
  console.log(version.stdout.trim());
  const result = await new Promise((resolve) => {
    const test = spawn(process.execPath, ['--import', 'tsx', 'scripts/database-e2e.ts'], {
      cwd: root,
      env: { ...process.env, TEST_DATABASE_URL: url },
      windowsHide: true,
      stdio: 'inherit',
    });
    test.once('exit', (code) => resolve(code));
  });
  assert.equal(result, 0, 'Postgres runtime contract failed');
} finally {
  if (child?.exitCode === null)
    spawnSync(join(binaries, 'pg_ctl.exe'), ['-D', directory, '-m', 'fast', '-w', 'stop'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  assert.ok(directory.startsWith(resolve('.audit') + sep));
  await rm(directory, { recursive: true, force: true });
}
