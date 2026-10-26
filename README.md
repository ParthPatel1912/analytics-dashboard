# Table & Thyme — full-stack analytics

A working npm-workspace monorepo: Fastify API, Next.js restaurant + analytics dashboard, zero-dependency browser SDK and framework-independent Node tracker. SQLite works out of the box. Node/TypeScript replaces the conflicting Laravel/PHP examples in the brief.

## Local setup (four commands)

Prerequisites: **Node 22.12+ within Node 22 LTS** (or Node 24/26), npm 10+, internet for npm dependencies. Node 20 is not supported by this repo's Vitest toolchain. `better-sqlite3` normally downloads a prebuilt binary; unsupported runtimes need native build tools. No Composer, PHP or external database required.

```powershell
npm install
Copy-Item .env.example .env
npm run seed:demo
npm run dev
```

On macOS/Linux use `cp .env.example .env` for the second command. Commands run from the repo root. `seed:demo` migrates and seeds automatically; `dev` builds SDKs and ensures the base database/menu exist before starting both servers.

- Restaurant: [localhost:3000](http://localhost:3000)
- Dashboard: [localhost:3000/dashboard](http://localhost:3000/dashboard)
- API health: [localhost:4000/health](http://localhost:4000/health)

Browse the menu, add an item, open your bag, and place a demo order with fake name/email. Browser events and the committed server order appear in the dashboard within ~8 seconds. No payment is taken. Click an event name to change its trend. Date range, timezone, interval and selected event persist in the URL. Dates are UTC bounds; timezone affects buckets only.

## Verification

```sh
npm test             # API + browser/React + Node SDK unit/regression tests
npm run test:api     # backend only (Vitest + Supertest)
npm run test:sdk     # SDKs only (browser tests use jsdom)
npm run smoke        # isolated in-memory page_view -> add_to_cart -> checkout -> stats
npm run typecheck
npm run build        # SDK packages, backend typecheck, production Next.js build
npm run size         # after build: browser IIFE gzip size; fails at 5 KiB
npm run test:e2e     # real API + Next processes, ingestion/auth/checkout/stats/throttling
npm run test:failures # actual API stop/restart, persisted delivery, concurrent retries
npm run test:ui      # five Playwright dashboard/checkout/failure-state tests
npm run test:docs    # execute the documented API requests against isolated services
npm run test:packages # build/exports/declarations/SSR/ignored files/documented size
npm run test:mutations # eight temporary mutations; run serially without dev servers
npm run explain     # recorded SQLite plans and bound alternative-dialect SQL
```

Browser SDK IIFE measured **2,910 bytes gzip (2.84 KiB)** after the audit fixes. Re-run `size` for the current measurement. React is a separate optional peer/entry and is excluded from that bundle. Start the built web app with `npm start -w @app/web`, and the API with `npx tsx apps/api/src/index.ts` under a process manager (without watch mode).

Playwright uses installed Edge on Windows. On other platforms install its browser with `npx playwright install chromium`; `PLAYWRIGHT_CHANNEL` can select another installed supported browser. Live tests start their own ephemeral servers and isolated databases/credentials. They need no manually running dev server and do not alter your developer data. No lint configuration exists; the commands above are the configured checks.

On Windows, `./scripts/verify-clean.ps1` reproduces the complete audit from a clean demo checkout. It deliberately deletes generated dependencies/build outputs, `.env`, local SQLite demo data and audit scratch files, then reinstalls and verifies everything serially. Results are saved incrementally in `docs/AUDIT-FINAL.json`.

## Five-line browser integration

```ts
import { createAnalytics } from '@pkg/sdk-js';
const analytics = createAnalytics({ writeKey: 'YOUR_PUBLIC_KEY', endpoint: 'https://api.example.com/api/v1/events/batch' });
analytics.track('add_to_cart', { menu_item_id: 1 });
analytics.identify('opaque-user-id');
await analytics.flush();
```

`page()`, `reset()`, `optOut()`, `optIn()`, `shutdown()` and `getIdentity()` are also available. Auto page views patch browser History and listen to popstate. React: import `AnalyticsProvider` / `useAnalytics` from `@pkg/sdk-js/react`; memoize the provider's options so renders do not recreate its tracker. In this demo options come from the server layout. IIFE: load `packages/sdk-js/dist/browser/index.global.js`, then call `TableAnalytics.createAnalytics(...)`.

## Server integration

```ts
import { ServerTracker, HttpTransport } from '@pkg/sdk-node';
const tracker = new ServerTracker(new HttpTransport(endpoint, process.env.DEMO_SECRET_KEY!), console.error);
await tracker.track('order_created', { order_id: 'opaque-id', total: 2500, item_count: 2, currency: 'USD' }, userId, anonymousId, sessionId);
```

Schedule tracking **after the business transaction commits**, and outside the checkout response path. The demo registers Fastify's `onResponse` hook and uses `InProcessTransport` (same ingestion service, no HTTP hop). External applications implement `EventTransport` or use `HttpTransport`, which retries stable UUIDs. Tracker errors never escape into business code. See [decisions](docs/DECISIONS.md) for the durability limitation of after-response work.

## Configuration

See [.env.example](.env.example). Its credentials are intentionally public and for local demos only. The API requires them through environment variables; there are no secret fallbacks in application code:

| Variable | Local default / purpose |
| --- | --- |
| `DEMO_PUBLIC_KEY` | `pk_local_restaurant`, browser project key |
| `DEMO_SECRET_KEY` | `sk_local_restaurant_change_me`, server ingestion secret |
| `DASHBOARD_TOKEN` | `dashboard_local_change_me`, API query bearer token |
| `WEB_ORIGIN` | `http://localhost:3000`, exact ingestion Origin allowlist |
| `PORT` | `4000`, API listen port |
| `API_URL` | `http://127.0.0.1:4000`, Next server proxy target |
| `NEXT_PUBLIC_ANALYTICS_ENDPOINT` | Browser-reachable ingestion URL |
| `SQLITE_FILE` | `./analytics.sqlite`, resolved relative to the repository root |
| `DATABASE_URL` | Optional `postgres://...` or `mysql://...`; overrides SQLite |
| `RATE_LIMIT` | `120` requests/min per valid public/secret project credential |
| `BLOCK_BOTS` | `false`; simple optional UA rejection |
| `TEST_DATABASE_URL` | Optional expendable Postgres database for `npm run test:postgres` |
| `PLAYWRIGHT_CHANNEL` | Optional UI-test browser channel; defaults to `msedge` on Windows |
| `API_EXAMPLE_BASE` | Optional base URL for executable API examples; otherwise `API_URL` |
| `NEXT_TELEMETRY_DISABLED` | Optional Next telemetry preference; live harness sets `1` |

No secret is sent to the browser. The local dashboard's Next proxy is deliberately open to whoever can visit this local app; the token protects direct query API calls only. **Add real web authentication before hosting publicly.** API binds loopback. Changing environment keys does not rewrite an existing project's stored keys/origins; use a fresh database for a new local project or perform an explicit credential migration.

## Structure

```text
apps/api/            ingestion, SQL stats, restaurant, migrations, seeds, tests
apps/web/            App Router UI + same-origin proxies
packages/sdk-js/     browser SDK + separate React helper
packages/sdk-node/   ServerTracker + transport interface + HTTP transport
docs/                setup, contract, assumptions, tradeoffs
```

Read [runnable API examples](docs/API.md), [engineering decisions](docs/DECISIONS.md), [extended setup](docs/README.md), and the [audit](docs/AUDIT.md). SQLite and PostgreSQL 18.4 runtime contracts were tested. MySQL SQL compiles; MySQL runtime/collation behavior remains unverified. Browser tests verify checkout, live events, filters and failure states. See [verification results](docs/VERIFICATION.md) and the [audited screenshot](docs/audit-dashboard.png).
