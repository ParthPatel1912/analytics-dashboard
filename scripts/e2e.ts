import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { launchSystem } from './live-system.js';

const system = await launchSystem();
let checks = 0;
function check(name: string) {
  checks++;
  console.log(`PASS ${name}`);
}
const envelope = (extra: Record<string, unknown> = {}) => ({
  event_id: randomUUID(),
  name: 'page_view',
  timestamp: new Date().toISOString(),
  anonymous_id: 'e2e-initial',
  session_id: 'e2e-initial-session',
  user_id: null,
  source: 'browser',
  properties: {},
  context: { path: '/menu' },
  ...extra,
});
async function ingest(
  events: unknown[],
  extra: { key?: string; origin?: string; bodyKey?: boolean; queryKey?: boolean } = {},
) {
  const url = `${system.api}/api/v1/events/batch${extra.queryKey ? `?write_key=${encodeURIComponent(system.publicKey)}` : ''}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: extra.origin || system.web,
  };
  if (!extra.bodyKey && !extra.queryKey) headers['X-Analytics-Key'] = extra.key || system.publicKey;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events, ...(extra.bodyKey ? { write_key: system.publicKey } : {}) }),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as any,
  };
}
async function stats(path = 'stats/overview') {
  const response = await fetch(`${system.api}/api/v1/${path}`, {
    headers: { Authorization: `Bearer ${system.dashboard}` },
  });
  assert.equal(response.status, 200);
  return (await response.json()) as any;
}
try {
  const event = envelope();
  const valid = await ingest([event]);
  assert.equal(valid.status, 202);
  assert.deepEqual(valid.body, { accepted: 1, duplicates: 0, rejected: [] });
  check('valid public-key batch -> 202, accepted 1');
  const beforeReplay = await stats();
  const replay = await ingest([event]);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.duplicates, 1);
  assert.deepEqual(await stats(), beforeReplay);
  check('replay -> duplicate 1, aggregate row count unchanged');
  const partial = await ingest([
    envelope({ name: 'custom_action' }),
    envelope({ name: 'INVALID EVENT' }),
  ]);
  assert.equal(partial.status, 202);
  assert.equal(partial.body.accepted, 1);
  assert.equal(partial.body.rejected[0].index, 1);
  assert.ok(partial.body.rejected[0].reason);
  check('partially valid batch accepts only valid event');
  assert.equal((await ingest([envelope()], { key: 'wrong' })).status, 401);
  assert.equal((await ingest([envelope()], { origin: 'https://disallowed.example' })).status, 403);
  assert.equal((await ingest(Array.from({ length: 51 }, () => envelope()))).status, 422);
  assert.equal(
    (await ingest([envelope({ properties: { huge: 'x'.repeat(270000) } })])).status,
    413,
  );
  check('wrong key, wrong origin, batch size and body bounds');
  const preflight = await fetch(`${system.api}/api/v1/events/batch`, {
    method: 'OPTIONS',
    headers: {
      Origin: system.web,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-analytics-key',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), system.web);
  assert.equal((await ingest([envelope()], { bodyKey: true })).body.accepted, 1);
  assert.equal((await ingest([envelope()], { queryKey: true })).body.accepted, 1);
  check('CORS preflight and body/query-key beacon transports');
  const before = await stats(),
    anon = randomUUID(),
    session = randomUUID();
  const flow = await ingest([
    envelope({ anonymous_id: anon, session_id: session }),
    envelope({
      anonymous_id: anon,
      session_id: session,
      name: 'add_to_cart',
      properties: { menu_item_id: 1 },
    }),
  ]);
  assert.equal(flow.status, 202);
  assert.equal(flow.body.accepted, 2);
  const menuResponse = await fetch(`${system.web}/api/restaurant/menu`);
  assert.equal(menuResponse.status, 200);
  const menu = (await menuResponse.json()) as any;
  const orderResponse = await fetch(`${system.web}/api/restaurant/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Analytics-Anonymous-Id': anon,
      'X-Analytics-Session-Id': session,
    },
    body: JSON.stringify({ items: [{ menu_item_id: menu.items[0].id, quantity: 2, price: 1 }] }),
  });
  assert.equal(orderResponse.status, 201);
  const order = (await orderResponse.json()) as any;
  assert.equal(order.total, menu.items[0].price * 2);
  let after = await stats();
  for (let i = 0; i < 50 && after.orders_created !== before.orders_created + 1; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    after = await stats();
  }
  assert.equal(after.total_events - before.total_events, 3);
  assert.equal(after.page_views - before.page_views, 1);
  assert.equal(after.orders_created - before.orders_created, 1);
  assert.equal(after.unique_visitors - before.unique_visitors, 1);
  assert.equal(after.sessions - before.sessions, 1);
  const breakdown = await stats('stats/events?event=add_to_cart');
  assert.equal(breakdown.events.find((e: any) => e.name === 'add_to_cart').count, 1);
  const recent = await stats('events/recent');
  const serverEvent = recent.events.find((e: any) => e.properties.order_id === order.id);
  assert.equal(serverEvent.anonymous_id, anon);
  assert.equal(serverEvent.session_id, session);
  assert.equal(serverEvent.source, 'server');
  assert.equal(serverEvent.properties.total, order.total);
  assert.equal((await fetch(`${system.web}/order/${order.id}`)).status, 200);
  check(
    'page_view -> add_to_cart -> real Next proxy checkout -> stitched stats, authoritative total and receipt',
  );
  const failedOrder = await fetch(`${system.api}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ menu_item_id: 999999, quantity: 1 }] }),
  });
  assert.equal(failedOrder.status, 422);
  assert.equal((await stats()).orders_created, after.orders_created);
  check('failed order emits no order_created');
  const limited = await Promise.all(Array.from({ length: 125 }, () => ingest([envelope()])));
  const blocked = limited.filter((r) => r.status === 429);
  assert.ok(blocked.length > 0);
  assert.ok(blocked.every((r) => Number(r.headers.get('Retry-After')) > 0));
  check('real per-key 120/min throttle -> 429 with Retry-After');
  const proxyStats = await fetch(`${system.web}/api/stats/overview`);
  assert.equal(proxyStats.status, 200);
  system.assertCleanLogs();
  check('dashboard proxy works; no leaked secrets or uncaught/unhandled errors in server logs');
  console.log(`E2E PASS: ${checks} grouped checks against real API + Next processes`);
} catch (error) {
  console.error(system.safeLogs());
  throw error;
} finally {
  await system.close();
}
