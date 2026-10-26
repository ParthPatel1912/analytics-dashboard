import knex, { type Knex } from 'knex';
import { resolve } from 'node:path';
import './config.js';
import * as initial from './migrations/001_initial.js';
export function createDb(filename?: string) {
  const url = filename ? undefined : process.env.DATABASE_URL;
  const client = url ? (url.startsWith('postgres') ? 'pg' : url.startsWith('mysql') ? 'mysql2' : '') : 'better-sqlite3';
  if (!client) throw new Error('DATABASE_URL must use postgres:// or mysql://');
  return knex({ client, connection: url || { filename: filename || process.env.SQLITE_FILE || resolve(import.meta.dirname, '../../../analytics.sqlite') }, useNullAsDefault: !url, pool: !url ? { min: 1, max: 1, afterCreate(conn: any, done: any) { conn.pragma('foreign_keys = ON'); done(null, conn); } } : { min: 0, max: 10 } });
}
const migrationSource = { getMigrations: async () => ['001_initial'], getMigrationName: (name: string) => name, getMigration: async () => initial };
export async function migrate(db: Knex) { await db.migrate.latest({ migrationSource }); }
