# Analytics audit

## Resume status — 26 October 2026

- Completed and committed: phases 1–6, through `5eb1c57`. Existing unit/regression, live E2E, mutation, SQLite EXPLAIN and PostgreSQL runtime evidence is retained below.
- Partial: phase 7. Uncommitted Playwright configuration, five browser tests, a live seed helper and its development dependency were recovered. The previous browser run failed 5/5: two cold-dev-server readiness/navigation timeouts, stale KPIs after API failure, checkout waiting for analytics, and corrupt saved cart data.
- Not started: phase 8 documentation reconciliation and final clean-state verification.
- Inspection found no unrecovered mutation: unique index, conflict-ignore, API-key/Origin checks, visitor identity, zero filling, post-commit scheduling, SDK retry and beacon are intact. No production source diff or half-edited source was present.
- Resume baseline: `npm run typecheck` exit 0; `npm run build` exit 0. `npm run test:report` initially reported API 30 passed / 1 timed out, browser/React SDK 18 passed, Node SDK 4 passed. The timed-out auth test file was immediately rerun unchanged: 6/6 passed in 668 ms, confirming a transient readiness/timing failure rather than a reproduced auth defect. Full-suite confirmation follows the phase-7 fixes.
- Continue from phase 7; do not redo completed phases. Browser tests will warm development routes before assertions, retaining all assertions and the strict stalled-analytics deadline.

Started 26 October 2026. This file records commands actually run, findings, regression evidence and remaining verification limits. Original checkout: `0411409`. No existing tests will be skipped or weakened.

## Findings

