# DatIQ Developer API Reference

> **For developers integrating DatIQ into their own software.** This reference describes DatIQ's
> public HTTP API — the endpoints, authentication, request parameters, and response schemas you use
> to extract, enrich, batch, and schedule from your own code.
>
> It documents **only the public, outward-facing API**. It intentionally does not describe DatIQ's
> internal implementation. You don't need to know how DatIQ works inside to build against it — you
> only need the contract below.
>
> **Availability:** API access is included on the **Business** plan and above. The versioned API contract
> is available in [`openapi.v1.json`](./openapi.v1.json). Endpoints explicitly marked beta in this guide
> remain subject to their documented release gate; do not treat an unpublished integration as available.

---

## Overview

- **Base URL:** `https://datiq.app/api/v1`
- **Protocol:** HTTPS only. All requests and responses are JSON (`Content-Type: application/json`).
- **Versioning:** the major version is in the path (`/v1`). Breaking changes ship under a new version; additive changes do not.
- **Authentication:** a secret API key sent as a bearer token (see below).

The API mirrors the extraction and monitoring core of the app: extract a page, enrich it, generate content,
run a batch, run a discoverability audit, and manage schedules that watch pages for changes.

**Getting intelligence out without polling.** DatIQ's newer workflow surfaces — templates, bulk account
lists, competitor watchlists — do not yet have public REST endpoints (see *Planned endpoints* at the end of
this document). They are, however, already programmatically reachable in the direction most integrations
want: a **signal routing rule** configured in the app can call **your** webhook whenever a watched
competitor changes, an account crosses your ICP threshold, or a workflow run finishes. That is a push, so
you receive events as they happen instead of polling for them. See **Webhooks** below for the current
delivery boundary and signing behaviour.

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

### Discoverability audits

Score a page for classic search (SEO), answer engines (AEO) and generative
engines (GEO), and get the prioritised fixes.

```http
POST   /v1/audits                          # run an audit
GET    /v1/audits                          # list your audits
GET    /v1/audits/{id}                     # status and summary
GET    /v1/audits/{id}/results             # the full payload
GET    /v1/audits/{id}/report              # markdown, csv or json
POST   /v1/audits/{id}/rerun               # re-run, measured against this one
DELETE /v1/audits/{id}
GET    /v1/audits/{id}/compare/{baseline}  # what changed between two audits
GET    /v1/audits/{id}/recommendations
GET    /v1/audits/{id}/headings
GET    /v1/audits/{id}/schema
GET    /v1/audits/{id}/answers
GET    /v1/audits/{id}/entities
GET    /v1/audits/{id}/technical
POST   /v1/recommendations/{id}/accept
POST   /v1/recommendations/{id}/dismiss    # a reason is required
GET    /v1/targets                         # pages you have audited
GET    /v1/targets/{id}/history
GET    /v1/targets/{id}/trends             # time series for charting
POST   /v1/benchmarks                      # audit several URLs and compare
GET    /v1/benchmarks/{id}
```

**Create body**

| Field | Type | Required | Description |
|---|---|---|---|
| `target_url` | string | yes | The page to audit. |
| `device_profile` | string | no | `mobile` (default) or `desktop`. |
| `audit_profile` | string | no | `balanced` (default), `seo`, `aeo` or `geo`. Selects which score leads the report; all four are always computed the same way. |
| `page_type_hint` | string | no | `article`, `faq`, `howto`, `pricing`, `product`, `docs`. Decides which checks apply. Detected automatically when omitted. |
| `baseline_audit_id` | string | no | An earlier audit to compare against. |
| `idempotency_key` | string | no | Strongly recommended. A repeated request returns the original audit instead of spending a second credit. |
| `prompt_sample_set_id` | string | no | A saved prompt set for citation sampling. |
| `tags` | string[] | no | Up to 10 labels. |

Returns an **Audit object**. Audits have their own monthly allowance, separate
from extraction credits.

**Report formats**

```http
GET /v1/audits/{id}/report?format=markdown&constructs=1
GET /v1/audits/{id}/report?format=csv&rows=recommendations
GET /v1/audits/{id}/report?format=json
```

`markdown` and `csv` return text rather than JSON. `constructs=1` embeds the
copy-ready implementation assets in the markdown report.

#### Governed P2 intelligence APIs

