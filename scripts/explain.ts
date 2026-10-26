import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createDb, migrate } from '../apps/api/src/db.js';
import { seedDemo } from '../apps/api/src/demo.js';
import { bucketPlan } from '../apps/api/src/buckets.js';
import knex from 'knex';
const db = createDb(':memory:');
try {
  await migrate(db);
  await seedDemo(db, new Date('2026-10-26T12:00:00Z'));
  const range = {
    from: '2026-10-25T00:00:00.000Z',
    to: '2026-10-25T23:59:59.999Z',
    tz: 'Asia/Kolkata',
  };
  const base = () =>
    db('events').where({ project_id: 1 }).whereBetween('occurred_at', [range.from, range.to]);
  const queries = {
    overview: base()
      .count({ total: '*' })
      .select(db.raw('COUNT(DISTINCT COALESCE(user_id, anonymous_id)) AS visitors')),
    timeseries: base()
      .select({ bucket: bucketPlan(db, range, 'day').expression })
      .count({ value: '*' })
      .groupBy('bucket'),
    pages: base()
      .where({ name: 'page_view' })
      .select('path')
      .count({ views: '*' })
      .groupBy('path')
      .orderBy('views', 'desc'),
    events: base().select('name').count({ count: '*' }).groupBy('name'),
    recent: base().orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(50),
  };
  const plans: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(queries)) {
    const sql = query.toSQL();
    const plan = await db.raw('EXPLAIN QUERY PLAN ' + sql.sql, sql.bindings as any[]);
    assert.ok(
      plan.some((row: any) => /SEARCH events USING .*INDEX events_project_id/.test(row.detail)),
      `${name} should use a project index`,
    );
    plans[name] = { sql: sql.sql, bindings: sql.bindings, plan };
  }
  const dialects: Record<string, unknown> = {};
  for (const client of ['pg', 'mysql2']) {
    const other = knex({ client });
    dialects[client] = other('events')
      .select({ bucket: bucketPlan(other, range, 'hour').expression })
      .count({ value: '*' })
      .where({ project_id: 1 })
      .whereBetween('occurred_at', [range.from, range.to])
      .groupBy('bucket')
      .toSQL()
      .toNative();
    await other.destroy();
  }
  await writeFile(
    'docs/QUERY-PLANS.json',
    JSON.stringify(
      { engine: 'SQLite', fixtureEvents: 3619, plans, dialectCompilation: dialects },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'EXPLAIN PASS: all five SQLite query shapes use a project index; PostgreSQL/MySQL bucket SQL compiles with bound parameters.',
  );
} finally {
  await db.destroy();
}
