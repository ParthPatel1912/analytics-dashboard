import { createDb, migrate } from './db.js';
import { seed } from './seed.js';
const db = createDb();
try { await migrate(db); if (process.argv[2] !== 'migrate') await seed(db); console.log('Database ready'); }
finally { await db.destroy(); }
