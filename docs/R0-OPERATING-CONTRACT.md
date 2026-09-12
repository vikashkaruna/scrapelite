# Release 0 operating contract

This document defines the public boundaries that are already shipped in Release 0. It is deliberately narrower than future product positioning: a capability is not described as generally available until its code path, privacy boundary, documentation and release test agree.

## Public reports and privacy

Public reports are opt-in. A report exists only after its owner explicitly chooses **Share**; it is then addressed by an opaque slug at `/p/{slug}`. A public report is a client-rendered report surface, not an authenticated extraction permalink, an index of a customer's workspace, or a promise of server-side rendering.

The public projection is limited to the report title, source URL, summary, selected extraction/enrichment results, headings, links, intent and creation time. It must never add account identity, API keys, authentication headers, raw browser session data, billing records, private notes, workflow credentials or unreviewed request/response logs. Owners can revoke a report; an administrator can revoke a curated report with a written reason. Revocation removes public access rather than erasing the audit trail.

Before extending the share projection, add a projection test and review the field for a reasonable expectation of privacy. A future SSR/Edge rendering implementation must preserve the same opt-in and revocation semantics before it is enabled.

## Export compatibility contract

Extraction exports are produced by the shared builders in `src/lib/utils.js` and the shared branding context in `src/lib/exportBranding.js`. The contract is intentionally content-oriented, not a promise that CSV column order will never grow.

| Format | Stable envelope | Notes |
|---|---|---|
| CSV | `page,type,name,text,value` data row schema | Brand lines begin with `#`; CSV readers may ignore comment lines. Additive row types are allowed. |
| Markdown | branded header, one numbered page section per selected extraction, branded footer | Headings, links, maps and enrichment/custom fields are represented when present. |
| JSON | `{ export, pages }` | `export` has branding metadata, version, date and count. `pages` preserves URL, title, summary, headings, links and optional map/enrichment/custom data. |

Every format carries a consistent DatIQ attribution and source set. PDF and Excel are presentation formats and are intentionally not treated as a stable machine API. Discoverability report export is server-rendered; it follows its own report schema so its download and on-screen report cannot drift. Any breaking change to the three stable envelopes requires a new major export version and a migration note in the changelog.

## Public API contract

The machine-readable contract is [`openapi.v1.json`](./openapi.v1.json). Its server is `https://datiq.app/api/v1`, matching the Netlify redirect in `netlify.toml`; `api.datiq.app` is not asserted as a separate host.

`docs/DatIQ-Developer-API.md` remains the narrative guide, examples and operation-specific reference. The OpenAPI file is checked against the router's supported stable paths in the Netlify contract suite. The unauthenticated health endpoint is a reachability probe only. All other v1 operations require a server-side bearer API key; use an `Idempotency-Key` for side-effecting requests.

The release runner may verify health and public Discoverability contracts without a credential. Authenticated API-key smoke tests require a disposable staging key and an owned target URL. A missing test key is reported as a release deviation, never as a successful test.

## Curated programmatic SEO governance

The six programmatic routes are curated entries in `src/lib/programmaticRoutes.js`; they are not an automated page-generation engine. A new route requires all of the following in the same change:

1. a human-reviewed title, description, H1, substantive copy and truthful CTA;
2. a route/component test and an update to the static sitemap/prerender output;
3. a static SEO audit with canonical, metadata and duplicate-title checks; and
4. a legal/privacy review if user content, public report data or third-party marks appear.

Do not publish thin variants, fabricated outcomes, ranking promises, or a route whose CTA requires an unshipped module. The existing DMCA/takedown route and gallery revocation process are the escalation path for a published page or report; content removal requests must be recorded and acted on by an operator.

## Webhook delivery contract

There are two intentionally separate webhook mechanisms. They must not be described as one uniform, generally available webhook API.

1. **Extraction-saved browser webhook** sends `extraction.saved` directly from the browser to a URL configured by the user or deployment. It is best effort, unsigned, has no delivery log or retry queue, and may contain the extraction data the user elected to route. It is suitable only for an endpoint the user controls and must not be used as an authenticated integration boundary.
2. **Discoverability audit webhook** is a server-side, per-user subscription for `audit.completed`, `audit.failed`, `audit.regressed`, and `recommendation.created`. The destination is checked for public reachability at registration and delivery. When a secret is configured, the raw JSON body is signed in `X-DatIQ-Signature` as `t=<epoch-ms>,v1=<hex-hmac-sha256(timestamp + "." + rawBody)>`; receivers must enforce the five-minute replay window. `X-DatIQ-Event: discoverability` identifies the producer. Each attempt has an eight-second timeout and updates the webhook's last status/time. It does not yet retry automatically or retain a per-attempt immutable event log.

The public API documentation therefore does not promise schedule-change webhooks, a five-second acknowledgement deadline, exponential retry, or a general-purpose delivery API. Those require a durable queue, attempt records, replay controls and an externally verified receiver test before promotion beyond beta.

## Analytics vocabulary and data boundary

The lifecycle vocabulary is defined in `src/lib/analyticsService.js` and is tested as a closed helper set. Product analytics records the minimum event name and properties required for funnel measurement: `page_view`, `extraction_success`, `extraction_failed`, `save`, `export`, `monitor`, and `first_insight`. It is consent-aware; the analytics erasure path is documented in the Privacy page.

Activation/PQL events use a separate private store and helpers such as `template_run_completed`, `integration_connected`, `integration_push`, `watchlist_created`, `bulk_enrichment_completed`, `enrichment_completed`, `report_published`, `report_shared`, `teammate_invited`, `pricing_viewed`, `extraction_exported`, `extraction_saved`, and `digest_received`. Add a helper and a test before adding a new event name. Do not put URLs, extracted page content, secrets, personal contact details or a free-form prompt into public product-analytics properties.

## Release evidence

The Train A gate requires the unit/contract/integration/system/database/build/prerender/security/smoke/visual suites, the six-route axe scan, and the parameterized release runner. The staging and production authenticated portions additionally require disposable credentials, an owned URL and a successful cleanup verification. An access-policy `401`, missing credential, skipped provider sandbox or failed cleanup is evidence of an incomplete deployment gate, not a pass.
