# Prospect Engagement Engine — Review, Gaps & Rollout Plan

> **Date:** 2026-09-23 · **Branch:** `feat/prospect-engagement-engine` @ `62898232`
> **Status:** NOT OPERATIONAL. Builds, tests green, **not safe to send a real message.**
> Supersedes the rollout parts of [PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md](PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md);
> that file is still the reference for the UI walkthrough.

---

## Decisions (owner, 2026-09-23)

| Question | Decision | Consequence for the plan |
|---|---|---|
| Audience | **Both — built customer-ready, opened to DatIQ only as a beta** | Phase 1 builds per-tenant sender identity, credit metering and plan gating, then gates *access* with `ENGAGEMENT_ALLOWLIST`. Legal/Terms work can run in parallel with the beta rather than blocking it. |
| Channels | **Phased: Email first, then WhatsApp + SMS** | Phase 1 is email-only. Start Meta Business verification and India DLT registration **now** — they are the long pole for Phase 3. Telegram stays out of outbound. |
| Source documents at repo root | **Removed from the branch; local copies kept** | Saved to `~/Downloads/DatIQ-source-docs/` (byte-identical, SHA-256 checked). `.gitignore` now blocks `/DatIQ *.md` and `/DatIQ *.pdf` at the root. They remain in this branch's *history* — squash-merge the branch so they never reach `staging`/`main`. |
| Message generation | **LLM fills template slots** | Phase 2: approved skeletons per campaign intent; the model fills named slots from prospect fields only, through `runChain` (metered, budgeted, schema output). Guardrails run on the filled result. |

---

## 0. What was done in this pass

| Step | Result |
|---|---|
| Merged `origin/staging` (69 commits) into the branch | 3 conflicts resolved (`db-verify.mjs`, `TopBar.jsx`, `screens.css`) |
| Migration renumbered `0048_prospect_engagement_engine.sql` → **`0081`** | `0048` is `0048_discoverability_evidence` on staging; two files shared one number |
| `run-all.sql` regenerated (`npm run build:sql`) | — |
| `db-verify` expectations | 118/59/29 + 5 tables / 1 function / 4 triggers = **123 / 60 / 33** |
| Engagement nav | Moved into the signed-in user menu **Workflows** group (where staging moved Lists/Watchlists/Rules) |
| Verification | db-verify **81 migrations / 931 assertions / 0 failed** · vitest **461 files / 7,408 passed** · pre-push gate **all green, 334s**, e2e smoke **159/159** |

⚠️ **Green here means "does not break the rest of DatIQ".** It does not mean the engine works: the
engagement tests assert what functions *return*, not what they *write* or *send* (see §3, F-1).
⚠️ **The next migration number is `0082`.**

---

## 1. PRD vs implementation

The PRD (`DatIQ - Prospect Engagement Engine.md`) is a research blueprint, not a spec — it has no
acceptance criteria, volumes, or pricing. Scorecard against its own sections:

