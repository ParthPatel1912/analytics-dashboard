import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, event } from './helpers.js';
import { config } from '../src/config.js';
export async function smoke() {
  const f = await fixture();
  try {
    const browser = await request(f.app.server)
      .post('/api/v1/events/batch')
      .set('X-Analytics-Key', config.publicKey)
      .set('Origin', config.origin)
      .send({ events: [event(), event({ name: 'add_to_cart', properties: { menu_item_id: 1 } })] });
    assert.equal(browser.body.accepted, 2);
    const order = await request(f.app.server)
      .post('/api/orders')
      .set('X-Analytics-Anonymous-Id', 'visitor-a')
      .set('X-Analytics-Session-Id', 'session-a')
      .send({ items: [{ menu_item_id: 1, quantity: 2 }] });
    assert.equal(order.status, 201);
    assert.equal(order.body.total, 2500);
    for (let i = 0; i < 50 && !(await f.db('events').where({ name: 'order_created' }).first()); i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const stats = await request(f.app.server)
      .get('/api/v1/stats/overview')
      .auth(config.dashboardToken, { type: 'bearer' });
    assert.deepEqual(stats.body, {
      total_events: 3,
      page_views: 1,
      unique_visitors: 1,
      sessions: 1,
      orders_created: 1,
    });
    const breakdown = await request(f.app.server)
      .get('/api/v1/stats/events')
      .auth(config.dashboardToken, { type: 'bearer' });
    assert.deepEqual(
      new Set(breakdown.body.events.map((e: any) => e.name)),
      new Set(['page_view', 'add_to_cart', 'order_created']),
    );
  } finally {
    await f.close();
  }
}
if (process.argv[1]?.endsWith('smoke.ts')) {
  await smoke();
  console.log('PASS: page_view → add_to_cart → committed order → stitched analytics stats');
}
