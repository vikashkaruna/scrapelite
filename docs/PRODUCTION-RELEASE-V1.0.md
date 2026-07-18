# DatIQ v1.0 — Production Release Checklist

> **Audience:** release ops, on-call engineers, anyone cutting the v1.0 release.
> **Status:** branch `V1.0-Release-Candidate` is ready (built on `main` at `911d4a9`).
> **Date prepared:** 2026-07-18.
>
> This document is the single source of truth for shipping DatIQ v1.0 to production
> (`datiq.app`). Walk every section top to bottom; tick each item before you
> move to the next.

---

## 0. Pre-flight: confirm the release is green

Before any production work, confirm the build is clean and tests pass on the release branch.

```bash
git checkout V1.0-Release-Candidate
git pull origin V1.0-Release-Candidate

# Local verification
npm install
npm run test:all
```

Expected:

- `vitest run` — **1297 / 1297** tests pass in ~14 s.
- `vite build` — clean in ~2 s.
- `playwright test e2e/smoke` — **294 / 294** tests pass (chromium + firefox + webkit) in ~2.5 m.
- `playwright test` (full) — **390 / 390** tests pass in ~3.5 m.
- `node scripts/security-check.mjs` — `[security-check] M0 stub passed`.

If any of these fail, **STOP** and fix before proceeding. The release branch must be
green-on-green at every commit before you cut a release.

---

## 1. Supabase production database

### 1.1 Pick / confirm the project

- Project: `datiqapp` (datiq.app)
- Region: pick the closest to your user base; defaults are usually fine.
- Plan: Free for staging; Pro for production. Storage grows with extractions; auth users
  count toward MAU.

### 1.2 Run the migrations

The canonical migration set is in `supabase/migrations/`. The single-file orchestrator
is `supabase/migrations/run-all.sql` — paste it into the SQL Editor and click **Run**.

```sql
-- Verify after the run (16 rows expected, 14 of which are new in v1.0):
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in (
     'extractions', 'usage_records', 'usage_alerts',
     'subscriptions', 'payment_events',
     'pricing_config', 'coupon_redemptions', 'coupon_counters',
     'app_config', 'scheduled_tasks',
     'analytics_events', 'public_reports', 'summary_feedback',
     'extraction_cache', 'rate_limit_log', 'reengagement_log'
   )
 order by table_name;
```

The final `NOTIFY pgrst, 'reload schema'` line in the orchestrator tells PostgREST to
refresh its schema cache so the new tables and the `redeem_coupon` RPC are immediately
visible to the API. If you see 404s on a new table anyway, run it manually.

See `supabase/README.md` for the full per-migration explanation.

### 1.3 Auth configuration

- **Site URL:** `https://datiq.app`
- **Additional redirect URLs:**
  - `https://datiq.app/**`
  - `https://datiqapp.netlify.app/**` (the legacy redirect target)
- **Email templates:** customize "Confirm signup", "Magic link", and "Reset password" with
  DatIQ branding (logo, colours, copy).
- **Providers to enable:**
  - Google (OAuth)
  - Microsoft (Azure)
  - GitHub
  For each: configure the OAuth client with the callback URL
  `https://<project-ref>.supabase.co/auth/v1/callback`.

### 1.4 Storage (if used for shareable images)

- Public bucket `datiq-share-og` for OG images (optional; static OG works as a fallback).
- RLS: anon read OK, writes only via service key.

### 1.5 Extensions

- Enable `pg_cron` (if not already) — the future 30-day auto-delete schedule will use it.

---

## 2. Netlify site configuration

### 2.1 Site basics

- **Site ID:** `0ac65a7e-bd3f-4cde-a8d3-66c23899c473`
- **Project name:** `datiqapp` (the old `scrapelite` is renamed)
- **Production branch:** `main` (NOT `V1.0-Release-Candidate` — see §3 for the merge order)
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions` (auto-detected; do not override)

### 2.2 Environment variables

The full authoritative list is in `CLAUDE.md`; this section is the production checklist
with the exact values you need.

#### 2.2.1 Supabase

| Variable | Side | Value | Required? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | browser (build-time) | `https://<project-ref>.supabase.co` | Required for auth + cloud |
| `VITE_SUPABASE_ANON_KEY` | browser (build-time) | `eyJhbGciOi...` (anon key) | Required for auth + cloud |
| `SUPABASE_URL` | server (runtime) | same value as `VITE_SUPABASE_URL` | Required for stats + scheduler |
| `SUPABASE_SERVICE_KEY` | server (runtime) | `eyJhbGciOi...` (service role) | Required for admin + payment webhooks |

