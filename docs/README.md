# Developer guide

The [root README](../README.md) is the canonical quick start. Run every command from the repository root.

1. `npm install` installs all four workspaces.
2. Copy `.env.example` to `.env`. Leave the defaults for a local run.
3. `npm run migrate` runs Knex migrations; `npm run setup` also seeds the project and ten menu items. Both are safe to repeat.
4. `npm run seed:demo` also inserts fourteen UTC calendar days of realistic analytics, with deterministic UUIDs and funnel drop-off. Repeating on the same dates does not duplicate fixtures. Real demo restaurant orders are stored separately; the generated analytics orders are synthetic events only.
5. `npm run dev` builds SDKs and starts API :4000 + web :3000, with watch mode.
6. `npm test` runs unit/regression tests, or use `npm run test:api` / `npm run test:sdk`. `npm run smoke` uses an isolated in-memory DB. `npm run test:e2e`, `npm run test:failures`, `npm run test:ui` and `npm run test:docs` start and stop actual temporary services. Run these serially; web tests share Next's development output directory.

## Custom ports / origins

Set `PORT`, `API_URL` and `NEXT_PUBLIC_ANALYTICS_ENDPOINT` together if changing the API port. For a different web port run `npm run dev -w @app/web -- --port 3001` and set `WEB_ORIGIN=http://localhost:3001` before seeding a new project. `localhost` and `127.0.0.1` are different Origins. Preflight must match the stored project's allowlist exactly.

Next loads root `.env` through `next.config.ts`; only the public write key and browser endpoint are passed into the client provider. The static dashboard token stays in the Next server process. Restart/rebuild when environment changes affect prerendered pages.

## PostgreSQL / MySQL

Create an empty UTF-8 database and put `DATABASE_URL=postgres://...` or `DATABASE_URL=mysql://...` in root `.env`. Then run `npm run setup`, `npm run seed:demo`, and `npm run dev`. Drivers are already dependencies. There is no automatic SQLite data transfer. Date arithmetic is isolated in `apps/api/src/buckets.ts`.

The audit ran native PostgreSQL 18.4 migrations, seed, concurrent idempotency, all queries, identity/timezone/zero filling, checkout and failure isolation. Set `TEST_DATABASE_URL` to your **expendable** Postgres database and run `npm run test:postgres`; only a generated `audit_*` schema is created/dropped. MySQL SQL compilation is checked, but real runtime/collation testing is still required.

For a temporary Windows Postgres fixture without a system service:

```sh
npm install --prefix .audit/postgres-runtime --no-save --package-lock=false --ignore-scripts @embedded-postgres/windows-x64@18.4.0-beta.17
npm run test:postgres:local
```

The downloaded binaries stay under the ignored audit directory, outside application dependencies. The harness starts a loopback-only cluster and stops/removes its generated data afterward. Other platforms can use `TEST_DATABASE_URL` with a local/container database.

## Tracking and privacy

The [root README](../README.md#five-line-browser-integration) shows browser and server integration. Never put server secrets in `NEXT_PUBLIC_*`. Supply only opaque user IDs; `identify` traits are caller-provided event properties and should contain no personal data. The demo does not send the name/email fields to any endpoint; it hashes the email client-side to demonstrate pseudonymous identification. Do Not Track / SDK opt-out disables browser delivery and forwarded browser identity; server business events still exist with a fresh anonymous identity.

`reset()` creates a new anonymous identity and session for future events (e.g. logout), while earlier queued events retain their original envelope. `shutdown()` attempts a beacon, aborts an active fetch, removes listeners and stops timers. Call and await `flush()` first when teardown must wait for acknowledged delivery.

## Debugging

- Empty range: choose 30 days or run `npm run seed:demo`; the default seven-day range should contain demo data immediately.
- Ingestion 403: compare Origin, public key and stored project origins. Beacon bodies use `write_key`.
- API unavailable: inspect both dev process logs and `/health`; check `API_URL`.
- DNT/opt-out: browser events are intentionally absent. Server orders remain independently tracked.
- Native SQLite install error: use Node 22 LTS with a prebuilt binary, or install the native toolchain required by better-sqlite3.
- Unit tests use in-memory databases; live/Playwright tests use temporary SQLite files and Postgres tests use a generated schema. The manually executed documentation example creates demo events/orders in your targeted API; its automated test runs in isolation.
