import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { config } from './config.js';
import { hashKey, parseJson } from './seed.js';
import { ingest } from './ingestion.js';
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function buildApp(db: Knex, options: { rateLimit?: number; logger?: boolean } = {}) {
  const app = Fastify({ bodyLimit: 256 * 1024, logger: options.logger ?? false, trustProxy: false });
  const windows = new Map<string, { count: number; reset: number }>();
  app.setErrorHandler((err: any, _req, reply) => {
    const code = err instanceof z.ZodError ? 422 : err.statusCode || 500;
    if (code >= 500) app.log.error(err);
    reply.code(code).send({ error: code >= 500 ? 'internal_error' : err.message, ...(err instanceof z.ZodError ? { details: err.issues } : {}) });
  });
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) { if (req.method === 'OPTIONS') return reply.code(403).send({ error: 'origin_required' }); return; }
    const projects = await db('projects').select('allowed_origins');
    const approved = origin === config.origin && req.url.startsWith('/api/') && !req.url.startsWith('/api/v1/events/batch') || projects.some(p => parseJson(p.allowed_origins).includes(origin));
    if (!approved) return reply.code(403).send({ error: 'origin_not_allowed' });
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    if (req.method === 'OPTIONS') return reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type, X-Analytics-Key, Authorization, X-Analytics-Anonymous-Id, X-Analytics-Session-Id, X-Analytics-User-Id').header('Access-Control-Max-Age', '600').code(204).send();
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/api/v1/events/batch', async (req, reply) => {
    const body = req.body as any;
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const publicKey = req.headers['x-analytics-key'] || (req.query as any).write_key || body?.write_key;
    const project = token ? await db('projects').where({ secret_key_hash: hashKey(token) }).first() : typeof publicKey === 'string' ? await db('projects').where({ public_key: publicKey }).first() : null;
    if (!project) return reply.code(401).send({ error: 'invalid_key' });
    if (!token && (!req.headers.origin || !parseJson(project.allowed_origins).includes(req.headers.origin))) return reply.code(403).send({ error: 'origin_not_allowed' });
    const key = `${project.id}:${token ? 'secret' : 'public'}`;
    const now = Date.now();
    // Bound memory even when credentials are rotated repeatedly.
    for (const [k, w] of windows) if (w.reset <= now) windows.delete(k);
    const window = windows.get(key) || { count: 0, reset: now + 60000 };
    windows.set(key, window);
    if (++window.count > (options.rateLimit ?? config.rateLimit)) return reply.header('Retry-After', Math.ceil((window.reset - now) / 1000)).code(429).send({ error: 'rate_limited' });
    if (config.blockBots && /bot|crawler|spider|headless/i.test(req.headers['user-agent'] || '')) return reply.code(403).send({ error: 'bot_blocked' });
    const parsed = z.object({ events: z.array(z.unknown()).min(1).max(50) }).safeParse(body);
    if (!parsed.success) return reply.code(422).send({ error: 'events must contain 1 to 50 events' });
    return reply.code(202).send(await ingest(db, project.id, parsed.data.events, token ? 'server' : 'browser'));
  });
  return app;
}
