import { createDb, migrate } from './db.js';
import { seed } from './seed.js';
import { buildApp } from './app.js';
import { config } from './config.js';
const db = createDb();
await migrate(db); await seed(db);
const app = buildApp(db, { logger: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await db.destroy(); process.exit(0); });
await app.listen({ port: config.port, host: '127.0.0.1' });
