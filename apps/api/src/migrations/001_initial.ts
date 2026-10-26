import type { Knex } from 'knex';
export async function up(db: Knex) {
  await db.schema.createTable('projects', (t) => {
    t.increments('id');
    t.string('name').notNullable();
    t.string('public_key').notNullable().unique();
    t.string('secret_key_hash', 64).notNullable().unique();
    t.json('allowed_origins').notNullable();
  });
  await db.schema.createTable('events', (t) => {
    t.bigIncrements('id');
    t.integer('project_id').unsigned().notNullable().references('id').inTable('projects');
    t.string('event_id', 36).notNullable();
    t.string('name', 100).notNullable();
    t.string('anonymous_id', 200).notNullable();
    t.string('session_id', 200).notNullable();
    t.string('user_id', 200);
    t.string('source', 10).notNullable();
    t.string('path', 500);
    t.string('referrer', 1000);
    t.json('properties').notNullable();
    t.json('context').notNullable();
    // Fixed-width UTC ISO strings are portable and lexicographically sortable in every supported DB.
    t.string('occurred_at', 24).notNullable();
    t.string('received_at', 24).notNullable();
    t.unique(['project_id', 'event_id']);
    for (const columns of [
      ['occurred_at'],
      ['name', 'occurred_at'],
      ['path', 'occurred_at'],
      ['anonymous_id', 'occurred_at'],
    ])
      t.index(['project_id', ...columns]);
  });
  await db.schema.createTable('menu_items', (t) => {
    t.increments('id');
    t.string('name').notNullable();
    t.string('description').notNullable();
    t.string('category').notNullable();
    t.integer('price').notNullable();
    t.string('emoji', 12).notNullable();
  });
  await db.schema.createTable('orders', (t) => {
    t.string('id', 36).primary();
    t.integer('total').notNullable();
    t.string('currency', 3).notNullable();
    t.string('created_at', 24).notNullable();
  });
  await db.schema.createTable('order_items', (t) => {
    t.increments('id');
    t.string('order_id', 36).notNullable().references('id').inTable('orders');
    t.integer('menu_item_id').unsigned().notNullable().references('id').inTable('menu_items');
    t.integer('quantity').notNullable();
    t.integer('unit_price').notNullable();
  });
}
export async function down(db: Knex) {
  for (const table of ['order_items', 'orders', 'menu_items', 'events', 'projects'])
    await db.schema.dropTableIfExists(table);
}
