# Manual test guide — Intelligence Workflows (Phases 0–2)

> Covers PRD 1 (Workflow Templates & Guided Onboarding) and PRD 2 (Shareable
> Intelligence Reports), plus the Phase 0 spine they both sit on.
> Branch: `feat/intelligence-workflows` · PR: [#136](https://github.com/vikashkaruna/scrapelite/pull/136)
> Written 2026-09-02.

---

## 0. Before you start — READ THIS FIRST

### 0.1 Apply the migrations, or most of this guide will not work

Migrations **`0036`–`0039`** have only ever run against **PGlite** (in-process
WASM Postgres via `npm run test:db`). PGlite has no GoTrue, no PostgREST and
shimmed roles, so a green `test:db` proves the SQL is *valid* — **not** that it
works against real Supabase.

```bash
PROD_SUPABASE_DB_URL='<staging Direct connection string, port 5432>' npm run migrate:prod -- --dry-run
```

The dry run connects, prints `current_database`, and aborts **without writing**.
Confirm it names the *staging* project (`aubwooslkkrprdxuiyvj`), then re-run
without `--dry-run`.

**What you should see afterwards — 70 tables / 42 functions / 14 triggers** (was
60 / 32 / 11). Verify:

```sql
select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';  -- 70
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';      -- 42
```

**Until the migrations are applied:**
- `/templates` still renders — it falls back to the bundled seeds and flags
  itself `degraded`. This is deliberate: a catalogue that renders empty makes a
  working feature look broken in every environment without a service key.
- **Everything in §3 (reports) returns 503.** That is the correct behaviour,
  not a bug to chase.

### 0.2 Where to test

| Environment | How |
|---|---|
| **Deploy preview** (recommended) | The preview URL on PR #136. Previews bypass Netlify's `allowed_branches` list, so this branch gets one even though it isn't `main`/`staging`. |
| **Staging** | Only after the PR merges. ⚠️ `staging.datiq.app` returns **401** without a Netlify session — that is by design (Edge Access gate), not a failure. |
| **Local** | See §6. |

### 0.3 What "working" looks like at a glance

You are testing three claims:
1. A new user can go from a cold catalogue to a finished piece of work in **under five minutes with zero prompt writing** (PRD 1's acceptance criterion).
2. A report is **private until you deliberately publish it**, and revoking a link **blocks access immediately**.
3. **Nothing charges you for work that did not happen.**

---

## 1. Templates — the catalogue

Go to **`/templates`** (also reachable from the "Templates" item in the main nav).

| # | Do this | Expect |
|---|---|---|
| 1.1 | Load the page signed out | Five template cards. The catalogue is public on purpose — it is an acquisition surface. |
| 1.2 | Read the cards | Sales-ready Account Brief · Competitor Pricing Tracker · SEO / GEO / AEO Audit · Pre-Meeting Due Diligence Brief · Customer Proof Extractor |
| 1.3 | Confirm what is **absent** | **"Bulk ICP Account Enrichment" must NOT appear.** It ships as a `draft` because its durable runner is Phase 4. A template whose runner 404s is worse than an absent one. |
| 1.4 | Click each persona chip | The grid filters. Chips only appear for personas that actually have a template — no dead filters. |
| 1.5 | Click "All roles" | All five return. |
| 1.6 | Open DevTools → Network → `/api/templates` | The response must contain **no `prompt_bundle`**. Prompts are the product; the listing must not leak them. |
| 1.7 | Resize to 390px | Cards stack to one column; nothing overflows horizontally. |
| 1.8 | Toggle dark mode | Text stays legible; chips keep contrast (they use `--accent-contrast` on the solid fill, not `--accent-on-dark`). |

---

## 2. Templates — running one

Open **Sales-ready Account Brief**.

### 2.1 The form is generated, not hand-built

| # | Do this | Expect |
|---|---|---|
| 2.1.1 | Look at the form | "Company domain" (text, required, red `*`, placeholder `stripe.com`, help text) and "Outreach angle" (select, 3 options). Both come from the template's `input_schema` — nothing about this form is hard-coded. |
| 2.1.2 | Click **Run this template** with the domain empty | Inline error: **"Company domain is required"** — the *human label*, not the field name. No request is sent. |
| 2.1.3 | Look at the estimate line | **"8 credits — 1 × Workflow setup, 3 × Pages fetched, 2 × AI analysis"**. Itemised, and visible *before* you commit. |

### 2.2 Input normalisation

| # | Enter this | Expect |
|---|---|---|
| 2.2.1 | `https://WWW.Stripe.com/pricing` | The run's **Sources** section shows `https://stripe.com` — scheme, `www.` and path stripped. This normalised value is the `entity_key` that Phase 3 dedupes on and Phase 4 diffs across, so it has to be right here. |
| 2.2.2 | `not a domain` | "Company domain must be a valid domain". |
| 2.2.3 | `docs.stripe.com` | Accepted and kept **distinct** from `stripe.com` — a subdomain is genuinely a different site. |

### 2.3 The run

| # | Do this | Expect |
|---|---|---|
| 2.3.1 | Enter `stripe.com`, click Run | Progress bar: "Reading the page…" → "Structuring what we found…" → "Done". |
| 2.3.2 | Read the **Result** | A summary, an "Extracted facts" JSON block, and a **Sources** list with the URL and the timestamp it was read. |
| 2.3.3 | Read the line under the summary | **"Written by AI from the extracted facts below."** This is the fact-vs-interpretation boundary made visible. The summary is prose the model *wrote*; it is not a quotation from the page. |
| 2.3.4 | Check the Sources timestamps | Every source shows when it was fetched. PRD 1: *"Every generated output has source URLs and an extraction timestamp."* |
| 2.3.5 | **Time yourself** from `/templates` to a result | Should be **well under five minutes**, with zero prompt authoring. That is PRD 1's acceptance criterion. |

### 2.4 Failure must not bill you

| # | Do this | Expect |
|---|---|---|
| 2.4.1 | Run against a domain that cannot be fetched (e.g. `this-domain-does-not-exist-xyz123.com`) | A toast ending **"— no credits were used."** The first thing anyone wonders after an error is whether they were charged; say so unprompted. |
| 2.4.2 | Signed in: check the ledger | `select * from credit_ledger where run_id = '<the failed run>'` returns **zero rows**. |
| 2.4.3 | Check the run row | `select status, credits_actual from template_runs where id='…'` → `failed`, `0`. |

### 2.5 Guest vs signed-in

| # | Do this | Expect |
|---|---|---|
| 2.5.1 | Run a template **signed out** | It runs. A toast says *"Running as a guest — sign in to save this to your dashboard."* `template.run` is deliberately ungated: PRD 1 exists to get a new user to a first outcome, and a paywall there defeats the feature. |
| 2.5.2 | Signed out, click **Create shareable report** | The sign-up modal opens. Reports need an owner. |
| 2.5.3 | Sign in, run again | `select * from template_runs order by created_at desc limit 1` → your `user_id`, `status='complete'`, `credits_estimated=8`, and a **pinned `template_version`**. |

---

## 3. Reports — the sharing state machine

> Needs migration `0039`. Without it these all return 503.

Run any template while signed in, then click **Create shareable report**.

### 3.1 Private by default

| # | Do this | Expect |
|---|---|---|
| 3.1.1 | Read the dialog when it opens | **"Private"** is selected. |
| 3.1.2 | Check the database | `select slug, visibility from reports order by created_at desc limit 1` → **`slug` is NULL**, `visibility='private'`. A private report has no URL, so there is nothing to guess at. |
| 3.1.3 | Confirm no link is shown | The copy-link box only appears once you publish. |

### 3.2 Publish → the link works

| # | Do this | Expect |
|---|---|---|
| 3.2.1 | Choose **"Anyone with the link"** | A slug is minted; the link box appears. **Write the slug down** — you need it for 3.3. |
| 3.2.2 | Copy the link, open it in a **private/incognito window** | The report renders: title, source, summary, extracted facts, sources. No sign-in required. |
| 3.2.3 | View source → `<meta name="robots">` | **Exactly ONE tag**, and it says **`noindex`**. ⚠️ Two tags is the bug this shipped with and was fixed — if you see two, something regressed. |
| 3.2.4 | Look at the footer | **"Run this on another company"** → `/templates?key=account_brief`. That link *is* the acquisition loop. |
| 3.2.5 | Look for attribution | On a non-Business plan: **"Made with DatIQ"**. Enforced server-side at render, so a downgrade cannot leave an unbranded page live. |

### 3.3 Unpublish is reversible — decision D3

**This is the single most important behaviour in Phase 2.**

| # | Do this | Expect |
|---|---|---|
| 3.3.1 | In the dialog choose **Private** | Toast: *"Sharing stopped. Re-publish any time — the same link will work again."* |
| 3.3.2 | Reload the incognito link | **404 / "This report isn't available"** — reason `private`. |
| 3.3.3 | Check the database | `select slug from reports where id='…'` → **the slug is STILL THERE**. Unpublish keeps it. |
| 3.3.4 | Choose **"Anyone with the link"** again | The link box shows the **exact same slug**. |
| 3.3.5 | Reload the incognito link | **It works again.** This is D3: unpublish is the reversible "hide this for now" control, and re-publishing revives the link a colleague already holds. |

### 3.4 Revoke is terminal

| # | Do this | Expect |
|---|---|---|
| 3.4.1 | Click **"Revoke this link permanently"** | An inline confirmation appears — it does **not** revoke on the first click. |
| 3.4.2 | Read the confirmation | It must say revoking is permanent, cannot be restored *even by you*, and point you at **Private** if you only want to hide the report. Separating these two verbs is why users keep using the safe one. |
| 3.4.3 | Confirm | Toast: *"Link permanently revoked."* |
| 3.4.4 | Reload the incognito link | 404, reason `revoked`. |
| 3.4.5 | Reload **as the owner** | Still 404. A revoked report denies **everyone**, its owner included. |
| 3.4.6 | Re-open the share dialog | The options are replaced by a "This link was revoked" panel. There is no path back. |
| 3.4.7 | Check the database | The revoked row **keeps its slug** — that is precisely what stops it being reissued, because `slug` is `UNIQUE`. |
| 3.4.8 | Create and publish a **new** report | It gets a **different** slug. The burned one is never handed out again. |

### 3.5 The other visibilities

| # | Do this | Expect |
|---|---|---|
| 3.5.1 | Choose **"Specific people"**, add `colleague@example.com` | Toast confirms. Hint explains a forwarded link won't work for anyone else. |
| 3.5.2 | Open that link in incognito (signed out) | Denied — `not_granted`. Access is bound to the *account's own verified email*, not to holding the URL. |
| 3.5.3 | Choose **"Workspace only"** | A non-member is denied with `not_in_workspace`. |
| 3.5.4 | Choose **"Public"** | An amber warning appears about search engines and the gallery. The robots tag flips to **`index, follow`** — `public` is the only indexable state. |
| 3.5.5 | Navigate from a public report to `/pricing` | The robots tag returns to the site default. Leaving the whole SPA noindexed would be a serious SEO regression. |

### 3.6 Existing shared reports must not break

| # | Do this | Expect |
|---|---|---|
| 3.6.1 | Find a pre-existing `/p/<slug>` link from before this change | It still works. |
| 3.6.2 | Check the migration result | `select visibility, count(*) from reports group by 1` → previously-shared rows are **`link`**, curated gallery rows are **`public`**. |
| 3.6.3 | Load `/gallery` | Unchanged. |

> **Why `link` and not `private`:** every one of those rows exists *because a user
> pressed Share*. Sending them to `private` would silently break links already in
> third parties' hands.

---

## 4. Credits — the ledger

> Needs migration `0037`.

| # | Do this | Expect |
|---|---|---|
| 4.1 | Run a template, then `select * from credit_ledger where run_id='…'` | **A few rows, not dozens** — events collapse to one row per (reason, unit). The ledger is an audit trail, not a firehose. |
| 4.2 | Compare estimate vs actual | `select credits_estimated, credits_actual from template_runs where id='…'`. They should be close. Both survive independently so drift stays measurable — a template whose estimate is routinely half its actual is mispriced. |
| 4.3 | Try to edit the ledger: `update credit_ledger set credits=999 where id='…'` | **Refused**: *"credit_ledger is append-only — record a compensating entry…"*. A ledger you can UPDATE is not a ledger. |
| 4.4 | Try `delete from credit_ledger where id='…'` | Refused the same way. |
| 4.5 | Check the balance is derived | `select credit_balance('<user-uuid>', to_char(now(),'YYYY-MM'));` — computed from the rows, never stored. |
| 4.6 | Re-run the **same** URL immediately | The second run should charge **less** (cache hit) or nothing for the fetch. You are never billed for a page we did not read. |

---

## 5. Entitlements

| Plan | `template.run` | `template.duplicate` | `report.share` | `report.branding` |
|---|---|---|---|---|
| Free | ✅ | ❌ | ✅ | ❌ |
| Go / Select / Pro | ✅ | ✅ | ✅ | ❌ |
| Business / Agency | ✅ | ✅ | ✅ | ✅ |

| # | Do this | Expect |
|---|---|---|
| 5.1 | On a Free plan, run a template | Allowed. Deliberate — see 2.5.1. |
| 5.2 | On a Free plan, publish a report | Allowed. PRD 2's acquisition loop *is* a free user sharing with someone who then signs up. Gating it would be charging for our own distribution. |
| 5.3 | On a Free plan, check a shared report's footer | Carries "Made with DatIQ". |
| 5.4 | Hand-build a `POST /api/reports` with `{"action":"create","title":"x","branding":{"companyName":"Sneaky"}}` on a Free plan | The report is created, but **`branding` is `{}`** in the database. The Brand Kit lives in localStorage so the client must send it — which is exactly why the server re-validates it. Note it is **silently dropped, not an error**: failing the whole publish over branding would block a legitimate share. |

---

## 6. Running it locally

Full stack (real functions, needs Supabase env):

```bash
nvm use 24 && netlify dev
```

UI-only, no keys and no network — enough for §1–§3 mechanics:

```bash
nvm use 24 && npm run dev -- --port 5180
```

⚠️ With plain `npm run dev`, `/api/*` is proxied to **port 9999** and **rewritten
to `/.netlify/functions/*`**. A stub must match the *rewritten* path, not
`/api/…`. (A working stub used during development is described in the PR
discussion.) Without a stub, `/templates` shows *"Couldn't load templates"* —
expected, not a bug.

---

## 7. Automated coverage — what you do **not** need to re-test by hand

| Suite | Result |
|---|---|
| Unit | **2566** passed |
| Contract (`netlify/`) | **1753** passed (+14 skipped) |
| Integration | **405** passed |
| System | **8** passed |
| Database (`npm run test:db`) | **39 migrations · 340 assertions** |
| Build · `check:prerender` · security | clean |

The state machine in §3 is pinned by **68 new database assertions**, including
the D3 slug-reuse rule and the terminal-revoke rule. The robots-tag behaviour in
3.2.3 is pinned by three regression tests **confirmed to fail against the
pre-fix code**.

Re-run everything with:

```bash
nvm use 24 && npm run test:all
```

---

## 8. Known gaps in this drop — not bugs

| Gap | Why |
|---|---|
| **Bulk ICP Enrichment is a draft** | Its durable runner is Phase 4 (§1.3a of the plan). Deliberately not offered. |
| **Runs are orchestrated client-side** | A synchronous Netlify function is killed at 10s; a run is 2–4 scrapes plus 1–2 AI calls. Closing the tab mid-run abandons it. Phase 4 introduces the durable server runner. |
| **No PDF/CSV export of a report yet** | PRD 2 lists it as "Later if not already supported". The existing export pipeline is not yet wired to the new `reports` table. |
| **Report engagement analytics are recorded but not surfaced** | `report_access_log` fills correctly; there is no UI reading it yet. |
| **No `/reports` management screen** | `GET /api/reports` returns your reports; the list UI is a follow-up. Sharing is driven from the run screen. |
| **Templates cannot be duplicated in the UI** | The `template.duplicate` entitlement exists and is gated; the fork UI is a follow-up. |

---

## 9. If something looks wrong

| Symptom | Most likely cause |
|---|---|
| `/templates` says "Couldn't load templates" | No stub/functions locally (§6), or `SUPABASE_SERVICE_KEY` unset. |
| Catalogue renders but publishing 503s | Migration `0039` not applied (§0.1). |
| A report link 404s unexpectedly | Check `visibility` — `private` after an unpublish is correct (3.3.2). |
| **Two** robots meta tags | A real regression. See 3.2.3 and `src/pages/Report.integration.test.jsx`. |
| Everything 401s | On `staging.datiq.app` that is the Edge Access gate, by design (§0.2). |
| Whole test suite red on first run | Node version. This project pins `>=24 <25`; the shell default here is v26. `nvm use 24` **in the same command**. |
