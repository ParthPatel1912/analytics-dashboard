import { test, expect, type Page } from '@playwright/test';
import { launchSystem } from '../../../scripts/live-system.js';
let system: Awaited<ReturnType<typeof launchSystem>>;
const date = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
test.beforeAll(async () => {
  system = await launchSystem();
  await system.seedDemo();
  // Compile development routes before timing UI behavior. Assertions must measure
  // the application, not first-use Next compilation on a fresh worker.
  for (const path of [
    '/menu',
    '/cart',
    '/checkout',
    '/dashboard',
    '/order/00000000-0000-4000-8000-000000000000',
    '/api/restaurant/menu',
    '/api/stats/overview',
  ]) {
    const response = await fetch(system.web + path);
    expect(response.status).toBe(200);
  }
});
test.afterAll(async () => {
  system.assertCleanLogs();
  await system.close();
});
async function data(path: string) {
  const response = await fetch(`${system.web}/api/stats/${path}`);
  expect(response.status).toBe(200);
  return await response.json();
}
async function disableAnalytics(page: Page) {
  await page.addInitScript(
    (key) => localStorage.setItem(`ta_${encodeURIComponent(key)}_optout`, '1'),
    system.publicKey,
  );
}
function errors(page: Page) {
  const messages: string[] = [];
  page.on('pageerror', (error) => messages.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration|hydrated.*match/i.test(message.text()))
      messages.push(message.text());
  });
  return messages;
}
test('restaurant checkout produces browser and server events without sending raw identity', async ({
  page,
}) => {
  const logs = errors(page);
  await page.goto(`${system.web}/menu`);
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Garden burrata', exact: true }) });
  await card.getByRole('button', { name: 'Add to bag' }).click();
  await page.getByRole('link', { name: 'View your bag' }).click();
  await expect(page.getByText('Quantity: 1')).toBeVisible();
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Audit Guest');
  await page
    .getByRole('textbox', { name: 'Email for demo identity' })
    .fill('audit-guest@example.com');
  await page.getByRole('button', { name: 'Place demo order' }).click();
  await expect(page).toHaveURL(/\/order\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'Good food is on its way.' })).toBeVisible();
  await expect(page.locator('.cart-total')).toContainText('$12.50');
  const id = page.url().split('/').pop();
  await page.getByRole('link', { name: 'Open analytics' }).click();
  await expect(page.getByRole('heading', { name: 'Visits over time' })).toBeVisible();
  await expect
    .poll(async () =>
      (await data('recent?limit=50')).events.some(
        (e: any) => e.name === 'order_created' && e.properties.order_id === id,
      ),
    )
    .toBe(true);
  const recent = await data('recent?limit=50');
  for (const name of [
    'page_view',
    'menu_item_viewed',
    'add_to_cart',
    'checkout_started',
    'identify',
    'order_created',
  ])
    expect(recent.events.some((e: any) => e.name === name)).toBe(true);
  expect(JSON.stringify(recent)).not.toContain('audit-guest@example.com');
  expect(JSON.stringify(recent)).not.toContain('Audit Guest');
  expect(logs).toEqual([]);
});
test('dashboard filters survive refresh and its KPIs, charts, pages and feed match the API', async ({
  page,
}) => {
  const logs = errors(page);
  await disableAnalytics(page);
  await page.goto(`${system.web}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Visits over time' })).toBeVisible();
  for (const [label, offset] of [
    ['Today', 0],
    ['7 days', -6],
    ['30 days', -29],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe(date(offset));
    await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(date());
  }
  await page.getByLabel('From date', { exact: true }).fill(date(-3));
  await page.getByLabel('To date', { exact: true }).fill(date(-1));
  await page.getByRole('button', { name: 'Hourly', exact: true }).click();
  await page.getByLabel('Selected event', { exact: true }).selectOption('add_to_cart');
  await expect.poll(() => new URL(page.url()).searchParams.get('interval')).toBe('hour');
  await expect.poll(() => new URL(page.url()).searchParams.get('event')).toBe('add_to_cart');
  await page.reload();
  await expect(page.getByLabel('From date', { exact: true })).toHaveValue(date(-3));
  await expect(page.getByLabel('To date', { exact: true })).toHaveValue(date(-1));
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled();
  const params = new URLSearchParams({ from: date(-3), to: date(-1), tz: 'UTC' });
  const overview = await data(`overview?${params}`);
  for (const [title, field] of [
    ['Page views', 'page_views'],
    ['Unique visitors', 'unique_visitors'],
    ['Sessions', 'sessions'],
    ['Orders created', 'orders_created'],
  ])
    await expect(page.locator('.kpi').filter({ hasText: title }).locator('strong')).toHaveText(
      overview[field].toLocaleString('en-US'),
    );
  const pages = await data(`top-pages?${params}`);
  expect(await page.locator('.top-page code').allTextContents()).toEqual(
    pages.pages.map((p: any) => p.path),
  );
  const events = await data(`events?${params}&event=add_to_cart`);
  expect(await page.locator('.event-choice code').allTextContents()).toEqual(
    events.events.map((e: any) => e.name),
  );
  const recent = await data(`recent?${params}&limit=12`);
  await expect(page.locator('.live-panel tbody tr')).toHaveCount(recent.events.length);
  expect(await page.locator('.live-panel tbody tr td:first-child code').allTextContents()).toEqual(
    recent.events.map((e: any) => e.name),
  );
  await expect(page.locator('.main-chart .recharts-line')).toHaveCount(2);
  await expect(page.locator('.trend-chart .recharts-bar')).toHaveCount(1);
  const series = await data(`timeseries?${params}&metric=page_views&interval=hour`);
  expect(series.buckets.reduce((n: number, b: any) => n + b.value, 0)).toBe(overview.page_views);
  expect(logs).toEqual([]);
  await page.screenshot({ path: 'docs/audit-dashboard.png', fullPage: true });
});
test('loading, empty and stopped-API states render without misleading stale KPIs', async ({
  page,
}) => {
  await disableAnalytics(page);
  await page.route('**/api/stats/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto(`${system.web}/dashboard?from=2001-01-01&to=2001-01-02`);
  await expect(page.getByText(/Loading your kitchen/)).toBeVisible();
  await expect(page.getByText('A fresh start. Your story begins here.')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto(`${system.web}/dashboard`);
  await expect(page.locator('.kpi')).toHaveCount(4);
  await system.stopApi();
  try {
    await page.getByRole('button', { name: 'Refresh data' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Analytics API is unavailable' }),
    ).toBeVisible();
    await expect(page.locator('.kpi')).toHaveCount(0);
  } finally {
    await system.startApi();
  }
});
test('checkout does not wait for a hung analytics endpoint', async ({ page }) => {
  await page.route('**/api/v1/events/batch', () => new Promise(() => {}));
  await page.goto(`${system.web}/menu`);
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Garden burrata', exact: true }) })
    .getByRole('button', { name: 'Add to bag' })
    .click();
  await page.getByRole('link', { name: 'View your bag' }).click();
  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Failure Guest');
  await page.getByRole('textbox', { name: 'Email for demo identity' }).fill('failure@example.com');
  await page.getByRole('button', { name: 'Place demo order' }).click();
  await expect(page).toHaveURL(/\/order\/[a-f0-9-]+$/, { timeout: 3000 });
});
test('corrupt persisted cart entries do not render NaN prices or impossible quantities', async ({
  page,
}) => {
  await disableAnalytics(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'restaurant_cart',
      JSON.stringify([
        { item: { id: 1, name: 'Broken item' }, quantity: 1 },
        { item: { id: 2, name: 'Broken quantity', price: 100 }, quantity: 999 },
      ]),
    ),
  );
  await page.goto(`${system.web}/cart`);
  await expect(page.getByText('Something delicious belongs here.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('NaN');
});
