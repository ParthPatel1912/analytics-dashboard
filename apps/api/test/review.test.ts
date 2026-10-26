import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
import { safeEqual } from '../src/app.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  if (f) await f.close();
});
const routes = [
  'stats/overview',
  'stats/timeseries',
  'stats/top-pages',
  'stats/events',
  'events/recent',
];
it('requires a Bearer scheme on every query endpoint rather than accepting a raw token', async () => {
  f = await fixture();
  for (const route of routes) {
    expect((await request(f.app.server).get(`/api/v1/${route}`)).status).toBe(401);
    expect(
      (
        await request(f.app.server)
          .get(`/api/v1/${route}`)
          .set('Authorization', config.dashboardToken)
      ).status,
    ).toBe(401);
    expect(
      (await request(f.app.server).get(`/api/v1/${route}`).auth('wrong', { type: 'bearer' }))
        .status,
    ).toBe(401);
  }
});
it('handles case-insensitive HTTP Bearer schemes for server and dashboard credentials', async () => {
  f = await fixture();
  const server = await request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Authorization', `bearer ${config.secretKey}`)
    .send({ events: [event({ source: 'server' })] });
  expect(server.status).toBe(202);
  expect(server.body.accepted).toBe(1);
  for (const route of routes)
    expect(
      (
        await request(f.app.server)
          .get(`/api/v1/${route}`)
          .set('Authorization', `bEaReR ${config.dashboardToken}`)
      ).status,
    ).toBe(200);
});
it('compares UTF-8 credentials without throwing for strings of equal character but different byte length', () => {
  expect(() => safeEqual('🔑', 'ab')).not.toThrow();
  expect(safeEqual('🔑', 'ab')).toBe(false);
  expect(safeEqual('same', 'same')).toBe(true);
});
it('rejects rolled-over calendar dates in full UTC timestamp query parameters', async () => {
  f = await fixture();
  for (const value of ['2026-02-30T00:00:00Z', '2026-10-25T24:00:00Z']) {
    const response = await request(f.app.server)
      .get('/api/v1/stats/overview')
      .query({ from: value, to: '2026-10-26T23:59:59Z' })
      .auth(config.dashboardToken, { type: 'bearer' });
    expect(response.status).toBe(422);
  }
});
it('canonicalizes equivalent uppercase/lowercase UUIDs for idempotent replay', async () => {
  f = await fixture();
  const e = event();
  const post = (value: unknown) =>
    request(f.app.server)
      .post('/api/v1/events/batch')
      .set('Origin', config.origin)
      .set('X-Analytics-Key', config.publicKey)
      .send({ events: [value] });
  expect((await post(e)).body.accepted).toBe(1);
  expect((await post({ ...e, event_id: e.event_id.toUpperCase() })).body.duplicates).toBe(1);
  expect(await f.db('events')).toHaveLength(1);
});
it('stores hashed secrets, truncates untrusted UA and has no IP storage columns', async () => {
  f = await fixture();
  const project = await f.db('projects').first();
  expect(project.secret_key_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(project.secret_key_hash).not.toBe(config.secretKey);
  const response = await request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Origin', config.origin)
    .set('X-Analytics-Key', config.publicKey)
    .send({ events: [event({ context: { path: '/menu', user_agent: 'x'.repeat(2000) } })] });
  expect(response.status).toBe(202);
  expect(JSON.parse((await f.db('events').first()).context).user_agent).toHaveLength(500);
  expect(
    Object.keys(await f.db('events').columnInfo()).some((column) => /(^|_)ip($|_)/.test(column)),
  ).toBe(false);
});