After setting the two `VITE_` ones, trigger a rebuild — they are baked into the JS bundle.

#### 2.2.2 AI providers (server-only)

Set at least one. The chain order defaults to `gemini,anthropic,openai`.

| Variable | Value | Cost-first choice |
|---|---|---|
| `GEMINI_API_KEY` | `AIza...` | Primary — cheapest, fastest for short extraction prompts |
| `AI_API_KEY` | `sk-ant-...` (Anthropic) | Fallback — best quality |
| `OPENAI_API_KEY` | `sk-...` | Last resort — slower, more expensive |
| `AI_PROVIDER_ORDER` | `gemini,anthropic,openai` | Optional override of the chain order |
| `AI_MAX_TOKENS` | `1024` | Optional per-request budget |

#### 2.2.3 Scrape providers (server-only)

At least one chain entry. Direct fetch always works without a key.

| Variable | Value | Notes |
|---|---|---|
| `FIRECRAWL_API_KEY` | `fc-...` | Primary — best HTML fidelity |
| `SPIDER_API_KEY` | `...` | Optional fallback |
| `JINA_API_KEY` | `...` | Optional fallback (works without key too) |
| `VITE_FIRECRAWL_API_KEY` | `fc-...` | Browser-side (only used in pure SPA mode) |
| `VITE_ENABLE_EXTRACT` | `true` | Build-time flag — enables real extraction in browser without a Firecrawl key |
| `SCRAPE_PROVIDER_ORDER` | `firecrawl,spider,jina,direct` | Optional override of the chain order |

#### 2.2.4 Payments — Razorpay (INR)

| Variable | Side | Value |
|---|---|---|
| `VITE_RAZORPAY_KEY_ID` | browser (build-time) | `rzp_live_...` |
| `RAZORPAY_KEY_ID` | server (runtime) | same as above |
| `RAZORPAY_KEY_SECRET` | server (runtime) | your key secret |
| `RAZORPAY_WEBHOOK_SECRET` | server (runtime) | webhook secret from Razorpay dashboard |

⚠️  After setting `VITE_RAZORPAY_KEY_ID`, trigger a **full rebuild** (Deploys → Trigger
deploy → Clear cache and deploy) — it's baked into the JS bundle at build time.

#### 2.2.5 Payments — Stripe (USD) — **deferred to v2.0**

Code paths are preserved (55 contract tests) but disabled in v1.0. See
`docs/STRIPE-DEFERRAL.md` for the re-enable runbook.

#### 2.2.6 Email & webhooks

| Variable | Side | Value |
|---|---|---|
| `RESEND_API_KEY` | server | `re_...` |
| `ALERT_EMAIL_FROM` | server | `DatIQ Alerts <alerts@datiq.app>` (the domain must be verified in Resend) |
| `VITE_WEBHOOK_URL` | browser (build-time) | n8n webhook URL for save / share notifications |
| `SCHEDULE_ALERT_WEBHOOK` | server | optional — separate n8n webhook for schedule alerts |

#### 2.2.7 Admin

| Variable | Side | Value |
|---|---|---|
| `ADMIN_PIN_HASH` | server (runtime) | SHA-256 hex of a strong PIN. Generate with: `printf '%s' 'your-strong-pin' \| shasum -a 256` |
| `ADMIN_TOKEN_SECRET` | server (runtime) | random string — defaults to `ADMIN_PIN_HASH` if unset |

⚠️  **Do NOT set both** `ADMIN_PIN` (plaintext) **and** `ADMIN_PIN_HASH` — prefer the
hashed form. Until `ADMIN_PIN_HASH` is set, `/admin` accepts the demo PIN `ADMIN123`
(do not ship this state to production).

#### 2.2.8 Other

| Variable | Side | Value |
|---|---|---|
| `VITE_LINK_CHANGELOG` | browser (build-time) | optional — footer link |
| `VITE_LINK_ABOUT` | browser (build-time) | optional |
| `VITE_LINK_BLOG` | browser (build-time) | optional |
| `VITE_PAYMENT_PROVIDER` | browser (build-time) | `auto` (default) \| `stripe` \| `razorpay` |

### 2.3 Build & deploy settings