| PRD capability | Built? | Notes |
|---|---|---|
| Data layer = Airtable/Sheets as **record** | ❌ Diverged | Supabase is the record. **This is the better choice for DatIQ** (RLS, tenancy, one ledger) — but it is an undocumented reversal of the PRD. |
| Sheets / Airtable two-way sync | ❌ | Only pure mapper functions. `engagement_sync_configs` has **zero writers and zero readers**. |
| State machine, validated transitions, audit log | 🟡 | Pure module, good. But `new → sent` is illegal and nothing sets `queued` (F-1). Audit log is not append-only. |
| Timeout → Follow-up Due | 🟡 | `check_stale_prospects` exists; **nothing ever calls it** (F-16). |
| AI personalisation (LLM, schema, variants) | ❌ | Fixed string templates. No model call. Named "AI" throughout the UI. |
| Guardrails (banned phrases, length, opt-out) | ✅ | Works; but approval ignores the result (F-28). |
| Email via Resend | 🟡 | Sends, from DatIQ's own domain (F-8). No unsubscribe link, no `List-Unsubscribe`. |
| WhatsApp (Twilio / Meta) | ❌ | Free-form body; cold WhatsApp requires approved templates (F-17). |
| Telegram | ❌ | Never sends; reports success (F-4). Cold Telegram is impossible by platform design (F-18). |
| SMS (Twilio) | 🟡 | Sends; no India DLT registration path (§6). |
| Inbound webhooks → state | 🟡 | Parses all three providers; auth and prospect matching are unsafe (F-5, F-6). |
| Dashboard: Kanban, timeline, analytics, approval queue, brand kit | ✅ | UI is the most complete part. There is **no Send button** — dispatch is n8n-only. |
| Consent / opt-out layer | 🟡 | STOP keyword → `opted_out`. Not enforced at send, per-row not per-contact, client-overridable (F-3). |
| Lead scoring | 🟡 | Inflates on repeated events (F-24). |
| A/B win-rate analytics | ❌ | Variants stored; analytics never groups by variant or channel. |
| Send-time optimisation, deliverability monitoring, template versioning | ❌ | Not started (PRD marks these "later"). |

---

## 2. What is genuinely good — keep it

- **Tenancy at the table layer is right**: RLS on, service-role-only policy, nothing granted to
  `anon`/`authenticated` — the `0044` pattern. db-verify pins it, including cascade deletes.
- **Every store query is scoped by `user_id`**, and "not found" is a 404, not a 403.
- `/engagement` is a **private prefix in all four places** (noindex header, robots, index guard, site-routes).
- `stateMachine.js` is a **pure module shared by client and server** — the same pattern as
  `entitlementModel.js` — with `opted_out` terminal.
- Normalisers/dedupe in `syncConnectors.js` are sensible and tested.

---

## 3. Findings

Severity: **P0** = must be fixed before any real message leaves · **P1** = before customers ·
**P2** = quality. Every P0 needs a regression test **confirmed RED against today's code first**.

### P0 — blockers

**F-1 · Messages are re-sent on every dispatch, and the funnel never moves.**
`dispatch_messages` ([engagement-engine.js:226-274](../netlify/functions/engagement-engine.js)) selects
every `approval_status = approved` message and sends it, but **never updates the message** —
no `status = sent`, no `sent_at`, no `external_message_id`. Run it twice, the prospect gets it twice.
Separately, it then moves the prospect to `sent`, but the graph only allows `new → queued`, and nothing
sets `queued` on approval — so that update is rejected, silently. The test
([engagement-engine.test.js ~L215](../netlify/__tests__/engagement-engine.test.js)) asserts only the
mocked dispatch result, which is why it is green.
*Fix:* claim-then-send per message (`update … set status='sending' where id=? and status='queued'`
returning — the `is.null`/conditional-PATCH idempotency pattern from `0063`), persist the provider id,
set prospect `queued` on approval.

**F-2 · One click can send one person five messages on three channels.**
`generatePersonalizedVariants` reads `campaign.channels`, which is **not a column**, so it always falls
back to email A + email B + WhatsApp A + WhatsApp B + SMS. The server ignores the `channel` and
`customInstructions` the client sends. F-1 then sends every approved one.
*Fix:* a sequence step owns exactly one channel and one chosen variant per prospect; A/B means
*different prospects get different variants*, never the same prospect getting both.

**F-3 · Opt-out is not enforced where it matters — at send.**
- Dispatch never checks the prospect's status. A message approved before a STOP is still sent after it.
- Opt-out is stored per **prospect row**; the same person in another campaign is still contactable.
- `update_prospect_status` passes `body.meta` straight into `transitionProspect`, which honours
  **`meta.adminOverride`** — a client-settable flag that reactivates an opted-out contact. This is the
  `?consented=true` defect again.
- Resend `email.complained` (spam complaint) is not handled; bounces are not suppressed.
*Fix:* a `engagement_suppressions (user_id, channel, address_normalised)` table checked inside the
send claim; never accept `adminOverride` from a request body.

