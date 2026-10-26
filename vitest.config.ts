import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['apps/api/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'], fileParallelism: false } });
