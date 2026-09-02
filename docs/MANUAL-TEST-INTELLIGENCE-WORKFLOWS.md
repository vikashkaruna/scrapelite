# Manual Test Plan — Intelligence Workflows (Phases 0–2)

> **Covers:** PRD 1 (Workflow Templates & Guided Onboarding), PRD 2 (Shareable
> Intelligence Reports), and the Phase 0 spine both sit on.
> **Branch:** `feat/intelligence-workflows` · **PR:** [#136](https://github.com/vikashkaruna/scrapelite/pull/136)
> **Last updated:** 2026-09-02
> **Automated coverage:** 4,732 tests already green (see §12). This document
> covers only what a machine could not assert for you.

---

## How to use this document

Every check has a **✅ Expect** line. Anything that does not match it is a
finding — write down the check number and what you saw instead.

Checks are marked:

| Mark | Meaning |
|---|---|
| 🔴 **BLOCKER** | Must pass before merging to `main`. A failure here is a data-leak, billing, or broken-promise bug. |
| 🟠 **MAJOR** | Should pass. A failure is a real defect but not a stop-ship. |
| 🟡 **MINOR** | Polish. Note it and move on. |
| 🧪 **SQL** | Verify in the Supabase SQL editor, not the UI. |

**Suggested order:** §0 → §1 → §2 → §3 → §4 → §5 → §6 → §7 → §8 → §9 → §10 → §11.
Sections §1–§5 are the core journey; §6–§11 are edges, regressions and cleanup.

---

## §0 — Preconditions

### 0.1 Migrations — ✅ ALREADY DONE (nothing for you to do)

`0036`–`0039` are applied and verified on **`DatIQ-dev` (`aubwooslkkrprdxuiyvj`)**.

| Verified | Result |
|---|---|
| Object counts | 71 tables / 43 functions / 14 triggers |
| New tables | all 10, RLS on, one `service_role` policy each |
| New functions | all 10 present |
| Template catalogue | 5 published + 1 draft |
| Existing shared reports | 10 migrated to `link` — live links preserved |
| Re-seed idempotency | no duplicate version created |

Behaviour was verified against **real Postgres** in a rolled-back transaction:
composite-FK version pinning, template immutability trigger, append-only ledger
trigger, D3 slug reuse, terminal revoke.

> 🔴 **Production (`sikkfxysjhirmtwkumpt`) was NOT touched** and still lacks
> `0036`–`0039`. Apply before/with any promotion to `main`.

### 0.2 Where to test

| Environment | URL | Notes |
|---|---|---|
| **Deploy preview** ← use this | preview link on PR #136 | ⚠️ **401 until you are logged into Netlify in that browser.** `/api/*` is gated too — `/api/stats` is equally 401, so a 401 is the gate, not a bug. |
| **Staging** | `staging.datiq.app` | Only after this merges to `staging`. Also 401 without a Netlify session — by design. |
| **Local** | see §11 | UI mechanics only unless you run `netlify dev`. |

### 0.3 Accounts you need

| # | Account | Needed for |
|---|---|---|
| 0.3.1 | Signed out / incognito | §1, §2.6, §4 |
| 0.3.2 | A **Free** plan account | §2, §3, §7 |
| 0.3.3 | A **Business or Agency** account | §7.4 (branding) |
| 0.3.4 | A **second** account (any plan) | §4.5, §4.6 (org / named access) |

### 0.4 Before you start

- [ ] **0.4.1** Open DevTools → Network, keep it open. Several checks read responses.
- [ ] **0.4.2** Have the Supabase SQL editor open on **DatIQ-dev** for the 🧪 checks.
- [ ] **0.4.3** Note your start time. §2.9 asks you to time the first-run journey.

---

## §1 — Templates catalogue (`/templates`)

### 1.1 Reachability

- [ ] **1.1.1** 🟠 Main nav shows **Templates** between *Extract* and *Discover*.
      ✅ Expect: order is **Extract · Templates · Discover · Dashboard**.
- [ ] **1.1.2** 🟠 Click it → lands on `/templates`; the nav item shows as active.
- [ ] **1.1.3** 🔴 Open `/templates` **signed out**.
      ✅ Expect: the catalogue renders. It is a public acquisition surface — a
      sign-in wall here would defeat PRD 1.
- [ ] **1.1.4** 🟡 Browser tab title reads *"Workflow templates — turn a URL into finished work | DatIQ"*.

### 1.2 Contents

- [ ] **1.2.1** 🔴 Exactly **five** cards are shown:
      Sales-ready Account Brief · Competitor Pricing Tracker · SEO / GEO / AEO Audit ·
      Pre-Meeting Due Diligence Brief · Customer Proof Extractor.
- [ ] **1.2.2** 🔴 **"Bulk ICP Account Enrichment" must NOT appear.**
      ✅ Expect: absent. Its runner is Phase 4; a template that cannot finish is
      worse than one visibly not offered yet.
- [ ] **1.2.3** 🟠 Each card shows a title, a persona chip, a one-line summary, and a *Run this* affordance.
- [ ] **1.2.4** 🟡 No card shows a truncated or empty summary.

### 1.3 Persona filtering

- [ ] **1.3.1** 🟠 Filter chips appear: **All roles**, plus only personas that
      actually have a template (Sales / SDR / BDR, Competitive Intelligence,
      SEO / Content Marketer, Startup Founder / VC).
      ✅ Expect: **no dead filter** for a persona with zero templates.
- [ ] **1.3.2** 🟠 Click **Sales / SDR / BDR** → only *Sales-ready Account Brief*.
- [ ] **1.3.3** 🟠 Click **Competitive Intelligence** → *Competitor Pricing Tracker* + *Customer Proof Extractor* (2 cards).
- [ ] **1.3.4** 🟠 Click **SEO / Content Marketer** → *SEO / GEO / AEO Audit*.
- [ ] **1.3.5** 🟠 Click **Startup Founder / VC** → *Pre-Meeting Due Diligence Brief*.
- [ ] **1.3.6** 🟠 Click **All roles** → all five return.
- [ ] **1.3.7** 🟡 Signed in with a persona set, the matching chip is pre-selected on load.

### 1.4 The catalogue must not leak prompts

- [ ] **1.4.1** 🔴 DevTools → Network → `GET /api/templates` → Response.
      ✅ Expect: **no `prompt_bundle` on any template.** The prompts are the
      product; the public listing must not carry them.
- [ ] **1.4.2** 🟠 Open one template, then inspect `GET /api/templates?key=…`.
      ✅ Expect: `prompt_bundle` **is** present here — the runner needs it.

### 1.5 Presentation

- [ ] **1.5.1** 🟠 Resize to **390px**. ✅ Expect: one column, no horizontal scrollbar on `<body>`.
- [ ] **1.5.2** 🟠 Resize to **768px**. ✅ Expect: grid reflows cleanly.
- [ ] **1.5.3** 🔴 Toggle **dark mode**. ✅ Expect: all text legible; the selected
      filter chip keeps contrast against its solid fill (it uses `--accent-contrast`).
- [ ] **1.5.4** 🟡 Keyboard-only: `Tab` reaches every chip and card; `Enter` opens a card.

---

## §2 — Template runner

Open **Sales-ready Account Brief**.

### 2.1 The form is generated from the schema

- [ ] **2.1.1** 🟠 Two fields render: **Company domain** (text, required, red `*`,
      placeholder `stripe.com`, help text) and **Outreach angle** (select).
      ✅ Expect: nothing about this form is hard-coded — it is built from `input_schema`.
- [ ] **2.1.2** 🟠 The select offers exactly: *Discovery call*, *Displacing an incumbent*, *Expansion / upsell*.
- [ ] **2.1.3** 🟠 *Discovery call* is pre-selected (the schema default).
- [ ] **2.1.4** 🟡 A **← All templates** back link returns to the catalogue with filters intact.

### 2.2 Validation

- [ ] **2.2.1** 🔴 Click **Run this template** with the domain empty.
      ✅ Expect: inline error **"Company domain is required"** — the *human label*,
      not the field name. **No network request is sent** (check Network).
- [ ] **2.2.2** 🟠 Enter `not a domain` → run.
      ✅ Expect: *"Company domain must be a valid domain"*.
- [ ] **2.2.3** 🟠 Enter `stripe` (no TLD) → ✅ Expect: rejected.
- [ ] **2.2.4** 🟡 Fixing the error and re-running clears the message.

### 2.3 Input normalisation 🔴

This value becomes the `entity_key` that Phase 3 dedupes on and Phase 4 diffs
across, so it must be right now.

| # | Enter | ✅ Expect the run's **Sources** to show |
|---|---|---|
| 2.3.1 | `https://WWW.Stripe.com/pricing` | `https://stripe.com` |
| 2.3.2 | `stripe.com` | `https://stripe.com` |
| 2.3.3 | `HTTP://stripe.com/` | `https://stripe.com` |
| 2.3.4 | `docs.stripe.com` | `https://docs.stripe.com` — a subdomain is a **different** site and must stay distinct |

### 2.4 The credit estimate

- [ ] **2.4.1** 🔴 Before running, the estimate line reads
      **"8 credits — 1 × Workflow setup, 3 × Pages fetched, 2 × AI analysis"**.
      ✅ Expect: itemised, and visible **before** you commit.
- [ ] **2.4.2** 🟠 The estimate is present on load, not only after typing.
- [ ] **2.4.3** 🟠 Open **Competitor Pricing Tracker** → estimate differs
      (2 pages, 2 AI). ✅ Expect: each template prices its own work.
- [ ] **2.4.4** 🔴 Open **SEO / GEO / AEO Audit** → ✅ Expect: **"No credits will be used."**
      Audits debit their own monthly budget; charging credits too would bill the same work twice.

### 2.5 A successful run

- [ ] **2.5.1** 🟠 Enter `stripe.com`, click **Run this template**.
      ✅ Expect: progress *"Reading the page…"* → *"Structuring what we found…"* → *"Done"*.
- [ ] **2.5.2** 🟠 The button is disabled while running (no double-submit).
- [ ] **2.5.3** 🔴 A **Result** section appears with: a summary, an *Extracted facts* block, and **Sources**.
- [ ] **2.5.4** 🔴 Under the summary: **"Written by AI from the extracted facts below."**
      ✅ Expect: present. This is the fact-vs-interpretation boundary made visible —
      the summary is prose the model *wrote*, not a quotation from the page.
- [ ] **2.5.5** 🔴 Every source shows a URL **and a timestamp**.
      ✅ Expect: PRD 1 requires *"source URLs and an extraction timestamp"* on every output.
- [ ] **2.5.6** 🟠 Source links open the real page in a new tab.
- [ ] **2.5.7** 🟡 *Extracted facts* JSON is scrollable, not overflowing the card.

### 2.6 Run each remaining template once 🟠

- [ ] **2.6.1** **Competitor Pricing Tracker** on `notion.so` → completes, shows tiers.
- [ ] **2.6.2** **SEO / GEO / AEO Audit** on a real URL → completes with scores.
- [ ] **2.6.3** **Pre-Meeting Due Diligence Brief** on `linear.app` → completes.
- [ ] **2.6.4** **Customer Proof Extractor** on `vercel.com` → completes.
      ✅ Expect for all four: no crash, no empty result with no explanation.

### 2.7 Failure must not bill you 🔴

- [ ] **2.7.1** Run against `this-domain-does-not-exist-xyz123.com`.
      ✅ Expect: a toast ending **"— no credits were used."** The first thing anyone
      wonders after an error is whether they were charged.
- [ ] **2.7.2** 🧪 `select status, credits_actual from template_runs order by created_at desc limit 1;`
      ✅ Expect: `failed`, `0`.
- [ ] **2.7.3** 🧪 `select count(*) from credit_ledger where run_id = '<that run id>';`
      ✅ Expect: **0 rows**.
- [ ] **2.7.4** 🟠 The error does **not** render a raw stack trace.

### 2.8 Guest behaviour

- [ ] **2.8.1** 🔴 Signed **out**, run a template.
      ✅ Expect: it runs, and a toast says *"Running as a guest — sign in to save
      this to your dashboard."* `template.run` is deliberately ungated.
- [ ] **2.8.2** 🟠 Signed out, click **Create shareable report**.
      ✅ Expect: the sign-up modal opens. Reports need an owner.
- [ ] **2.8.3** 🧪 Signed out run → `select count(*) from template_runs;` is unchanged.

### 2.9 The five-minute claim 🔴

- [ ] **2.9.1** From a cold `/templates` (signed in, first time), time yourself to a completed result.
      ✅ Expect: **under five minutes, with zero prompt authoring.** This is PRD 1's
      acceptance criterion — if it fails, the feature has missed its point.

---

## §3 — Runs and credits

### 3.1 Persistence 🧪

- [ ] **3.1.1** 🔴 After a signed-in run:
      `select id, template_key, template_version, status, credits_estimated, credits_actual, user_id from template_runs order by created_at desc limit 1;`
      ✅ Expect: your `user_id`, `status='complete'`, `credits_estimated=8`,
      and **`template_version` populated** (this is what makes the run reproducible).
- [ ] **3.1.2** 🟠 `select * from template_run_sources where run_id='<id>';`
      ✅ Expect: one row per page fetched, with `url` and `fetched_at`.

### 3.2 The ledger 🧪

- [ ] **3.2.1** 🔴 `select reason, unit, credits, quantity from credit_ledger where run_id='<id>';`
      ✅ Expect: **a few rows, not dozens** — events collapse to one row per
      (reason, unit). The ledger is an audit trail, not a firehose.
- [ ] **3.2.2** 🔴 `update credit_ledger set credits=999 where run_id='<id>';`
      ✅ Expect: **refused** — *"credit_ledger is append-only…"*. A ledger you can UPDATE is not a ledger.
- [ ] **3.2.3** 🔴 `delete from credit_ledger where run_id='<id>';` ✅ Expect: refused the same way.
- [ ] **3.2.4** 🟠 `select credit_balance('<your-user-uuid>'::uuid, to_char(now(),'YYYY-MM'));`
      ✅ Expect: a number matching the sum of your ledger rows this month —
      **derived, never stored**.
- [ ] **3.2.5** 🟠 `select estimated_credits, breakdown from credit_estimates where run_id='<id>';`
      ✅ Expect: the estimate you were shown, stored separately so drift stays measurable.

### 3.3 Cache / no-double-charge

- [ ] **3.3.1** 🟠 Run the **same** domain again immediately.
      ✅ Expect: it completes, and charges **less or nothing** for the fetch.
      You are never billed for a page we did not read.
- [ ] **3.3.2** 🧪 Compare `credits_actual` between the two runs. ✅ Expect: second ≤ first.

### 3.4 Overrun disclosure

- [ ] **3.4.1** 🟠 If any run charges materially more than its estimate,
      ✅ Expect: a toast disclosing it. We must never quietly bill more than the
      number you agreed to.

---

## §4 — Reports: the sharing state machine 🔴

**This is the highest-risk area in the release.** Run a template signed in, then
click **Create shareable report**.

### 4.1 Private by default

- [ ] **4.1.1** 🔴 The dialog opens with **Private** selected.
- [ ] **4.1.2** 🔴 **No link box is shown** while private.
- [ ] **4.1.3** 🔴 🧪 `select slug, visibility from reports order by created_at desc limit 1;`
      ✅ Expect: **`slug` IS NULL**, `visibility='private'`.
      A private report has no URL, so there is nothing to guess at.

### 4.2 Publish

- [ ] **4.2.1** 🔴 Choose **"Anyone with the link"**.
      ✅ Expect: a link box appears with a URL like `…/r/<8-char-slug>`.
      **Write the slug down** — §4.3 needs it.
- [ ] **4.2.2** 🔴 Copy the link, open it in a **private/incognito window (signed out)**.
      ✅ Expect: the report renders fully — title, source, summary, facts, sources.
- [ ] **4.2.3** 🔴 View source → `<meta name="robots">`.
      ✅ Expect: **exactly ONE tag**, and it says **`noindex`**.
      ⚠️ **Two tags is a bug that shipped once and was fixed.** If you see two, stop and report it.
- [ ] **4.2.4** 🟠 The **"Run this on another company"** button links to
      `/templates?key=account_brief`. ✅ Expect: this is the acquisition loop; it must work.
- [ ] **4.2.5** 🟠 On a Free/Go/Select/Pro plan the footer shows **"Made with DatIQ"**.

### 4.3 Unpublish is reversible — decision D3 🔴 **MOST IMPORTANT SECTION**

- [ ] **4.3.1** 🔴 In the dialog choose **Private**.
      ✅ Expect: toast *"Sharing stopped. Re-publish any time — the same link will work again."*
- [ ] **4.3.2** 🔴 Reload the incognito link.
      ✅ Expect: **"This report isn't available"** (404).
- [ ] **4.3.3** 🔴 🧪 `select slug from reports where id='<id>';`
      ✅ Expect: **the slug is STILL THERE.** Unpublish keeps it.
- [ ] **4.3.4** 🔴 Choose **"Anyone with the link"** again.
      ✅ Expect: the link box shows the **exact same slug** as 4.2.1.
- [ ] **4.3.5** 🔴 Reload the incognito link.
      ✅ Expect: **it works again.** This is D3 — unpublish is the reversible
      "hide this for now" control, and re-publishing revives the link a
      colleague already holds.

### 4.4 Revoke is terminal 🔴

- [ ] **4.4.1** 🔴 Click **"Revoke this link permanently"**.
      ✅ Expect: an inline confirmation — it does **not** revoke on first click.
- [ ] **4.4.2** 🔴 Read the confirmation text.
      ✅ Expect: it says revoking is permanent, cannot be restored *even by you*,
      and points you at **Private** if you only want to hide the report.
- [ ] **4.4.3** 🔴 Confirm. ✅ Expect: *"Link permanently revoked."*
- [ ] **4.4.4** 🔴 Reload the incognito link → 404.
- [ ] **4.4.5** 🔴 Reload the link **as the owner** → **still 404**.
      ✅ Expect: a revoked report denies **everyone**, its owner included.
- [ ] **4.4.6** 🔴 Re-open the share dialog.
      ✅ Expect: the options are replaced by a *"This link was revoked"* panel.
      **There is no path back.**
- [ ] **4.4.7** 🔴 🧪 `select slug, visibility from reports where id='<id>';`
      ✅ Expect: `revoked`, and **the slug is retained** — that is precisely what
      stops it being reissued, because `slug` is `UNIQUE`.
- [ ] **4.4.8** 🔴 Create and publish a **new** report.
      ✅ Expect: a **different** slug. The burned one is never handed out again.

### 4.5 Named collaborators

- [ ] **4.5.1** 🟠 On a fresh report choose **"Specific people"**; add the email of account 0.3.4.
      ✅ Expect: confirmation toast, and a hint that a forwarded link won't work for anyone else.
- [ ] **4.5.2** 🔴 Open that link **signed out** in incognito → ✅ Expect: 404.
- [ ] **4.5.3** 🔴 Open it signed in as a **different, non-granted** account → ✅ Expect: 404.
- [ ] **4.5.4** 🟠 Open it signed in as the **granted** account → ✅ Expect: it renders.
- [ ] **4.5.5** 🟠 Grant using a **different case** (`MATE@x.com` vs `mate@x.com`) → ✅ Expect: still works.

### 4.6 Workspace-only

- [ ] **4.6.1** 🟠 Choose **"Workspace only"**. Open as a **non-member** → ✅ Expect: 404.
- [ ] **4.6.2** 🟠 Open as a **member** of that workspace → ✅ Expect: it renders.

### 4.7 Public

- [ ] **4.7.1** 🟠 Choose **Public**. ✅ Expect: an amber warning about search engines and the gallery.
- [ ] **4.7.2** 🔴 View source → robots tag flips to **`index, follow`**.
      ✅ Expect: `public` is the **only** indexable state.
- [ ] **4.7.3** 🔴 Navigate from the public report to `/pricing`.
      ✅ Expect: the robots tag returns to the site default —
      leaving the whole SPA noindexed would be a serious SEO regression.

### 4.8 Expiry

- [ ] **4.8.1** 🟠 🧪 `update reports set expires_at = now() - interval '1 hour' where id='<id>';`
      then reload the link signed out → ✅ Expect: 404.
- [ ] **4.8.2** 🟠 Reload as the **owner** → ✅ Expect: still visible, so you can re-publish.
- [ ] **4.8.3** 🧪 Reset: `update reports set expires_at = null where id='<id>';`

### 4.9 Denials must never leak

- [ ] **4.9.1** 🔴 Visit `/r/doesnotexist12`.
      ✅ Expect: the same *"This report isn't available"* page as a private report.
      Distinguishing "private" from "does not exist" tells an enumerator which slugs are real.
- [ ] **4.9.2** 🔴 In Network, check the denial response.
      ✅ Expect: HTTP **404**, and `Cache-Control: no-store`.
      A cached revoked link is a live revoked link.
- [ ] **4.9.3** 🔴 On any denial page, ✅ Expect: **no report content visible anywhere**, including in the HTML source.

### 4.10 Access logging 🧪

- [ ] **4.10.1** 🟠 `select event, visibility, created_at from report_access_log where report_id='<id>' order by created_at;`
      ✅ Expect: `published`, `unpublished`, `revoked` state changes **and** `viewed` / `denied` reads.
- [ ] **4.10.2** 🟠 `select view_count from reports where id='<id>';`
      ✅ Expect: increments on a permitted view, **not** on a denial.

---

## §5 — Report page rendering

- [ ] **5.1** 🟠 Title, source URL (clickable), and *"Generated <date>"* all present.
- [ ] **5.2** 🔴 Summary carries *"Written by AI from the extracted facts below — not quoted from the page."*
- [ ] **5.3** 🟠 *Extracted facts* renders; long values scroll rather than overflow.
- [ ] **5.4** 🟠 Sources list shows URL + when it was read.
- [ ] **5.5** 🟠 At 390px the page has no horizontal scroll.
- [ ] **5.6** 🟠 Dark mode renders legibly.
- [ ] **5.7** 🟡 Page title in the browser tab reflects the report.

---

## §6 — Templates + reports together (the loop)

- [ ] **6.1** 🔴 From a shared report (as a signed-out recipient) click
      **"Run this on another company"** → lands on the runner for that template.
- [ ] **6.2** 🟠 Run it as a guest → works, with the guest toast.
- [ ] **6.3** 🟠 Sign up from there → returns you to a usable state (not a blank page).
      ✅ Expect: this is the PLG loop PRD 2 is built around; it must not dead-end.

---

## §7 — Entitlements

| Plan | `template.run` | `template.duplicate` | `report.share` | `report.branding` |
|---|---|---|---|---|
| Free | ✅ | ❌ | ✅ | ❌ |
| Go / Select / Pro | ✅ | ✅ | ✅ | ❌ |
| Business / Agency | ✅ | ✅ | ✅ | ✅ |

- [ ] **7.1** 🔴 On **Free**, run a template → allowed (see 2.8.1 for why).
- [ ] **7.2** 🔴 On **Free**, publish a report → allowed.
      ✅ Expect: PRD 2's acquisition loop *is* a free user sharing with someone who
      then signs up. Gating it would be charging for our own distribution.
- [ ] **7.3** 🟠 On **Free**, a shared report footer shows *"Made with DatIQ"*.
- [ ] **7.4** 🔴 On **Business/Agency**, the attribution can be replaced by the Brand Kit.
- [ ] **7.5** 🔴 **Paywall bypass attempt.** On a **Free** account, in DevTools console:
      ```js
      await fetch('/api/reports', {method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+<your jwt>},
        body: JSON.stringify({action:'create', title:'Bypass probe',
                              branding:{companyName:'Sneaky Ltd', hideAttribution:true}})})
      ```
      Then 🧪 `select branding from reports where title='Bypass probe';`
      ✅ Expect: **`{}`** — the brand kit is silently **dropped**, not honoured.
      (Silently, not as an error: failing the whole publish over branding would
      block a legitimate share.)

---

## §8 — Regression: nothing else broke

The nav and shared components changed, so re-check the neighbours.

- [ ] **8.1** 🔴 `/` — Home composer still extracts a single URL.
- [ ] **8.2** 🔴 `/dashboard` — saved extractions still list.
- [ ] **8.3** 🟠 `/batch` — a 2-URL batch still runs.
- [ ] **8.4** 🟠 `/discoverability` — an audit still runs.
- [ ] **8.5** 🟠 `/schedules` — a schedule can still be created.
- [ ] **8.6** 🟠 `/pricing` — plan cards + comparison matrix render.
- [ ] **8.7** 🟠 `/workspace` — tabs still work.
- [ ] **8.8** 🔴 `/gallery` — **unchanged** by the reports migration.
- [ ] **8.9** 🔴 An **older** `/p/<slug>` share link still opens.
      ✅ Expect: works. Existing shares were migrated to `link`, not `private`.
- [ ] **8.10** 🟠 `/account` — billing and usage render.
- [ ] **8.11** 🟠 Sign out → sign in → no console errors, nav restores.
- [ ] **8.12** 🟡 Mobile hamburger nav lists **Templates**.

---

## §9 — Cross-browser / accessibility

- [ ] **9.1** 🟠 Chrome — §1, §2.5, §4.2, §4.3 pass.
- [ ] **9.2** 🟠 Safari — same.
- [ ] **9.3** 🟡 Firefox — same.
- [ ] **9.4** 🟠 Keyboard-only through the runner form and the share dialog.
- [ ] **9.5** 🟠 The share dialog traps focus and closes on the ✕.
- [ ] **9.6** 🟡 Screen-reader: the share options read as a labelled radio group.

---

## §10 — Data integrity sweep 🧪

Run at the end, once.

```sql
-- 10.1 no orphaned runs
select count(*) from template_runs r
 where not exists (select 1 from workflow_templates t
                    where t.template_key=r.template_key and t.version=r.template_version);
-- ✅ expect 0

-- 10.2 no report is shareable without a slug
select count(*) from reports where visibility not in ('private','revoked') and slug is null;
-- ✅ expect 0

-- 10.3 no revoked report lost its slug (that is what stops reissue)
select count(*) from reports where visibility='revoked' and slug is null;
-- ✅ expect 0

-- 10.4 confidence is never a silent zero
select count(*) from extracted_fields where confidence = 0;
-- ✅ expect 0 unless you deliberately created one — NULL means "unmeasured",
--    0 means "measured and scored nothing". They must stay different.

-- 10.5 exactly one published version per template key
select template_key, count(*) from workflow_templates
 where status='published' group by 1 having count(*) > 1;
-- ✅ expect no rows

-- 10.6 ledger never has a zero-credit row
select count(*) from credit_ledger where credits = 0;
-- ✅ expect 0

-- 10.7 every new table still has RLS on
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
-- ✅ expect no rows
```

---

## §11 — Running locally

Full stack (real functions; needs Supabase env):

```bash
nvm use 24 && netlify dev
```

UI-only (no keys, no network) — enough for §1, §2.1–2.4 mechanics:

```bash
nvm use 24 && npm run dev -- --port 5180
```

⚠️ With plain `npm run dev`, `/api/*` is proxied to **port 9999** *and rewritten
to `/.netlify/functions/*`*. Any stub must match the **rewritten** path. Without
one, `/templates` shows *"Couldn't load templates"* — expected, not a bug.

⚠️ Node must be **>=24 <25**. The shell default here is v26 and the whole suite
goes red on that alone. Always `nvm use 24` **in the same command**.

---

## §12 — Already covered automatically (do NOT re-test by hand)

| Suite | Result |
|---|---|
| Unit | 2,566 passed |
| Contract (`netlify/`) | 1,753 passed (+14 skipped) |
| Integration | 405 passed |
| System | 8 passed |
| Database (`npm run test:db`) | 39 migrations · 340 assertions |
| E2E smoke (Playwright) | 131 passed, 1 skipped |
| Build · `check:prerender` · security | clean |

The §4 state machine is pinned by **68 database assertions** including D3 slug
reuse and terminal revoke. The 4.2.3 robots-tag behaviour is pinned by three
regression tests **confirmed to fail against the pre-fix code**.

```bash
nvm use 24 && npm run test:all
```

---

## §13 — Known gaps in this drop (not bugs — do not raise these)

| Gap | Why |
|---|---|
| **Bulk ICP Enrichment absent** | Its durable runner is Phase 4. Seeded as `draft` on purpose. |
| **Runs orchestrated client-side** | Closing the tab mid-run abandons it. A 10s serverless limit cannot host a 2–4 scrape run; Phase 4 brings the durable runner. |
| **No `/reports` management screen** | `GET /api/reports` works; sharing is driven from the run screen. |
| **No PDF/CSV/email export of a report** | PRD 2 lists it "Later if not already supported". |
| **Engagement analytics not surfaced** | `report_access_log` fills correctly; no UI reads it yet. |
| **Template duplicate/fork UI missing** | The entitlement is gated; the UI is a Phase 7 follow-up. |
| **`extracted_fields` empty** | Phases 4 and 5 populate it. Phase 1 stores provenance in the run's `output`. |
| **Schema drift on staging** | `account_deletion_audit`, `delete_user_account` exist in no migration. Reconcile before prod. |

---

## §14 — Reporting a finding

For each failure record:

1. **Check number** (e.g. `4.3.4`)
2. **What you expected** (copy the ✅ line)
3. **What happened**
4. **Environment** (preview / staging / local; browser; signed-in plan)
5. **Evidence** — screenshot, the Network response, or the SQL output
6. **Severity** as marked (🔴 / 🟠 / 🟡)

🔴 failures block the merge to `main`. Everything else can be triaged into the
next phase — fixes land on **`feat/intelligence-workflows`**, which stays open.