| ID | Severity | Issue / root cause | Fix | Regression evidence | Status |
| --- | --- | --- | --- | --- | --- |
| A01 | major | README advertises Node 20.19 and root engines allow Node 20, but installed Vitest 5 requires Node 22.12 / 24 / 26+. | Root engines and README now require Node 22.12+ (22.x), 24.x or 26.x. | `setup.test.ts`: minimum-runtime test failed before (20 < 22.12), passed after. | Fixed |
| A02 | minor | README server example uses undocumented `ANALYTICS_SECRET`, while setup provides `DEMO_SECRET_KEY`. | Example now reads `DEMO_SECRET_KEY`. | `setup.test.ts`: example-env contract failed before, passed after. | Fixed |
| A03 | major | `.env.local`, `.env.production` and other local secret variants were not ignored. | Ignore `.env.*` except `.env.example`, plus logs and temporary audit output. | `node --test scripts/packages.test.mjs`: ignore test failed before, passed after. | Fixed |
| A04 | minor | A jsdom test that mocked both cookie accessors left an own-property mock descriptor, breaking later tests. | Restore the prototype cookie accessor during cleanup; preserve every original assertion. | New lifecycle/queue tests initially failed with leaked `blocked` getter; all 39 tests pass after cleanup. | Fixed |
| A05 | major | Existing tests could not detect external order tracking before commit. | Add an explicit transport observer test across the transaction boundary. | `order-before-commit` mutation survived 4 original order tests, fails with the fifth test. | Fixed (test gap) |
| A06 | major | Readable but quota-full localStorage overrode a newer opt-out cookie on reload. | Read the mirrored consent/identity cookie first. | `failures.test.ts`: consent regression failed before, passed after. | Fixed |
| A07 | minor | A failed in-flight fetch could recreate a retry timer after shutdown. | Abort delivery and clear request/retry timers; never schedule after stop. | Timer count was 1 after shutdown, now 0. | Fixed |
| A08 | major | A fetch that never settled held the SDK busy forever. | Abort each fetch after 10 seconds and enter ordinary retry/backoff. | Hung-fetch recovery test failed before (one attempt), passed after (delivery on retry). | Fixed |
| A09 | minor | Old Retry-After state survived opt-out and delayed later opted-in events. | Cancel backoff and clear its deadline during opt-out. | Immediate new-event delivery regression failed before, passed after. | Fixed |
| A10 | minor | Wholly invalid huge/deep-property batches returned 202, conflicting with the newer QA request's clean-4xx rule. | Return indexed 422 when every event is rejected; preserve partial-batch 202. | API failure regression failed before (202), passed after (422); mixed batch remains 202. | Fixed |
| A11 | minor | Dashboard auth accepted a bare token; both auth parsers rejected valid differently cased Bearer schemes. | Shared strict, case-insensitive Bearer parser on ingestion and every query route. | Two auth regressions failed before, passed after. | Fixed |
| A12 | minor | Credential helper compared character lengths before byte buffers, throwing on some UTF-8 inputs. | Compare byte lengths before timingSafeEqual; use helper for fixed hash/token comparisons. | UTF-8 no-throw regression failed before, passed after. | Fixed |
| A13 | minor | Full timestamp query dates silently rolled invalid calendar dates into another day. | Validate full UTC timestamps before Date normalization. | Invalid February date / 24:00 regressions failed before, passed after. | Fixed |
| A14 | major | Equivalent uppercase/lowercase event UUIDs could create two rows in SQLite. | Canonicalize validated event UUIDs to lowercase. | Case-variant replay regression failed before, passed after. | Fixed |
| A15 | minor | Node HTTP transport retried before Retry-After when delay exceeded one minute. | Honor the server deadline, splitting only for platform timer limits. | 120-second fake-clock regression failed before, passed after. | Fixed |
| A16 | minor | Malformed Node Retry-After produced NaN and an immediate retry. | Ignore non-finite parsed delays and retain exponential delay. | Malformed-header regression failed before, passed after. | Fixed |
| A17 | minor | Missing favicon generated a browser console 404. | Add native SVG app icon and legacy favicon redirect. | Warmed normal browser checkout failed the unchanged zero-console-errors assertion before fix. | Fixed |
| A18 | major | Rapid dashboard changes built URLs from stale navigation state and dropped earlier filters. | Merge pending changes until their navigation commits. | Existing filter browser test failed with missing `interval=hour` before fix. | Fixed |
| A19 | major | Dashboard retained old KPIs/feed after a failed query, implying stale data belonged to the current filter. | Clear stale result data when its request fails. | Stopped-API regression saw four stale cards instead of none before fix. | Fixed |
| A20 | major | Checkout awaited analytics delivery, letting a stalled analytics request block ordering. | Start best-effort analytics delivery without awaiting it; forward identity synchronously. | Hung-analytics browser checkout missed its unchanged 3-second deadline before fix. | Fixed |
| A21 | minor | Saved-cart restoration accepted incomplete items and invalid quantities, rendering NaN totals. | Validate restored item fields, cents and quantity bounds before display. | Corrupt-storage browser test failed before fix. | Fixed |

## Phase 1 — clean-state setup

- Read the README before running setup. Node here is 22.17.0, npm 10.9.2.
- Verified absolute cleanup targets are inside `D:\demo\analyticDashboard`; only generated dependencies, build outputs, `.env`, and local SQLite data will be removed.
- No `docker`, `psql` or `mysql` executable was returned by `Get-Command`. Alternative database runtime verification needs further investigation; no claim of a successful service test yet.

## Phase status

1. Clean-state setup: passed.
2. Static/build: passed.
3. Test coverage + mutation checks: passed.
4. Live end-to-end automation: passed.
5. Failure modes: passed.
6. Risky-code review and EXPLAIN: passed (SQLite + PostgreSQL runtime; MySQL compilation only).
7. Dashboard/browser checks: passed (5 Playwright tests).
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


## Phase 5 — failure modes

