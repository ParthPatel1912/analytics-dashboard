import { it, expect } from 'vitest';
import { createDb, migrate } from '../src/db.js';
import { seed } from '../src/seed.js';
it('migrates a clean database and seeds idempotently', async () => {
  const db = createDb(':memory:');
  try { await migrate(db); await migrate(db); await seed(db); await seed(db); expect(await db('menu_items')).toHaveLength(10); expect(await db('projects')).toHaveLength(1); }
  finally { await db.destroy(); }
});
