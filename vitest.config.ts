import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    fileParallelism: false,
    env: dotenv.parse(readFileSync(new URL('.env.example', import.meta.url))),
  },
});
