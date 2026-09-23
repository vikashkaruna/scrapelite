# Prospect Engagement Engine — Review, Gaps & Rollout Plan

> **Updated:** 2026-09-24 · **Branch:** `feat/prospect-engagement-engine` (code @ `fedb0195`) · **Preview:** [deploy-preview-219](https://deploy-preview-219--datiqapp.netlify.app/engagement)
> **Status:** Phase 1 (safe email MVP) **built, verified and in beta testing on the deploy preview.** Not merged, not in production.
> **Database:** `0081` + `0082` are **applied to staging Supabase** (tables confirmed present, anon reads refused). **Not applied to production.** ⚠️ **The next migration number on this branch is `0083`.**
> **Sending:** no real email has left. The preview runs with `ENGAGEMENT_MOCK_SEND=1`.
> Supersedes the rollout parts of [PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md](PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md).

**How to read this document.** §A–§D are the current state and what to do next. §1–§3 are the original
review, kept as the record (finding text unchanged, a status mark added to each). §4–§7 are the plan,
updated to where it stands.

**Status key:** ✅ done · 🟡 partly done · ⏳ planned for a later phase · 👤 needs the owner

---

## A. Where things stand

### Findings, by severity

| Severity | Findings | State |
|---|---|---|
| **P0** — before any real message leaves | F-1 … F-8 (F-9 was hygiene) | ✅ **All fixed.** Each has a regression test **proven RED** by putting the defect back (§5.1). |
| **P1** — before customers | F-10 … F-20 | ✅ 8 fixed · 🟡 F-16 (sending fixed; **follow-ups not built**) · ⏳ F-17 WhatsApp templates (Phase 3) · ⏳ F-19 Sheets/Airtable (Phase 4) |
| **P2** — quality | F-21 … F-30 | ✅ 8 fixed · 🟡 F-22 (log is append-only; its insert is still separate from the status write) · 🟡 F-27 (per-variant/per-channel results use message timestamps; the headline funnel still counts current prospect status) |

### Phase 1 — what each finding became

| Finding | Status | Where |
|---|---|---|
| F-1 re-send on every dispatch | ✅ Per-message claim (`queued → sending`, conditional update), provider id recorded, `Idempotency-Key` = message id, stale claims re-taken by the cron | `lib/engagement/dispatcher.js`, `0082` |
| F-2 five messages per prospect | ✅ One channel, one assigned A/B variant per prospect; no duplicate open draft | `engagement-engine.js` `generate_messages`, `assignVariant()` |
| F-3 opt-out not enforced | ✅ Per-channel `engagement_suppressions`, checked **at send time**; `adminOverride` never read from a request; complaint + permanent bounce suppress | `suppressionModel.js`, `optOut.js` |
| F-4 fabricated "sent" | ✅ Unconfigured = `failed/email_not_configured`; mock only with `ENGAGEMENT_MOCK_SEND=1` outside production | `emailSender.js` |
| F-5 webhook auth | ✅ Svix verification; 503 when the secret is unset; Twilio/Telegram 404 until Phase 3 | `engagement-webhook.js` |
| F-6 cross-tenant matching | ✅ Correlated by provider message id only | same |
| F-7 mass assignment | ✅ Field allow-lists everywhere | `engagementStore.js` |
| F-8 sender / unsubscribe | ✅ Sender restricted to `ENGAGEMENT_SENDER_DOMAINS`; separate `ENGAGEMENT_RESEND_API_KEY`; signed unsubscribe link + RFC 8058 one-click headers | `engagementGuards.js`, `engagement-unsubscribe.js` |
| F-9 source docs in a public repo | ✅ Removed; local copies kept (see Decisions) | `.gitignore` |
| F-10 credits | ✅ `affords()` before, `outreach_email` charged after — **weight 1 is PROVISIONAL** 👤 | `creditWeights.js` |
| F-11 invented claims, DatIQ default brand | ✅ Removed; no default brand | `aiMessageGenerator.js` |
| F-12 HTML injection | ✅ Escaped; CR/LF stripped; non-http CTA dropped | same |
| F-13 parent ids | ✅ Ownership-checked, 404 | `engagementStore.js` |
| F-14 localStorage fallback + PII | ✅ Removed; legacy keys swept on sign-out | `engagementClient.js`, `GuestTrialProvider.jsx` |
| F-15 in-memory store | ✅ 503 when unconfigured | `engagementStore.js` |
| F-16 n8n can't authenticate | 🟡 Five workflows retired; sending moved to the Send button + `engagement-dispatcher` cron (`*/5`). **The follow-up half is still missing** — nothing marks silent prospects "follow-up due" (Phase 2). | `netlify.toml`, `AUTOMATION_JOBS` |
| F-17 WhatsApp templates | ⏳ Phase 3 | — |
| F-18 Telegram by phone | ✅ Telegram address is a chat id | `suppressionModel.js` |
| F-19 Sheets/Airtable | ⏳ Phase 4 | — |
| F-20 timeouts | ✅ Request sends within budget; cron drains the rest | `dispatcher.js` |
| F-21, F-23 … F-26, F-28 … F-30 | ✅ Search sanitised, uniqueness indexes, no re-scoring, per-address matching gone, codes not messages, approval checks guardrails, aliases removed, local storage no longer used | various |
| F-22, F-27 | 🟡 See the severity table above | `0082`, `engagementStore.js` |

### Found and fixed while building (none were in the review)

- Reviewer edits in the approval queue were **discarded** — the approved text was not the sent text.
- The brand-kit editor saved field names the generator never read, so **no brand-kit edit ever reached a message**.
- The board could mark a prospect **Sent / Delivered by hand** with nothing sent.
- The first dispatcher required 8.5s free per send against a 7–8s budget, so **it would never have sent anything** — caught by the real-Postgres suite, not by review.
- `verify:rls` counted a table that does not exist as a pass.
- Nothing tested two sends racing for the same message, so the claim rule could be removed with every test still green — found by the P0 mutation check (§5.1); a concurrent-send test now covers it.

### Beta feedback, fixed (first preview test, 2026-09-23)

| Report | Fix |
|---|---|
| Importing a comma-separated row imported nothing and said nothing | A pasted contact line with no header became the header (zero rows); `First Name`/`Email Address` headers matched no field; `"Acme, Inc."` shifted columns; rows without email/phone vanished uncounted; the dialog closed after a toast either way. New pure `src/lib/engagement/prospectImport.js` (quoted fields, `,`/`;`/tab, header aliases, per-row reasons with line numbers, 1,000-row cap) drives a **live check** in the dialog. Import is disabled with the reason shown until a row is importable, and the dialog **stays open with a result panel**: added · already in campaign · repeated in paste · rejected. |
| Duplicate campaign names allowed | Refused per account, ignoring case and spacing (`409 campaign_name_taken`), in the dialog and on the server. Deliberately **not** a unique index: accounts that already hold duplicates must still load. |
| Campaigns could not be edited | **Edit** → name, description, status; **Delete** behind a second confirmation that says opt-outs are kept (they are account-wide — pinned by test). |
| The dropdown did not say which campaign | Same-named campaigns show their creation date (and a short id if the date is shared); a non-active status is shown; a line under the header shows the selected campaign's description, date and prospect count. |
| "Private beta" for an allow-listed tester | **Configuration, not code:** `ENGAGEMENT_ALLOWLIST` held `datiqadmin@gmail.com,*.BETA=DatIQ` — an email (ids are matched, not emails) and a string that is not a bare `*`. See §C for the correct values. |

---

## B. Decisions

| Question | Decision (owner, 2026-09-23) | Consequence |
|---|---|---|
| Audience | **Both — built customer-ready, opened to DatIQ only as a beta** | Per-tenant sender identity, credit metering and plan gating are built; *access* is gated by `ENGAGEMENT_ALLOWLIST`. Legal/Terms work runs in parallel with the beta. |
| Channels | **Phased: email first, then WhatsApp + SMS** | Phase 1 is email-only. Start Meta Business verification and India DLT registration **now** — they are the long pole for Phase 3. Telegram stays out of outbound. |
| Source documents at repo root | **Removed from the branch; local copies kept** | Saved to `~/Downloads/DatIQ-source-docs/`. `.gitignore` blocks `/DatIQ *.md` and `/DatIQ *.pdf`. They remain in this branch's *history* — **squash-merge** so they never reach `staging`/`main`. |
| Message generation | **LLM fills template slots** | Phase 2: approved skeletons per campaign intent; the model fills named slots from prospect fields only, through `runChain` (metered, budgeted, schema output). Guardrails run on the filled result. |
| Consent model | **Per channel, with a multi-channel UI** | `engagement_suppressions` is keyed by (account, channel, address) and applies to every campaign on the account. The prospect drawer opts out of any combination of channels, or all at once. |
| n8n | **Not in the sending path** | Sending is decided inside DatIQ (claim, consent, credits). n8n may return for notifications (e.g. "prospect replied → Slack") via the signed `workflow_events` pipeline. |
| Campaign names | **Unique per account** | Enforced in the dialog and on the server; existing duplicates are shown with their creation date. |
| Which opt-outs a team may remove | 👤 **Owner to write** `canLiftSuppression()` | Ships returning `false` — nothing can be lifted. A spam complaint must never be liftable (pinned by test). |

---

## C. Configuration

### Environment variables (server-only, per Netlify context)

| Var | Required | Notes |
|---|---|---|
| `ENGAGEMENT_ENABLED` | yes | `1` to turn the module on. Anything else = off (API 403, cron no-op). **Rollback switch.** |
| `ENGAGEMENT_ALLOWLIST` | yes | Comma-separated **account ids (UUIDs)**, or a bare `*`. ⚠️ Emails are **not** matched (the 5-minute send job has only the id), and `*` must stand alone — `*.BETA=…` is not a wildcard. A wrong value fails as "private beta" for everyone. Find an id in Supabase → Authentication → Users → UID. |
| `ENGAGEMENT_SENDER_DOMAINS` | yes | Domains verified in the outreach Resend account. A campaign's sender must be `@` one of these exactly (subdomains are not implied). |
| `ENGAGEMENT_RESEND_API_KEY` | yes | **Not** `RESEND_API_KEY` — never falls back to it. |
| `ENGAGEMENT_RESEND_WEBHOOK_SECRET` | yes | `whsec_…` from Resend's webhook settings. Unset = webhook 503. |
| `ENGAGEMENT_UNSUBSCRIBE_SECRET` | yes | ≥16 random chars (`openssl rand -hex 32`). **Rotating it breaks every unsubscribe link already sent.** |
| `ENGAGEMENT_PUBLIC_URL` | recommended | **Bare origin** for unsubscribe links — no path, no `/**`, no `*.`. Falls back to Netlify's `URL`, which on a deploy preview is the **production** site. For preview 219 use `https://deploy-preview-219--datiqapp.netlify.app`. |
| `ENGAGEMENT_MOCK_SEND` | staging only | `1` = simulated sends, labelled as mock (ignored in production). |
| `ENGAGEMENT_SEND_BUDGET_MS` / `ENGAGEMENT_DISPATCH_BUDGET_MS` | optional | Defaults 7000 / 8000. |
| `TWILIO_*`, `TELEGRAM_*` | Phase 3 / alerts | Not read yet. |

⚠️ **Netlify gives functions their env values at deploy time** — after changing any of these, redeploy
the preview (Deploys → Retry deploy) before testing.

⚠️ **Preview configuration as last checked (2026-09-23)** — deploy-preview and branch-deploy contexts:
`ENGAGEMENT_ALLOWLIST = "datiqadmin@gmail.com,*.BETA=DatIQ"` ✗ and `ENGAGEMENT_PUBLIC_URL` set to
`https://staging.datiq.app/**` / `https://*.datiq.app/**` ✗. Both need correcting (above). Secret values
could not be inspected (the CLI masks them).

### Resend

Register the webhook at `https://<site>/api/engagement-webhook?provider=resend` for `email.delivered`,
`email.opened`, `email.clicked`, `email.bounced`, `email.complained`. Use a domain **separate from the
transactional one** (F-8).

---

## D. What is needed next

| # | Item | Owner | Blocks |
|---|---|---|---|
| 1 | Fix `ENGAGEMENT_ALLOWLIST` and `ENGAGEMENT_PUBLIC_URL` on the preview contexts; redeploy | 👤 Operator | Beta testing |
| 2 | Write `canLiftSuppression()` (`src/lib/engagement/suppressionModel.js`) | 👤 Owner | "Remove opt-out" in the UI |
| 3 | Set the credit weight for `outreach_email` (provisional 1) | 👤 Owner | Charging customers |
| 4 | Verify a dedicated outreach domain in Resend; list it in `ENGAGEMENT_SENDER_DOMAINS`; real `whsec_` secret | 👤 Operator | Any real send |
| 5 | Legal review: unsubscribe page, Terms/AUP for customer-sent outreach, DPDP basis | 👤 Owner/counsel | Customers |
| 6 | Manual pass M-1 … M-16 on staging with Resend test addresses (§5.2) | Owner + Claude | Merge to staging |
| 7 | Squash-merge PR → `staging`; then production per §7 | Owner | Production |
| 8 | Phase 2: follow-up worker (closes F-16), LLM slot filling, headline funnel from message timestamps (closes F-27) | Claude | — |
| 9 | Meta Business verification + India DLT registration | 👤 Operator | Phase 3 |

---

## 0. History of this branch

| Commit | What |
|---|---|
| `62898232` | Merged `origin/staging` (69 commits); migration renumbered `0048 → 0081` (staging already had `0048_discoverability_evidence`); `run-all.sql` regenerated |
| `abb6e22c` | This review: findings F-1…F-30, phased plan, testing plan |
| `17f383fb` | Source BRD/PRD removed from the repo root; decisions recorded |
| `2ee7a69c` + `bcd0db87` | **Phase 1** — safe email sending with per-channel consent (`0082`, dispatcher, webhook, unsubscribe, consent UI, Send panel) |
| `a5f07732` | Beta feedback: import feedback, unique/editable/identifiable campaigns |
| `fedb0195` | Every P0 guard proven RED (`verify:engagement-p0`); concurrent-send test |

---

## 1. PRD vs implementation (original review)

The PRD is a research blueprint, not a spec — it has no acceptance criteria, volumes, or pricing.
The scorecard below is **as reviewed, before Phase 1**. Changes since: the Send button exists, email
sends are safe and consent-checked (F-1…F-8), analytics group by variant and channel, Sheets/Airtable
and AI generation remain unbuilt (Phases 4 and 2).

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

## 3. Findings (original review; status marks added)

Severity: **P0** = must be fixed before any real message leaves · **P1** = before customers ·
**P2** = quality. Every P0 needs a regression test **confirmed RED against today's code first** —
✅ done for all P0s, see §5.1.

### P0 — blockers

**✅ F-1 · Messages are re-sent on every dispatch, and the funnel never moves.**
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

**✅ F-2 · One click can send one person five messages on three channels.**
`generatePersonalizedVariants` reads `campaign.channels`, which is **not a column**, so it always falls
back to email A + email B + WhatsApp A + WhatsApp B + SMS. The server ignores the `channel` and
`customInstructions` the client sends. F-1 then sends every approved one.
*Fix:* a sequence step owns exactly one channel and one chosen variant per prospect; A/B means
*different prospects get different variants*, never the same prospect getting both.

**✅ F-3 · Opt-out is not enforced where it matters — at send.**
- Dispatch never checks the prospect's status. A message approved before a STOP is still sent after it.
- Opt-out is stored per **prospect row**; the same person in another campaign is still contactable.
- `update_prospect_status` passes `body.meta` straight into `transitionProspect`, which honours
  **`meta.adminOverride`** — a client-settable flag that reactivates an opted-out contact. This is the
  `?consented=true` defect again.
- Resend `email.complained` (spam complaint) is not handled; bounces are not suppressed.
*Fix:* a `engagement_suppressions (user_id, channel, address_normalised)` table checked inside the
send claim; never accept `adminOverride` from a request body.

**✅ F-4 · The dispatcher reports success for messages that were never sent.**
[channelRouter.js:162-169](../src/lib/engagement/channelRouter.js): if a channel's provider key is
missing, it returns `ok: true, status: "sent"` with a fabricated id. With only `RESEND_API_KEY` set in
production, every WhatsApp/SMS message is recorded as sent and nothing leaves. Telegram has no send
path at all and *always* takes this branch. Mock mode (no keys) does the same. **A fabricated "sent" is
worse than a failure** — it is the same class as the fixture prose badged `ai_generated` that this repo
already removed once.
*Fix:* missing credentials → `failed` with `code: channel_not_configured`; mock only when an explicit
`ENGAGEMENT_MOCK=1` is set in a non-production context.

**✅ F-5 · Webhook authentication fails open, and when configured it rejects the real providers.**
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

**✅ F-6 · Inbound events are matched to prospects across ALL tenants.**
Lines 78-95 look up `engagement_prospects` by email (or `ilike '%<last 8 digits>%'` for phone) with
**no user or campaign filter** and `limit(1)`. Tenant A's bounce, reply or opt-out lands on tenant B's
row whenever they share a contact — and the last-8-digits match hits unrelated people too.
*Fix:* correlate by the provider message id stored on `engagement_messages.external_message_id`
(unique index). Inbound replies with no message id: match on exact normalised address **within tenants
that have messaged it**, and apply opt-outs to every such tenant's suppression list.

**✅ F-7 · `update_campaign` is mass-assignable, including `user_id`.**
[engagementStore.js:126-132](../netlify/functions/lib/engagement/engagementStore.js) spreads the request's
`updates` into the UPDATE. A caller can set `user_id` to another account (planting a campaign there),
or `workspace_id` to a workspace they do not belong to. *Fix:* allow-list of editable fields.

**✅ F-8 · Customer cold outreach would be sent from DatIQ's own domain.**
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
| ✅ F-10 | **No entitlement or credit check** on generate or dispatch. Every WhatsApp/SMS costs real money; the unified-credits parity test does not cover messaging providers. | engagement-engine.js |
| ✅ F-11 | **"AI" generation is fixed templates**, and the copy asserts things that are not true: *"We set up an automated intelligence monitor for {company}. It uncovered a few interesting shifts"*. Defaults to DatIQ's brand, so an unfilled brand kit markets DatIQ from the customer's campaign. | aiMessageGenerator.js |
| ✅ F-12 | **HTML injection into outbound email**: prospect fields (from CSV, Sheets or scraped pages) are interpolated unescaped into `body_html`. | aiMessageGenerator.js:196, 204 |
| ✅ F-13 | Parent ids from the body are not ownership-checked: `add_prospects` does not verify the campaign is the caller's (rows attach to another tenant's campaign; FK error vs success is an existence oracle); `workspace_id` accepted unchecked. Rule: 404, never 403. | engagementStore.js:210, 86 |
| ✅ F-14 | **Client falls back to localStorage on any error** — 400/401/404/500 included. A signed-in user's failed write "succeeds" and vanishes; prospect PII (emails, phones) lives under `datiq_engagement_*` and is **not cleared on sign-out** (not in `SENSITIVE_KEYS`). | engagementClient.js |
| ✅ F-15 | Server silently uses in-memory `Map`s when Supabase env is missing — in a deployed context, data "saves" and disappears on the next cold start. Should be 503 outside dev. | engagementStore.js |
| 🟡 F-16 | **The n8n automation cannot work.** Workflows authenticate with `DATIQ_N8N_API_KEY`; the engine accepts only user Supabase JWTs → 401. The state monitor calls only `list_campaigns`, as a POST the handler does not route — **nothing ever calls `check_stale_prospects`, so no follow-up is ever sent.** The webhook forwarder posts n8n's `{headers, body, …}` wrapper instead of the provider payload and drops signature headers. n8n webhooks are unauthenticated, and user JWTs passed as `_ctx.auth_token` persist in n8n execution history. | n8n/workflows/datiq_*.json |
| ⏳ F-17 | WhatsApp cold outreach via Twilio with a free-form body is rejected outside the 24-hour session window; business-initiated messages need **approved Content Templates** (`ContentSid`). | channelRouter.js |
| ✅ F-18 | Telegram bots cannot message a user who has not started the bot; there is no `chat_id` capture. Telegram can only be an **opt-in/inbound** channel, never cold outreach. | channelRouter.js |
| ⏳ F-19 | Sheets/Airtable sync is unbuilt; `engagement_sync_configs` is the **fifth declared-and-never-written table** in this schema. | — |
| ✅ F-20 | Dispatch and stale-check loop serially inside a 10s/26s function. A few hundred prospects → 504 mid-send → partial state with no record (compounds F-1). Needs a queue + cron worker (the `bulk-runner` pattern). | engagement-engine.js |

