# Engineering decisions

## Scope and assumptions

The explicit TECH STACK and monorepo layout take precedence over the contradictory Laravel, FormRequest, Artisan, Composer and PHPUnit references. All equivalents use Node 20+, Fastify, Zod, Knex and Vitest. No PHP installation is needed. This is a local application, not a hosted Sites deployment. Optional queues, rollups and bot filtering beyond a simple UA rule are intentionally out of scope.

## Storage and identity

Browser and server use the same UUID-v4 event envelope. `timestamp` becomes `occurred_at`; `received_at` is assigned at ingestion. Both are canonical 24-character UTC ISO strings so comparisons work identically across SQLite, Postgres and MySQL. Dashboards use occurred-at. Ingestion rejects dates older than 7 days or more than 24 hours ahead. The historical demo generator writes trusted fixtures directly so it can populate two weeks without weakening that rule.

Unique visitors count `COALESCE(user_id, anonymous_id)` within the range. Identity is attached only to subsequent events, with no retroactive merge, so a person who identifies can count twice. Sessions count distinct session IDs. The SDK persists anonymous identity and a session with a 30-minute inactivity timeout; reset starts both identities anew. A browser forwards anonymous/session/user IDs to checkout, linking its order event. Fake identification hashes an entered email in the browser and never sends the email or name to analytics. A hash is still a pseudonymous identifier, not anonymization.

Properties are JSON objects, at most 8 KiB in UTF-8, with depth <= 6; context is bounded too. The SDK collects page context but strips URL query strings and fragments by default. Applications must avoid personal data in event properties, paths and titles. No IP addresses are stored. User-agent text is untrusted, bounded to 500 characters, and never used for identity. `BLOCK_BOTS=true` optionally rejects known bot-like agents; it is not a security boundary.

Indexes: the unique project/event pair prevents retry duplicates. Project/time supports every range query; name/time supports event filtering; path/time supports page breakdowns; anonymous/time supports visitor investigations. Tenant project scope is always included. At scale add daily rollups, dialect-specific DB timezone grouping, partitioning and eventually a column store such as ClickHouse. Indexes increase write cost; retain only those justified by query plans.

## Credentials and deployment

Local demo keys have documented fallback values and can be replaced through `.env`. Public keys identify projects, not secrets. Public ingestion requires an exact allowed Origin and browser source; server source requires a SHA-256 hashed, high-entropy secret bearer key. Beacon sends the public key in the JSON body because it cannot set headers. Preflight is allowed only for a project-approved origin, while the actual request also validates its key. Query endpoints use one static dashboard bearer token scoped to the seeded demo project. The Next server proxies queries so the token is never bundled in browser code. Replace this with per-user authentication, project authorization, HTTPS and credential rotation for production.

Rate limiting is an in-memory fixed window per valid credential, 120 requests/minute by default, with Retry-After. Multi-instance deployments need a shared limiter. Browser localStorage and cookies require a real consent policy in production; Do Not Track and opt-out are honored. Cross-device identity merging, consent UI, sampling and event schema versions are future work.

## Portability references

Knex's [conflict handling](https://knexjs.org/guide/query-builder#onconflict) emits conflict-ignore SQL for supported engines. Fastify's [body limit](https://fastify.dev/docs/latest/Reference/Server/#bodylimit) enforces the 256 KiB ingestion bound before parsing. SQLite is exercised locally; Postgres/MySQL drivers are included, with portable migrations and queries, but need integration runs against real services before a production switch.
