# Verification — 26 October 2026

Environment: Windows, Node 22.17.0, npm 10.9.2; SQLite, native PostgreSQL 18.4, Playwright with installed Edge.

The final clean-state run **passed** using `./scripts/verify-clean.ps1`. Generated dependencies, `.env`, SQLite data, build outputs and audit scratch files were removed first. Every command below exited 0; source hashes were checked after mutation restoration.

| Command/check | Observed result |
| --- | --- |
| `npm ci`; `Copy-Item .env.example .env` | Clean dependency installation/environment setup passed |
| `npm run migrate`; `npm run seed:demo` | Passed; 3,619 events over 14 days |
| `npm run build`; `npm run typecheck` | SDK ESM/CJS/IIFE + declarations, API TypeScript build check and Next production build passed |
| `npm run test:report`, before and immediately after mutations | **54/54 passed**: API 31, browser/React SDK 19, Node SDK 4 |
| `npm run test:mutations` | **8/8 detected**, every patched source hash restored |
| `npm run test:packages` | **4/4 passed**: client directives, ignored artifacts, exports/declarations/SSR, truthful size docs |
| `npm run test:e2e` | Nine grouped checks passed against real API/Next processes |
| `npm run test:failures` | API stop/restart, persisted delivery, concurrency and clean malformed-input failures passed |
| `npm run test:docs` | **26/26** runnable documented requests passed |
| `npm run test:ui` | **5/5 passed** in 18.2s: checkout/privacy, filters/API agreement, loading/empty/outage states, hung analytics, corrupt cart |
| `npm run explain` | Five SQLite query shapes use project indexes; alternative SQL compiles with bindings |
| `npm run test:postgres:local` | Native PostgreSQL **18.4** migrations, queries, concurrency, identity, timezone and checkout passed |
| `npm run size` | **2,910 bytes gzip (2.84 KiB)**, below 5 KiB |
| `npm audit` | **0 vulnerabilities** |

See [AUDIT.md](AUDIT.md), [mutation results](MUTATIONS.json), [query plans](QUERY-PLANS.json), and the [verified screenshot](audit-dashboard.png).

MySQL runtime/collation remains unverified and needs a running service. No lint configuration exists. Static dashboard authentication and best-effort after-response delivery are documented demo limitations.

The temporary Postgres binaries were installed with the documented `npm install --prefix .audit/postgres-runtime --no-save --package-lock=false --ignore-scripts @embedded-postgres/windows-x64@18.4.0-beta.17` command. Clusters, schemas and live test processes were stopped/removed by their harnesses. The developer SQLite file contains only the new seed; run `npm run dev` to browse it.

## Original definition of done

| Requirement | Result |
| --- | --- |
| Install, migrate, seed and start locally | PASS using the explicitly selected Node stack; Laravel/Composer references are superseded as documented |
| Browser pages/custom activity and committed server order appear in dashboard | PASS: permanent browser and live HTTP tests |
| Backend and SDK tests pass through documented commands | PASS: all 54 unit/regression tests; separate real-process/UI commands also pass |
| Docs explain integration, assumptions and limitations | PASS: executable API examples, decisions, audit and final command evidence |

MySQL runtime is an explicit remaining verification gap, not a claimed pass. A disposable MySQL service plus an equivalent migration/query/checkout contract (including case-sensitive identity/path collation) is needed to close it.
