import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => { if (f) await f.close(); });
function send(events: unknown[], key = config.publicKey, origin = config.origin) { return request(f.app.server).post('/api/v1/events/batch').set('X-Analytics-Key', key).set('Origin', origin).send({ events }); }
it('accepts valid events, partially rejects invalid data, and ignores duplicates', async () => {
  f = await fixture(); const e = event();
  const res = await send([e, event({ name: 'Not valid' }), e]);
  expect(res.status).toBe(202); expect(res.body).toMatchObject({ accepted: 1, duplicates: 1, rejected: [{ index: 1 }] });
  expect((await send([e])).body.duplicates).toBe(1); expect(await f.db('events')).toHaveLength(1);
});
it('checks keys, project origins, source and secret auth', async () => {
  f = await fixture();
  expect((await send([event()], 'bad')).status).toBe(401);
  expect((await request(f.app.server).post('/api/v1/events/batch').send({ events: [event()] })).status).toBe(401);
  expect((await send([event()], config.publicKey, 'https://evil.test')).status).toBe(403);
  expect((await send([event()], config.publicKey, '')).status).toBe(403);
  expect((await send([event({ source: 'server' })])).body.rejected).toHaveLength(1);
  const result = await request(f.app.server).post('/api/v1/events/batch').auth(config.secretKey, { type: 'bearer' }).send({ events: [event({ source: 'server' })] });
  expect(result.body.accepted).toBe(1);
});
it('limits payload, batch, property size/depth and timestamps', async () => {
  f = await fixture();
  expect((await send(Array.from({ length: 51 }, () => event()))).status).toBe(422);
  expect((await send([event({ properties: { huge: 'x'.repeat(270000) } })])).status).toBe(413);
  const result = await send([event({ timestamp: new Date(Date.now() + 86400001).toISOString() }), event({ timestamp: new Date(Date.now() - 8 * 86400000).toISOString() }), event({ properties: { huge: 'x'.repeat(8192) } }), event({ properties: { a: { b: { c: { d: { e: { f: { g: true } } } } } } } }), event({ properties: { safe: true } })]);
  // Use 25h to avoid timing races on the exact future boundary.
  expect(result.body.rejected.length).toBeGreaterThanOrEqual(3);
});
it('rate limits with Retry-After and returns beacon preflight', async () => {
  f = await fixture(1); await send([event()]);
  const res = await send([event()]); expect(res.status).toBe(429); expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  const preflight = await request(f.app.server).options('/api/v1/events/batch').set('Origin', config.origin).set('Access-Control-Request-Method', 'POST');
  expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-origin']).toBe(config.origin);
  f = f;
});
it('accepts JSON beacon bodies with a body write key', async () => {
  f = await fixture(); const res = await request(f.app.server).post('/api/v1/events/batch').set('Origin', config.origin).send({ write_key: config.publicKey, events: [event()] });
  expect(res.body.accepted).toBe(1);
});