- **Node version:** 20.x (set in Netlify env: `NODE_VERSION=20`)
- **Build cache:** enabled (the second build is much faster)
- **Auto-deploy:** enabled, on push to `main`
- **Branch deploys:** optional — enable for `V1.0-Release-Candidate` to smoke-test before
  merging
- **Deploy notifications:** set up Slack / email notifications for production deploys
- **Function region:** pick the region closest to Supabase

### 2.4 Webhooks

Register the Razorpay webhook:

1. Razorpay Dashboard → Settings → Webhooks → **Add new webhook**
2. URL: `https://datiq.app/.netlify/functions/payment-webhook?provider=razorpay`
3. Active events: `payment.captured`, `payment.failed`, `subscription.activated`,
   `subscription.cancelled`, `subscription.completed`
4. Copy the **webhook secret** → add to Netlify env as `RAZORPAY_WEBHOOK_SECRET`

### 2.5 Razorpay settings

- **Auto-capture:** enabled (Payments → Settings → Payment Capture = Automatic).
  The code also explicitly captures any `authorized` payment, so the duplicate is a
  belt-and-suspenders.

### 2.6 Domain & DNS

- Apex `datiq.app` and `www.datiq.app` both point to the Netlify load balancer.
- HTTPS only — Netlify auto-provisions Let's Encrypt.
- The legacy `scrapelite.netlify.app` host now 404s; redirect it to `datiq.app`.

---

## 3. Release deployment

### 3.1 Merge order

The V1.0-Release-Candidate branch contains everything that was approved. To ship:

```bash
# 1. Confirm V1.0-Release-Candidate is the latest and clean.
git checkout V1.0-Release-Candidate
git pull origin V1.0-Release-Candidate
npm run test:all  # last sanity check

# 2. Tag the release on the release-candidate branch.
git tag v1.0.0 -m "DatIQ v1.0 — Production release"

# 3. Merge to main with --no-ff for a clean audit trail.
git checkout main
git pull origin main
git merge --no-ff V1.0-Release-Candidate -m "Merge V1.0-Release-Candidate into main (v1.0.0)"
git push origin main --follow-tags

# 4. Delete the release-candidate branch (it has done its job).
git push origin --delete V1.0-Release-Candidate
git branch -d V1.0-Release-Candidate
```

### 3.2 Trigger a production deploy

If auto-deploy is on, the push to `main` triggers a build. Otherwise:

- Netlify dashboard → Deploys → **Trigger deploy** → **Clear cache and deploy** (the
  `VITE_` env vars may have changed since the last build, so clearing the cache is
  the safe move).

Watch the build log. The build should finish in ~2 minutes. If it fails, see §6.

### 3.3 Verify the deploy

Once the build is "Published":

- `https://datiq.app/` — loads, shows the home composer
- `https://datiq.app/dashboard` — loads
- `https://datiq.app/pricing` — loads, shows 7 plan cards
- `https://datiq.app/help/index.html` — static help site
- `https://datiq.app/.netlify/functions/stats` — returns JSON (the stats endpoint)

---

## 4. Smoke test (run within 30 minutes of deploy)

This is a human-eyes-on check. Walk through it in order.

### 4.1 Public surface

- [ ] Home loads. Composer is visible. Outcome tiles row appears below the box.
- [ ] Click an outcome tile → URL pre-fills, intent chip activates.
- [ ] Trust strip (3 pills) is visible below the composer.
- [ ] Pricing page loads. 7 plan cards (Free, Select, Pro, Business, Agency, Developer
      "Coming soon", Enterprise). Annual is the default toggle. Plan comparison matrix
      is visible below the cards.
- [ ] Toggle Monthly → prices update. Toggle Annual → prices update + "Save 20%" badge.
- [ ] Integrations page → 13 cards (5 live + 6 coming-soon + 1 agency + 1 roadmap).
- [ ] Blog page → 7 post cards, newsletter form.
- [ ] About page → founder block visible.
- [ ] Privacy / Terms → DPDP / Indian arbitration sections present.
- [ ] Footer → 3 socials + copyright + Privacy / Terms links.

### 4.2 Extraction flow

