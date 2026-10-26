# HTTP API

Local base: `http://localhost:4000`. All responses are JSON. Ingestion body limit is 256 KiB including envelope. Examples use documented **local-demo** credentials; substitute environment values in real deployments.

## Ingest a batch

`POST /api/v1/events/batch`

Browser: `X-Analytics-Key: pk_local_restaurant` and `Origin: http://localhost:3000`. A public key without an allowed Origin is rejected. `write_key` in the JSON body (beacon) or query string is also supported; prefer the body to avoid query logging. Server: `Authorization: Bearer sk_local_restaurant_change_me`. A server secret authenticates only `source=server`; public keys authenticate only `source=browser`.

```json
{
  "events": [{
    "event_id": "f04827a2-b733-4bba-a350-ea6aef1c4113",
    "name": "page_view",
    "timestamp": "2026-10-26T10:30:00.000Z",
    "anonymous_id": "browser-opaque-id",
    "session_id": "session-opaque-id",
    "user_id": null,
    "source": "browser",
    "properties": {},
    "context": {
      "url": "http://localhost:3000/menu",
      "path": "/menu",
      "referrer": "http://localhost:3000/",
      "title": "Table & Thyme",
      "user_agent": "untrusted agent text",
      "screen": { "width": 1440, "height": 900 },
      "locale": "en-US"
    }
  }]
}
```

Use a current UTC timestamp when trying the example. Names must be lower snake_case, start with a letter, max 100 chars. UUIDs must be v4. Identity/session fields are non-empty strings up to 200 chars; user_id is nullable. Context/properties must be JSON objects, each <= 8 KiB UTF-8 and depth <= 6. `context.path`, when supplied, begins with `/`; paths and UA are truncated to 500 chars and other named text context fields to 1,000. No IP is stored. Timestamps older than 7 days or more than 24 hours ahead are rejected per event.

202 (partial validity is normal):

```json
{
  "accepted": 1,
  "duplicates": 1,
  "rejected": [{ "index": 2, "reason": "name: Invalid string" }]
}
```

Indexes refer to the submitted array. Accepted + duplicates + rejected count = batch size. Duplicate UUIDs do not update existing rows, including retries with changed content. Malformed duplicates still undergo validation. 1–50 events per batch. A completely invalid, structurally valid batch still returns 202 with all events rejected.

```sh
curl -X OPTIONS http://localhost:4000/api/v1/events/batch \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,x-analytics-key'
```

Preflight: 204 with reflected approved Origin, `Vary: Origin`, allowed methods/headers, max-age 600. CORS does not authenticate the actual batch; its project key and Origin are checked again. There are no credentialed cross-origin cookies.

| Status | Example body / condition |
| --- | --- |
| 400 | `{ "error": "..." }`, malformed JSON |
| 401 | `{ "error": "invalid_key" }`, missing/bad credential |
| 403 | `{ "error": "origin_not_allowed" }` or `bot_blocked` |
| 413 | `{ "error": "Request body is too large" }` |
| 422 | `{ "error": "events must contain 1 to 50 events" }` |
| 429 | `{ "error": "rate_limited" }`, `Retry-After: <seconds>` |
| 500 | `{ "error": "internal_error" }`; no internal stack returned |

## Dashboard queries

All five endpoints require `Authorization: Bearer dashboard_local_change_me`. Results scope to the configured demo project. The Next.js local dashboard proxies these requests server-side; its UI never receives the token.

Shared query parameters:

| Field | Behavior |
| --- | --- |
| `from` | UTC ISO timestamp ending in Z or YYYY-MM-DD; defaults to seven days before `to` |
| `to` | UTC ISO timestamp ending in Z or YYYY-MM-DD; defaults to now |
| `tz` | IANA timezone for buckets, defaults to UTC |

Both endpoints of the time range are **inclusive**. A date-only from is 00:00:00.000Z; a date-only to is 23:59:59.999Z. Maximum span: 90 × 24 hours. `tz` does not reinterpret UTC range boundaries. Use explicit UTC instants to query a complete local calendar day. Date-range, timezone, metric, event-name or limit validation failures return 422 `{ "error": "...", "details": [...] }` (details only for Zod failures). Missing/wrong dashboard bearer returns 401 `{ "error": "invalid_dashboard_token" }`.

### Overview

`GET /api/v1/stats/overview?from=2026-10-20&to=2026-10-26`

```json
{ "total_events": 1000, "page_views": 400, "unique_visitors": 80, "sessions": 95, "orders_created": 22 }
```

Visitors count distinct COALESCE(user_id, anonymous_id); sessions count distinct session_id in range. Pre-identify events are not merged.

### Timeseries

`GET /api/v1/stats/timeseries?from=2026-10-25&to=2026-10-26&metric=page_views&interval=day&tz=UTC`