The canonical namespace for Discoverability automation is `/v1/discoverability/*`. The older
bare P1 paths above remain permanent aliases. P2 resources are workspace-aware: pass
`workspace_id` as a query parameter on reads and in the JSON body on writes. Read endpoints require
a workspace viewer role; writes require the action-specific workspace role and entitlement
(`audit.business_truth`, `audit.entity_graph`, `audit.subject_score`, `audit.local_directory`, or
`audit.schema_trust`). A resource outside the caller's personal/workspace scope returns `404`, not `403`, so
opaque IDs cannot be enumerated. A valid resource with an insufficient workspace role returns `403`.

```http
GET|POST /v1/discoverability/business-truth
GET      /v1/discoverability/business-truth/{id}
GET|POST /v1/discoverability/business-truth/{id}/versions
POST     /v1/discoverability/business-truth/{id}/versions/{version}/promote

GET      /v1/discoverability/entity-graph
POST     /v1/discoverability/entity-graph/entities
POST     /v1/discoverability/entity-graph/relationships

GET|POST /v1/discoverability/subject-score/subjects
GET|POST /v1/discoverability/subject-score/scores
GET|POST /v1/discoverability/local-directory/listings
GET|POST /v1/discoverability/local-directory/checks
GET|POST /v1/discoverability/schema-trust/schema
GET|POST /v1/discoverability/schema-trust/trust
```

Entity-backed `brand`, `product`, and `service` subjects are created only through the explicit
subject endpoint and only after the referenced entity is approved. Approval never auto-mints a
scorable subject. Business-truth promotion also requires an independent reviewer; self-approval is
refused. Duplicate entity relationships return `409` with corroboration semantics rather than
silently creating a second edge.

#### P3 SXO and outcome APIs

The canonical prefix is `/v1/discoverability/sxo/*`; `/v1/sxo/*` is a permanent compatibility
alias. SXO reads are authenticated. Evaluation, imports, connection configuration, goals and
validation require `audit.sxo`; portfolio experiment writes require `audit.portfolio`.

```http
POST /v1/discoverability/sxo/audits
GET  /v1/discoverability/sxo/audits/{id}
GET  /v1/discoverability/sxo/audits/{id}/results
GET  /v1/discoverability/sxo/audits/{id}/intent-match
GET  /v1/discoverability/sxo/audits/{id}/first-screen
GET  /v1/discoverability/sxo/audits/{id}/journey
GET  /v1/discoverability/sxo/audits/{id}/form-diagnostics
POST /v1/discoverability/sxo/events/import
POST /v1/discoverability/sxo/integrations/{provider}/connect
POST /v1/discoverability/sxo/conversion-goals
GET  /v1/discoverability/sxo/conversion-goals
POST /v1/discoverability/sxo/experiments
GET  /v1/discoverability/sxo/portfolio/rollups
POST /v1/discoverability/sxo/recommendations/{id}/validate
```

`POST /sxo/audits` requires `audit_id`; optional `intent_class`, `primary_outcome`, and
`weight_set_id` select the declared evaluation context. The response contains six layer results,
coverage, the SXO score, and the read-time master composite. Unmeasured inputs are `null` and named;
they are never coerced to zero.

Analytics connection bodies require `provider_account_id` plus `token` or `api_key`. Supported
providers are `ga4`, `posthog`, and `plausible`. Credentials are encrypted and never returned;
responses expose only a masked fingerprint. Saving credentials produces `status: "configured"`—it
does not claim provider verification or a successful sync.

Aggregate imports require a stable `idempotency_key`, `provider`, and an `events` array of
`{ event_name, count }`. Counts must be non-negative safe integers. The API accepts aggregate-only
data, queues it with `202`, returns `200` for a completed replay, and returns `409
IDEMPOTENCY_CONFLICT` if the same key is reused with different content. Raw sessions, IP addresses,
and visitor identifiers are not accepted. Funnel responses name and exclude uninstrumented stages.

Common errors are `400` invalid shape/vocabulary, `401` invalid API key, `402` missing entitlement,
`403` insufficient role on a known workspace resource, `404` absent or out-of-scope resource, `409`
idempotency/duplicate conflict, and `503` unavailable credential encryption or import queue.

---

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

## Webhooks — beta boundary

The only server-side webhook subscription currently covered by this API is **Discoverability audit**
delivery: `audit.completed`, `audit.failed`, `audit.regressed`, and `recommendation.created`. It posts a
summary payload (score, issue counts, top recommendations and links to the full report), not a customer's
full extraction payload.

When a subscriber configures a secret, DatIQ includes a timestamped `X-DatIQ-Signature` header that
cryptographically verifies the exact JSON body. Reject a signature outside the five-minute replay window.
`X-DatIQ-Event: discoverability` identifies the producer.

