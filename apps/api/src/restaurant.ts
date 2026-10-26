import type { Knex } from 'knex';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ServerTracker, type EventTransport } from '../../../packages/sdk-node/src/index.js';
import { config } from './config.js';
import { ingest } from './ingestion.js';
export class InProcessTransport implements EventTransport {
  constructor(private readonly db: Knex, private readonly projectId: number) {}
  async send(events: Parameters<EventTransport['send']>[0]) {
    const result = await ingest(this.db, this.projectId, events, 'server');
    if (result.rejected.length) throw new Error('Server analytics validation failed');
  }
}
const orderSchema = z.object({ items: z.array(z.object({ menu_item_id: z.number().int().positive(), quantity: z.number().int().min(1).max(20) })).min(1).max(30) });
export function restaurantRoutes(app: FastifyInstance, db: Knex, transport?: EventTransport) {
  const pending = new Map<string, () => Promise<void>>();
  const tasks = new Set<Promise<void>>();
  app.addHook('onResponse', async req => {
    const work = pending.get(req.id); pending.delete(req.id);
    if (work) {
      const task = work().catch(error => app.log.error(error)); tasks.add(task);
      void task.finally(() => tasks.delete(task));
    }
  });
  app.addHook('onClose', async () => { await Promise.allSettled(tasks); });
  app.get('/api/menu', async () => ({ items: await db('menu_items').orderBy('id') }));
  app.get('/api/orders/:id', async (req, reply) => {
    const id = z.string().uuid().parse((req.params as any).id);
    const order = await db('orders').where({ id }).first();
    if (!order) return reply.code(404).send({ error: 'order_not_found' });
    const items = await db('order_items').join('menu_items', 'menu_items.id', 'order_items.menu_item_id').where('order_id', id).select('menu_items.name', 'order_items.quantity', 'order_items.unit_price');
    return { ...order, items };
  });
  app.post('/api/orders', async (req, reply) => {
    const { items } = orderSchema.parse(req.body);
    const ids = items.map(i => i.menu_item_id);
    if (new Set(ids).size !== ids.length) return reply.code(422).send({ error: 'duplicate_menu_items' });
    const order = await db.transaction(async trx => {
      const menu = await trx('menu_items').whereIn('id', ids);
      if (menu.length !== items.length) throw Object.assign(new Error('unknown_menu_item'), { statusCode: 422 });
      const prices = new Map(menu.map(m => [m.id, m.price]));
      const total = items.reduce((sum, i) => sum + prices.get(i.menu_item_id)! * i.quantity, 0);
      const order = { id: randomUUID(), total, currency: 'USD', created_at: new Date().toISOString() };
      await trx('orders').insert(order);
      await trx('order_items').insert(items.map(i => ({ ...i, order_id: order.id, unit_price: prices.get(i.menu_item_id) })));
      return order;
    });
    const header = (name: string) => typeof req.headers[name] === 'string' ? String(req.headers[name]).slice(0, 200) : undefined;
    const anonymousId = header('x-analytics-anonymous-id'), sessionId = header('x-analytics-session-id'), userId = header('x-analytics-user-id');
    // Runs only after transaction commit AND response, with failure isolated from checkout.
    pending.set(req.id, async () => {
      try {
        const project = await db('projects').where({ public_key: config.publicKey }).first();
        const tracker = new ServerTracker(transport || new InProcessTransport(db, project.id), error => app.log.error(error));
        await tracker.track('order_created', { order_id: order.id, total: order.total, item_count: items.reduce((n, i) => n + i.quantity, 0), currency: order.currency }, userId || null, anonymousId, sessionId);
      } catch (error) { app.log.error(error); }
    });
    return reply.code(201).send(order);
  });
}
