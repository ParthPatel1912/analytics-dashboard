import { createDb, migrate } from './db.js';
import { seed } from './seed.js';
import { seedDemo } from './demo.js';
const db = createDb();
try {
  await migrate(db);
  if (process.argv[2] !== 'migrate') await seed(db);
  if (process.argv[2] === 'demo') console.log(await seedDemo(db));
  console.log('Database ready');
} finally {
  await db.destroy();
}
