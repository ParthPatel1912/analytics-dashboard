import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing ${name}. Copy .env.example to .env before starting the app.`);
  return value;
}
export const config = {
  port: Number(process.env.PORT || 4000),
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  publicKey: required('DEMO_PUBLIC_KEY'),
  secretKey: required('DEMO_SECRET_KEY'),
  dashboardToken: required('DASHBOARD_TOKEN'),
  rateLimit: Number(process.env.RATE_LIMIT || 120),
  blockBots: process.env.BLOCK_BOTS === 'true',
};