- [ ] Sign in with email (magic link) → land on Home.
- [ ] Paste a URL → click Extract → Preview loads with the page results.
- [ ] Preview shows title, URL, headings, links, AI summary.
- [ ] Quick enrichment card → click "Find contacts" → contacts tab appears.
- [ ] Click "Generate content" → ContentModal opens with 3 formats.
- [ ] Choose SEO blog outline → result appears, copy button works.
- [ ] Feedback widget (thumbs up/down) on the AI summary → toast confirms.
- [ ] "View Dashboard" → Dashboard shows the extraction in the list.

### 4.3 Batch

- [ ] Navigate to /batch via the top nav.
- [ ] Paste 3 URLs → URL review table shows 3 rows.
- [ ] Click Extract → progress bar appears.
- [ ] On completion, results table shows all 3 pages with status, snippet, View button.
- [ ] Click Export ▾ → CSV / PDF / Markdown / JSON options visible.
- [ ] "View in Dashboard →" → Dashboard now shows the 3 batched items grouped under a
      parent row with a "Batch" tag chip.

### 4.4 Schedule

- [ ] Navigate to /schedules → list is empty initially.
- [ ] Click "New schedule" → inline editor opens.
- [ ] Fill URL, name, select Daily cadence, add alert email.
- [ ] Click "Create schedule" → schedule appears in list.
- [ ] Click Run now → toasts "Running" → toasts "Unchanged" (or "Changed" with a
      side-by-side diff if the page actually changed).

### 4.5 Sharing

- [ ] On a saved extraction, click Share → public link appears, e.g.
      `https://datiq.app/p/a8K2mQ4x`.
- [ ] Open the link in a private/incognito window → the report renders.
- [ ] Visit /gallery → the extraction appears in the list.

### 4.6 Payments

- [ ] /pricing → click "Get Pro" → PaymentConfirmModal shows base + 18% GST + total.
- [ ] Click "Confirm & Pay" → Razorpay modal opens.
- [ ] In test mode, complete a test payment → modal closes, plan upgrades, redirects
      to /account.
- [ ] /account → "Plan: Pro" pill is visible, "Active until" date is 1 year out.
- [ ] Check /admin/revenue → MRR includes the test payment.

### 4.7 Admin

