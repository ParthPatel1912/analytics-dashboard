import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

test('built React entry preserves the Next.js client boundary in ESM and CJS', () => {
  for (const extension of ['js', 'cjs']) {
    const source = readFileSync(`packages/sdk-js/dist/react.${extension}`, 'utf8');
    assert.ok(
      /^\s*(?:['"]use strict['"];?\s*)?['"]use client['"];?/.test(source),
      `${extension} client directive prologue`,
    );
  }
});
test('local environment variants and generated outputs cannot be accidentally committed', () => {
  const paths = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.test',
    'analytics.sqlite',
    'apps/web/.next/a',
    'packages/sdk-js/dist/index.js',
    'node_modules/a',
  ];
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    input: paths.join('\n'),
    encoding: 'utf8',
  });
  const ignored = new Set(result.stdout.trim().split(/\r?\n/));
  for (const path of paths) assert.ok(ignored.has(path), `${path} must be ignored`);
  assert.equal(spawnSync('git', ['check-ignore', '.env.example']).status, 1);
});
test('built SDK exports and declarations exist, and core imports safely without window', async () => {
  assert.equal(
    typeof (await import('../packages/sdk-js/dist/index.js')).createAnalytics,
    'function',
  );
  assert.equal(
    typeof (await import('../packages/sdk-node/dist/index.js')).ServerTracker,
    'function',
  );
  for (const path of [
    'packages/sdk-js/dist/index.d.ts',
    'packages/sdk-js/dist/react.d.ts',
    'packages/sdk-node/dist/index.d.ts',
  ])
    assert.ok(existsSync(path), path);
});
test('README reports the measured browser gzip size', () => {
  const size = gzipSync(
    readFileSync('packages/sdk-js/dist/browser/index.global.js'),
  ).length.toLocaleString('en-US');
  for (const path of ['README.md'])
    assert.ok(
      readFileSync(path, 'utf8').includes(size + ' bytes'),
      `${path} must report ${size} bytes`,
    );
});
