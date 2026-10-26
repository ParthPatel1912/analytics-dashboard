// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createAnalytics, type Analytics } from '../src/index.js';
const instances: Analytics[] = [];
let sent: any[];
function create(extra = {}) {
  const a = createAnalytics({
    writeKey: 'test',
    endpoint: '/events',
    autoPageViews: false,
    ...extra,
  });
  instances.push(a);
  return a;
}
const ok = (status = 202, retry?: string) => ({
  ok: status < 300,
  status,
  headers: { get: () => retry || null },
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.split('=')[0].trim() + '=; Max-Age=0; Path=/';
  });
  history.replaceState({}, '', '/');
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return ok();
    }),
  );
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '0' });
});
afterEach(() => {
  instances.splice(0).forEach((a) => a.shutdown());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('batches by size and interval', async () => {
  const a = create({ maxBatchSize: 2 });
  a.track('one');
  expect(fetch).not.toHaveBeenCalled();
  a.track('two');
  await vi.advanceTimersByTimeAsync(0);
  expect(sent[0].events).toHaveLength(2);
  a.page();
  await vi.advanceTimersByTimeAsync(5000);
  expect(sent[1].events[0].name).toBe('page_view');
});
it('uses beacon on pagehide and retains persisted events for acknowledged replay', async () => {
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
  const a = create();
  a.track('test');
  window.dispatchEvent(new Event('pagehide'));
  expect(beacon).toHaveBeenCalledOnce();
  expect(JSON.parse(localStorage.getItem('ta_test_queue')!)).toHaveLength(1);
  await a.flush();
  expect(sent[0].events).toHaveLength(1);
});
it('retries server and network failures, respects Retry-After, drops permanent 4xx', async () => {
  const a = create();
  vi.mocked(fetch)
    .mockResolvedValueOnce(ok(429, '10') as any)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(ok(500) as any)
    .mockResolvedValueOnce(ok(400) as any);
  a.track('test');
  await a.flush();
  await vi.advanceTimersByTimeAsync(9999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetch).toHaveBeenCalledTimes(4);
  await a.flush();
  expect(fetch).toHaveBeenCalledTimes(4);
});
it('caps retries and persists across reload with stable UUID', async () => {
  const a = create();
  a.track('test');
  const id = JSON.parse(localStorage.getItem('ta_test_queue')!)[0].event.event_id;
  vi.mocked(fetch).mockResolvedValue(ok(503) as any);
  a.shutdown();
  await vi.advanceTimersByTimeAsync(0);
  const b = create();
  await b.flush();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body)).events[0].event_id).toBe(
    id,
  );
  await vi.advanceTimersByTimeAsync(180000);
  expect(JSON.parse(localStorage.getItem('ta_test_queue')!)).toHaveLength(0);
});
it('tracks SPA routes with dedupe and restores history on shutdown', async () => {
  const original = history.pushState;
  const a = create({ autoPageViews: true });
  history.pushState({}, '', '/menu');
  history.replaceState({}, '', '/menu');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await a.flush();
  expect(sent[0].events.map((e: any) => e.context.path)).toEqual(['/', '/menu']);
  a.shutdown();
  expect(history.pushState).toBe(original);
});
it('identifies, resets and expires sessions after inactivity', async () => {
  const a = create();
  const before = a.getIdentity()!;
  a.identify('opaque-user');
  a.track('hello');
  await a.flush();
  expect(sent[0].events[1].user_id).toBe('opaque-user');
  await vi.advanceTimersByTimeAsync(30 * 60000 + 1);
  expect(a.getIdentity()!.session_id).not.toBe(before.session_id);
  a.reset();
  expect(a.getIdentity()!.anonymous_id).not.toBe(before.anonymous_id);
  expect(a.getIdentity()!.user_id).toBeNull();
});
it('honors opt-out and Do Not Track', async () => {
  const a = create();
  a.track('before');
  a.optOut();
  a.track('after');
  await a.flush();
  expect(fetch).not.toHaveBeenCalled();
  a.optIn();
  a.track('again');
  await a.flush();
  expect(sent).toHaveLength(1);
  Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
  a.track('private');
  await a.flush();
  expect(sent).toHaveLength(1);
});
it('does not throw when storage is unavailable or properties are cyclic', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const a = create();
  const cyclic: any = {};
  cyclic.self = cyclic;
  expect(() => {
    a.track('cyclic', cyclic);
    a.page();
    a.identify('u');
    a.reset();
  }).not.toThrow();
  await a.flush();
  expect(sent[0].events.length).toBeGreaterThan(0);
});
it('drains byte-bounded batches without overlapping requests', async () => {
  let release!: (value: any) => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const a = create({ maxBatchSize: 50 });
  for (let i = 0; i < 20; i++) a.track('large_event', { text: 'x'.repeat(7800) });
  const flushing = a.flush();
  await a.flush();
  expect(fetch).toHaveBeenCalledTimes(1);
  release(ok());
  await flushing;
  expect(fetch).toHaveBeenCalledTimes(3);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls.reduce((n, c) => n + JSON.parse(String(c[1]!.body)).events.length, 0)).toBe(20);
  expect(calls.every((c) => new TextEncoder().encode(String(c[1]!.body)).length < 64000)).toBe(
    true,
  );
});
it('supports later opt-in and storage-free in-memory identity', async () => {
  const a = create();
  a.optOut();
  a.shutdown();
  const b = create();
  b.optIn();
  b.track('consented');
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).toHaveBeenCalled();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
    throw new Error('blocked');
  });
  const c = create();
  const id = c.getIdentity();
  expect(id?.anonymous_id).toBeTruthy();
  c.track('safe');
  expect(c.getIdentity()?.anonymous_id).toBe(id?.anonymous_id);
});
