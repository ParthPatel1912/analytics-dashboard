import { it, expect } from 'vitest';
import { createAnalytics } from '../src/index.js';
it('imports and operates safely without window', async () => {
  const a = createAnalytics({ writeKey: 'x', endpoint: 'https://example.test' });
  expect(() => {
    a.track('test');
    a.page();
    a.reset();
    a.identify('user');
    a.optIn();
    a.optOut();
    a.shutdown();
  }).not.toThrow();
  await a.flush();
  expect(a.getIdentity()).toBeNull();
});
