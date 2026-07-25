# DatIQ Developer API Reference

> **For developers integrating DatIQ into their own software.** This reference describes DatIQ's
> public HTTP API — the endpoints, authentication, request parameters, and response schemas you use
> to extract, enrich, batch, and schedule from your own code.
>
> It documents **only the public, outward-facing API**. It intentionally does not describe DatIQ's
> internal implementation. You don't need to know how DatIQ works inside to build against it — you
> only need the contract below.
>
> **Availability:** the public API is part of **API access**, included on the **Business** plan and above.
> This reference is published ahead of general availability; treat unreleased endpoints as a preview and
> pin to the versioned base URL.

---

## Overview

- **Base URL:** `https://api.datiq.app/v1`
- **Protocol:** HTTPS only. All requests and responses are JSON (`Content-Type: application/json`).
- **Versioning:** the major version is in the path (`/v1`). Breaking changes ship under a new version; additive changes do not.
- **Authentication:** a secret API key sent as a bearer token (see below).

The API mirrors what you can do in the app: extract a page, enrich it, generate content, run a batch,
and manage schedules that watch pages for changes.

---

## Authentication

Authenticate every request with your API key in the `Authorization` header:

```http
Authorization: Bearer dq_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

- Create and revoke keys in **Account → API keys** (Business plan and above).
- Keys are secret — use them only from your server, never in browser or mobile client code.
- Test keys are prefixed `dq_test_` and run against a sandbox that returns representative sample data without consuming quota.

Requests without a valid key return `401 Unauthorized`.

---

## Requests & conventions

- **IDs** are opaque strings; do not parse them.
- **Timestamps** are ISO-8601 UTC strings (e.g. `2026-06-20T13:49:26Z`).
- **Pagination** uses `limit` (default 25, max 100) and `cursor`. List responses return a `next_cursor` when more results exist.
- **Idempotency:** send an `Idempotency-Key` header on `POST` requests to safely retry without creating duplicates.

---

## Rate limits

Limits depend on your plan. Every response includes these headers:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Requests allowed in the current window. |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | Unix time when the window resets. |

Exceeding the limit returns `429 Too Many Requests`. Back off and retry after the reset.

---

## Endpoints

### Extract a single page

```http
POST /v1/extractions
```

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | The public page URL to extract. |
| `intent` | string | no | One of `summary` (default), `contacts`, `pricing`, `map`, `custom`. |
| `prompt` | string | when `intent=custom` | Plain-English description of the field(s) to extract. |
| `render_js` | boolean | no | Render JavaScript before reading the page. Default `false`. |

```bash
curl https://api.datiq.app/v1/extractions \
  -H "Authorization: Bearer $DATIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "intent": "summary"
  }'
```

Returns an **Extraction object** (see schemas).

### Retrieve an extraction

```http
GET /v1/extractions/{id}
```

Returns the **Extraction object** for a previously created extraction.

### List extractions

```http
GET /v1/extractions?limit=25&cursor=...
```

Returns `{ "data": [ Extraction, ... ], "next_cursor": "..." | null }`.

### Delete an extraction

```http
DELETE /v1/extractions/{id}
```

Returns `204 No Content`.

### Enrich an extraction

Run a targeted follow-up pass that adds more detail to an existing extraction.

```http
POST /v1/extractions/{id}/enrichments
```

| Field | Type | Required | Description |
|---|---|---|---|
| `focus` | string | yes | One of `contacts`, `leadership`, `social`, `mission`, `pricing`. |

Returns an **Enrichment object**.

### Generate content from an extraction

```http
POST /v1/extractions/{id}/content
```

| Field | Type | Required | Description |
|---|---|---|---|
| `format` | string | yes | One of `seo_outline`, `competitor_summary`, `social_posts`. |

Returns `{ "format": "...", "content": "..." }`.

### Submit a batch

Extract many URLs in one job.

```http
POST /v1/batches
```

| Field | Type | Required | Description |
|---|---|---|---|
| `urls` | string[] | yes | List of public page URLs. |
| `intent` | string | no | Same values as a single extraction. Applied to every URL. |
| `prompt` | string | when `intent=custom` | Plain-English field description. |

```bash
curl https://api.datiq.app/v1/batches \
  -H "Authorization: Bearer $DATIQ_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com", "https://stripe.com"],
    "intent": "summary"
  }'
