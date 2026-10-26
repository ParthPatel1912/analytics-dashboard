import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort() {
  const server = createServer();
  await new Promise<void>((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((ready, reject) =>
    server.close((error) => (error ? reject(error) : ready())),
  );
  return port;
}
export async function waitFor(url: string, child?: ChildProcess) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw new Error(`Server exited before readiness: ${child.exitCode}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
export async function launchSystem() {
  const directory = join(root, '.audit', `live-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const apiPort = await freePort(),
    webPort = await freePort();
  const api = `http://127.0.0.1:${apiPort}`,
    web = `http://127.0.0.1:${webPort}`;
  const secret = randomBytes(32).toString('hex'),
    dashboard = randomBytes(32).toString('hex'),
    publicKey = `pk_${randomUUID()}`;
  const env = {
    ...process.env,
    ...dotenv.parse(await readFile(join(root, '.env.example'))),
    PORT: String(apiPort),
    API_URL: api,
    WEB_ORIGIN: web,
    NEXT_PUBLIC_ANALYTICS_ENDPOINT: `${api}/api/v1/events/batch`,
    SQLITE_FILE: join(directory, 'analytics.sqlite'),
    DATABASE_URL: '',
    DEMO_PUBLIC_KEY: publicKey,
    DEMO_SECRET_KEY: secret,
    DASHBOARD_TOKEN: dashboard,
    RATE_LIMIT: '120',
    BLOCK_BOTS: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  let logs = '',
    apiProcess: ChildProcess | undefined,
    webProcess: ChildProcess | undefined;
  const children = new Set<ChildProcess>();
  function start(args: string[], cwd: string) {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.add(child);
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data) => {
        logs = (logs + String(data)).slice(-500000);
      });
    child.on('error', (error) => {
      logs += `\nspawn error: ${error.message}`;
    });
    return child;
  }
  async function stop(child?: ChildProcess) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    else child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        const timeout = setTimeout(resolve, 5000);
        child.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      }
    });
  }
  const system = {
    api,
    web,
    publicKey,
    secret,
    dashboard,
    directory,
    async startApi() {
      apiProcess = start(['--import', 'tsx', 'apps/api/src/index.ts'], root);
      await waitFor(`${api}/health`, apiProcess);
    },
    async stopApi() {
      await stop(apiProcess);
    },
    assertCleanLogs() {
      assert.doesNotMatch(logs, /"remoteAddress":"(?!\[Redacted\])[^\"]+"/);
      assert.doesNotMatch(
        logs,
        /UnhandledPromiseRejection|uncaughtException|ERR_UNHANDLED_REJECTION/,
      );
      assert.ok(
        !logs.includes(secret) && !logs.includes(dashboard),
        'server logs must not contain secret credentials',
      );
    },
    safeLogs() {
      return logs
        .replaceAll(secret, '[REDACTED]')
        .replaceAll(dashboard, '[REDACTED]')
        .split('\n')
        .slice(-20)
        .join('\n');
    },
    async close() {
      for (const child of children) await stop(child);
      const parent = resolve(root, '.audit') + sep;
      assert.ok(resolve(directory).startsWith(parent), 'cleanup must stay in the audit directory');
      await rm(directory, { recursive: true, force: true });
    },
  };
  try {
    await system.startApi();
    const require = createRequire(join(root, 'apps/web/package.json'));
    webProcess = start(
      [
        require.resolve('next/dist/bin/next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(webPort),
      ],
      join(root, 'apps/web'),
    );
    await waitFor(web, webProcess);
    return system;
  } catch (error) {
    console.error(system.safeLogs());
    await system.close();
    throw error;
  }
}
