import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const readme = readFileSync(new URL('README.md', root), 'utf8');
it('does not advertise a Node minimum below the installed test toolchain', () => {
  const version = (range: string) => {
    const [major, minor = '0', patch = '0'] = range.match(/\d+(?:\.\d+){0,2}/)![0].split('.');
    return Number(major) * 1000000 + Number(minor) * 1000 + Number(patch);
  };
  expect(version(manifest.engines.node)).toBeGreaterThanOrEqual(
    version(require('vitest/package.json').engines.node),
  );
  expect(readme).not.toMatch(/20\.19\+ also supported/);
});
it('every environment variable in the integration examples exists in the example environment', () => {
  const environment = readFileSync(new URL('.env.example', root), 'utf8');
  for (const [, name] of readme.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
    expect(environment, `${name} must be documented and supplied by setup`).toMatch(
      new RegExp(`^${name}=`, 'm'),
    );
  }
});