`metric=page_views|events|visitors` (default page_views), `interval=day|hour` (default day), optional `event=<snake_case>` filter. Applying a non-page_view event filter together with metric=page_views returns zeroes.

```json
{
  "from": "2026-10-25T00:00:00.000Z", "to": "2026-10-26T23:59:59.999Z",
  "tz": "UTC", "interval": "day", "metric": "page_views",
  "buckets": [{ "bucket": "2026-10-25", "value": 0 }, { "bucket": "2026-10-26", "value": 19 }]
}
```

Buckets are local wall-clock labels, e.g. `2026-10-26T10:00` for hours, without a misleading Z suffix. Empty buckets are zero-filled. Missing hours on DST spring-forward are absent; repeated fall-back hours combine into one local label with a distinct visitor count for the combined hour. Partial first/last buckets contain only events within the requested UTC range.

### Top pages

`GET /api/v1/stats/top-pages?from=2026-10-20&to=2026-10-26&limit=10`

Limit 1–100, default 10. Page_view events only; null paths excluded. Descending views, then path ascending for deterministic ties.

```json
{ "pages": [{ "path": "/menu", "views": 200, "unique_visitors": 55 }, { "path": "/", "views": 140, "unique_visitors": 60 }] }
```

### Event breakdown and selected daily trend

`GET /api/v1/stats/events?from=2026-10-25&to=2026-10-26&event=order_created`

Selected event defaults to order_created. Breakdown always includes all names in range; selected event only filters trend.

```json
{
  "events": [{ "name": "page_view", "count": 19 }, { "name": "order_created", "count": 2 }],
  "trend": {
    "from": "2026-10-25T00:00:00.000Z", "to": "2026-10-26T23:59:59.999Z", "tz": "UTC",
    "interval": "day", "metric": "events",
    "buckets": [{ "bucket": "2026-10-25", "value": 0 }, { "bucket": "2026-10-26", "value": 2 }]
  }
}
```

### Recent event feed

`GET /api/v1/events/recent?from=2026-10-25&to=2026-10-26&limit=50`

Limit 1–100, default 50. Descending occurred_at, then storage ID. All shared range parameters apply.

```json
{ "events": [{ "id": 7, "project_id": 1, "event_id": "f04827a2-b733-4bba-a350-ea6aef1c4113", "name": "page_view", "source": "browser", "anonymous_id": "opaque-visitor", "session_id": "opaque-session", "user_id": null, "path": "/menu", "referrer": "", "properties": {}, "context": { "path": "/menu" }, "occurred_at": "2026-10-26T10:30:00.000Z", "received_at": "2026-10-26T10:30:01.000Z" }] }
```

## Restaurant endpoints

No authentication in this local demo. These are not intended as production checkout APIs.

`GET /api/menu`:

```json
{ "items": [{ "id": 1, "name": "Garden burrata", "description": "Creamy burrata, seasonal tomatoes, basil oil", "category": "Starters", "price": 1250, "emoji": "🥗" }] }
```

Prices and order totals are integer USD cents. Ten items are seeded.

`POST /api/orders`:

```json
{ "items": [{ "menu_item_id": 1, "quantity": 2 }] }
```

Optional identity stitching headers: `X-Analytics-Anonymous-Id`, `X-Analytics-Session-Id`, `X-Analytics-User-Id` (bounded to 200 chars). Never include raw personal data. Unknown menu IDs, duplicate item IDs, 0/negative/over-20 quantities, empty carts or more than 30 line items return 422. Client prices are ignored.

201:

```json
{ "id": "b72ec3e6-8230-4bfd-bad1-f4969a757612", "total": 2500, "currency": "USD", "created_at": "2026-10-26T10:35:00.000Z" }
```

After commit and response, server emits order_created with `{ order_id, total, item_count, currency }`. Analytics failures are logged and do not alter a successful checkout response.

`GET /api/orders/b72ec3e6-8230-4bfd-bad1-f4969a757612` returns the same fields plus:

```json
{ "items": [{ "name": "Garden burrata", "quantity": 2, "unit_price": 1250 }] }
```

404: `{ "error": "order_not_found" }`. Invalid UUID: 422. Order UUIDs act as unguessable local-demo receipt URLs; add real ownership checks for production.

`GET /health`: 200 `{ "status": "ok" }` (process liveness only).

## Next.js proxies

`/api/restaurant/menu`, `/api/restaurant/orders`, `/api/restaurant/orders/:id` forward only allowlisted restaurant paths and identity headers. `/api/stats/overview`, `/timeseries`, `/top-pages`, `/events`, `/recent` forward allowlisted stats paths with a server-held bearer token. Upstream connection failures return 502 `{ "error": "..." }`. They are deliberately accessible without login in this local demo. Add authentication and request-rate/body limits to these proxies before deployment.
