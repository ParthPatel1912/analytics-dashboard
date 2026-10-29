// Run from the repository root: node --env-file=.env scripts/api-examples.mjs
// Creates demonstration events and one demonstration order. No payment is taken.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const api = process.env.API_EXAMPLE_BASE || process.env.API_URL || 'http://127.0.0.1:4000';
const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
for (const name of ['DEMO_PUBLIC_KEY', 'DEMO_SECRET_KEY', 'DASHBOARD_TOKEN'])
  assert.ok(process.env[name], `${name} is required; load .env`);
const publicHeaders = {
  'Content-Type': 'application/json',
  Origin: origin,
  'X-Analytics-Key': process.env.DEMO_PUBLIC_KEY,
};
const dashboardHeaders = { Authorization: `Bearer ${process.env.DASHBOARD_TOKEN}` };
let checks = 0;
async function call(path, { expected = 200, ...init } = {}) {
  const response = await fetch(api + path, init);
  assert.equal(response.status, expected, `${init.method || 'GET'} ${path}`);
  const body = response.status === 204 ? null : await response.json();
  checks++;
  console.log(`${init.method || 'GET'} ${path.split('?')[0]} -> ${response.status}`);
  return body;
}
const event = {
  event_id: randomUUID(),
  name: 'page_view',
  timestamp: new Date().toISOString(),
  anonymous_id: 'docs_' + randomUUID(),
  session_id: randomUUID(),
  user_id: null,
  source: 'browser',
  properties: {},
  context: { path: '/menu', title: 'API example' },
};
const post = (events, expected = 202, headers = publicHeaders) =>
  call('/api/v1/events/batch', {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
    expected,
  });
await call('/health');
assert.deepEqual(await post([event]), { accepted: 1, duplicates: 0, rejected: [] });
assert.equal((await post([event])).duplicates, 1);
const partial = await post([
  { ...event, event_id: randomUUID(), name: 'docs_action' },
  { ...event, name: 'INVALID EVENT' },
]);
assert.equal(partial.accepted, 1);
assert.equal(partial.rejected[0].index, 1);
assert.equal(typeof partial.rejected[0].reason, 'string');
const allInvalid = await post([{ ...event, properties: { text: 'x'.repeat(8193) } }], 422);
assert.equal(allInvalid.error, 'no_valid_events');
await post([event], 401, { ...publicHeaders, 'X-Analytics-Key': 'invalid-example-key' });
await post([event], 403, { ...publicHeaders, Origin: 'https://not-allowed.example' });
await post(
  Array.from({ length: 51 }, () => event),
  422,
);
await post([{ ...event, properties: { text: 'x'.repeat(270000) } }], 413);
await call('/api/v1/events/batch', {
  method: 'POST',
  headers: publicHeaders,
  body: '{broken',
  expected: 400,
});
await call('/api/v1/events/batch', {
  method: 'POST',
  headers: { ...publicHeaders, 'Content-Type': 'application/xml' },
  body: '<event/>',
  expected: 415,
});
await call('/api/v1/events/batch', {
  method: 'OPTIONS',
  headers: {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type,x-analytics-key',
  },
  expected: 204,
});
await call('/api/v1/events/batch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({
    write_key: process.env.DEMO_PUBLIC_KEY,
    events: [{ ...event, event_id: randomUUID(), name: 'docs_beacon' }],
  }),
  expected: 202,
});
await post(
  [{ ...event, event_id: randomUUID(), source: 'server', name: 'docs_server_check' }],
  202,
  { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEMO_SECRET_KEY}` },
);
const menu = await call('/api/menu');
assert.ok(menu.items.length);
const item = menu.items[0];
const order = await call('/api/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Analytics-Anonymous-Id': event.anonymous_id,
    'X-Analytics-Session-Id': event.session_id,
  },
  body: JSON.stringify({ items: [{ menu_item_id: item.id, quantity: 2, price: 1 }] }),
  expected: 201,
});
assert.equal(order.total, item.price * 2);
assert.equal(order.currency, 'USD');
const receipt = await call(`/api/orders/${order.id}`);
assert.equal(receipt.items[0].quantity, 2);
assert.equal(receipt.items[0].unit_price, item.price);
await call(`/api/orders/${randomUUID()}`, { expected: 404 });
await call('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{ menu_item_id: 999999, quantity: 1 }] }),
  expected: 422,
});
const today = new Date().toISOString().slice(0, 10),
  range = new URLSearchParams({ from: today, to: today, tz: 'UTC' });
const overview = await call(`/api/v1/stats/overview?${range}`, { headers: dashboardHeaders });
assert.ok(overview.page_views >= 1);
assert.ok(overview.orders_created >= 1);
const series = await call(`/api/v1/stats/timeseries?${range}&metric=page_views&interval=day`, {
  headers: dashboardHeaders,
});
assert.equal(series.buckets.length, 1);
assert.equal(series.buckets[0].value, overview.page_views);
const pages = await call(`/api/v1/stats/top-pages?${range}&limit=10`, {
  headers: dashboardHeaders,
});
assert.ok(pages.pages.some((p) => p.path === '/menu'));
const events = await call(`/api/v1/stats/events?${range}&event=docs_action`, {
  headers: dashboardHeaders,
});
assert.ok(events.events.some((e) => e.name === 'docs_action'));
assert.ok(events.trend.buckets[0].value >= 1);
const recent = await call(`/api/v1/events/recent?${range}&limit=100`, {
  headers: dashboardHeaders,
});
assert.ok(
  recent.events.some((e) => e.name === 'order_created' && e.properties.order_id === order.id),
);
await call('/api/v1/stats/overview', { expected: 401 });
await call('/api/v1/stats/overview?from=2026-02-30T00:00:00Z', {
  headers: dashboardHeaders,
  expected: 422,
});
console.log(
  `API EXAMPLES PASS: ${checks} runnable requests; generated timestamps/order IDs and asserted responses`,
);