- Before fixes: targeted failure tests 1 passed / 5 failed (four SDK bugs and all-invalid API status). After: 6/6 passed.
- npm run test:report: 45/45 passed; API 25, browser/React SDK 18, Node SDK 2.
- npm run test:failures: exit 0. Actual API process stopped while SDK ran, queued event persisted, SDK instance reloaded, API restarted, same UUID delivered exactly once. Twelve concurrent HTTP retries produced one acceptance and eleven duplicates.
- Malformed JSON 400, unsupported XML 415, Fastify-parsed plain text 422, empty JSON body 400, wholly huge/deep properties 422; API stayed healthy. The first harness expectation incorrectly assumed text/plain was unsupported; this was corrected to test both the built-in text parser and unsupported XML, without changing production media handling.
- Server logs checked for uncaught/unhandled errors and actual generated secrets; none found. Existing order-rollback and tracking-failure isolation tests remain passing.
- npm run typecheck: exit 0.


## Phase 6 — risky code, storage and performance

- Reviewed ingestion/auth/stats/bucketing/migrations, restaurant commit scheduling, both SDK implementations and React lifecycle line by line. Raw SQL expressions are fixed/allowlisted fragments; all event values, date bounds, offsets and user filters are bound. Ingestion uses one bulk insert within a transaction and storage-level unique UUID constraint.
- Before auth/date/UUID fixes: review.test.ts 1 passed / 5 failed. After: 6/6 passed. Node retry tests before 2/4 passed, after 4/4.
- npm run explain: exit 0. See docs/QUERY-PLANS.json for actual SQLite plans and bound PostgreSQL/MySQL compilation. Overview/recent use project+time; timeseries uses its covering index; pages use project+name+time; event breakdown uses the project/name/time covering index. GROUP BY / COUNT DISTINCT temp B-trees remain expected, with rollups a scale improvement.
- Temporary npm binary package @embedded-postgres/windows-x64@18.4.0-beta.17 installed only under ignored .audit/postgres-runtime with scripts disabled. No application dependency or system service added. Its postgres --version reported PostgreSQL 18.4.
- npm run test:postgres:local: exit 0; actual PostgreSQL migrations, seed, concurrent idempotency, every query endpoint, identity, timezone/zero filling, server-priced checkout, post-commit event and invalid-order isolation passed. Generated cluster/schema stopped and removed afterward.
- Secrets stored only as SHA-256 hashes; UTF-8-safe constant-time comparison is used after fixed-hash lookup and for dashboard tokens. Direct API routes all require a Bearer token. Logs redact raw IP and credentials; live harness asserts both. UA truncation and absence of IP columns tested. Demo raw identity privacy is checked in browser phase.
- SDK fetch timeout and shutdown/consent cleanup tested; methods contain guarded synchronous/async boundaries and no framework/runtime dependency in the browser core. npm run build:sdks, npm run typecheck passed; npm run size measured 2,754 gzip bytes (2.69 KiB), README corrected.
- MySQL SQL compilation is verified; MySQL runtime/collation behavior still needs a running service and is explicitly not claimed as verified.


## Phase 7 — resumed browser verification

- Recovered tests, Playwright dependency and seed helper were completed rather than discarded. No production mutation leftovers existed.
- Warmed dev routes before assertions; did not remove/relax any assertion or change the 3-second stalled-analytics deadline. Warmed pre-fix run: 0/5 passed, exposing favicon 404, lost URL filter, stale data, analytics-blocked checkout, and corrupt cart.
- npx playwright test after fixes: 5/5 passed in 19.4 seconds against installed Edge. Normal checkout and dashboard emitted no browser console errors, page errors or hydration warnings. Intentional stopped-API 502 responses were verified separately.
- Browser checks cover Today/7d/30d/custom presets, URL persistence across refresh, rapid interval/event changes, KPI/page/event/feed agreement with API, line/bar charts, loading/empty/error states, seeded data, raw-name/email exclusion, receipt total and stalled analytics.
- Screenshot visually inspected: docs/audit-dashboard.png.
- npm run test:report: API 31/31, browser/React SDK 18/18, Node SDK 4/4; full suite 53/53. The earlier resume timeout did not recur.
- npm run typecheck and npm run build -w @app/web: exit 0.
