import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb, migrate } from '../apps/api/src/db.js';
import { seed } from '../apps/api/src/seed.js';
import { ingest } from '../apps/api/src/ingestion.js';
import { buildApp } from '../apps/api/src/app.js';
import { config } from '../apps/api/src/config.js';
import knex from 'knex';
const url = process.env.TEST_DATABASE_URL;
if (!url?.startsWith('postgres'))
  throw new Error(
    'Set TEST_DATABASE_URL to an expendable Postgres test database. Only a generated audit schema is created/dropped.',
  );
const schema = `audit_${randomUUID().replaceAll('-', '')}`;
assert.match(schema, /^audit_[a-f0-9]{32}$/);
const admin = knex({ client: 'pg', connection: url });
const previous = process.env.DATABASE_URL;
await admin.schema.createSchema(schema);
const scoped = new URL(url);
scoped.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = scoped.toString();
const db = createDb(),
  app = buildApp(db);
try {
  await migrate(db);
  await migrate(db);
  await seed(db);
  await seed(db);
  await app.ready();
  assert.equal((await db('menu_items')).length, 10);
  console.log('PASS Postgres migrations and repeatable seed');
  const event = {
    event_id: randomUUID(),
    name: 'page_view',
    timestamp: '2026-10-25T19:15:00.000Z',
    anonymous_id: 'pg_anon',
    session_id: 'pg_session',
    user_id: null,
    source: 'browser',
    properties: {},
    context: { path: '/menu' },
  };
  const project = await db('projects').first();
  assert.equal(
    (await ingest(db, project.id, [event], 'browser', Date.parse('2026-10-26T12:00:00Z'))).accepted,
    1,
  );
  const race = await Promise.all(
    Array.from({ length: 12 }, () =>
      ingest(db, project.id, [event], 'browser', Date.parse('2026-10-26T12:00:00Z')),
    ),
  );
  assert.ok(race.every((result) => result.accepted === 0 && result.duplicates === 1));
  await ingest(
    db,
    project.id,
    [
      {
        ...event,
        event_id: randomUUID(),
        user_id: 'pg_user',
        timestamp: '2026-10-25T19:45:00.000Z',
      },
    ],
    'browser',
    Date.parse('2026-10-26T12:00:00Z'),
  );
  const query = async (route: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/${route}`,
      headers: { authorization: `Bearer ${config.dashboardToken}` },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const overview = await query('stats/overview?from=2026-10-25&to=2026-10-25');
  assert.equal(overview.total_events, 2);
  assert.equal(overview.unique_visitors, 2);
  const series = await query(
    'stats/timeseries?from=2026-10-25T19:00:00Z&to=2026-10-25T20:00:00Z&tz=Asia/Kolkata&interval=hour&metric=visitors',
  );
  assert.deepEqual(series.buckets, [
    { bucket: '2026-10-26T00:00', value: 1 },
    { bucket: '2026-10-26T01:00', value: 1 },
  ]);
  const zero = await query('stats/timeseries?from=2026-10-24&to=2026-10-26');
  assert.deepEqual(
    zero.buckets.map((b: any) => b.value),
    [0, 2, 0],
  );
  assert.equal((await query('stats/top-pages?from=2026-10-25&to=2026-10-25')).pages[0].views, 2);
  assert.equal((await query('stats/events?from=2026-10-25&to=2026-10-25')).events[0].count, 2);
  assert.equal((await query('events/recent?from=2026-10-25&to=2026-10-25')).events.length, 2);
  console.log(
    'PASS Postgres concurrent idempotency, all five query endpoints, identity, timezone and zero filling',
  );
  const order = await app.inject({
    method: 'POST',
    url: '/api/orders',
    headers: { 'x-analytics-anonymous-id': 'pg_order' },
    payload: { items: [{ menu_item_id: 1, quantity: 2, price: 1 }] },
  });
  assert.equal(order.statusCode, 201);
  assert.equal(order.json().total, 2500);
  for (
    let attempt = 0;
    attempt < 50 && !(await db('events').where({ name: 'order_created' }).first());
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    (await db('events').where({ name: 'order_created' }).first()).anonymous_id,
    'pg_order',
  );
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/orders',
    payload: { items: [{ menu_item_id: 999, quantity: 1 }] },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal((await db('orders')).length, 1);
  console.log(
    'POSTGRES E2E PASS: authoritative checkout, post-commit event and failed-order isolation',
  );
} finally {
  await app.close();
  await db.destroy();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  await admin.schema.dropSchema(schema, true);
  await admin.destroy();
}
