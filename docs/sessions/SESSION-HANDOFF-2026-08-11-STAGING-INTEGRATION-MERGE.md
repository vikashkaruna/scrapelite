# Session Handoff — 2026-08-11 ~05:00 IST — Integration-with-outside-ecosystem merged to staging

> **For the next agent (or future-me in a fresh session):** the V1.0+
> Integrations release is now LIVE on staging. Production (`main` @
> `ebaa4bf`) is untouched. The next step is a production promotion once
> the staging smoke has held for at least one business day.

## 1. TL;DR

- **Branch:** `staging` (HEAD `beacca3`, in sync with `origin/staging`)
- **Branch deploy URL:** `https://integration-with-outside-ecosystem--datiqapp.netlify.app` (still live, all late-night integration fixes + Account rich status + ExportIntegrations one-click refactor)
- **Staging URL:** `https://staging--datiqapp.netlify.app` (rebuild triggered on the push, confirmed live with the new bundle `index-h0wsHMgg.js` at handoff time)
- **Production:** `https://datiq.app` — **untouched** (still on `main` @ `ebaa4bf`, bundle `index-ClmxOVpE.js`, last changelog entry 2026-08-09)
- **Last redeploy trigger:** `beacca3`
- **Single remaining operator action:** still `add /api/* to Netlify Edge Access bypass` (carried from the late-night handoff)
- **DB state:** all 21 migrations apply cleanly under `npm run test:db` (PGlite + pgcrypto stub). The real Supabase project has not yet been promoted to take 0019-0021 — the app continues to use the v1 `extractions` columns only and degrades gracefully (see the existing late-night handoff for the ALTER).

## 2. What this session did

| # | Commit | What it does |
|---|---|---|
| 1 | `f5afca8` | **db-verify fix.** PGlite (WASM Postgres) does not ship the `pgcrypto` extension, so `create extension pgcrypto` failed before 0019_api_keys.sql could apply. The migration only needs `gen_random_uuid()`, which PGlite provides natively (Postgres 13+). The script now strips the `create extension` line at test time (the real Supabase project keeps it). Bumped `EXPECT` tables 29→33, functions 10→11 to account for the three new migrations. Unblocks `npm run test:all` and the staging gate. |
| 2 | `127ad8a` | **Public + internal doc sweep.** No product code; everything here is customer-facing collateral or a public mirror of the integration state. See §3 below. |
| 3 | `beacca3` | **Merge commit (no-ff).** Brings 59 commits' worth of integration work from `Integration-with-outside-ecosystem` into `staging`. main is still at `ebaa4bf`. |

## 3. The public doc sweep (commit `127ad8a`)

**What changed (14 files, +192/−37):**

- `docs/DatIQ-User-Guide.md` §10 + regenerated `public/help/10-exports-and-sharing.html` — new **"Push to your tools (HubSpot, Airtable, Notion, Slack, Zapier)"** subsection with a destination table and the Test/Edit/Disconnect flow
- `public/changelog/index.html` — new **V1.0+ (2026-08-11)** release block for the integrations overhaul, plus an **"Integrations & sharing"** group in "What's in V1.0" replacing the stale "Webhook push" line
- `public/blog/index.html` + `src/pages/Blog.jsx` — new **"One-Click Push to HubSpot, Airtable, Notion, Slack, and Zapier"** release post (with `BlogPosting` JSON-LD)
- `src/pages/Changelog.jsx` — refreshed the **"Integrations & sharing"** feature group and the 2026-08 update banner
- `public/llms.txt` + `public/llms-full.txt` — refreshed the integrations list (HubSpot, Airtable, Notion, Slack, Zapier) and added a "server-stored connections" line. Plan table mentions all five destinations on Business + Agency
- `public/pricing/index.html` — the **"HubSpot / Salesforce sync"** row in the plan matrix was replaced with **"HubSpot / Airtable / Notion / Slack / Zapier"** to match reality
- `public/use-cases/lead-generation/index.html` + `public/use-cases/competitor-research/index.html` + `public/what-is-datiq/index.html` — replaced "HubSpot or Salesforce" phrasing with the full five-destination list
- `AGENTS.md` — refreshed quick orientation, branch state, handoff pointer, and operator-action items
- `docs/internal/DatIQ-Product-Documentation-Internal.md` — bumped the "Last updated" and "Documented version" lines to reflect the staging promotion. Full screen-by-screen refresh is the next internal pass.

