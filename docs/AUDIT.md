# Analytics audit

Started 26 October 2026. This file records commands actually run, findings, regression evidence and remaining verification limits. Original checkout: `0411409`. No existing tests will be skipped or weakened.

## Findings

| ID | Severity | Issue / root cause | Fix | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | major | README advertises Node 20.19 and root engines allow Node 20, but installed Vitest 5 requires Node 22.12 / 24 / 26+. | Root engines and README now require Node 22.12+ (22.x), 24.x or 26.x. | `setup.test.ts`: minimum-runtime test failed before (20 < 22.12), passed after. | Fixed |
| A02 | minor | README server example uses undocumented `ANALYTICS_SECRET`, while setup provides `DEMO_SECRET_KEY`. | Example now reads `DEMO_SECRET_KEY`. | `setup.test.ts`: example-env contract failed before, passed after. | Fixed |

## Phase 1 — clean-state setup

- Read the README before running setup. Node here is 22.17.0, npm 10.9.2.
- Verified absolute cleanup targets are inside `D:\demo\analyticDashboard`; only generated dependencies, build outputs, `.env`, and local SQLite data will be removed.
- No `docker`, `psql` or `mysql` executable was returned by `Get-Command`. Alternative database runtime verification needs further investigation; no claim of a successful service test yet.

## Phase status

1. Clean-state setup: passed.
2. Static/build: pending.
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