- [ ] Visit /admin → PIN gate → enter the configured `ADMIN_PIN` (NOT `ADMIN123`).
- [ ] Revenue → KPIs show real numbers (if you've made a test payment).
- [ ] Users → your test user is in the list with the assigned Pro plan + plan period.
- [ ] Pricing → USD + INR fields editable, "Save" persists.
- [ ] Coupons → can create a new coupon, can assign it to a user.
- [ ] AI → provider chain editor shows the configured order.
- [ ] General → global settings editor shows 4 fields.

### 4.8 Keyboard shortcuts & mod+K

- [ ] Press `?` → hotkey help modal opens with the full list.
- [ ] Press `mod+k` → command palette opens. Type "Dashboard" → Enter → lands on
      /dashboard.
- [ ] Press `g` then `d` → goes to /dashboard.
- [ ] Press `Esc` → closes any open modal.

### 4.9 Guest trial gating

- [ ] Sign out.
- [ ] Extract 3 times as a guest → soft prompt appears after the 3rd.
- [ ] Dismiss with "Continue as guest" → can extract again.
- [ ] Extract 7 more times (10 total) → hard block modal appears, no dismiss button,
      no backdrop click, no Escape. Only "Create free account" or "Sign in" works.
- [ ] Sign in → hard block clears.

---

## 5. Production monitoring (week 1)

### 5.1 Netlify

- **Function logs** — Netlify dashboard → Functions → Logs. Watch for 5xx and
  unhandled rejections.
- **Deploy notifications** — Slack/email should fire on every production deploy.
- **Build minutes** — should stay well under the plan limit.

### 5.2 Supabase

- **Logs** — Supabase → Logs → Postgres. Watch for `permission denied for table X`
  (RLS policy gap) and `relation X does not exist` (migration skipped).
- **API health** — Supabase → Settings → API. Check request rate + error rate.
- **Auth** — Supabase → Auth → Users. Watch for sign-up failures or rate-limit hits.

### 5.3 Razorpay

- **Payments dashboard** — watch the live feed for failures.
- **Webhook logs** — Razorpay → Webhooks. Every event should return 200.
- **Refunds** — should be zero in week 1 unless you're testing.

### 5.4 Resend

- **Dashboard** — watch delivery rate, bounce rate, spam reports.
- **Domain verification** — alerts@datiq.app must stay verified (DNS records).

### 5.5 DatIQ admin pages

- **/admin/revenue** — MRR matches Razorpay; total users matches Supabase Auth.
- **/admin/users** — new sign-ups appear within a minute.
- **/admin/ai** — no provider error spikes in the chain.

### 5.6 Error budget

- Week 1: < 0.1 % of API requests return 5xx
- Week 1: 0 hard-block bugs in the guest trial flow
- Week 1: 0 payment reconciliation mismatches

---

## 6. Rollback

If a critical issue is found within the first 24 hours, the rollback is the same code
path as any other deploy:

```bash
# Option A — roll back to the previous tag
git checkout main
git revert -m 1 <merge-commit>   # if merged via PR
git push origin main

# Option B — point the production deploy to the previous commit
# Netlify dashboard → Deploys → click the previous successful deploy → "Publish deploy"
```

The Postgres migrations are **forward-only** — they do not break the app code if you
roll back. The new tables simply go unused. If a table causes a problem (extremely
unlikely), drop it:

```sql
DROP TABLE public.<offending_table> CASCADE;
NOTIFY pgrst, 'reload schema';
```

For destructive teardown of every v1.0 migration, see `supabase/migrations/rollback.sql`
(test databases only — never on prod without a `pg_dump` first).

---

## 7. Pending v2.0 work (do NOT block the v1.0 release)

These are documented but intentionally deferred. The release is not blocked by any
of them; they are listed here so post-release work is captured.

- **Stripe USD payments** — see `docs/STRIPE-DEFERRAL.md`. Code is preserved (55
  contract tests), disabled in v1.0.
- **Razorpay / Stripe recurring subscriptions** — see `docs/RECURRING-BILLING-DEFERRAL.md`.
  v1.0 ships one-time Orders only.
- **30-day auto-delete cron** — the trust-strip says "Auto-deleted in 30 days" but
  the pg_cron schedule is v2.0 work. Until then, the promise is honest (data IS
  erasable on request via /account) but not automatic.
- **Q4 tour opt-in** — currently auto-fires for first-time visitors. Consider a
  manual trigger button (e.g. on the empty Dashboard) for v1.1 to avoid the "modal
  blocks the page" first impression.
- **Cross-device Supabase session sync** — sessions are still per-device today.
- **Browser extension (Chrome / Firefox / Edge)** — multi-week; not in v1.0 scope.
- **Referral / affiliate program** — UI teaser is live on /pricing, backend is v2.0.
- **`/blog/:slug` SEO routing** — currently in-page modal only.

---

## 8. Post-release cleanup (day 2-7)

- [ ] Update `CHANGELOG.md` with the v1.0 release entry (date, headline, test counts).
- [ ] Publish the release notes using `docs/internal/V1.0-RELEASE-CANDIDATE.md` as the
      source.
- [ ] Send the v1.0 launch email to the existing waitlist.
- [ ] Pin a launch announcement in the blog and on socials.
- [ ] Open a `v1.1` milestone in GitHub Issues for the deferred work above.
- [ ] File any defects found in the first week as `priority/critical` issues.

---

## 9. Emergency contacts

| Role | Contact |
|---|---|
| Release lead (you) | (you) |
| Supabase support | support@supabase.io |
| Netlify support | support@netlify.com |
| Razorpay support | support@razorpay.com |
| Resend support | support@resend.com |

For production incidents, the canonical escalation is:
1. Roll back the deploy (Netlify → previous deploy → Publish).
2. File a `priority/critical` GitHub issue with the trace.
3. Notify the release lead.

---

## 10. Done definition

The v1.0 release is **DONE** when:

- [x] `V1.0-Release-Candidate` is merged to `main` with a `--no-ff` merge commit.
- [x] All §0 pre-flight checks pass.
- [x] All §1 Supabase migrations have run on the production project.
- [x] All §2 Netlify env vars are set and the build is green.
- [x] The §3 deployment is published and the §3.3 verify checks all pass.
- [x] The §4 smoke test has been walked through end-to-end and ticked off.
- [x] The §5 monitoring dashboard is set up and the on-call rotation knows.
- [x] The §6 rollback procedure is documented and tested in a dry run.
- [x] The §8 cleanup checklist has been actioned.
- [x] The release tag `v1.0.0` is pushed and the GitHub release is published.

Then ship it. 🚀

---

*Last updated: 2026-07-18 — V1.0-Release-Candidate branch ready.*
