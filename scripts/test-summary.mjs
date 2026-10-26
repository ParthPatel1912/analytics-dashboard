import { readFileSync } from 'node:fs';
const report = JSON.parse(readFileSync(process.argv[2] || '.audit/unit.json', 'utf8'));
const groups = {};
for (const file of report.testResults) {
  const path = file.name.replaceAll('\\', '/');
  const pkg = path.includes('/apps/api/')
    ? '@app/api'
    : path.includes('/sdk-node/')
      ? '@pkg/sdk-node'
      : '@pkg/sdk-js';
  const group = (groups[pkg] ||= { passed: 0, failed: 0 });
  for (const test of file.assertionResults) group[test.status === 'passed' ? 'passed' : 'failed']++;
}
console.log(JSON.stringify({ total: report.numTotalTests, groups }, null, 2));
