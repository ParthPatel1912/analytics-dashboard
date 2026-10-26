import { afterEach, it, expect } from 'vitest';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
import { ingest } from '../src/ingestion.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  if (f) await f.close();
});
const send = (events: unknown[]) =>
  request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Origin', config.origin)
    .set('X-Analytics-Key', config.publicKey)
    .send({ events });
it('enforces the storage uniqueness constraint independently of service deduplication', async () => {
  f = await fixture();
  const e = event();
  await send([e]);
  const { id, ...row } = await f.db('events').first();
  await expect(f.db('events').insert(row)).rejects.toThrow(/UNIQUE/);
  expect(await f.db('events')).toHaveLength(1);
});
it('is race-safe for concurrent retries and performs one bulk insert per batch', async () => {
  f = await fixture();
  const e = event();
  await f.app.listen({ port: 0, host: '127.0.0.1' });
  const responses = await Promise.all(Array.from({ length: 12 }, () => send([e])));
  expect(responses.every((r) => r.status === 202)).toBe(true);
  expect(responses.reduce((n, r) => n + r.body.accepted, 0)).toBe(1);
  expect(responses.reduce((n, r) => n + r.body.duplicates, 0)).toBe(11);
  const inserts: string[] = [];
  f.db.on('query', (q) => {
    if (/insert into [`"]events/.test(q.sql)) inserts.push(q.sql);
  });
  const result = await send(Array.from({ length: 20 }, () => event()));
  expect(result.body.accepted).toBe(20);
  expect(inserts).toHaveLength(1);
});
it('accepts exact timestamp limits and rejects events one millisecond outside them', async () => {
  f = await fixture();
  const project = await f.db('projects').first(),
    now = Date.parse('2026-10-26T12:00:00Z');
  const times = [-7 * 86400000, 86400000, -7 * 86400000 - 1, 86400001];
  const result = await ingest(
    f.db,
    project.id,
    times.map((offset) => event({ timestamp: new Date(now + offset).toISOString() })),
    'browser',
    now,
  );
  expect(result).toMatchObject({ accepted: 2, duplicates: 0 });
  expect(result.rejected.map((r) => r.index)).toEqual([2, 3]);
  expect(
    (await f.db('events')).every((row) => row.received_at === new Date(now).toISOString()),
  ).toBe(true);
});
it('requires each public key to match its own Origin allowlist and isolates duplicate UUIDs by project', async () => {
  f = await fixture();
  await f
    .db('projects')
    .insert({
      name: 'Second project',
      public_key: 'pk_second',
      secret_key_hash: '1'.repeat(64),
      allowed_origins: JSON.stringify(['https://second.example']),
    });
  const e = event();
  await send([e]);
  const blocked = await request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Origin', config.origin)
    .set('X-Analytics-Key', 'pk_second')
    .send({ events: [e] });
  expect(blocked.status).toBe(403);
  const accepted = await request(f.app.server)
    .post('/api/v1/events/batch')
    .set('Origin', 'https://second.example')
    .set('X-Analytics-Key', 'pk_second')
    .send({ events: [e] });
  expect(accepted.status).toBe(202);
  expect(accepted.body.accepted).toBe(1);
  expect(await f.db('events')).toHaveLength(2);
});
