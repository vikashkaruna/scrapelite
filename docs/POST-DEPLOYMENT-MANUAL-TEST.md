# Post-deployment manual test — DatIQ

> **Run this AFTER the next deploy reaches the environment you are testing.**
> Written 2026-09-06, against `staging` @ the commit that split the workflow
> orchestrator's cron from its HTTP surface.
>
> **Scope.** The checks that cannot be asserted by CI: they need a real session,
> real third-party traffic, a real clock, or a populated account. Everything
> else is already covered — unit 3 016 · contract 2 006 · integration 432 ·
> db 463+17+56 · e2e smoke 142. Do not re-do here what those already prove.
>
> **Companions.** `MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md` (the 158-check feature
> pass) · `TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md` (execution record) ·
> `N8N-DEPLOYMENT-STATUS.md` (pipeline state) · `V2-IMPLEMENTATION-GUIDE.md`.

---

## 0. Before you start

### 0.1 A deploy must have happened

🔴 **Netlify injects Function env vars at DEPLOY time.** A variable changed or
deleted in the UI reaches no function until the next deploy. Two changes are
waiting on this right now:

* `SCRAPE_PROVIDER_ORDER` was **deleted** (all three contexts). Until the
  context redeploys, its functions still run the old order.
* The new `workflow-orchestrator-cron` schedule only exists after a deploy.

Confirm the deploy is the one you think it is — never infer it from a 200:

```bash
curl -s https://datiq.app/ | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'
# compare against the hash in the deploy log. A SPA catch-all answers a missing
# asset with index.html at status 200, so "everything returns 200" proves nothing.
```

### 0.2 What each result means

Record every row as **PASS / FAIL / BLOCKED / N-A**, with the evidence
(timestamp, row id, screenshot). A blank is not a pass. Where a check says
"🔴", a failure there is a stop-ship, not a bug to file.

### 0.3 Environment

| | |
|---|---|
| Staging | `https://staging--datiqapp.netlify.app` (401-gated by Netlify edge access — you need a logged-in Netlify session) |
| Production | `https://datiq.app` |
| Self-hosted n8n | `https://n8n-dev-692109205619.asia-south1.run.app` |
| Admin | `/admin` → PIN. Separate PIN per context. |

---

## 1. M1 — the feature pass (158 checks)

**Document:** `MANUAL-TEST-INTELLIGENCE-WORKFLOWS.md`
**Time:** ~3–4 h for a full pass, ~45 min for the 🔴 subset
**Prerequisite:** a signed-in account on a paid plan (Agency or Business — bulk
and watchlist limits gate several sections).

Work that document top to bottom. It covers `/templates`, the domain resolver,
all 7 template runners, credits and the ledger, the run-history modal, shareable
reports, the integration gallery, and the PQL funnel.

**If you only have 45 minutes**, run these, which are the ones where a failure
means the product is telling a customer something untrue:

| From | Check | Why it is the priority |
|---|---|---|
| §4.2 | Competitor Pricing renders its **tiers table** | The renderer ignored `from:` entirely until 2026-09-05 and filled every list from `talking_points`. Confirm the table is real extracted data, not talking points under a table heading. |
| §4.4 | Due Diligence opens `/about`, not `/pricing` | Five of seven templates used to be routed to `/pricing` by a first-match regex. |
| §4.5 | Customer Proof on a site that **does** publish named customers | It correctly returns nothing on `datiq.app` — that is not a bug. Test it somewhere with real testimonials or you learn nothing. |
| §5 | Ledger: actual ≈ estimate, and a **failed** row costs 0 credits | |
| §7 | Publish → `/r/<slug>` is `noindex`; revoke → immediate refusal on reload, not a cached body | |

---

## 2. M2 — `/workflows` against a populated account

🔴 **This has never been done.** Both phases of `/workflows` are pinned only
against synthetic fixtures, because staging is 401-gated and no session has
opened the page on an account with real data. Its whole purpose is to detect
that the Lists → Watchlists → Rules pipeline is silently inert, so a false
"everything is wired" is the worst thing it could say.

**Prerequisite:** an account that has **at least one** of each: a list with
enriched records, a watchlist with a discovered page, and an active signal rule.
Build them in §3 below if you don't have them, then come back.