**F-4 · The dispatcher reports success for messages that were never sent.**
[channelRouter.js:162-169](../src/lib/engagement/channelRouter.js): if a channel's provider key is
missing, it returns `ok: true, status: "sent"` with a fabricated id. With only `RESEND_API_KEY` set in
production, every WhatsApp/SMS message is recorded as sent and nothing leaves. Telegram has no send
path at all and *always* takes this branch. Mock mode (no keys) does the same. **A fabricated "sent" is
worse than a failure** — it is the same class as the fixture prose badged `ai_generated` that this repo
already removed once.
*Fix:* missing credentials → `failed` with `code: channel_not_configured`; mock only when an explicit
`ENGAGEMENT_MOCK=1` is set in a non-production context.

**F-5 · Webhook authentication fails open, and when configured it rejects the real providers.**
[engagement-webhook.js:33-47](../netlify/functions/engagement-webhook.js): with
`ENGAGEMENT_WEBHOOK_SECRET` unset, **anyone** can POST forged opens/replies/opt-outs. With it set, it
compares a static `x-engagement-secret` header — which Resend, Twilio and Telegram **never send**. The
commit calls this "HMAC verification"; it is a string compare. Each provider has its own scheme:

| Provider | Real verification |
|---|---|
| Resend | Svix: `svix-id`, `svix-timestamp`, `svix-signature` (HMAC-SHA256 over id.timestamp.body) |
| Twilio | `X-Twilio-Signature`: HMAC-SHA1 of full URL + sorted POST params with the auth token |
| Telegram | `X-Telegram-Bot-Api-Secret-Token`, set via `setWebhook(secret_token=…)` |

*Fix:* per-provider verifiers, route per provider (`?provider=` from the URL you register, never inferred
from the body), **refuse with 503 when the secret is unset** (as `payment-webhook.js` does).

**F-6 · Inbound events are matched to prospects across ALL tenants.**
Lines 78-95 look up `engagement_prospects` by email (or `ilike '%<last 8 digits>%'` for phone) with
**no user or campaign filter** and `limit(1)`. Tenant A's bounce, reply or opt-out lands on tenant B's
row whenever they share a contact — and the last-8-digits match hits unrelated people too.
*Fix:* correlate by the provider message id stored on `engagement_messages.external_message_id`
(unique index). Inbound replies with no message id: match on exact normalised address **within tenants
that have messaged it**, and apply opt-outs to every such tenant's suppression list.

**F-7 · `update_campaign` is mass-assignable, including `user_id`.**
[engagementStore.js:126-132](../netlify/functions/lib/engagement/engagementStore.js) spreads the request's
`updates` into the UPDATE. A caller can set `user_id` to another account (planting a campaign there),
or `workspace_id` to a workspace they do not belong to. *Fix:* allow-list of editable fields.

**F-8 · Customer cold outreach would be sent from DatIQ's own domain.**
Default sender `outreach@datiq.app` through DatIQ's Resend account — the same reputation that carries
invoices, password resets and alerts. One customer's bad list damages mail for every customer. Resend's
acceptable-use terms also restrict unsolicited/cold email — **confirm before relying on it**. The
"unsubscribe" link is `${cta_url}/privacy`, not an unsubscribe, and there is no `List-Unsubscribe`
header (required by Gmail/Yahoo bulk-sender rules since 2024).

**F-9 · ✅ RESOLVED 2026-09-23 — Two source documents were committed to the root of a public repository.**
`DatIQ - Prospect Engagement Engine.md` and `DatIQ  - Persona Specific Templates & Shareable Reports.pdf`
(the latter unrelated to this feature). CLAUDE.md's standing rule is that source documents are not
committed because the repo is public. They are already visible on the pushed branch.

### P1 — before customers

