import { z } from 'zod';
import type { Knex } from 'knex';
const object = z.record(z.string(), z.unknown());
export const eventSchema = z.object({
  event_id: z
    .string()
    .uuid()
    .refine((v) => v[14] === '4', 'event_id must be UUID v4')
    .transform((v) => v.toLowerCase()),
  name: z
    .string()
    .max(100)
    .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
  timestamp: z.string().datetime(),
  anonymous_id: z.string().min(1).max(200),
  session_id: z.string().min(1).max(200),
  user_id: z.string().min(1).max(200).nullable().default(null),
  source: z.enum(['browser', 'server']),
  properties: object.default({}),
  context: object.default({}),
});
export type AnalyticsEvent = z.infer<typeof eventSchema>;
function depth(value: unknown, level = 0): number {
  if (level > 6) return level;
  if (value && typeof value === 'object')
    return Math.max(level, ...Object.values(value).map((v) => depth(v, level + 1)));
  return level;
}
function bounded(value: object) {
  return Buffer.byteLength(JSON.stringify(value)) <= 8192 && depth(value) <= 6;
}
export async function ingest(
  db: Knex,
  projectId: number,
  inputs: unknown[],
  source?: 'browser' | 'server',
  now = Date.now(),
) {
  const rejected: { index: number; reason: string }[] = [];
  const valid: AnalyticsEvent[] = [];
  inputs.forEach((input, index) => {
    const parsed = eventSchema.safeParse(input);
    let reason: string | undefined;
    if (!parsed.success)
      reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    else {
      const e = parsed.data;
      const time = Date.parse(e.timestamp);
      if (source && source !== e.source) reason = 'source does not match credential';
      else if (time < now - 7 * 86400000 || time > now + 86400000)
        reason = 'timestamp outside allowed window';
      else if (!bounded(e.properties) || !bounded(e.context))
        reason = 'properties/context exceed 8KB or depth 6';
      else if (
        e.context.path !== undefined &&
        (typeof e.context.path !== 'string' || !e.context.path.startsWith('/'))
      )
        reason = 'context.path must be an absolute path';
      else valid.push(e);
    }
    if (reason) rejected.push({ index, reason });
  });
  let accepted = 0;
  if (valid.length)
    await db.transaction(async (trx) => {
      // Serialize writers for a project, ensuring portable and exact duplicate accounting.
      if (db.client.config.client !== 'better-sqlite3')
        await trx('projects').where({ id: projectId }).forUpdate().first();
      const existing = new Set(
        (
          await trx('events')
            .select('event_id')
            .where({ project_id: projectId })
            .whereIn(
              'event_id',
              valid.map((e) => e.event_id),
            )
        ).map((r) => r.event_id),
      );
      const rows = [];
      for (const e of valid) {
        if (existing.has(e.event_id)) continue;
        existing.add(e.event_id);
        const ctx = { ...e.context };
        for (const key of ['url', 'path', 'referrer', 'title', 'user_agent', 'locale'])
          if (ctx[key] !== undefined)
            ctx[key] = String(ctx[key]).slice(
              0,
              key === 'path' || key === 'user_agent' ? 500 : 1000,
            );
        rows.push({
          project_id: projectId,
          event_id: e.event_id,
          name: e.name,
          anonymous_id: e.anonymous_id,
          session_id: e.session_id,
          user_id: e.user_id,
          source: e.source,
          path: typeof ctx.path === 'string' ? ctx.path : null,
          referrer: typeof ctx.referrer === 'string' ? ctx.referrer : null,
          properties: JSON.stringify(e.properties),
          context: JSON.stringify(ctx),
          occurred_at: new Date(e.timestamp).toISOString(),
          received_at: new Date(now).toISOString(),
        });
      }
      if (rows.length)
        await trx('events').insert(rows).onConflict(['project_id', 'event_id']).ignore();
      accepted = rows.length;
    });
  return { accepted, duplicates: valid.length - accepted, rejected };
}
