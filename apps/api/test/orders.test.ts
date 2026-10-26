import { it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture } from './helpers.js';
import { buildApp } from '../src/app.js';
let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  if (f) await f.close();
});
it('computes server prices and emits a stitched event only after commit', async () => {
  f = await fixture();
  const res = await request(f.app.server)
    .post('/api/orders')
    .set('X-Analytics-Anonymous-Id', 'visitor')
    .set('X-Analytics-Session-Id', 'session')
    .send({ items: [{ menu_item_id: 1, quantity: 2, price: 1 }] });
  expect(res.status).toBe(201);
  expect(res.body.total).toBe(2500);
  await expect.poll(async () => (await f.db('events')).length).toBe(1);
  const e = await f.db('events').first();
  expect(e).toMatchObject({
    name: 'order_created',
    source: 'server',
    anonymous_id: 'visitor',
    session_id: 'session',
  });
  expect(JSON.parse(e.properties).total).toBe(2500);
});
it('rolls back failures without emitting analytics', async () => {
  f = await fixture();
  expect(
    (
      await request(f.app.server)
        .post('/api/orders')
        .send({ items: [{ menu_item_id: 999, quantity: 1 }] })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(f.app.server)
        .post('/api/orders')
        .send({ items: [{ menu_item_id: 1, quantity: 0 }] })
    ).status,
  ).toBe(422);
  expect(await f.db('orders')).toHaveLength(0);
  expect(await f.db('events')).toHaveLength(0);
});
it('returns the successful order even when tracking fails', async () => {
  f = await fixture();
  await f.app.close();
  f.app = buildApp(f.db, {
    transport: {
      send: async () => {
        throw new Error('tracking unavailable');
      },
    },
  });
  await f.app.ready();
  const res = await request(f.app.server)
    .post('/api/orders')
    .send({ items: [{ menu_item_id: 1, quantity: 1 }] });
  expect(res.status).toBe(201);
  expect(await f.db('orders')).toHaveLength(1);
  expect(await f.db('events')).toHaveLength(0);
});
it('rolls back an already-inserted order if writing its items fails', async () => {
  f = await fixture();
  await f.db.raw(
    "CREATE TRIGGER reject_order_items BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
  );
  const res = await request(f.app.server)
    .post('/api/orders')
    .send({ items: [{ menu_item_id: 1, quantity: 1 }] });
  expect(res.status).toBe(500);
  expect(await f.db('orders')).toHaveLength(0);
  expect(await f.db('events')).toHaveLength(0);
});
it('never calls an external analytics transport before the order transaction commits', async () => {
  f = await fixture();
  await f.app.close();
  let committed = false;
  const observed: boolean[] = [];
  f.db.on('query', (q) => {
    if (/^COMMIT\b/i.test(q.sql)) committed = true;
  });
  f.app = buildApp(f.db, {
    transport: {
      send: async () => {
        observed.push(committed);
      },
    },
  });
  await f.app.ready();
  const result = await request(f.app.server)
    .post('/api/orders')
    .send({ items: [{ menu_item_id: 1, quantity: 1 }] });
  expect(result.status).toBe(201);
  await expect.poll(() => observed.length).toBe(1);
  expect(observed).toEqual([true]);
});