```

Returns a **Batch object** with `status: "queued"`.

### Get batch status & results

```http
GET /v1/batches/{id}
```

Returns the **Batch object**. When `status` is `completed`, `results` holds one entry per URL (each with its own
status and, on success, an embedded Extraction).

### Schedules

Create and manage recurring extractions that watch a page and report changes.

```http
POST   /v1/schedules
GET    /v1/schedules
GET    /v1/schedules/{id}
PATCH  /v1/schedules/{id}
DELETE /v1/schedules/{id}
POST   /v1/schedules/{id}/run     # run once, immediately
```

**Create body**

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | yes | Page to watch. |
| `intent` | string | no | What to extract each run. |
| `cadence` | string | yes | One of `every_6h`, `twice_daily`, `daily`, `weekdays`, `weekly`, `monthly`, or a cron expression. |
| `alert_email` | string | no | Address to notify when the page changes. |
| `expires_at` | string | no | ISO-8601 date after which the schedule stops. |
| `name` | string | no | A label for the schedule. |

Returns a **Schedule object**.

---

## Webhooks

To receive change alerts programmatically instead of (or in addition to) email, register a webhook URL in
**Account → API keys → Webhooks**. When a scheduled run detects a change, DatIQ POSTs an event:

```json
{
  "type": "schedule.changed",
  "created_at": "2026-06-20T09:00:00Z",
  "data": {
    "schedule_id": "sch_123",
    "url": "https://example.com/pricing",
    "extraction_id": "ex_456"
  }
}
```

Respond with `2xx` within 5 seconds to acknowledge. DatIQ retries failed deliveries with exponential backoff.

---

## Response schemas

### Extraction object

```json
{
  "id": "ex_2eqi99p",
  "url": "https://lumio.io",
  "title": "Lumio — Product analytics that actually make sense",
  "intent": "summary",
  "summary": "Lumio is a product-analytics platform aimed at fast-moving teams…",
  "headings": [
    { "level": 1, "text": "Product analytics that actually make sense" },
    { "level": 2, "text": "Built for teams who move fast" }
  ],
  "links": [
    { "text": "Pricing", "href": "https://lumio.io/pricing", "category": "internal" },
    { "text": "LinkedIn", "href": "https://linkedin.com/company/lumio", "category": "social" }
  ],
  "enrichments": {},
  "created_at": "2026-06-20T13:49:26Z"
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique extraction id. |
| `url` | string | The page that was extracted. |
| `title` | string | The page's title. |
| `intent` | string | The intent used for this extraction. |
| `summary` | string | Plain-language AI overview (present for `summary` and most intents). |
| `headings` | array | Heading outline. Each item: `level` (1–6) and `text`. |
| `links` | array | Links found. Each item: `text`, `href`, and `category` (`internal` / `external` / `social`). |
| `enrichments` | object | Map of any enrichment results attached to this extraction (keyed by focus). |
| `created_at` | string | ISO-8601 creation time. |

When `intent` is `map`, the response also includes a `site_map` array of discovered URLs. When `intent`
is `pricing` or `contacts`, the relevant structured data appears under `enrichments`.

### Batch object

```json
{
  "id": "batch_zdldy51",
  "status": "completed",
  "intent": "summary",
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "created_at": "2026-06-20T13:57:45Z",
  "results": [
    { "url": "https://example.com", "status": "succeeded", "extraction": { "id": "ex_tkp20mc" } },
    { "url": "https://stripe.com",  "status": "succeeded", "extraction": { "id": "ex_6tt10md" } }
  ]
}
```

`status` is one of `queued`, `running`, `completed`. Each result's `status` is `succeeded` or `failed`
(failed entries include an `error` message).

### Schedule object

```json
{
  "id": "sch_ts2whjj",
  "name": "Track · lumio.io/pricing",
  "url": "https://lumio.io/pricing",
  "intent": "summary",
  "cadence": "daily",
  "status": "active",
  "alert_email": "you@company.com",
  "last_run_at": "2026-06-20T13:59:15Z",
  "last_status": "unchanged",
  "next_run_at": "2026-06-21T09:00:00Z",
  "created_at": "2026-06-20T13:58:56Z"
}
```

`status` is `active` or `paused`. `last_status` is `unchanged` or `changed`.

### Enrichment object

```json
{
  "focus": "contacts",
  "data": {
    "emails": ["press@lumio.io"],
    "people": [{ "name": "Jane Doe", "role": "VP Marketing" }]
  }
}
```

The shape of `data` depends on `focus`.

---

## Errors

Errors use standard HTTP status codes and a consistent JSON envelope:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "The 'url' field is required."
  }
}
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Missing or malformed parameters. |
| 401 | `unauthorized` | Missing or invalid API key. |
| 402 | `quota_exceeded` | Monthly extraction allowance reached. |
| 403 | `forbidden` | Your plan doesn't include this capability. |
| 404 | `not_found` | No such resource. |
| 422 | `unprocessable` | The target page could not be extracted (blocked, non-HTML, unreachable). |
| 429 | `rate_limited` | Too many requests; retry after the reset. |
| 5xx | `server_error` | Transient problem on DatIQ's side; retry with backoff. |

