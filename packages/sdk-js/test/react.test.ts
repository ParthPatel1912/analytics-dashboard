// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { StrictMode, createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalyticsProvider } from '../src/react.js';
it('does not double-count initial page views when React Strict Mode replays effects', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 202 })),
  );
  localStorage.clear();
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    const options = { writeKey: 'strict-mode', endpoint: '/events' };
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(AnalyticsProvider, { options, children: null }),
        ),
      );
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body.events).toHaveLength(1);
    expect(body.events[0].name).toBe('page_view');
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
