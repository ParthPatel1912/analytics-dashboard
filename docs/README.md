# Developer guide

The [root README](../README.md) is the canonical quick start. Run every command from the repository root.

1. `npm install` installs all four workspaces.
2. Copy `.env.example` to `.env`. Leave the defaults for a local run.
3. `npm run migrate` runs Knex migrations; `npm run setup` also seeds the project and ten menu items. Both are safe to repeat.
4. `npm run seed:demo` also inserts fourteen UTC calendar days of realistic analytics, with deterministic UUIDs and funnel drop-off. Repeating on the same dates does not duplicate fixtures. Real demo restaurant orders are stored separately; the generated analytics orders are synthetic events only.
5. `npm run dev` builds SDKs and starts API :4000 + web :3000, with watch mode.
6. `npm test` checks everything, or `npm run test:api` / `npm run test:sdk`. `npm run smoke` exercises ingestion -> order commit -> aggregate stats in an isolated in-memory DB, with no running services required.

## Custom ports / origins

Set `PORT`, `API_URL` and `NEXT_PUBLIC_ANALYTICS_ENDPOINT` together if changing the API port. For a different web port run `npm run dev -w @app/web -- --port 3001` and set `WEB_ORIGIN=http://localhost:3001` before seeding a new project. `localhost` and `127.0.0.1` are different Origins. Preflight must match the stored project's allowlist exactly.

Next loads root `.env` through `next.config.ts`; only the public write key and browser endpoint are passed into the client provider. The static dashboard token stays in the Next server process. Restart/rebuild when environment changes affect prerendered pages.

## PostgreSQL / MySQL

Create an empty UTF-8 database and put `DATABASE_URL=postgres://...` or `DATABASE_URL=mysql://...` in root `.env`. Then run `npm run setup`, `npm run seed:demo`, and `npm run dev`. Drivers are already dependencies. URL scheme is validated. There is no automatic copying of SQLite data. Knex migrations use native JSON columns and foreign keys; event timestamps are canonical UTC strings for portable comparisons. Date arithmetic lives in `apps/api/src/buckets.ts`. CI should provision actual DB services before switching a deployment; local automated tests use SQLite only.

## Tracking and privacy

The [root README](../README.md#five-line-browser-integration) shows browser and server integration. Never put server secrets in `NEXT_PUBLIC_*`. Supply only opaque user IDs; `identify` traits are caller-provided event properties and should contain no personal data. The demo does not send the name/email fields to any endpoint; it hashes the email client-side to demonstrate pseudonymous identification. Do Not Track / SDK opt-out disables browser delivery and forwarded browser identity; server business events still exist with a fresh anonymous identity.

`reset()` creates a new anonymous identity and session for future events (e.g. logout), while earlier queued events retain their original envelope. `shutdown()` attempts a beacon, aborts an active fetch, removes listeners and stops timers. Call and await `flush()` first when teardown must wait for acknowledged delivery.

## Debugging

- Empty range: choose 30 days or run `npm run seed:demo`; the default seven-day range should contain demo data immediately.
- Ingestion 403: compare Origin, public key and stored project origins. Beacon bodies use `write_key`.
- API unavailable: inspect both dev process logs and `/health`; check `API_URL`.
- DNT/opt-out: browser events are intentionally absent. Server orders remain independently tracked.
- Native SQLite install error: use Node 22 LTS with a prebuilt binary, or install the native toolchain required by better-sqlite3.
- All tests run against fresh in-memory databases and do not modify your local analytics file.