---

## Example: end-to-end (Node.js)

```js
const API = "https://api.datiq.app/v1";
const key = process.env.DATIQ_API_KEY;
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

// 1. Extract a page
const res = await fetch(`${API}/extractions`, {
  method: "POST",
  headers,
  body: JSON.stringify({ url: "https://example.com", intent: "summary" }),
});
const extraction = await res.json();

// 2. Enrich it with contacts
await fetch(`${API}/extractions/${extraction.id}/enrichments`, {
  method: "POST",
  headers,
  body: JSON.stringify({ focus: "contacts" }),
});

// 3. Generate a competitor summary
const content = await fetch(`${API}/extractions/${extraction.id}/content`, {
  method: "POST",
  headers,
  body: JSON.stringify({ format: "competitor_summary" }),
}).then((r) => r.json());

console.log(content.content);
```

---

## Support

Questions about the API? Email **hello@datiq.app**. For account, billing, and plan upgrades to unlock
API access, see the **Account** screen in the app.

---

## v1.0 preview endpoints

The following endpoints are scheduled for the v1.0 release. They are documented here ahead of general
availability so integrators can plan around them; treat them as a preview and pin to the versioned
base URL.

### Create a public shareable report

```http
POST /v1/extractions/{id}/share
```

Turn an existing extraction into a public, read-only report at
`https://datiq.app/p/{slug}`. Anyone with the link can view it; no DatIQ account required.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `ttl_days` | integer | no | Auto-expire the public report after N days. Omit for "no expiry". |

**Response**

```json
{
  "slug": "a8K2mQ4x",
  "url": "https://datiq.app/p/a8K2mQ4x",
  "expires_at": "2026-08-15T00:00:00Z"
}
```

### Revoke a public report

```http
DELETE /v1/extractions/{id}/share
```

Removes the public report; the underlying extraction is unaffected.

### List public gallery

```http
GET /v1/gallery?limit=20&cursor=...
```

Returns recent public extractions across all users. Useful for discovery integrations.

**Response**

```json
{
  "data": [
    {
      "slug": "a8K2mQ4x",
      "title": "Acme pricing",
      "intent": "pricing",
      "url": "https://datiq.app/p/a8K2mQ4x",
      "created_at": "2026-07-15T10:00:00Z"
    }
  ],
  "next_cursor": null
}
```

### Submit feedback on an AI summary

```http
POST /v1/extractions/{id}/feedback
```

Record a thumbs-up / thumbs-down rating on the AI summary, optionally with a free-text comment.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `rating` | string | yes | `up` or `down`. |
| `comment` | string | no | Free-text feedback. |

This data is used to improve the AI model.
