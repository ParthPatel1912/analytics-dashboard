# Analytics audit

Started 26 October 2026. This file records commands actually run, findings, regression evidence and remaining verification limits. Original checkout: `0411409`. No existing tests will be skipped or weakened.

## Findings

| ID | Severity | Issue / root cause | Fix | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | major | README advertises Node 20.19 and root engines allow Node 20, but installed Vitest 5 requires Node 22.12 / 24 / 26+. | Root engines and README now require Node 22.12+ (22.x), 24.x or 26.x. | `setup.test.ts`: minimum-runtime test failed before (20 < 22.12), passed after. | Fixed |
| A02 | minor | README server example uses undocumented `ANALYTICS_SECRET`, while setup provides `DEMO_SECRET_KEY`. | Example now reads `DEMO_SECRET_KEY`. | `setup.test.ts`: example-env contract failed before, passed after. | Fixed |
| A03 | major | `.env.local`, `.env.production` and other local secret variants were not ignored. | Ignore `.env.*` except `.env.example`, plus logs and temporary audit output. | `node --test scripts/packages.test.mjs`: ignore test failed before, passed after. | Fixed |
| A04 | minor | A jsdom test that mocked both cookie accessors left an own-property mock descriptor, breaking later tests. | Restore the prototype cookie accessor during cleanup; preserve every original assertion. | New lifecycle/queue tests initially failed with leaked `blocked` getter; all 39 tests pass after cleanup. | Fixed |
| A05 | major | Existing tests could not detect external order tracking before commit. | Add an explicit transport observer test across the transaction boundary. | `order-before-commit` mutation survived 4 original order tests, fails with the fifth test. | Fixed (test gap) |

## Phase 1 — clean-state setup

- Read the README before running setup. Node here is 22.17.0, npm 10.9.2.
- Verified absolute cleanup targets are inside `D:\demo\analyticDashboard`; only generated dependencies, build outputs, `.env`, and local SQLite data will be removed.
- No `docker`, `psql` or `mysql` executable was returned by `Get-Command`. Alternative database runtime verification needs further investigation; no claim of a successful service test yet.

## Phase status

1. Clean-state setup: passed.
2. Static/build: passed.
3. Test coverage + mutation checks: passed.
4. Live end-to-end automation: passed.
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


## Phase 3 — suite audit and mutations

- Serial npm test: 39/39 passed (12 files), API 23, browser/React SDK 14, Node SDK 2.
- New coverage: direct uniqueness constraint, concurrent duplicates, one bulk insert, exact timestamp limits, per-project Origin/UUID scoping, explicit post-commit external transport observation, visibilitychange beacon, listener cleanup, 200-event cap and reload/outage recovery.
- Mutation commands: node scripts/mutations.mjs docs/MUTATIONS-before.json and npm run test:mutations. Before: 7 killed / 1 survived. After: all 8 killed, every source restored in finally; see the JSON reports.
- The first attempted baseline overlapped deliberate mutations and is invalid. It was not counted as a product failure; all subsequent suite/mutation runs are serial.
- Initial added tests exposed a leaked accessor mock (A04); 37/39 passed before fixture cleanup, 39/39 after. Concurrent Supertest uses one explicitly listening server, avoiding artificial MaxListeners warnings.
- No .skip, .only or .todo tests. The smoke test delegates to a helper containing real node:assert checks. Tests have meaningful assertions; no existing assertion was removed.


## Phase 4 — real process E2E

- npm run test:e2e: exit 0, nine grouped checks against actual Fastify and Next dev processes on ephemeral loopback ports, with isolated SQLite and random per-run credentials.
- Verified: 202 acceptance, retry duplicate counts + unchanged total, partial rejection index/reason, 401/403/422/413 responses, OPTIONS, body/query beacon keys, full browser-shaped event/order flow, authoritative server total despite tampered price, forwarded anonymous/session identity, no event for invalid order, 120/min throttle and Retry-After, dashboard proxy, no uncaught/unhandled errors or credential leakage in logs.
- The permanent command builds SDKs before launch and tears down its own child process trees and temporary database in finally. It does not depend on a manually running server or change the developer database.

