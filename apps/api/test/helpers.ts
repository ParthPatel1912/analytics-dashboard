import { randomUUID } from 'node:crypto';
import { createDb, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';
import { buildApp } from '../src/app.js';
export const event = (extra: Record<string, unknown> = {}) => ({
  event_id: randomUUID(),
  name: 'page_view',
  timestamp: new Date().toISOString(),
  anonymous_id: 'visitor-a',
  session_id: 'session-a',
  user_id: null,
  source: 'browser',
  properties: {},
  context: { path: '/menu' },
  ...extra,
});
export async function fixture(rateLimit = 120) {
  const db = createDb(':memory:');
  await migrate(db);
  await seed(db);
  const app = buildApp(db, { rateLimit });
  await app.ready();
  return {
    db,
    app,
    close: async () => {
      await app.close();
      await db.destroy();
    },
  };
}