| ID | Check | Expected | Result |
|---|---|---|---|
| M2-01 | Open `/workflows` | Issues lead, diagram is context — not the other way round | |
| M2-02 | Compare each reported issue against the real data | No issue is reported for something that is actually wired | |
| M2-03 | 🔴 Something genuinely broken (pause a rule, or leave a list unenriched) | It is reported. **An inert pipeline that reads healthy is the defect this page exists to prevent.** | |
| M2-04 | Dry trace: pick a plausible event | Shows which rules fire **and which condition turned the others away** | |
| M2-05 | 🔴 Dry trace sends nothing | No Slack message, no email, no webhook hit. The page says so; confirm it is true. | |
| M2-06 | Inline repair → create a rule | Trigger source derived from the issue, never asked. Rule emails the signed-in address. | |
| M2-07 | The created rule ships with **no conditions**, and the form said so | A rule that silently matched nothing would reproduce the very defect the screen surfaces | |
| M2-08 | Edges are by **kind**, never id-to-id | `trigger_source` names a class of event; an id edge would imply precision the schema lacks | |

---

## 3. M3 — watch the first real `account.score_changed`

🔴 **The routing fix is reasoned from the schema and pinned by test, not
observed firing.**

Until 2026-09-05, `EVENT_TO_SOURCE` emitted `account`, `extraction`, `report`
and `system`, while migration `0043`'s CHECK constraint only permits
`watchlist`, `bulk_enrichment`, `workflow_run`. **Eight of the ten canonical
event kinds queried for a value no row can hold**, matched zero rules every
time, and dispatched nothing — silently, because an empty result is
indistinguishable from "no rule wanted this". Only `monitor.*` ever routed.

| ID | Check | Expected | Result |
|---|---|---|---|
| M3-01 | Create a rule on `account.score_changed`, armed to a webhook you control (webhook.site) | Rule saves, shows ACTIVE | |
| M3-02 | Cause a real ICP score change (re-enrich a list record so its score moves) | | |
| M3-03 | 🔴 The webhook receives the payload | This is the assertion. A rule listed ACTIVE that never fires is exactly the pre-fix behaviour. | |
| M3-04 | `/rules` → history shows the execution with status, latency, response | | |
| M3-05 | Repeat for one more previously-dead kind (`report.*` or `extraction.*`) | Fires | |
| M3-06 | `integration.action_failed` and `usage.limit_approaching` do **not** route | ⚠️ **Deliberate.** They are in `UNROUTED_EVENTS` with a written reason — routing an integration failure to a rule whose action is that integration is a loop. Absence here is correct. | |

---

## 4. T1–T6 — the n8n pipeline end to end

**Prerequisite:** K1–K4 complete (instance reachable, 18 workflows imported,
`datiq-slack-monitoring` credential bound, workflows activated) and N1–N3 set in
Netlify. All are done as of 2026-09-06 — but see §0.1: a deploy must have
followed.

### 4.0 First, prove the two halves are both alive

The cron and the HTTP surface are now **separate functions** and fail
independently. Check both; a green on one says nothing about the other.

| ID | Check | Command / place | Expected | Result |
|---|---|---|---|---|
| T0-A | HTTP surface answers | `curl -sS -X POST https://datiq.app/api/workflow-orchestrator/ping` | `{"ok":true,"pong":true,...}` | |
| T0-B | 🔴 HTTP surface is **not** 404 | as above | A 404 means someone re-added a `schedule` block for `workflow-orchestrator` and broke n8n's callbacks | |
| T0-C | The cron is registered | `netlify functions:list` | `workflow-orchestrator-cron` present **with a schedule** | |
| T0-D | The cron has actually run | `/admin/monitoring` → "Workflow dispatch loop" | A run within the last ~10 min. **"Never run" = the schedule did not take.** | |
| T0-E | Stop/Run-now work | `/admin/monitoring` | Stop requires a written reason; Run now executes and appears in history | |

### 4.1 T1 — smoke test workflow

| Step | Expected | Result |
|---|---|---|
| Wait 5 min after activation, open n8n → Executions | `00_datiq_smoke_test` green | |
| Its request reached DatIQ | `/ping` returned 200 (T0-A is the same path) | |

### 4.2 T2 — happy path 🔴 the load-bearing one

