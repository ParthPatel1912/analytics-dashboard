import type { NextConfig } from 'next';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
const config: NextConfig = { transpilePackages: ['@pkg/sdk-js'], poweredByHeader: false };
export default config;