Each delivery has an eight-second timeout and updates the subscription's last delivery status/time. There
is **no durable retry queue or per-attempt replay log yet**. Generic schedule-change webhooks and the old
five-second acknowledgement/exponential-backoff promise are not part of v1. See
[`R0-OPERATING-CONTRACT.md`](./R0-OPERATING-CONTRACT.md) before treating webhooks as an integration
boundary.

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

### Audit object

```json
{
  "audit_id": "aud_01K123ABCXYZ",
  "target": {
    "url": "https://example.com/guide/what-is-geo",
    "page_type": "article",
    "device_profile": "mobile",
    "audit_profile": "balanced"
  },
  "framework_scores": { "overall": 78.4, "seo": 75.2, "aeo": 82.1, "geo": 77.3 },
  "coverage": 92.5,
  "pillar_scores": {
    "answer_clarity": {
      "score": 84.0,
      "weight": 0.30,
      "coverage": 100,
      "signals": {
        "direct_answer_block": 100,
        "conciseness": 88,
        "passage_independence": 79,
        "question_headings": 70,
        "extractable_formatting": 82
      }
    },
    "technical_accessibility": {
      "score": 76.0,
      "weight": 0.25,
      "coverage": 70,
      "signals": {
        "crawl_index_eligibility": 90,
        "render_completeness": 70,
        "core_web_vitals": null,
        "mobile_parity": 100,
        "structured_data_validity": 78
      }
    }
  },
  "penalties": [
    {
      "code": "AI_CRAWLER_PARTIAL_BLOCK",
      "severity": "medium",
      "penalty_factor": 0.05,
      "description": "One or more AI crawlers appear blocked in robots directives."
    }
  ],
  "score_math": { "pre_penalty_total": 82.5, "penalty_multiplier": 0.95, "final_score": 78.4 },
  "issues": [
    {
      "code": "SH-06",
      "pillar": "structural_hierarchy",
      "severity": "high",
      "frameworks": ["aeo", "seo"],
      "title": "Visible FAQs carry no FAQPage schema",
      "evidence": "6 visible question-and-answer pairs carry no FAQPage markup."
    }
  ],
  "recommendations": [
    {
      "id": "rec_901",
      "code": "SH-06",
      "priority": "high",
      "priority_score": 58.4,
      "owner": "seo",
      "frameworks": ["aeo", "seo"],
      "title": "Add FAQPage JSON-LD whose wording matches the visible questions and answers exactly.",
      "rationale": "The content is already there; the markup is what makes it eligible for direct extraction.",
      "estimated_lift": 4.8,
      "implementation_asset": {
        "type": "jsonld",
        "format": "html",
        "label": "FAQPage schema",
        "body": "<script type=\"application/ld+json\">{ ... }</script>"
      },
      "status": "open"
    }
  ],
  "stage_errors": []
}
```

**`null` is not `0`.** A signal that reads `null` was not measured — the
external service was unavailable, or the check does not apply to this page
type. It is EXCLUDED from its pillar and its weight is redistributed across the
signals that were measured, rather than being scored as a failure.

That is what `coverage` reports: the share of intended evidence this audit
actually gathered. A score of 92 built on 70% coverage is not the same as a 92
built on all of it, and your code should treat them differently. `stage_errors`
lists what could not be gathered and why.

`penalties` are multiplicative and apply to every framework score, not only the
overall one. `score_math` shows the arithmetic.

---

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

---

## Planned endpoints

These surfaces exist in the app today and are on the roadmap for the public API. They are listed so you can
plan around them; they are **not callable yet**, and this section will be replaced by full reference entries
when they ship.

| Area | Planned resources | What it will let you do |
|---|---|---|
| **Workflow templates** | `/v1/templates`, `/v1/templates/{key}/runs` | List the catalogue, start a run with an input payload, poll or receive its result. |
| **Account lists** | `/v1/lists`, `/v1/lists/{id}/items`, `/v1/lists/{id}/runs` | Import domains, start enrichment, read back scored accounts with coverage and provenance. |
| **ICP rules** | `/v1/icp-rules` | Read and update the weighted criteria and threshold an account list is scored against. |
| **Watchlists** | `/v1/watchlists`, `/v1/watchlists/{id}/changes` | Create a watch, set its cadence, and read the classified change feed. |
| **Signal rules** | `/v1/signal-rules` | Manage routing rules programmatically instead of in the app. |
| **Reports** | `/v1/reports`, `/v1/reports/{id}/visibility` | Publish a result as a report and change or revoke its visibility. |

Until they land, the supported integration pattern for these surfaces is: configure the workflow in the app,
and route its output to your systems with a **webhook signal rule**.
