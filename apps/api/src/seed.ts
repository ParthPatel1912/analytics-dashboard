import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { config } from './config.js';
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const parseJson = (value: any) => typeof value === 'string' ? JSON.parse(value) : value;
export async function seed(db: Knex) {
  if (!await db('projects').where({ public_key: config.publicKey }).first()) await db('projects').insert({ name: 'Table & Thyme', public_key: config.publicKey, secret_key_hash: hashKey(config.secretKey), allowed_origins: JSON.stringify([config.origin]) });
  if (await db('menu_items').first()) return;
  await db('menu_items').insert([
    ['Garden burrata', 'Creamy burrata, seasonal tomatoes, basil oil', 'Starters', 1250, '🥗'],
    ['Crispy artichokes', 'Lemon aioli, fresh parsley, sea salt', 'Starters', 950, '🌿'],
    ['Wild mushroom toast', 'Sourdough, thyme butter, parmesan', 'Starters', 1100, '🍄'],
    ['Margherita pizza', 'San Marzano tomatoes, mozzarella, basil', 'Mains', 1650, '🍕'],
    ['Lemon ricotta pasta', 'Handmade ribbons, lemon zest, garden peas', 'Mains', 1850, '🍝'],
    ['Roasted salmon', 'Herbed potatoes, tender greens, lemon', 'Mains', 2450, '🐟'],
    ['Chocolate torte', 'Dark chocolate, vanilla cream, berries', 'Desserts', 850, '🍫'],
    ['Pistachio gelato', 'Two scoops, toasted pistachios', 'Desserts', 650, '🍨'],
    ['Blood orange spritz', 'Blood orange, soda, rosemary, alcohol free', 'Drinks', 700, '🍊'],
    ['House lemonade', 'Fresh lemon, mint, a little sunshine', 'Drinks', 500, '🍋'],
  ].map(([name, description, category, price, emoji]) => ({ name, description, category, price, emoji })));
}
