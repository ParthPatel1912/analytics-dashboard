# Analytics audit

Started 26 October 2026. This file records commands actually run, findings, regression evidence and remaining verification limits. Original checkout: `0411409`. No existing tests will be skipped or weakened.

## Findings

| ID | Severity | Issue / root cause | Fix | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | major | README advertises Node 20.19 and root engines allow Node 20, but installed Vitest 5 requires Node 22.12 / 24 / 26+. | Root engines and README now require Node 22.12+ (22.x), 24.x or 26.x. | `setup.test.ts`: minimum-runtime test failed before (20 < 22.12), passed after. | Fixed |
| A02 | minor | README server example uses undocumented `ANALYTICS_SECRET`, while setup provides `DEMO_SECRET_KEY`. | Example now reads `DEMO_SECRET_KEY`. | `setup.test.ts`: example-env contract failed before, passed after. | Fixed |
| A03 | major | `.env.local`, `.env.production` and other local secret variants were not ignored. | Ignore `.env.*` except `.env.example`, plus logs and temporary audit output. | `node --test scripts/packages.test.mjs`: ignore test failed before, passed after. | Fixed |

## Phase 1 — clean-state setup

- Read the README before running setup. Node here is 22.17.0, npm 10.9.2.
- Verified absolute cleanup targets are inside `D:\demo\analyticDashboard`; only generated dependencies, build outputs, `.env`, and local SQLite data will be removed.
- No `docker`, `psql` or `mysql` executable was returned by `Get-Command`. Alternative database runtime verification needs further investigation; no claim of a successful service test yet.

## Phase status

1. Clean-state setup: passed.
2. Static/build: passed.
3. Test coverage + mutation checks: pending.
4. Live end-to-end automation: pending.
5. Failure modes: pending.
6. Risky-code review and EXPLAIN: pending.
7. Dashboard/browser checks: pending.
8. Documentation + final clean verification: pending.

### Phase 1 evidence

- Removed the verified generated targets with native PowerShell Remove-Item; no source or Git history deleted.
- npm install: exit 0, 375 packages installed, npm audit 0 vulnerabilities. Transitive deprecation notices are recorded for phase 2.
- Copy-Item .env.example .env: exit 0.
- npm run seed:demo: exit 0, 3,619 events / 14 days.
- npm run dev: both API :4000 and web :3000 started.
- HTTP health, home, menu proxy and overview proxy: all 200.
- npm test -- apps/api/test/setup.test.ts: before 0/2 passed, after 2/2 passed.
- npm install --package-lock-only --ignore-scripts: exit 0, 0 vulnerabilities.


## Phase 2 — static/build evidence

- npm run typecheck: exit 0, all workspaces.
- npm run build: exit 0, both SDKs (ESM/CJS/IIFE + declarations), API TypeScript check and Next production build.
- node --test scripts/packages.test.mjs: 2/3 before ignore fix, 3/3 after; verifies actual built client directive prologues, declarations, SSR imports and ignored artifacts.
- npm audit --json: exit 0, no low/moderate/high/critical findings.
- No lint script/config exists; no lint success claimed.
- git ls-files scan: no committed .env, SQLite, node_modules, dist or .next files.
- Source scan: no TODO/FIXME stubs or skipped/focused/todo tests. console.log is limited to intentional CLI/test/size output; console.debug is guarded by SDK debug option.
- npm install reports deprecations for transitive whatwg-encoding and prebuild-install. Neither has an audit advisory; replacing the SQLite driver or jsdom solely to hide notices is outside this audit's necessary scope.
- npm run size: 2,659 gzip bytes before SDK behavior fixes.

