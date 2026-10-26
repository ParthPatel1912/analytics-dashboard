import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { launchSystem } from './live-system.js';
import { createAnalytics, type Analytics } from '../packages/sdk-js/src/index.js';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const system = await launchSystem(),
  dom = new JSDOM('<title>Failure QA</title>', { url: system.web });
const keys = [
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'screen',
  'localStorage',
] as const;
const descriptors = new Map(
  keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const originalFetch = globalThis.fetch;
const rejected: unknown[] = [];
const onRejection = (error: unknown) => rejected.push(error);
process.on('unhandledRejection', onRejection);
let tracker: Analytics | undefined;
try {
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: dom.window[key],
    });
  globalThis.fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Origin', system.web);
    return originalFetch(url, { ...init, headers });
  };
  const options = {
    writeKey: system.publicKey,
    endpoint: `${system.api}/api/v1/events/batch`,
    autoPageViews: false,
  };
  await system.stopApi();
  tracker = createAnalytics(options);
  assert.doesNotThrow(() => tracker!.track('outage_queued', { test: true }));
  await tracker.flush();
  const storageKey = `ta_${encodeURIComponent(system.publicKey)}_queue`;
  const queued = JSON.parse(localStorage.getItem(storageKey)!);
  assert.equal(queued.length, 1);
  const id = queued[0].event.event_id;
  tracker.shutdown();
  await system.startApi();
  tracker = createAnalytics(options);
  await tracker.flush();
  const feed = await originalFetch(`${system.api}/api/v1/events/recent`, {
    headers: { Authorization: `Bearer ${system.dashboard}` },
  });
  const body = (await feed.json()) as any;
  assert.equal(
    body.events.filter((e: any) => e.event_id === id && e.name === 'outage_queued').length,
    1,
  );
  assert.deepEqual(JSON.parse(localStorage.getItem(storageKey)!), []);
  console.log(
    'PASS stopped API -> SDK queues without host errors -> reload tracker -> restarted API accepts same UUID exactly once',
  );
  const envelope = {
    event_id: randomUUID(),
    name: 'concurrent_event',
    timestamp: new Date().toISOString(),
    anonymous_id: 'failure-visitor',
    session_id: 'failure-session',
    user_id: null,
    source: 'browser',
    properties: {},
    context: {},
  };
  const headers = {
    'Content-Type': 'application/json',
    Origin: system.web,
    'X-Analytics-Key': system.publicKey,
  };
  const endpoint = `${system.api}/api/v1/events/batch`;
  const responses = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const response = await originalFetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: [envelope] }),
      });
      assert.equal(response.status, 202);
      return (await response.json()) as any;
    }),
  );
  assert.equal(
    responses.reduce((n, r) => n + r.accepted, 0),
    1,
  );
  assert.equal(
    responses.reduce((n, r) => n + r.duplicates, 0),
    11,
  );
  console.log('PASS 12 simultaneous live submissions -> one insert, eleven duplicates');
  const payloads = [
    { body: '{broken', content: 'application/json', status: 400 },
    { body: '{}', content: 'application/xml', status: 415 },
    { body: '{}', content: 'text/plain', status: 422 },
    { body: '', content: 'application/json', status: 400 },
    {
      body: JSON.stringify({ events: [{ ...envelope, properties: { value: 'x'.repeat(8193) } }] }),
      content: 'application/json',
      status: 422,
    },
    {
      body: JSON.stringify({
        events: [{ ...envelope, properties: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }],
      }),
      content: 'application/json',
      status: 422,
    },
  ];
  for (const payload of payloads) {
    const response = await originalFetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': payload.content },
      body: payload.body,
    });
    assert.equal(response.status, payload.status);
    assert.ok(((await response.json()) as any).error);
  }
  assert.equal((await originalFetch(`${system.api}/health`)).status, 200);
  console.log(
    'PASS malformed JSON, media type, empty body, huge/deep properties -> clean 4xx and healthy process',
  );
  system.assertCleanLogs();
  assert.deepEqual(rejected, []);
  console.log('FAILURE E2E PASS: no uncaught/unhandled errors or secret leakage');
} catch (error) {
  console.error(system.safeLogs());
  throw error;
} finally {
  tracker?.shutdown();
  process.off('unhandledRejection', onRejection);
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    const descriptor = descriptors.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as any)[key];
  }
  dom.window.close();
  await system.close();
}
