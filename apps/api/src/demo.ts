import type { Knex } from 'knex';
import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.js';
import { seed } from './seed.js';
// Trusted historical fixture path; deliberately bypasses ingestion's 7-day cutoff.
// Deterministic IDs make repeat runs on the same UTC dates idempotent.
function uuid(key: string) {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function seedDemo(db: Knex, now = new Date()) {
  await seed(db);
  const project = await db('projects').where({ public_key: config.publicKey }).first();
  const rows: Record<string, unknown>[] = [];
  for (let d = 13; d >= 0; d--) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - d);
    const date = start.toISOString().slice(0, 10),
      visitors = 22 + (13 - d) * 2 + (d % 3) * 5;
    for (let v = 0; v < visitors; v++) {
      const anonymous_id = `demo_visitor_${v % 65}`,
        session_id = uuid(`session_${date}_${v}`);
      const hour =
        d === 0 ? Math.max(0, Math.min(now.getUTCHours() - 1, 9 + (v % 12))) : 9 + (v % 12);
      const occurred = +start + hour * 3600000 + ((v * 7) % 50) * 60000;
      const menuId = (v % 10) + 1;
      const journey: [string, string, Record<string, unknown>?][] = [['page_view', '/']];
      if (v % 7 !== 0)
        journey.push(
          ['page_view', '/menu'],
          ['menu_item_viewed', '/menu', { menu_item_id: menuId }],
        );
      if (v % 3 !== 0)
        journey.push(['add_to_cart', '/menu', { menu_item_id: menuId }], ['page_view', '/cart']);
      if (v % 5 === 0) journey.push(['remove_from_cart', '/cart', { menu_item_id: menuId }]);
      else if (v % 3 !== 0) journey.push(['checkout_started', '/cart'], ['page_view', '/checkout']);
      if (v % 3 !== 0 && v % 5 !== 0 && v % 4 !== 0) {
        journey.push(
          ['identify', '/checkout'],
          [
            'order_created',
            '/checkout',
            {
              order_id: uuid(`order_${date}_${v}`),
              total: 1250 + (v % 5) * 650,
              item_count: 1 + (v % 3),
              currency: 'USD',
            },
          ],
          ['page_view', `/order/${uuid(`order_${date}_${v}`)}`],
        );
      }
      let identified = false;
      journey.forEach(([name, path, properties = {}], index) => {
        const timestamp = Math.min(+now, occurred + index * 25000);
        if (name === 'identify') identified = true;
        rows.push({
          project_id: project.id,
          event_id: uuid(`${date}_${v}_${index}`),
          name,
          anonymous_id,
          session_id,
          user_id: identified ? `demo_user_${v}` : null,
          source: name === 'order_created' ? 'server' : 'browser',
          path: name === 'order_created' ? null : path,
          referrer: '',
          properties: JSON.stringify(properties),
          context: JSON.stringify(
            name === 'order_created' ? {} : { path, title: 'Table & Thyme', locale: 'en-US' },
          ),
          occurred_at: new Date(timestamp).toISOString(),
          received_at: now.toISOString(),
        });
      });
    }
  }
  await db.transaction(async (trx) => {
    for (let i = 0; i < rows.length; i += 50)
      await trx('events')
        .insert(rows.slice(i, i + 50))
        .onConflict(['project_id', 'event_id'])
        .ignore();
  });
  return { generated: rows.length, days: 14 };
}
