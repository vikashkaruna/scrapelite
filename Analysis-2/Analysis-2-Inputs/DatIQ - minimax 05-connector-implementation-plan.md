# Datiq — Connector Implementation Plan: HubSpot, Stripe, Calendly, Apollo

**Companion to**: findings.md §1.7 (gap #5: no native CRM), the 12-week sprint plan, and `03-pricing-packaging.md` (CRM enrichment credits per tier).
**Authoring window**: 2026-08-03
**Scope**: 4 connectors — 2 OAuth (HubSpot, Stripe), 1 webhook receiver (Calendly), 1 API-key (Apollo). Plus the shared **Connector Framework** that all four live on, and that future connectors (Salesforce, Pipedrive, Notion, etc.) will be added to in Phase 2+.
**Out of scope for this plan**: bi-directional sync (we do outbound writes; inbound sync is Phase 2+), custom field mapping UIs (the four connectors ship with opinionated default mappings; the UI for arbitrary field maps is Phase 2).

**v2 sequencing note**: The corrected Top-10 + Major Bet reordering (per `06-corrections-and-correed-top10.md`) puts **M08 — Chat with this extraction** ahead of M01 — Templates marketplace. This plan is consistent with that reordering: M08 alpha lands in P1-W7, public alpha in P1-W8, GA in P1-W11. The connectors and the templates marketplace ship in parallel and converge at P1-W12 (all GA). The end-to-end "Lead to Meeting" demo at W12 now includes the M08 chat loop as the conversation starter, not just the extraction result.

---

## 1. The Connector Framework (one-week investment, pays back forever)

All four connectors live on the same internal abstraction. The framework is built in P1-W8.5 (1 BE × 1 week) and ships before the four connectors. Without it, each connector is a one-off; with it, each connector is 1–2 weeks of net-new work.

### 1.1 Core types

```typescript
// Every connector implements this. The "scope" defines what data the
// connector can read and write on the destination system.

type ConnectorScope =
  | 'contacts.read' | 'contacts.write'
  | 'companies.read' | 'companies.write'
  | 'deals.read' | 'deals.write'
  | 'events.read'  // Calendly-style: pull scheduled meetings
  | 'events.write' // push a contact → trigger a Calendly invite
  | 'payments.read' // Stripe-style: pull customers + invoices
  | 'enrichment'    // Apollo-style: enrich a contact or company

interface Connector {
  id: string                              // 'hubspot', 'stripe', etc.
  displayName: string
  authType: 'oauth2' | 'api_key' | 'webhook_receiver'
  // OAuth flow
  authorizationUrl?: (state: string, redirectUri: string) => string
  exchangeCode?: (code: string, redirectUri: string) => Promise<TokenSet>
  refreshToken?: (refreshToken: string) => Promise<TokenSet>
  // Operations
  ops: Record<string, ConnectorOp>        // op name → op spec
  // Webhooks (Stripe, Calendly)
  verifyWebhook?: (req: Request, body: string) => Promise<boolean>
  parseWebhookEvent?: (body: any) => WebhookEvent
}

interface ConnectorOp {
  inputSchema: z.ZodTypeAny
  outputSchema: z.ZodTypeAny
  // The op knows nothing about the user's data; it just runs against
  // the destination. The orchestration (which records to send, when
  // to refresh tokens, what to do on failure) lives in the worker.
  execute: (auth: AuthContext, input: any) => Promise<any>
  costEstimate?: (input: any) => { credits: number; usd: number }
}
```

### 1.2 Storage model

```sql
-- One row per connected account
create table connector_connections (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  connector_id text not null,                 -- 'hubspot', 'apollo', ...
  external_account_id text,                    -- e.g. HubSpot portal id
  auth_type text not null,                     -- 'oauth2' | 'api_key'
  encrypted_token_set jsonb,                   -- AES-256-GCM at rest
  scopes text[] not null,
  status text not null default 'active',       -- 'active' | 'revoked' | 'expired' | 'error'
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz default now(),
  unique (workspace_id, connector_id, external_account_id)
);

-- Per-operation audit log
create table connector_runs (
  id uuid primary key,
  workspace_id uuid not null,
  connection_id uuid references connector_connections(id),
  op text not null,                            -- 'contacts.upsert', etc.
  input_hash text,                             -- for idempotency
  output_summary jsonb,
  status text not null,                        -- 'ok' | 'error' | 'rate_limited'
  error text,
  credits_consumed numeric(10,3),
  started_at timestamptz,
  finished_at timestamptz
);
create index on connector_runs (workspace_id, started_at desc);
```

### 1.3 Rate-limit & retry policy

- Per-connector rate limiter using the destination's published limits (see per-connector sections).
- Exponential backoff on 429/5xx with jitter; max 3 retries.
- On 401, mark the connection `expired` and notify the workspace owner (in-app + email).
- On 429 from a destination, surface a "destination is rate limiting us" toast to the user; the worker continues the queue in the background.
- Idempotency: every write op sends a client-supplied `Idempotency-Key` (Datiq-side) that maps to a `request_id` on the destination (HubSpot supports it natively via the header; Stripe via the `Idempotency-Key` header; Apollo does not — we add a `clay_last_attempt_id` field as a soft-dedup for Apollo).

### 1.4 UI surface

A new `/integrations` page (added to top nav in W4) shows the four connector cards. Each card has:
- **Connect** / **Reconnect** / **Disconnect** CTA
- **Status pill**: active / error / expired
- **Usage this month**: e.g. "2,341 / 10,000 enrichment credits"
- **Recent runs**: last 10 runs with status + link to the run detail

A reusable **"Send to <Connector>"** action surfaces on the Preview page (contact, company) and on the Dashboard (batch result row). The action opens a 2-step modal: pick the connection → confirm the field mapping → run.

---

## 2. HubSpot — full implementation plan

### 2.1 Why HubSpot first

1. The Datiq "Build a lead list" outcome tile (findings.md §1.3) is the most differentiated marketing surface; without a HubSpot push, it stops at "spreadsheet."
2. HubSpot is the most-requested CRM in the Datiq testimonial signal ("we replaced a $300/month tool" — Alex R., Head of Sales).
3. HubSpot's API is well-documented and the OAuth app marketplace is open to public apps in 4–6 weeks.

### 2.2 Auth

- **Type**: OAuth 2.0
- **App registration**: Public app on the HubSpot developer platform (developer.hubspot.com). Listing in the HubSpot Marketplace is a Phase 2 goal (gated by SOC 2 Type II).
- **Required scopes**:
  - `crm.objects.contacts.read`, `crm.objects.contacts.write`
  - `crm.objects.companies.read`, `crm.objects.companies.write`
  - `crm.objects.deals.read`, `crm.objects.deals.write` (Phase 2 — not in MVP)
  - `sales-email-read` (Phase 2 — to read recent email activity on a contact)
- **Token refresh**: HubSpot access tokens expire after 6 hours; refresh tokens last 6 months with rolling refresh. We refresh on every use if the token is within 1 hour of expiry.
- **Account-level storage**: the connection is per-HubSpot-portal. A workspace can have one or more HubSpot connections (multi-portal agencies).

### 2.3 Operations

| Op | Direction | Datiq input | HubSpot endpoint | Notes |
|---|---|---|---|---|
| `contacts.upsert` | Datiq → HubSpot | `{ email, firstName, lastName, company, phone, customFields }` | `POST /crm/v3/objects/contacts` (create) or `PATCH /crm/v3/objects/contacts/{id}` (update) | **Match by HubSpot Object ID first**, then by email. Never overwrite fields owned by the customer. |
| `companies.upsert` | Datiq → HubSpot | `{ domain, name, industry, employees, revenue }` | `POST /crm/v3/objects/companies` | Match by domain. |
| `contacts.search` | HubSpot → Datiq | `{ email?, domain?, limit }` | `GET /crm/v3/objects/contacts/search` | Used by "did we already push this?" pre-check. |
| `companies.search` | HubSpot → Datiq | `{ domain, limit }` | `GET /crm/v3/objects/companies/search` | |
| `contacts.note.add` | Datiq → HubSpot | `{ contactId, note, sourceUrl }` | `POST /crm/v3/objects/notes` | Logs the Datiq extraction as a HubSpot engagement. |
| `companies.activity.add` | Datiq → HubSpot | `{ companyId, activityType, body, sourceUrl }` | `POST /crm/v3/objects/engagements` | |

### 2.4 Field mapping defaults

| Datiq field | HubSpot contact property | HubSpot company property | Notes |
|---|---|---|---|
| `email` | `email` | n/a | Required for create |
| `firstName` | `firstname` | n/a | |
| `lastName` | `lastname` | n/a | |
| `phone` | `phone` | `phone` | |
| `jobTitle` | `jobtitle` | n/a | |
| `linkedinUrl` | `linkedin` | n/a | |
| `name` | n/a | `name` | |
| `domain` | n/a | `domain` | Required for create |
| `industry` | n/a | `industry` | |
| `employees` | n/a | `numberofemployees` | |
| `description` | n/a | `description` | |
| `techStack[]` | n/a | custom: `datiq_tech_stack` | Multi-line text — Phase 2 splits into a multi-checkbox property |
| `extractedAt` | custom: `datiq_last_enriched` | custom: `datiq_last_enriched` | ISO-8601 timestamp; never overwritten by HubSpot-side workflows |
| `extractionUrl` | custom: `datiq_source_url` | custom: `datiq_source_url` | Original URL the lead was extracted from |

**Custom property names** are namespaced (`datiq_*`) and the documentation will tell the customer to create them on their portal — we provide a one-click "create the Datiq custom properties" button on the integration setup screen.

### 2.5 Rate-limit policy (per the HubSpot docs)

- **OAuth public app**: 110 requests per 10 seconds per HubSpot account that installs the app. (Source: HubSpot developer docs, 2025.)
- **CRM search API**: 5 requests per second per auth token, 200 records per page.
- **Batch**: max 100 records per batch request.
- **Our internal budget**:
  - Free / Pro: 50,000 HubSpot API calls / workspace / month
  - Team: 250,000 / month
  - Business: 1,000,000 / month
  - Agency: 5,000,000 / month
- **Pre-flight check**: before a batch send, run `contacts.search` (capped at 5/sec) to determine create vs update, so we make exactly 1 write per record (not 2).
- **429 handling**: 3-retry exponential backoff with jitter; mark the connection `error` and surface a banner if the rate-limit persists for >1 hour.

### 2.6 User-facing UX

1. **Setup**: User clicks "Connect HubSpot" on `/integrations`. OAuth flow. On return, a setup wizard shows:
   - "Create Datiq custom properties on your HubSpot portal" (one-click, idempotent)
   - "Pick a default list" (optional; default = no list)
   - "Test connection" (sends a single fake contact to a Datiq test list, then deletes it)
2. **Daily use**: From any Preview or Dashboard row with a contact, the user clicks "Send to HubSpot." A 2-step modal shows the field mapping (default + the option to override for this record), then runs. A toast confirms: "Pushed 1 contact to HubSpot · view in HubSpot →".
3. **Activity logging**: Every push adds a HubSpot note engagement with the source URL and the extraction timestamp.
4. **Re-push**: From a saved extraction, "Re-push to HubSpot" re-runs the upsert with the latest extracted data. The user can pick "update only changed fields" or "force overwrite of Datiq-owned fields."

### 2.7 Build estimate

| Task | Owner | Eng-weeks |
|---|---|---|
| OAuth app registration + scope approval | 1 BE | 0.5 (incl. wait time — do in W3) |
| Token storage + refresh | 1 BE | 0.3 |
| 6 ops (contacts.upsert, contacts.search, companies.upsert, companies.search, contacts.note.add, companies.activity.add) | 1 BE | 1.5 |
| Pre-flight create-vs-update check | 1 BE | 0.5 |
| Rate-limit + retry layer (shared with framework) | 1 BE | 0.5 (counted against framework) |
| UI: `/integrations` card + connect flow + custom property wizard | 1 FE + 0.3 DES | 1.0 |
| UI: "Send to HubSpot" action on Preview + Dashboard | 1 FE | 1.0 |
| Re-push action + field-override modal | 1 FE | 0.5 |
| Docs page + 1 demo video | 0.3 DR | 0.3 |
| **HubSpot total** | | **6.1 eng-weeks** |

Phasing: P1-W7 (read-side), P1-W8 (write-side), P1-W10 (activity log), P1-W11 (public beta), P1-W12 (GA).

### 2.8 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| OAuth app review stalls in HubSpot's queue | High | Start the registration in P0-W3. Have a "user pastes their own private app token" fallback for the first 50 paying customers. |
| Field-mapping collisions (a user has a different `datiq_tech_stack`) | Medium | Always namespace as `datiq_*`; never overwrite an existing property; surface a "couldn't create property, please create manually" message with the spec. |
| 429 storms on a single workspace | Medium | Token-bucket rate limiter per workspace; surface a "destination is rate limiting us" toast; never let one workspace consume the global budget. |
| Customer-side workflows overwrite our write | Medium | Use the `datiq_*` namespace; document the "use Datiq custom properties only" rule. |
| Revoked token during a batch | High | Detect before batch start; surface the "reconnect" CTA; resume the batch after re-auth. |
| Overwriting the customer's own contact data | High | **Match by HubSpot Object ID; never overwrite fields that the customer manages in HubSpot.** Only write to the `datiq_*` properties by default. Field-override modal requires explicit user opt-in. |

---

## 3. Apollo.io — full implementation plan

### 3.1 Why Apollo (not instead of HubSpot)

Apollo provides **enrichment** (email, phone, title, employer) where HubSpot stores **records**. The two are complementary: extract a domain and a name from a page → enrich with Apollo → push the enriched record to HubSpot. This is the workflow Clay sells at $446/mo.

### 3.2 Auth

- **Type**: API key (no OAuth required for Apollo's enrichment API)
- **App registration**: Apollo → Settings → Integrations → API. Generate a key per workspace. The user pastes the key into Datiq; we encrypt at rest.
- **For partners** (Phase 2): OAuth 2.0 for joint-customer scenarios.

### 3.3 Operations

| Op | Direction | Datiq input | Apollo endpoint | Notes |
|---|---|---|---|---|
| `people.enrich` | Apollo → Datiq | `{ firstName, lastName, domain?, linkedinUrl? }` | `POST /api/v1/people/match` | Returns email, phone, title, employer. |
| `people.bulk_enrich` | Apollo → Datiq | `[ {firstName, lastName, domain?} ]` (max 100) | `POST /api/v1/people/bulk_match` | Returns up to 100 enriched records. |
| `organizations.enrich` | Apollo → Datiq | `{ domain }` | `POST /api/v1/organizations/enrich` | Returns industry, size, revenue, tech stack. |
| `people.search` | Apollo → Datiq | `{ jobTitle, domain, seniority, limit }` | `POST /api/v1/mixed_people/search` | Used by "Build a lead list" tile to find decision-makers at a domain. |

### 3.4 Cost model

- Apollo charges **per enriched record when credit-consuming data is returned** (their docs are explicit: "if Apollo doesn't find credit-consuming data, the request consumes 0 credits").
- **Our internal pricing**: $0.012 per credit consumed; we mark-up to $0.04/credit for the "Native CRM — extra enrichment" line in `03-pricing-packaging.md` §4.
- **UI**: before a bulk enrichment, show a "this will use N credits (~$X)" estimate and require a confirm.
- **Soft cap**: workspace-level monthly cap (default $50); user can raise it in `/integrations` settings.

### 3.5 Rate-limit policy (per Apollo docs)

- Per-endpoint rate limits; published in the View API Usage Stats endpoint.
- Apollo uses **fixed-window rate limiting**.
- Apollo's hard cap: 200 req/min on a typical paid plan. We budget at 100 req/min to leave headroom.
- Apollo does **not** support an `Idempotency-Key` header — we add a `clay_last_attempt_id` (Apollo's name) and `datiq_run_id` field as a soft-dedup. For full idempotency, the user must use the "Don't enrich already-enriched" filter (built into our orchestrator).

### 3.6 User-facing UX

1. **Setup**: User pastes their Apollo API key in `/integrations`. We test with a sample enrichment against `apollo.io`.
2. **Daily use**: From a "Find contacts" tab on Preview, the user sees a list of contacts already on the page (from Datiq's basic extraction). Each row has a "Enrich with Apollo" button. Click → modal shows cost estimate → run. A toast confirms and adds the enriched fields to the row.
3. **Bulk**: From a Batch result, the user can "Enrich all unmatched" — runs Apollo on every row that has a firstName + lastName + domain but is missing an email or phone. Cost estimate shown before run.
4. **Waterfall (Phase 2)**: M09 — try Apollo first, fall back to Hunter, then Clearbit. Out of scope for this plan.

### 3.7 Build estimate

| Task | Owner | Eng-weeks |
|---|---|---|
| API key encryption + connection storage | 1 BE | 0.3 (counted against framework) |
| 4 ops (people.enrich, people.bulk_enrich, organizations.enrich, people.search) | 1 BE | 1.0 |
| Cost estimator + soft cap | 1 BE | 0.3 |
| UI: Apollo card on `/integrations` | 1 FE | 0.3 |
| UI: "Enrich with Apollo" action on Find-contacts tab | 1 FE | 0.5 |
| UI: Bulk-enrich modal on Batch results | 1 FE | 0.5 |
| Docs page + 1 demo video | 0.3 DR | 0.3 |
| **Apollo total** | | **3.2 eng-weeks** |

Phasing: P1-W7 (people.enrich + organizations.enrich), P1-W8 (people.search + bulk), P1-W10 (bulk-enrich on Batch results), P1-W11 (public beta), P1-W12 (GA).

### 3.8 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Apollo credit costs blow up the COGS | High | Per-workspace soft cap; pre-run cost estimate surfaced; rate-limit bulk runs. |
| Apollo API key leaked | High | AES-256-GCM at rest; show last-4 only in UI; one-click rotate. |
| Apollo changes pricing or shuts down enrichment API | Medium | Connector is one of four — the other three (HubSpot, Stripe, Calendly) absorb value even if Apollo goes away. |
| Apollo "matched person" has wrong email | Medium | Surface Apollo's match confidence in the UI; never auto-overwrite a verified email. |

---

## 4. Stripe — full implementation plan

### 4.1 Why Stripe

Datiq's customer base is mostly paying customers (the pricing ladder). Stripe is the billing layer for most of them (and for Datiq itself). The Stripe connector is **internal-first** — it powers Datiq's own metering + billing, and it gives customers a "what did I spend on Datiq" view. Phase 2 extends it to "pull competitor Stripe data" via public dashboards.

### 4.2 Auth

- **Type**: OAuth 2.0 (recommended for SaaS platforms); **or** restricted API key (read-only, scoped to billing data). For the internal-first MVP, we use the **restricted key** (one per environment).
- **App registration**: Stripe Connect platform app (for connected accounts) — Phase 2. For the MVP, the user creates a restricted key in their Stripe dashboard and pastes it.

### 4.3 Operations

| Op | Direction | Datiq input | Stripe endpoint | Notes |
|---|---|---|---|---|
| `customers.list` | Stripe → Datiq | `{ limit, cursor }` | `GET /v1/customers` | Powers the "your customers" view. |
| `customers.usage` | Stripe → Datiq | `{ customerId, since }` | `GET /v1/usage_records/summation` | Aggregated metered usage. |
| `invoices.list` | Stripe → Datiq | `{ customerId, status, limit }` | `GET /v1/invoices` | For the "what did I spend" view. |
| `webhook.handle` | Stripe → Datiq | `{ event }` | `POST /v1/webhook_endpoints` | We **receive** webhooks. |
| `checkout.create` | Datiq → Stripe | `{ priceId, customerId, quantity }` | `POST /v1/checkout/sessions` | For usage top-ups. |

### 4.4 Webhook receiver

This is the most important part of the Stripe connector — the destination calls us.

- **Endpoint**: `POST /api/v1/webhooks/stripe` (HTTPS, signature-verified).
- **Signature verification**: HMAC SHA-256 of `timestamp.payload` using the endpoint secret. We reject if (a) the timestamp is >5 minutes old or (b) the signature doesn't match.
- **Subscribed events** (initial 7):
  - `customer.subscription.created` — start of a new paying customer
  - `customer.subscription.updated` — plan change; update ARPA tracking
  - `customer.subscription.deleted` — churn event
  - `invoice.paid` — revenue recognized
  - `invoice.payment_failed` — dunning
  - `checkout.session.completed` — top-up
  - `usage_record.summary.created` — metered billing
- **Idempotency**: Stripe's `event.id` is unique; we de-dupe in the `connector_runs` table by `event_id` and a UNIQUE constraint.
- **Local testing**: `stripe listen --forward-to localhost:4242/webhook` for dev; the Stripe CLI handles signature generation.

### 4.5 Build estimate

| Task | Owner | Eng-weeks |
|---|---|---|
| Restricted-key connector + storage | 1 BE | 0.3 (framework) |
| 4 ops (customers.list, customers.usage, invoices.list, checkout.create) | 1 BE | 0.8 |
| Webhook receiver: endpoint, signature verification, idempotency | 1 BE | 1.0 |
| 7 event handlers | 1 BE | 1.0 |
| UI: Stripe card on `/integrations` | 1 FE | 0.3 |
| UI: "Spend" view (your Stripe customers + usage by plan) | 1 FE + 0.3 DES | 1.0 |
| Stripe CLI setup + local dev story | 1 BE | 0.3 |
| **Stripe total** | | **4.7 eng-weeks** |

Phasing: P0-W4 (receiver scaffolding), P0-W5 (event handlers for `subscription.*` and `invoice.paid`), P1-W7 (metered billing foundation), P1-W12 (Spend view GA).

### 4.6 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Webhook signature verification bug | High | Use the official `stripe` SDK; cover with tests; never bypass in any env. |
| Webhook receiver down during a Stripe event burst | High | Idempotent retries; dead-letter queue; alerting at 1% failure rate. |
| Metred-billing math wrong | High | Property-based tests; shadow mode for 2 weeks before GA. |
| Restricted key has more scope than needed | Medium | Always use the most-restricted key type; document the "minimum scopes" required. |

---

## 5. Calendly — full implementation plan

### 5.1 Why Calendly

Calendly is the scheduling layer for the personas Datiq serves. The integration closes the loop: extract contact from a page → enrich with Apollo → push to HubSpot → **offer a Calendly invite** to book a call. This is the workflow that turns a Datiq extractions into a sales meeting.

### 5.2 Auth

- **Type**: OAuth 2.0 (personal access token for the MVP; OAuth is the same flow as HubSpot's).
- **App registration**: Calendly developer portal → OAuth app. Review takes 1–2 weeks; the personal access token is the immediate fallback.

### 5.3 Operations

| Op | Direction | Datiq input | Calendly endpoint | Notes |
|---|---|---|---|---|
| `event_types.list` | Calendly → Datiq | `{}` | `GET /users/me/event_types` | Powers the "which meeting to offer" picker. |
| `scheduling_links.create` | Calendly → Datiq | `{ eventType }` | `POST /scheduling_links` | Single-use link for one invitee. |
| `webhook.handle` | Calendly → Datiq | `{ event }` | `POST /webhook_subscriptions` | We **receive** webhooks. |

### 5.4 Webhook receiver

- **Endpoint**: `POST /api/v1/webhooks/calendly` (HTTPS).
- **Auth**: Calendly signs with HMAC SHA-256 in the `Calendly-Webhook-Signature` header; we verify before processing.
- **Subscribed events** (Calendly supports exactly 3):
  - `invitee.created` — new booking
  - `invitee.canceled` — cancellation
  - `routing_form_submission` — form submission with or without booking
- **Use**: An `invitee.created` event creates a HubSpot note engagement on the contact; surfaces "booked a call" in the Datiq Dashboard.

### 5.5 User-facing UX

1. **Setup**: User clicks "Connect Calendly" on `/integrations`. OAuth flow. We pull event types and let the user pick "the default meeting for extracted contacts."
2. **Daily use**: From a Preview row, "Offer a Calendly invite" opens a modal that:
   - Shows the chosen event type
   - Pre-fills the invitee's name + email (from the Datiq extraction)
   - Generates a single-use scheduling link
   - Copies the link to clipboard with a toast
3. **Activity**: `invitee.created` events create a HubSpot note engagement on the contact (via the HubSpot connector).

### 5.6 Build estimate

| Task | Owner | Eng-weeks |
|---|---|---|
| OAuth connector + storage | 1 BE | 0.3 (framework) |
| 2 ops (event_types.list, scheduling_links.create) | 1 BE | 0.5 |
| Webhook receiver: endpoint, signature verification | 1 BE | 0.5 |
| 3 event handlers | 1 BE | 0.5 |
| UI: Calendly card on `/integrations` | 1 FE | 0.3 |
| UI: "Offer a Calendly invite" action on Preview | 1 FE | 0.5 |
| HubSpot engagement on `invitee.created` (cross-connector orchestration) | 1 BE | 0.5 |
| **Calendly total** | | **3.1 eng-weeks** |

Phasing: P0-W4 (receiver scaffolding), P0-W5 (event handlers), P1-W9 (public beta), P1-W12 (GA).

### 5.7 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Calendly OAuth review stalls | Medium | Use personal access tokens for the first 50 paying customers. |
| Single-use scheduling link leaks | Low | Single-use is enforced by Calendly. Log the link creation + the invitee event together. |
| Webhook receiver races with HubSpot engagement creation | Low | Use `invitee.created` event's `created_at` as the dedup key in HubSpot. |

---

## 6. Cross-connector orchestration — the workflow that justifies the framework

The real product is the workflow that strings all four together. This is the demo we ship in P1-W12.

### 6.1 The "Lead to Meeting" workflow

```
1. User pastes a company's pricing page in Datiq.
2. Datiq extracts: company name, domain, 12 leadership contacts (name + title + LinkedIn).
3. User clicks "Build a lead list" tile.
4. For each contact, Datiq:
   a. Calls Apollo `people.enrich` → email, phone.
   b. Calls HubSpot `contacts.upsert` → contact exists in HubSpot.
   c. Adds a HubSpot note engagement with the source URL.
5. User picks 5 contacts to reach out to.
6. Datiq:
   a. Generates a Calendly single-use link for each.
   b. Pre-fills an outreach email template (saved in the Templates marketplace).
7. User clicks "Send" → outreach email goes out via the user's connected email tool
   (Smartlead / Instantly / HubSpot Sequences — out of scope for the connector plan).
8. Calendly `invitee.created` events land in Datiq → HubSpot note engagement.
9. Datiq Dashboard shows: "12 leads enriched · 5 contacted · 1 booked."
```

### 6.2 The "Competitor Pricing Watch" workflow

```
1. User pastes 5 competitor pricing URLs in Datiq (Batch mode).
2. User clicks "Watch" on each.
3. Datiq schedules daily checks; on a change, fires a webhook to the user's Slack.
4. Datiq also writes the change to a Google Sheet (via the Sheets connector — Q05).
5. Datiq Dashboard shows: "5 watches · 1 change this week."
```

### 6.3 The "Spend" workflow (internal-first)

```
1. Datiq's own Stripe account is connected.
2. Every paying customer's subscription event lands in the Datiq warehouse.
3. Datiq's "Spend" view (P1-W12 GA) shows:
   - MRR, by plan, by month
   - Net new MRR, expansion MRR, churned MRR
   - The top 20 paying customers by ARR
4. Used by Datiq's own RevOps. Same view is exposed to Agency customers.
```

## 7. The framework pays back

After P1-W8.5, the marginal cost of a new connector (Salesforce, Pipedrive, Notion, Airtable, Intercom, Mixpanel, etc.) is **0.5–1.0 BE-weeks for ops + 0.5–1.0 FE-weeks for the UI card**. Phase 2 (post-W12) can ship 2 connectors per month without growing the team.

The 4 connectors in this plan ship in **~17.1 net eng-weeks** (Connector Framework 1.0 + HubSpot 6.1 + Apollo 3.2 + Stripe 4.7 + Calendly 3.1, minus framework overlap). With the planned headcount, that fits in P1-W7 through P1-W12 with 2 weeks of slack.
