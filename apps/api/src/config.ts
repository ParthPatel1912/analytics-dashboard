import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
export const config = {
  port: Number(process.env.PORT || 4000), origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  publicKey: process.env.DEMO_PUBLIC_KEY || 'pk_local_restaurant',
  secretKey: process.env.DEMO_SECRET_KEY || 'sk_local_restaurant_change_me',
  dashboardToken: process.env.DASHBOARD_TOKEN || 'dashboard_local_change_me',
  rateLimit: Number(process.env.RATE_LIMIT || 120), blockBots: process.env.BLOCK_BOTS === 'true',
};
