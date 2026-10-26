import { it, expect } from 'vitest';
import { createDb, migrate } from '../src/db.js';
import { seedDemo } from '../src/demo.js';
it('seeds fourteen days idempotently without events in the future', async () => {
  const db = createDb(':memory:');
  const now = new Date('2026-10-26T12:00:00Z');
  try {
    await migrate(db);
    const result = await seedDemo(db, now);
    expect(result.generated).toBeGreaterThan(2000);
    const before = await db('events').count({ n: '*' }).first();
    await seedDemo(db, now);
    expect(await db('events').count({ n: '*' }).first()).toEqual(before);
    const days = await db('events')
      .select(db.raw('substr(occurred_at, 1, 10) AS day'))
      .groupBy('day');
    expect(days).toHaveLength(14);
    expect(await db('events').where('occurred_at', '>', now.toISOString())).toHaveLength(0);
  } finally {
    await db.destroy();
  }
});
