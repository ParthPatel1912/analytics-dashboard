# Verification — 26 October 2026

Environment: Windows, Node 22.17.0, npm 10.9.2, SQLite (better-sqlite3).

| Check | Result |
| --- | --- |
| `npm test` | 30 tests passed across 10 files |
| `npm run smoke` | Ingestion -> cart event -> committed order -> stitched stats passed |
| `npm run typecheck` | All four workspaces passed |
| `npm run build` | SDK ESM/CJS/IIFE + declarations, API check and Next production build passed |
| `npm run size` | 2,659 bytes gzip / 2.60 KiB, below 5 KiB target |
| `npm audit` | 0 vulnerabilities |
| `npm run seed:demo` | 3,619 synthetic events over 14 days; repeat-run idempotency tested |
| Live HTTP routes | /, /menu, /cart, /checkout, /dashboard returned 200 |
| Live Next proxies | Menu and seeded overview returned expected JSON |
| Live checkout | POST via Next proxy produced $25.00 order, receipt GET and page returned 200, dashboard order count increased by one |
| Browser visual QA | Passed: populated dashboard, full browser checkout, receipt, and resulting browser/server events in live feed |
| Postgres / MySQL runtime | Unverified: no running services available |

The API tests include partial batches, auth, Origin restrictions, bounds, throttling, deduplication, identity semantics, UTC date boundaries, fractional timezone offsets, DST transitions, tenant isolation, order rollback and analytics failure isolation. SDK tests cover size/time batching, byte ceilings, beacon, retry/drop behavior, persistence, SPA dedupe, identity/session/reset, DNT/consent, storage failure and SSR.

Local dev servers were stopped after verification. Start them with `npm run dev`. Local fixture data and HTTP and browser smoke orders remain in the ignored SQLite database; tests use separate in-memory databases.