| # | Finding | Where |
|---|---|---|
| F-10 | **No entitlement or credit check** on generate or dispatch. Every WhatsApp/SMS costs real money; the unified-credits parity test does not cover messaging providers. | engagement-engine.js |
| F-11 | **"AI" generation is fixed templates**, and the copy asserts things that are not true: *"We set up an automated intelligence monitor for {company}. It uncovered a few interesting shifts"*. Defaults to DatIQ's brand, so an unfilled brand kit markets DatIQ from the customer's campaign. | aiMessageGenerator.js |
| F-12 | **HTML injection into outbound email**: prospect fields (from CSV, Sheets or scraped pages) are interpolated unescaped into `body_html`. | aiMessageGenerator.js:196, 204 |
| F-13 | Parent ids from the body are not ownership-checked: `add_prospects` does not verify the campaign is the caller's (rows attach to another tenant's campaign; FK error vs success is an existence oracle); `workspace_id` accepted unchecked. Rule: 404, never 403. | engagementStore.js:210, 86 |
| F-14 | **Client falls back to localStorage on any error** — 400/401/404/500 included. A signed-in user's failed write "succeeds" and vanishes; prospect PII (emails, phones) lives under `datiq_engagement_*` and is **not cleared on sign-out** (not in `SENSITIVE_KEYS`). | engagementClient.js |
| F-15 | Server silently uses in-memory `Map`s when Supabase env is missing — in a deployed context, data "saves" and disappears on the next cold start. Should be 503 outside dev. | engagementStore.js |
| F-16 | **The n8n automation cannot work.** Workflows authenticate with `DATIQ_N8N_API_KEY`; the engine accepts only user Supabase JWTs → 401. The state monitor calls only `list_campaigns`, as a POST the handler does not route — **nothing ever calls `check_stale_prospects`, so no follow-up is ever sent.** The webhook forwarder posts n8n's `{headers, body, …}` wrapper instead of the provider payload and drops signature headers. n8n webhooks are unauthenticated, and user JWTs passed as `_ctx.auth_token` persist in n8n execution history. | n8n/workflows/datiq_*.json |
| F-17 | WhatsApp cold outreach via Twilio with a free-form body is rejected outside the 24-hour session window; business-initiated messages need **approved Content Templates** (`ContentSid`). | channelRouter.js |
| F-18 | Telegram bots cannot message a user who has not started the bot; there is no `chat_id` capture. Telegram can only be an **opt-in/inbound** channel, never cold outreach. | channelRouter.js |
| F-19 | Sheets/Airtable sync is unbuilt; `engagement_sync_configs` is the **fifth declared-and-never-written table** in this schema. | — |
| F-20 | Dispatch and stale-check loop serially inside a 10s/26s function. A few hundred prospects → 504 mid-send → partial state with no record (compounds F-1). Needs a queue + cron worker (the `bulk-runner` pattern). | engagement-engine.js |

### P2 — quality

- F-21 `listProspects` builds a PostgREST `.or()` from the raw search string; commas/parens break the query (the tenant `eq` is ANDed, so it is not a leak).
- F-22 Activity log insert is unchecked and non-atomic with the status update; "immutable" is not enforced by any trigger.
- F-23 No unique index on `(campaign_id, lower(email))` / normalised phone — dedupe is read-then-write and races.
- F-24 Self-transitions re-score: every repeat `opened` adds +15 (Apple Mail Privacy Protection pre-opens inflate it further).
- F-25 `ilike %last8%` phone match (see F-6).
- F-26 Raw `err.message` returned in 500 bodies from both functions.
- F-27 Analytics derive from current prospect status only; a prospect that bounced after opening leaves "opened". No per-channel, per-variant breakdown, so A/B is unmeasurable.
- F-28 `approve_message` ignores `guardrail_checks.passed` and current state — a failed-guardrail or already-sent message can be approved (and, with F-1, resent).
- F-29 Five redirect aliases for two functions; the generic `/api/*` rule already covers them.
- F-30 localStorage prefix `datiq_engagement_` breaks the `datiq.*` convention.

---

## 4. Remediation plan (phased)

