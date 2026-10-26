import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
import { ingest } from '../src/ingestion.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  if (f) await f.close();
});
const get = (path: string) =>
  request(f.app.server).get(path).auth(config.dashboardToken, { type: 'bearer' });
async function insert(events: ReturnType<typeof event>[]) {
  const project = await f.db('projects').first();
  await ingest(f.db, project.id, events, undefined, Date.parse('2026-10-26T12:00:00Z'));
}
it('counts identity exactly, scopes projects and includes date boundaries', async () => {
  f = await fixture();
  await insert([
    event({ timestamp: '2026-10-25T00:00:00.000Z' }),
    event({ timestamp: '2026-10-25T23:59:59.999Z', user_id: 'user-a' }),
    event({ timestamp: '2026-10-26T00:00:00.000Z', anonymous_id: 'other' }),
  ]);
  const res = await get('/api/v1/stats/overview?from=2026-10-25&to=2026-10-25');
  expect(res.body).toMatchObject({
    total_events: 2,
    unique_visitors: 2,
    sessions: 1,
    page_views: 2,
  });
  expect((await request(f.app.server).get('/api/v1/stats/overview')).status).toBe(401);
  expect((await get('/api/v1/stats/overview?from=2020-01-01&to=2026-01-01')).status).toBe(422);
  expect((await get('/api/v1/stats/overview?tz=Bad/Zone')).status).toBe(422);
  expect((await get('/api/v1/stats/overview?from=2026-02-30')).status).toBe(422);
});
it('zero fills, orders top pages, and counts distinct visitors across each bucket', async () => {
  f = await fixture();
  await insert([
    event({ timestamp: '2026-10-25T12:00:00Z' }),
    event({ timestamp: '2026-10-25T13:00:00Z' }),
    event({ timestamp: '2026-10-25T14:00:00Z', context: { path: '/' }, anonymous_id: 'b' }),
  ]);
  const res = await get('/api/v1/stats/timeseries?from=2026-10-24&to=2026-10-26&metric=visitors');
  expect(res.body.buckets.map((b: any) => b.value)).toEqual([0, 2, 0]);
  const pages = await get('/api/v1/stats/top-pages?from=2026-10-24&to=2026-10-26');
  expect(pages.body.pages[0]).toMatchObject({ path: '/menu', views: 2, unique_visitors: 1 });
});
it('handles fractional timezone offsets, event filters and DST transitions', async () => {
  f = await fixture();
  await insert([
    event({ timestamp: '2026-10-25T19:15:00Z' }),
    event({ timestamp: '2026-10-25T19:45:00Z', name: 'add_to_cart' }),
  ]);
  const res = await get(
    '/api/v1/stats/timeseries?from=2026-10-25T19:00:00Z&to=2026-10-25T20:00:00Z&tz=Asia/Kolkata&interval=hour&metric=events',
  );
  expect(res.body.buckets).toEqual([
    { bucket: '2026-10-26T00:00', value: 1 },
    { bucket: '2026-10-26T01:00', value: 1 },
  ]);
  const filtered = await get(
    '/api/v1/stats/events?from=2026-10-25&to=2026-10-26&event=add_to_cart',
  );
  expect(filtered.body.trend.buckets.map((b: any) => b.value)).toEqual([1, 0]);
  const dst = await get(
    '/api/v1/stats/timeseries?from=2026-03-08T05:00:00Z&to=2026-03-08T08:00:00Z&tz=America/New_York&interval=hour',
  );
  expect(dst.body.buckets.map((b: any) => b.bucket)).toEqual([
    '2026-03-08T00:00',
    '2026-03-08T01:00',
    '2026-03-08T03:00',
    '2026-03-08T04:00',
  ]);
});
it('combines repeated fall-back hours and never leaks another project', async () => {
  f = await fixture();
  const project = await f.db('projects').first();
  await ingest(
    f.db,
    project.id,
    [event({ timestamp: '2026-11-01T05:15:00Z' }), event({ timestamp: '2026-11-01T06:15:00Z' })],
    undefined,
    Date.parse('2026-11-02T00:00:00Z'),
  );
  await f
    .db('projects')
    .insert({
      name: 'other',
      public_key: 'other',
      secret_key_hash: '0'.repeat(64),
      allowed_origins: '[]',
    });
  const other = await f.db('projects').where({ public_key: 'other' }).first();
  await ingest(
    f.db,
    other.id,
    [event({ timestamp: '2026-11-01T06:15:00Z', anonymous_id: 'other' })],
    undefined,
    Date.parse('2026-11-02T00:00:00Z'),
  );
  const res = await get(
    '/api/v1/stats/timeseries?from=2026-11-01T05:00:00Z&to=2026-11-01T06:59:59Z&interval=hour&tz=America/New_York&metric=visitors',
  );
  expect(res.body.buckets).toEqual([{ bucket: '2026-11-01T01:00', value: 1 }]);
  expect(
    (await get('/api/v1/stats/overview?from=2026-11-01&to=2026-11-01')).body.total_events,
  ).toBe(2);
});
