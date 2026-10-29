import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const replace = (source, before, after) => {
  assert.ok(source.includes(before), `Mutation anchor missing: ${before.slice(0, 70)}`);
  return source.replace(before, after);
};
const cases = [
  {
    name: 'idempotency-storage',
    target: 'apps/api/test',
    files: {
      'apps/api/src/migrations/001_initial.ts': (s) =>
        replace(s, "t.unique(['project_id', 'event_id']);", ''),
      'apps/api/src/ingestion.ts': (s) =>
        replace(
          s,
          "await trx('events').insert(rows).onConflict(['project_id', 'event_id']).ignore();",
          "await trx('events').insert(rows);",
        ),
    },
  },
  {
    name: 'api-key',
    target: 'apps/api/test/ingestion.test.ts',
    files: {
      'apps/api/src/app.ts': (s) =>
        replace(s, "if (!project) return reply.code(401).send({ error: 'invalid_key' });", ''),
    },
  },
  {
    name: 'origin-allowlist',
    target: 'apps/api/test/ingestion.test.ts',
    files: {
      'apps/api/src/app.ts': (s) =>
        replace(
          replace(
            s,
            "if (!approved) return reply.code(403).send({ error: 'origin_not_allowed' });",
            '',
          ),
          '!token &&',
          'false &&',
        ),
    },
  },
  {
    name: 'visitor-identity',
    target: 'apps/api/test/stats.test.ts',
    files: {
      'apps/api/src/stats.ts': (s) =>
        s.replaceAll(
          'COUNT(DISTINCT COALESCE(user_id, anonymous_id))',
          'COUNT(DISTINCT anonymous_id)',
        ),
    },
  },
  {
    name: 'zero-fill',
    target: 'apps/api/test/stats.test.ts',
    files: {
      'apps/api/src/stats.ts': (s) =>
        replace(
          s,
          'buckets: plan.keys.map((bucket) => ({ bucket, value: counts.get(bucket) || 0 })),',
          'buckets: rows.map(r => ({ bucket: r.bucket, value: Number(r.value) })),',
        ),
    },
  },
  {
    name: 'order-before-commit',
    target: 'apps/api/test/orders.test.ts',
    files: {
      'apps/api/src/restaurant.ts': (s) =>
        replace(
          s,
          "const menu = await trx('menu_items').whereIn('id', ids);",
          "if (transport) await new ServerTracker(transport).track('order_created');\n      const menu = await trx('menu_items').whereIn('id', ids);",
        ),
    },
  },
  {
    name: 'sdk-retry',
    target: 'packages/sdk-js/test/sdk.test.ts',
    files: {
      'packages/sdk-js/src/index.ts': (s) => {
        const start = s.indexOf('        for (const item of items) item.tries++;');
        const end = s.indexOf('\n      }\n    } catch (e)', start);
        assert.ok(start >= 0 && end > start, 'retry block anchor');
        return s.slice(0, start) + '        remove(items);' + s.slice(end);
      },
    },
  },
  {
    name: 'sdk-pagehide-beacon',
    target: 'packages/sdk-js/test/sdk.test.ts',
    files: {
      'packages/sdk-js/src/index.ts': (s) =>
        replace(s, "window.addEventListener('pagehide', onPageHide);", ''),
    },
  },
];
mkdirSync('.audit', { recursive: true });
const results = [];
for (const mutation of cases) {
  const originals = new Map(
    Object.keys(mutation.files).map((path) => [path, readFileSync(path, 'utf8')]),
  );
  try {
    for (const [path, mutate] of Object.entries(mutation.files))
      writeFileSync(path, mutate(originals.get(path)));
    const report = `.audit/mutation-${mutation.name}.json`;
    const run = spawnSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        mutation.target,
        '--reporter=json',
        `--outputFile=${report}`,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    const output = JSON.parse(readFileSync(report, 'utf8'));
    const failed = output.numFailedTests;
    const result = {
      mutation: mutation.name,
      status: run.status === 1 && failed > 0 ? 'killed' : run.status === 0 ? 'survived' : 'invalid',
      failedTests: failed,
      totalTests: output.numTotalTests,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    for (const [path, source] of originals) writeFileSync(path, source);
  }
}
mkdirSync('.audit', { recursive: true });
const path = process.argv[2] || '.audit/MUTATIONS.json';
writeFileSync(
  path,
  JSON.stringify(
    { command: 'node scripts/mutations.mjs', restoredAllSources: true, results },
    null,
    2,
  ) + '\n',
);
if (results.some((r) => r.status !== 'killed')) process.exitCode = 1;