### P2 — quality

- ✅ F-21 `listProspects` builds a PostgREST `.or()` from the raw search string; commas/parens break the query (the tenant `eq` is ANDed, so it is not a leak).
- 🟡 F-22 Activity log insert is unchecked and non-atomic with the status update; "immutable" is not enforced by any trigger.
- ✅ F-23 No unique index on `(campaign_id, lower(email))` / normalised phone — dedupe is read-then-write and races.
- ✅ F-24 Self-transitions re-score: every repeat `opened` adds +15 (Apple Mail Privacy Protection pre-opens inflate it further).
- ✅ F-25 `ilike %last8%` phone match (see F-6).
- ✅ F-26 Raw `err.message` returned in 500 bodies from both functions.
- 🟡 F-27 Analytics derive from current prospect status only; a prospect that bounced after opening leaves "opened". No per-channel, per-variant breakdown, so A/B is unmeasurable.
- ✅ F-28 `approve_message` ignores `guardrail_checks.passed` and current state — a failed-guardrail or already-sent message can be approved (and, with F-1, resent).
- ✅ F-29 Five redirect aliases for two functions; the generic `/api/*` rule already covers them.
- ✅ F-30 localStorage prefix `datiq_engagement_` breaks the `datiq.*` convention.

---

## 4. Remediation plan (phased)