The recommendation is **ship email-only first**, because every other channel has an external approval
dependency (templates, DLT, business verification) measured in weeks.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Hygiene** | ✅ Root documents removed (F-9). Remaining: delete redundant redirects (F-29). Start Meta Business verification + DLT registration in parallel. | Repo root clean; squash-merge noted on the PR. |
| **1 · Safe email MVP** | F-1, F-2, F-3, F-4, F-5 (Resend/Svix only), F-6, F-7, F-8, F-10, F-12, F-13, F-14, F-15, F-26, F-28. New migration **`0082`**: `engagement_suppressions`, `external_message_id` unique, message send-claim columns, prospect uniqueness. **Send button in the UI** behind a feature flag. Queue-based dispatch worker (cron, per-item claim). | Every P0 test RED→GREEN; two-tenant real-Postgres suite green; a staging campaign to Resend test addresses produces exactly one send per prospect, correct state, suppression on bounce/complaint/unsubscribe. |
| **2 · Real personalisation + follow-ups** | LLM generation through `runChain` (metered, budgeted, schema output, template skeleton + slots, *no factual claims not in the prospect record*). Scheduled follow-up worker replaces the n8n state monitor. Per-variant/per-channel analytics. | Follow-up fires once after N days, never to replied/opted-out; generated copy passes guardrails and cites only supplied fields. |
| **3 · WhatsApp + SMS** | Twilio Content Templates, Twilio signature verification, India DLT headers/templates for SMS, STOP handling per channel. | Template approved; sandbox + one real number round-trip; STOP suppresses across campaigns. |
| **4 · Sheets / Airtable** | Import (one-way) first; two-way only if a customer needs it. | Import of 1,000 rows idempotent; no duplicate outreach. |
| Telegram | **Recommend dropping from outbound** — keep only as an internal "hot lead" alert channel. | — |

---

## 5. Testing plan

### 5.1 Automated — write each RED first

| Layer | New tests |
|---|---|
| Unit (`src/lib/engagement`) | Generator escapes HTML; generator emits one variant per requested channel; no copy asserts a fact absent from the prospect; `adminOverride` is not honoured from a request path; repeat `opened` does not re-score; dispatcher returns `failed` (not `sent`) when a channel is unconfigured. |
| Contract (`netlify/__tests__`) | Dispatch twice → provider called once; message row gets `sent`/`external_message_id`; opted-out/suppressed prospect is skipped; `update_campaign` cannot change `user_id`/`workspace_id`; `add_prospects` to another user's campaign → 404; webhook with secret unset → 503; valid Svix signature → 200, tampered → 401 (use Resend's documented sample); cross-tenant event correlates by message id only; unknown action and 500 bodies carry no raw error text; credit denial → 402 before any provider call. |
| DB (`db-verify` + a `verify-engagement-e2e.mjs` like `verify-workflows-e2e`) | Real store against PGlite with **two tenants**: isolation of every action; suppression uniqueness; duplicate prospect refused; send-claim race (two claims, one winner); counts 123/60/33 → updated by 0082. |
| Browser (`e2e/`) | Signed-in journey (skips without creds, like `workflows-authenticated.spec.js`): create campaign → import CSV → generate → approve → send (mock provider) → Kanban shows Sent → timeline shows the event. Guest → redirected to sign-in, never localStorage. |
| Parity | Extend the credits provider-call parity test to Resend-outreach/Twilio call sites; add engagement tables to `npm run verify:rls`'s table list. |

### 5.2 Manual — staging, then production

**Test identities that never reach a real person:**
- Resend: `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`.
- Twilio test credentials + magic numbers (e.g. `+15005550006` valid, `+15005550001` invalid); WhatsApp Sandbox.