| Step | Expected | Result |
|---|---|---|
| Sign in, create a monitoring schedule on a page you can edit | Schedule saved and **not** `_localOnly` | |
| Change the page so the next run detects a diff | | |
| Wait for `scheduled-runner` (hourly) | A `workflow_events` row appears, `state='pending'` | |
| Wait ≤5 min for the dispatch | Row moves `pending → processing → done` | |
| Slack + email arrive | Content matches the change | |
| `/admin/automation` | The event is visible with attempts and timing | |

⚠️ If the row sits at `pending` for more than ~10 minutes, the **cron** is the
suspect, not n8n — check T0-C/T0-D before anything else. That failure mode was
invisible before this session because the job was on no dashboard.

### 4.3 T3 — MCP path

| Step | Expected | Result |
|---|---|---|
| From Claude Desktop / Code / mavis, ask: "list the 5 most recent DatIQ workflow events" | The 11 tools are listed and the call returns real rows | |
| Call `datiq_list_pending_workflows` | Matches what `/admin/automation` shows | |

### 4.4 T4 — admin path

| Step | Expected | Result |
|---|---|---|
| `/admin/automation` | KPIs render; **not** stuck on "loading" | |
| Click an event row | Detail panel opens with state, attempts, error, channels | |
| "Run now" | Executes, feedback shown | |

⚠️ This page never loaded under `npm run dev` before 2026-09-06 (a StrictMode
`alive`-ref bug). It is fixed and now has 6 e2e specs, but this is the first
time it is being exercised against real data.

### 4.5 T5 — retry path

| Step | Expected | Result |
|---|---|---|
| Point a rule at a URL that returns 500 | Dispatch recorded `failed` **with the status**; the run itself is OK | |
| Watch `signal-retry` (every 5 min) | Backoff 1m, 5m, 30m, 2h, 12h; status `retrying`, **not** `failed`, while in flight | |
| Fix the destination, click Retry | Delivered; history shows the whole chain | |
| A 4xx that is not 408/429 | Settles immediately — resending what the destination already rejected is how a rule earns a rate-limit ban on a customer's Slack | |
| An SSRF-refused destination | Recorded `refused`, **distinct from `failed`**, and never retried | |

### 4.6 T6 — cancel path

| Step | Expected | Result |
|---|---|---|
| `/admin/automation` → a `pending` event → Cancel → confirm | `state='cancelled'`; it is not picked up by the next poll | |

---

## 5. Also worth doing on this deploy

| ID | Check | Why now | Result |
|---|---|---|---|
| X-01 | 🔴 `npm run verify:rls -- --prod` | Re-run after any migration. 15/15 must be **401**. | |
| X-02 | Scrape provider order | `SCRAPE_PROVIDER_ORDER` is deleted, so the code default (`firecrawl → spider → jina → direct`) applies. Extract a JS-rendered SPA (e.g. `notion.so`) and confirm `_providerAttempts` no longer starts with `direct`. | |
| X-03 | `/admin/ai` → Test all providers | Confirms the AI accounts are funded and the adapters work | |
| X-04 | `/admin/health` | Resend, Razorpay, PageSpeed, Supabase all `ok` or an honest `Not checked` — never a false `Down` | |
| X-05 | The four newly-wired Run-now buttons | `/admin/monitoring` → `discoverability-monitor`, `watchlist-monitor`, `bulk-runner`, `signal-retry`. All four returned `400 No runner is wired` before 2026-09-06. | |
| X-06 | `billing-purge`'s Run now is **disabled** | Destructive; its schedule must remain its only trigger path | |

---

## 6. Known-blocked / not testable here

| ID | Item | Why |
|---|---|---|
| S-01 | Sign in with a real credential | An agent cannot create accounts or enter passwords. The spec exists (`e2e/journeys/workflows-authenticated.spec.js`), reads credentials from env only, and skips cleanly without them. |
| — | Screenshots | `/templates`, `/lists`, `/watchlists`, `/rules`, `/workflows` have no captures, so help §§10–15 ship without imagery. `node docs/capture-screenshots.mjs` with a dev server up. |
| — | `prune_ops_history(30)` | Written, never scheduled. `job_runs` and `health_samples` grow unbounded (~150k rows/yr). `ops_audit_log` is deliberately excluded and must stay so. |

---

## 7. Recording the result

Update `TEST-EXECUTION-INTELLIGENCE-WORKFLOWS.md` §0 with the pass/fail counts
and the date. If anything in §2, §3 or §4.2 fails, **do not promote to
production** — those are the checks that distinguish a working pipeline from one
that looks working, which is the failure this whole document exists to catch.