**Ship email-only first**: every other channel has an external approval dependency (templates, DLT,
business verification) measured in weeks.

| Phase | Scope | Exit criteria | State |
|---|---|---|---|
| **0 · Hygiene** | Root documents removed (F-9); redundant redirects removed (F-29). Start Meta Business verification + DLT registration. | Repo root clean; squash-merge noted on the PR. | ✅ code · 👤 registrations |
| **1 · Safe email MVP** | F-1…F-8, F-10, F-12…F-15, F-20, F-26, F-28; `0082`; Send button; dispatch cron with per-message claim; per-channel consent + unsubscribe. | Every P0 test RED→GREEN; two-tenant real-Postgres suite green; a staging campaign to Resend test addresses produces exactly one send per prospect, correct state, suppression on bounce/complaint/unsubscribe. | ✅ built and tested · 🟡 **staging manual pass outstanding** (D-6) |
| **2 · Real personalisation + follow-ups** | LLM generation through `runChain` (metered, budgeted, schema output, skeleton + slots, *no factual claims not in the prospect record*). **Follow-up worker** (a cron like `engagement-dispatcher`) replaces the n8n state monitor. Headline funnel from message timestamps. | Follow-up fires once after N days, never to replied/opted-out; generated copy passes guardrails and cites only supplied fields. | ⏳ |
| **3 · WhatsApp + SMS** | Twilio Content Templates, Twilio signature verification, India DLT headers/templates, STOP per channel (the suppression table is already per channel). | Template approved; sandbox + one real number round-trip; STOP suppresses across campaigns. | ⏳ |
| **4 · Sheets / Airtable** | One-way import first (reuses `prospectImport.js`'s validation); two-way only if a customer needs it. | 1,000-row import idempotent; no duplicate outreach. | ⏳ |
| Telegram | **Dropped from outbound** — internal "hot lead" alert channel only. | — | — |

---

## 5. Testing plan

### 5.1 Automated — what exists

| Layer | Tests | What they prove |
|---|---|---|
| Server (`netlify/__tests__/engagement-*.test.js`) | **83** | The real store against **real Postgres** (PGlite, `0081` + `0082`), **two tenants**: sending exactly once (incl. two sends racing), consent at send time per channel and across campaigns, credits, provider failures and retries, webhook signature + per-message correlation, unsubscribe page (GET confirms only, one-click POST), ownership 404s, mass-assignment refusal, unique campaign names, delete keeps opt-outs. Run under `// @vitest-environment node`. |
| Unit (`src/lib/engagement`) | **73** | Suppression model, generator escaping and variants, state machine, channel routing, CSV import parsing (line numbers, quoting, delimiters, aliases), campaign labels. |
| UI (`src/pages/Engagement.test.jsx`) | **24** | Sign-in and beta gates call nothing; one explicit Send; consent panel per channel; import check blocks and explains; result panel; duplicate-name refusal; edit, rename, confirmed delete. |
| **P0 mutation check** — `npm run verify:engagement-p0` | **19 mutants** | Puts each P0 defect back into today's code and requires its test to fail. **All 19 killed.** ~2 min; not in pre-push; refuses to run over uncommitted changes and restores every file. If a mutation stops applying, the code moved — **update the entry, never delete it.** |
| DB (`npm run test:db`) | 82 migrations / **952 assertions** | `0082` tables, indexes, the append-only trigger, the credit-ledger reason/unit widening; engagement tables in the RLS lockdown list. |
| Registry parity | existing | `engagement-dispatcher` is in `netlify.toml`, `AUTOMATION_JOBS` and the admin runner. |

**Still to write:** a signed-in browser journey (create → import → generate → approve → send with mock
provider), skipped without credentials like `workflows-authenticated.spec.js`; mutation coverage for the
P1/P2 guards.

### 5.2 Manual — staging, then production

**Test identities that never reach a real person:** Resend `delivered@resend.dev`, `bounced@resend.dev`,
`complained@resend.dev`. (Twilio magic numbers and the WhatsApp Sandbox for Phase 3.)

| # | Check | Expected |
|---|---|---|
| M-1 | Create campaign, set sender + brand kit, import 5 prospects incl. a duplicate | Result panel: 4 added, 1 skipped |
| M-2 | Generate for one prospect | Exactly one email draft |
| M-3 | Approve → Send → Send again | One email; message `sent`; second click sends nothing |
| M-4 | Delivered/open/click webhooks (real, signed) | Prospect advances; score increments once per state |
| M-5 | `bounced@` and `complained@` | Address suppressed; later send skipped with the reason shown |
| M-6 | Unsubscribe link (page) and one-click header | Email suppressed in every campaign on the account; "also stop WhatsApp and SMS" works |
| M-7 | Forged webhook without signature | 401; no state change |
| M-8 | Second account with the same prospect email | A's events never touch B |
| M-9 | Out of credits | Send deferred before any provider call; clear message |
| M-10 | Sign out | No `datiq_engagement_*` keys left in localStorage |
| M-11 | 300-prospect campaign | The cron drains the queue across ticks; no 504; no duplicates |
| M-12 | Redeploy during a send | Resumes; nothing sent twice |
| M-13 | Paste one contact line with no header; paste `name,company` only; paste a bad email row | Each blocked or flagged with the reason and line number; nothing imported silently |
| M-14 | Create a campaign with an existing name (different case) | Refused in the dialog |
| M-15 | Edit name/description/status; delete with a prospect opted out | Selector updates; opt-out survives the delete |
| M-16 | Consent panel: opt out of SMS only, then all channels | SMS only; then every reachable channel and the prospect shows opted out |

Production pass is **read-only + owner allowlist only**, sending to the owner's own addresses.

---

## 6. Prerequisites — who owns what

| Item | Owner | State |
|---|---|---|
| Sender model (F-8) | Owner | Decided in code: a campaign sends as an address on a domain in `ENGAGEMENT_SENDER_DOMAINS`. 👤 Choose the domain. |
| Resend: separate domain/subdomain, SPF/DKIM/DMARC, webhook + signing secret | Operator | 👤 Not done. Do **not** reuse the transactional domain. |
| Legal review | Owner/counsel | 👤 DPDP 2023 consent basis; CAN-SPAM physical address + unsubscribe; Terms/Privacy/AUP. |
| Credit weight per send | Owner | 👤 Provisional 1. |
| `canLiftSuppression()` policy | Owner | 👤 Returns `false` until written. |
| Apply `0081` + `0082` | Operator | ✅ **staging** · 👤 production ([DB-MIGRATION-RUNBOOK.md §4h](DB-MIGRATION-RUNBOOK.md)) |
| Twilio, WhatsApp sender, **Meta Business verification**, Content Templates | Operator | ⏳ Phase 3 — weeks, start now |
| **India SMS DLT registration** | Operator | ⏳ Phase 3 |

---

## 7. Deployment sequence

| # | Step | State |
|---|---|---|
| 1 | Phase 0 + 1 on the feature branch; all P0 tests RED→GREEN; pre-push gate green | ✅ |
| 2 | Apply `0081` + `0082` to **staging** Supabase | ✅ tables present; confirm with `npm run verify:rls` |
| 3 | Preview/staging env vars correct (§C) | 👤 allow-list and public URL need fixing |
| 4 | Register the Resend webhook for staging | 👤 |
| 5 | Manual pass M-1…M-16 with test identities | pending |
| 6 | **Squash-merge** PR → `staging`; Staging Gate green | pending |
| 7 | `ENGAGEMENT_ENABLED=0` in production; promote `staging → main` (manual unlock + `approved`) | pending |
| 8 | Apply migrations to **production**; `npm run verify:rls -- --prod` | pending |
| 9 | Enable for the owner allowlist only; send to own addresses; watch Resend 7 days (bounce < 2%, complaint < 0.1%) | pending |
| 10 | Open to paid plans; Phases 2–4 follow the same sequence | pending |

**Rollback:** `ENGAGEMENT_ENABLED=0` stops all sending immediately (the API refuses and the cron does
nothing); the migrations are additive and can stay.