| # | Check | Expected |
|---|---|---|
| M-1 | Create campaign, fill brand kit, import 5 prospects incl. a duplicate | 4 created, 1 reported duplicate |
| M-2 | Generate for one prospect, email only | Exactly one pending message |
| M-3 | Approve → Send → Send again | One Resend email; message `sent`; prospect `sent`; second click sends nothing |
| M-4 | Resend delivered/open/click webhooks (real, signed) | Prospect advances; score increments once per state |
| M-5 | `bounced@` and `complained@` | Prospect suppressed; later send skipped with reason |
| M-6 | Click the unsubscribe link and the `List-Unsubscribe` header | Suppressed in every campaign for that user |
| M-7 | Forged webhook without signature | 401; no state change |
| M-8 | Second account with the same prospect email | Tenant A's events never touch tenant B |
| M-9 | Out of credits / Free plan | Send refused before any provider call, clear message |
| M-10 | Sign out | No `datiq_engagement_*` / engagement PII left in localStorage |
| M-11 | 300-prospect campaign | Worker drains the queue across ticks; no 504; no duplicates |
| M-12 | Kill a send mid-run (deploy during run) | Resumes; nothing sent twice |

Production pass is **read-only + owner allowlist only**, sending to the owner's own addresses.

---

## 6. Prerequisites — who owns what

| Item | Owner | Notes |
|---|---|---|
| Decide sender model (F-8) | Owner | Per-customer verified domain vs a dedicated DatIQ outreach subdomain. |
| Resend: separate domain/subdomain, SPF/DKIM/DMARC, webhook + signing secret | Operator | Do **not** reuse the transactional domain. |
| Legal review | Owner/counsel | DPDP 2023 consent basis for marketing messages; CAN-SPAM physical address + unsubscribe; Terms/Privacy/AUP update for customer-sent outreach. |
| Twilio account, WhatsApp sender, **Meta Business verification**, Content Templates | Operator | Weeks, not days. Phase 3 only. |
| **India SMS DLT registration** (entity, header, templates) | Operator | Mandatory for commercial SMS to Indian numbers. Phase 3 only. |
| Pricing: is this a paid-plan feature? credit weight per send per channel | Owner | Needed for F-10. |
| Apply migrations `0081` (+ `0082`) staging → production | Operator | [DB-MIGRATION-RUNBOOK.md](DB-MIGRATION-RUNBOOK.md) subset procedure; then `npm run verify:rls` with engagement tables added. |

### Environment variables (per Netlify context, server-only)

| Var | Phase | Purpose |
|---|---|---|
| `ENGAGEMENT_ENABLED` | 1 | Kill switch / feature flag (read from env so it cannot fail open) |
| `ENGAGEMENT_ALLOWLIST` | 1 | User ids allowed during beta |
| `ENGAGEMENT_FROM_EMAIL` | 1 | Dedicated outreach sender — never falls back to another sender (house rule) |
| `ENGAGEMENT_RESEND_API_KEY` | 1 | Separate key/account from transactional `RESEND_API_KEY` if the sender model requires it |
| `ENGAGEMENT_RESEND_WEBHOOK_SECRET` | 1 | Svix signing secret |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` / `TWILIO_SMS_FROM` | 3 | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` | alerts only | — |
| ~~`ENGAGEMENT_WEBHOOK_SECRET`~~ | — | Retire; replaced by per-provider verification |

---

## 7. Deployment sequence

1. Phase 0 + Phase 1 on the feature branch; all new tests RED→GREEN; `npm run test:all` green.
2. PR → `staging`. Staging Gate green.
3. Apply `0081` + `0082` to **staging** Supabase (subset procedure); `npm run verify:rls` shows engagement tables at 401.
4. Staging env vars; register the Resend webhook at `https://staging…/api/engagement-webhook?provider=resend`.
5. Manual pass M-1…M-12 on staging with test identities.
6. `ENGAGEMENT_ENABLED=0` in production; promote `staging → main` (manual unlock + `approved`).
7. Apply migrations to **production**; `verify:rls -- --prod`.
8. Enable for the owner allowlist only; send to own addresses; watch `/admin/health` + Resend dashboard 7 days (bounce < 2%, complaint < 0.1%).
9. Open to paid plans. Phase 2/3 follow the same sequence.

Rollback: `ENGAGEMENT_ENABLED=0` stops all sending immediately; migrations are additive and can stay.
