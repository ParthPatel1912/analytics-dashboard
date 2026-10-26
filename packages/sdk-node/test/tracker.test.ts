import { it, expect, vi } from 'vitest';
import { ServerTracker, HttpTransport, type ServerEvent } from '../src/index.js';
it('builds stitched envelopes and never propagates transport or logger failures', async () => {
  const send = vi.fn(async (_events: ServerEvent[]) => {});
  const tracker = new ServerTracker({ send });
  await tracker.track('order_created', { total: 123 }, 'user', 'anon', 'session');
  expect(send.mock.calls[0][0][0]).toMatchObject({
    source: 'server',
    user_id: 'user',
    anonymous_id: 'anon',
    session_id: 'session',
    properties: { total: 123 },
  });
  const bad = new ServerTracker(
    {
      send: async () => {
        throw new Error('offline');
      },
    },
    () => {
      throw new Error('logger failed');
    },
  );
  await expect(bad.track('order_created')).resolves.toBeUndefined();
});
it('HTTP transport sends bearer auth and retries stable IDs', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: 1, rejected: [] }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const tracker = new ServerTracker(new HttpTransport('https://example.test/events', 'secret'));
    const done = tracker.track('event');
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
it('respects Retry-After longer than one minute', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'Retry-After': '120' }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rejected: [] }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const pending = new HttpTransport('https://example.test/events', 'test-secret').send([]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
it('keeps exponential delay when Retry-After is malformed instead of retrying immediately', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers({ 'Retry-After': 'invalid-date' }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rejected: [] }) });
  vi.stubGlobal('fetch', fetcher);
  try {
    const pending = new HttpTransport('https://example.test/events', 'test-secret').send([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
