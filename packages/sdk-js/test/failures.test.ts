// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createAnalytics, type Analytics } from '../src/index.js';
const instances: Analytics[] = [];
const ok = { ok: true, status: 202, headers: new Headers() };
const create = () => {
  const a = createAnalytics({ writeKey: 'failure', endpoint: '/events', autoPageViews: false });
  instances.push(a);
  return a;
};
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  for (const cookie of document.cookie.split(';'))
    document.cookie = cookie.split('=')[0].trim() + '=; Max-Age=0; Path=/';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ok),
  );
});
afterEach(() => {
  instances.splice(0).forEach((a) => a.shutdown());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('retains opt-out after reload when localStorage can be read but writes are blocked', async () => {
  const first = create();
  first.optIn();
  first.shutdown();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded');
  });
  const second = create();
  second.optOut();
  second.shutdown();
  const reloaded = create();
  expect(reloaded.getIdentity()).toBeNull();
  reloaded.track('must_not_send');
  await reloaded.flush();
  expect(fetch).not.toHaveBeenCalled();
});
it('does not recreate retry timers after shutdown when an in-flight request fails', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const a = create();
  a.track('pending');
  const pending = a.flush();
  a.shutdown();
  reject(new Error('offline'));
  await pending;
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds a hung fetch and recovers delivery rather than keeping busy forever', async () => {
  vi.mocked(fetch).mockImplementationOnce(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const a = create();
  a.track('pending');
  const pending = a.flush();
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetch).toHaveBeenCalledTimes(2);
  await pending;
  expect(JSON.parse(localStorage.getItem('ta_failure_queue')!)).toEqual([]);
});
it('cancels the old backoff on opt-out so a later opt-in can deliver new events', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 429,
    headers: new Headers({ 'Retry-After': '3600' }),
  } as Response);
  const a = create();
  a.track('before');
  await a.flush();
  a.optOut();
  a.optIn();
  a.track('after');
  await a.flush();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]!.body)).events[0].name).toBe('after');
});
