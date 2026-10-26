import { z } from 'zod';
import type { Knex } from 'knex';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { parseJson } from './seed.js';
import { bucketPlan, type Range, type Interval } from './buckets.js';
import { safeEqual, bearerToken } from './auth.js';
function error(message: string) {
  return Object.assign(new Error(message), { statusCode: 422 });
}
function date(value: string, end: boolean) {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dayOnly && !z.string().datetime().safeParse(value).success)
    throw error('dates must be UTC ISO timestamps or YYYY-MM-DD');
  const normalized = new Date(
    dayOnly ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value,
  );
  if (!Number.isFinite(+normalized) || (dayOnly && normalized.toISOString().slice(0, 10) !== value))
    throw error('invalid date');
  return normalized.toISOString();
}
export function parseRange(q: Record<string, any>): Range {
  const to = date(String(q.to || new Date().toISOString()), true);
  const from = date(String(q.from || new Date(Date.parse(to) - 7 * 86400000).toISOString()), false);
  if (from > to || Date.parse(to) - Date.parse(from) > 90 * 86400000)
    throw error('range must be ordered and at most 90 days');
  const tz = String(q.tz || 'UTC');
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format();
  } catch {
    throw error('invalid timezone');
  }
  return { from, to, tz };
}
const eventName = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
const visitor = 'COUNT(DISTINCT COALESCE(user_id, anonymous_id))';
const base = (db: Knex, projectId: number, r: Range) =>
  db('events').where({ project_id: projectId }).whereBetween('occurred_at', [r.from, r.to]);
export async function timeseries(
  db: Knex,
  projectId: number,
  range: Range,
  interval: Interval,
  metric: string,
  event?: string,
) {
  const plan = bucketPlan(db, range, interval);
  const query = base(db, projectId, range);
  if (metric === 'page_views') query.where({ name: 'page_view' });
  if (event) query.where({ name: event });
  const rows = await query
    .select({ bucket: plan.expression })
    .select(db.raw(metric === 'visitors' ? `${visitor} AS value` : 'COUNT(*) AS value'))
    .groupBy('bucket')
    .orderBy('bucket');
  const counts = new Map(rows.map((r) => [r.bucket, Number(r.value)]));
  return {
    ...range,
    interval,
    metric,
    buckets: plan.keys.map((bucket) => ({ bucket, value: counts.get(bucket) || 0 })),
  };
}
export function statsRoutes(app: FastifyInstance, db: Knex) {
  async function auth(req: FastifyRequest) {
    const token = bearerToken(req.headers.authorization);
    if (!token || !safeEqual(token, config.dashboardToken))
      throw Object.assign(new Error('invalid_dashboard_token'), { statusCode: 401 });
    const project = await db('projects').where({ public_key: config.publicKey }).first();
    if (!project) throw Object.assign(new Error('project_not_found'), { statusCode: 404 });
    return project.id as number;
  }
  const endpoint = (path: string, fn: (id: number, range: Range, q: any) => Promise<unknown>) =>
    app.get(path, async (req) => {
      const id = await auth(req);
      const q = req.query as Record<string, any>;
      return fn(id, parseRange(q), q);
    });
  endpoint('/api/v1/stats/overview', async (id, range) => {
    const row = await base(db, id, range)
      .select(
        db.raw(
          "COUNT(*) AS total_events, COUNT(CASE WHEN name = 'page_view' THEN 1 END) AS page_views, COUNT(DISTINCT COALESCE(user_id, anonymous_id)) AS unique_visitors, COUNT(DISTINCT session_id) AS sessions, COUNT(CASE WHEN name = 'order_created' THEN 1 END) AS orders_created",
        ),
      )
      .first();
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  });
  endpoint('/api/v1/stats/timeseries', async (id, range, q) =>
    timeseries(
      db,
      id,
      range,
      z.enum(['day', 'hour']).default('day').parse(q.interval),
      z.enum(['page_views', 'events', 'visitors']).default('page_views').parse(q.metric),
      q.event ? eventName.parse(q.event) : undefined,
    ),
  );
  endpoint('/api/v1/stats/top-pages', async (id, range, q) => {
    const rows = (await base(db, id, range)
      .where({ name: 'page_view' })
      .whereNotNull('path')
      .select('path')
      .count({ views: '*' })
      .select(db.raw(`${visitor} AS unique_visitors`))
      .groupBy('path')
      .orderBy('views', 'desc')
      .orderBy('path')
      .limit(z.coerce.number().int().min(1).max(100).default(10).parse(q.limit))) as unknown as {
      path: string;
      views: number | string;
      unique_visitors: number | string;
    }[];
    return {
      pages: rows.map((r) => ({
        ...r,
        views: Number(r.views),
        unique_visitors: Number(r.unique_visitors),
      })),
    };
  });
  endpoint('/api/v1/stats/events', async (id, range, q) => ({
    events: (
      await base(db, id, range)
        .select('name')
        .count({ count: '*' })
        .groupBy('name')
        .orderBy('count', 'desc')
        .orderBy('name')
    ).map((r) => ({ ...r, count: Number(r.count) })),
    trend: await timeseries(
      db,
      id,
      range,
      'day',
      'events',
      eventName.default('order_created').parse(q.event),
    ),
  }));
  endpoint('/api/v1/events/recent', async (id, range, q) => ({
    events: (
      await base(db, id, range)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(z.coerce.number().int().min(1).max(100).default(50).parse(q.limit))
    ).map((e) => ({ ...e, properties: parseJson(e.properties), context: parseJson(e.context) })),
  }));
}
