import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { launchSystem } from './live-system.js';
const system = await launchSystem();
try {
  const child = spawn(process.execPath, ['scripts/api-examples.mjs'], {
    env: {
      ...process.env,
      API_EXAMPLE_BASE: system.api,
      WEB_ORIGIN: system.web,
      DEMO_PUBLIC_KEY: system.publicKey,
      DEMO_SECRET_KEY: system.secret,
      DASHBOARD_TOKEN: system.dashboard,
    },
    windowsHide: true,
    stdio: 'inherit',
  });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  assert.equal(code, 0, 'the documented API example must pass');
  system.assertCleanLogs();
} finally {
  await system.close();
}
