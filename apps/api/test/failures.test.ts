import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  if (f) await f.close();
});
const post = () =>
  request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Origin', config.origin)
    .set('X-Analytics-Key', config.publicKey);
it('returns clean client errors for malformed JSON, unsupported media type and empty body', async () => {
  f = await fixture();
  const results = [
    await post().set('Content-Type', 'application/json').send('{broken'),
    await post().set('Content-Type', 'text/plain').send('{}'),
    await post().send(),
  ];
  for (const response of results) {
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.error).toBeTruthy();
  }
  expect((await request(f.app.server).get('/health')).status).toBe(200);
});
it('returns 422 for entirely invalid huge/deep properties while retaining indexed rejection details', async () => {
  f = await fixture();
  const invalid = [
    event({ properties: { text: 'x'.repeat(8193) } }),
    event({ properties: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } }),
  ];
  for (const e of invalid) {
    const response = await post().send({ events: [e] });
    expect(response.status).toBe(422);
    expect(response.body.rejected).toHaveLength(1);
    expect(response.body.rejected[0].index).toBe(0);
    expect(response.body.rejected[0].reason).toMatch(/8KB|depth/);
  }
  const partial = await post().send({ events: [event(), ...invalid] });
  expect(partial.status).toBe(202);
  expect(partial.body.accepted).toBe(1);
  expect(partial.body.rejected).toHaveLength(2);
});
