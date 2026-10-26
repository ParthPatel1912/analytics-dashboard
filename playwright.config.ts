import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 5000 },
  use: {
    browserName: 'chromium',
    channel:
      process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: '.audit/playwright',
  reporter: [['list'], ['json', { outputFile: '.audit/browser.json' }]],
});