**Confidentiality boundary preserved (audit PASS):**
- No admin routes, no PIN/HMAC mechanics, no schema details, no internal email addresses on any public surface
- The `/vs/clay` page keeps the "HubSpot or Salesforce" line because that's a **competitor feature claim** (Clay's two-way sync), not a DatIQ claim
- The "Introducing DatIQ" blog post from 2026-06-09 keeps its original "HubSpot / Salesforce" line because it's a historical launch announcement

**Audit (post-sweep):** 5 pass / 2 warn / 0 fail. Both warns are pre-existing:
- Screenshot staleness (regenerate with `node docs/capture-screenshots.mjs` next time a customer-facing visual ships)
- Gallery / persona coverage (runtime-populated, can't prove from source)

## 4. Test results on staging (all green)

| Suite | Result | Notes |
|---|---|---|
| Audit (`scripts/audit.mjs`) | **5 pass / 2 warn / 0 fail** | both warns pre-existing |
| Unit (`test:unit`) | **107 files / 1720 passed** | +9 from prior handoff (db-verify mock now matches real code) |
| Contract (`test:contract`) | **57 files / 916 passed + 14 skipped** | unchanged |
| Integration (`test:integration`) | **40 files / 281 passed** | unchanged |
| System (`test:system`) | **5 files / 7 passed** | unchanged |
| DB verify (`test:db`) | **21 migrations / 105 assertions / 0 failed** | +3 migrations, +4 assertions vs. the previous handoff's 18/101 |
| Security (`test:security`) | clean | unchanged |
| Build (`build`) | clean (~770ms) | unchanged |
| E2E smoke (`test:e2e:smoke`) | **114 passed + 1 skipped (1.3m)** | the 1 skip is the deliberately CSS-hidden Pillar-0 banner, expected |
| E2E a11y (`test:e2e:a11y`) | **24 passed (41.4s)** | runs all three browsers (chromium + firefox + webkit) |

**Total: 2,978 tests + 14 skipped / 0 failed** across every suite that runs in CI.

## 5. Live verification (just before handoff)

```
$ curl -s https://datiq.app/changelog/index.html | grep 2026-08-11
(no output — production still on 2026-08-09 ✓)

$ curl -s https://staging--datiqapp.netlify.app/changelog/index.html | grep -E "One-Click|2026-08-11"
2026-08-11
2026-08-11
One-Click     ← new V1.0+ release block is live

$ curl -s https://staging--datiqapp.netlify.app/blog/index.html | grep -iE "one-click"
One-Click
one-click
one-click    ← new blog post is live

$ curl -s https://staging--datiqapp.netlify.app/help/10-exports-and-sharing.html | grep -E "HubSpot|Airtable|Notion|Slack|Zapier"
HubSpot
Airtable
Notion
Slack
Zapier     ← new "Push to your tools" section is live

$ curl -s https://staging--datiqapp.netlify.app/llms.txt | grep -E "HubSpot|Airtable|Notion|Slack|Zapier" | wc -l
6    ← all five destinations + "Integrations" header line

$ curl -s https://datiq.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-ClmxOVpE.js    ← production still on the old bundle ✓

$ curl -s https://staging--datiqapp.netlify.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-h0wsHMgg.js    ← staging on the new bundle ✓
```

## 6. What is NOT on this branch yet

- **Migrations 0019 / 0020 / 0021** are now in the supabase/migrations folder and apply cleanly under `npm run test:db`, but the **real Supabase project has not been promoted** to take them. The app continues to work with the v1 `extractions` columns only and degrades gracefully (see the late-night handoff for the ALTER SQL and the DB-MIGRATION-RUNBOOK.md for the manual apply steps). Promoting to prod Supabase is a separate operator action and was deliberately not done in this session.
- **The browser extension** (Chrome + Firefox + Edge, Manifest v3) — still on the v2.0 backlog, multi-week project
- **Stripe re-enable** (R6 deferred) — see `docs/STRIPE-DEFERRAL.md`
- **Recurring subscription billing** (Razorpay/Stripe Subscriptions) — see `docs/RECURRING-BILLING-DEFERRAL.md`
- **Screenshot regeneration** — the audit's pre-existing "stale screenshot" warn was not addressed in this session because no new customer-facing visuals shipped; the doc sweep was text-only. Regenerate with `node docs/capture-screenshots.mjs` when the next visual lands.

## 7. What the next session should do

1. **Verify staging held overnight** — re-run `npm run test:all` on `staging` after at least 12 hours of production traffic against the new bundle, and confirm no new Sentry / monitoring alerts (see `docs/OPS-MONITORING-RUNBOOK.md` for the alert-routing reference).
2. **Apply 0019-0021 to the production Supabase project** following `docs/DB-MIGRATION-RUNBOOK.md`. The audit script still passes without these because the app's v1 path is fully exercised; but the new `api_keys`, `integration_connections`, and `zapier_events` tables are needed for the new endpoints to function. Do this on a low-traffic window, in the same change window as the production promotion.
3. **Promote staging → main** (production). This is the V1.0+ Integrations GA. Requires the two-human-act unlock in the Netlify UI (see the late-night handoff for the walkthrough). The phase-gate smoke will then validate the live bundle.
4. **Close out the v2.0 backlog** — the integration work was the last big deferred item. The remaining items (browser extension, recurring billing, Stripe re-enable) are all explicitly out of this release's scope.
5. **(Still from prior sessions)** Add `/api/*` to the Netlify Edge Access bypass list. Until this is done, in-browser Connect/Push calls hit the SSO gate on the branch preview, which makes demoing the new flow to anyone outside your account awkward.

## 8. Memory worth keeping (agent-level)

- **PGlite does not ship pgcrypto** but it provides `gen_random_uuid()` natively (Postgres 13+). For any new migration that does `create extension pgcrypto` purely to get `gen_random_uuid()`, the `scripts/db-verify.mjs` shim now strips the `create extension` line at test time. The real Supabase project keeps the line. If a future migration actually needs `digest`, `crypt`, or `hmac` from pgcrypto, the shim has to be extended (or the test pattern rethought).
- **The `npm run test:all` gate hard-fails on `npm run test:db`** if any migration fails to apply, even if PGlite is the only environment affected. The `EXPECT` object at the top of `scripts/db-verify.mjs` must be updated to match the running migration set (currently 33 tables, 11 functions, 2 triggers, 0 tablesWithoutRls). A mismatch is a hard failure, by design — a future migration added or renamed without updating this file is exactly the kind of thing the gate should catch.
- **The V1.0+ "Integrations & sharing" feature group on `/changelog` (the React page, not the static HTML) and the matching block in `public/changelog/index.html` are now in sync.** Future integrations should update both, in the same commit, to avoid the drift the audit used to flag.
- **The static `public/blog/index.html` and the React `src/pages/Blog.jsx` POSTS array are TWO separate data sources** for the blog. They need to be updated together. The audit doesn't currently catch a drift between them; if the next blog post only updates one, expect a one-line copy discrepancy between the public-marketing version and the in-app version. A future improvement would be to drive both from a single `docs/Blog.jsx`-style source file, but that's a refactor for another session.
- **Netlify staging rebuild on a push to `staging` is observable in ~30-60 seconds on this machine** — bundle hash changes, all five integration names appear in the static surfaces. Worth waiting a beat before claiming a push "didn't take" if the bundle hash is still the old one.

## 9. Operator action items

1. **Watch the staging smoke for 24-48 hours.** If anything red shows up, the rollback path is: `git revert -m 1 beacca3` (or `git push origin :staging` to force-push the old `df43565` back). The `pre-integration-merge` safety tag at `ebaa4bf` is the main's pre-merge HEAD, not the staging rollback point — for staging, the rollback point is the previous `origin/staging` HEAD `df43565`.
2. **Apply the Supabase migrations 0019-0021 to production** on a low-traffic window, following `docs/DB-MIGRATION-RUNBOOK.md`. Required for the new endpoints to function.
3. **Promote staging → main** when ready (V1.0+ Integrations GA).
4. **(Still from prior sessions)** Add `/api/*` to the Netlify Edge Access bypass list.
