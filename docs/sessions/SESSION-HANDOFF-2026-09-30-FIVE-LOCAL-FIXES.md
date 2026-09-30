# Session Handoff — 2026-09-30 (late) — Five Local Environment Fixes + gcloud Substitutions Fix

> **Branch:** `docker-desktop-build` @ `ef0e702e`  
> **Target:** feature branch only — **no staging / no main / no deploys**  
> **Verification:** unit 9407 ✓ · contract 5569 ✓ · deployment 20 ✓ · parameterisation gate ✓ · build ✓ · smoke 17/17 ✓ · live probes for every fix ✓

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-30 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | `ef0e702e` (parents: `d6d15c29` fixes, `8481e270` gcloud fix, `0e46763f` prior session) |
| **Status** | Complete & verified |
| **Active Focus** | The 5 reported local issues (schedules 500, Mailpit empty, Razorpay stuck + no upgrade, 2 template-run defects) + the Cloud Build `--substitutions` error |

## 2. What Was Accomplished

### Issue 1 — /schedules "Unexpected server error." on a wrong domain
`netlify/functions/lib/publicUrl.js` `isPublicHttpUrlAsync` **threw** on DNS failure and on malformed input; the discoverability handler's outer catch turned it into a 500. Now the async guard **never throws** — a non-resolving/typo domain answers `false` → existing 400 "That URL is not a public web address." Fixes the schedule-create AND run-audit routes (shared helper). Tests: `publicUrl.dns.test.js` (mocked resolver) + no-throw suite in `publicUrl.test.js`. **Live-verified**: bad domain → clean 400; good domain → passes to plan gating.

### Issue 2 — Mailpit empty
Every sender hard-coded `fetch("https://api.resend.com/emails")`; no Mailpit bridge existed (README claim was false). New **`netlify/functions/lib/mailTransport.js`** choke point: `MAIL_TRANSPORT=mailpit` + `MAILPIT_URL` → Mailpit Send API (`POST {url}/api/v1/send`, verified live); unset → byte-identical Resend. All 12 senders refactored through it (welcome/contact/report/export/invoice/billing/reengagement/scheduled-runner/discoverability-monitor/health-monitor/signalDispatch/engagement), each preserving its public contract. Env added to `.env.local` + documented in `.env.local.example`. **Live-verified**: contact-email landed in Mailpit (`5ShQTaK…`).

### Issue 3 — Razorpay LAUNCH20: stuck spinner + plan never upgrades
Three stacked defects:
1. **Client hang**: `paymentService.js` — `verifyResp.json()` outside every catch; non-JSON response (gateway 502) left the SDK handler dead and the modal at VERIFYING forever. Now every path settles the promise (rejects with payment-id message); test proves it.
2. **No server-side upgrade**: invoice drafts never carried `user_id` (JWT never sent/used) → `activateFromInvoice` silently no-op'd; the client's own subscriptions write is RLS-revoked; the webhook can't reach localhost. Now: `paymentService` sends the JWT; `create-checkout` stamps the draft `user_id` from the JWT; `verify-payment` patches an unclaimed draft, activates entitlements server-side, and writes the subscriptions row + payment event via shared **`lib/paymentLedger.js`** (webhook parity, extracted from payment-webhook.js). **Live-verified**: JWT-stamped draft (`user_id` populated, LAUNCH20 applied, `136786` paise).
3. ACTIVATING stage now timeout-bounded (withTimeout) so it always resolves.

### Issues 4+5 — Template runs: "incomplete" banner + mock placeholder
Root cause for both: the Docker web bundle never baked `VITE_ENABLE_EXTRACT` (absent from `.env.local` → absent from the generated web-build.env), so template runs scraped with the browser-side MOCK while real keys sat in the api container. `.env.local` now sets `VITE_ENABLE_EXTRACT=true` and `AI_BUDGET_MS=20000` (OpenAI reasoning models exceed the Netlify-tuned 8s locally). Mock scrape results carry `mock: true`; `templatesClient.executeRun`/`readCompany` abort BEFORE startRun/AI/billing with an actionable error. **Live-verified**: flag baked `true`; real `/api/extract` returns real HTML + honest structured reason (`no_match` for customer proof on datiq.app); `/api/ai` resolves `openai → gpt-6-luna`.

### Bonus — gcloud `--substitutions` "Bad syntax for dict arg: [admin]"
`build-images.sh` passed comma-containing values in one `--substitutions` arg; gcloud's ArgDict parser splits on commas with no escaping → bare `admin` failed. Fixed with the documented `^;^` delimiter syntax (verified against the SDK's own parser via a stub gcloud); same fix applied to `deploy-run.sh`'s auth `--set-env-vars` (`GOTRUE_URI_ALLOW_LIST`). Commit `8481e270`.

### Bonus — local auth schema repair (pre-existing, blocked live verification)
The rehearsal-restored local DB had auth tables owned by `supabase_admin` with RLS on and no policies → GoTrue 42501 "permission denied" on signup ("Database error finding/saving user"). Repaired live (ownership → `supabase_auth_admin`, grants restored) and made **durable**: `compose.local.yaml` `db-passwords` now reasserts ownership/grants on every stack up. Also cleared the stale migrated `app_config['ai']` row (`gpt-4o`/`gemini-2.5-pro`) so the refreshed model defaults resolve (60s cache TTL — verified `gpt-6-luna` after).

## 3. Root Causes (the load-bearing ones)

- **DNS-as-validation**: a guard that throws on a user's typo turns "reject this URL" into an unhandled 500 two layers up. Contract change documented in the file header.
- **Mock data was indistinguishable from real results**: no marker on mockScrape, so a billed template run could persist "Structured data … would appear here" as facts. Marked + guarded; the guard is also the answer to any deployment where the flag is missing.
- **Payment identity gap**: sessionId is a client-minted random id; only a verified JWT resolves a user. Server now does that on both order creation and verify, with the webhook as the unchanged safety net.

## 4. Verification Evidence

- `npm run test:unit` — 540 files / **9407 passed** (incl. new mockGuard + payment hang tests)
- `npm run test:contract` — 312 files / **5569 passed** (incl. new C-20 activation-path tests, C-37a DNS)
- `npx vitest run deployment` — **20 passed** · parameterisation gate **green**
- `npm run build` — clean; prerender 35 pages synced (committed)
- Live: bad-domain 400 · Mailpit receives mail · real extract/AI chains · JWT-stamped draft · signon e2e green · smoke **17/17**
- Pushed through the full pre-push gate (`CI=1`): `0e46763f..ef0e702e` on `docker-desktop-build`

## 5. Open Items for Next Session / Owner

- [ ] **Full browser pass of the Razorpay flow** (real payment) to see the upgrade land in the UI — the server side is proven; the browser modal flow couldn't be fully exercised non-interactively.
- [ ] `RAZORPAY_WEBHOOK_SECRET` still equals `RAZORPAY_KEY_SECRET` in `.env.local` — set the dashboard webhook secret to match (or rotate) once a public webhook URL is registered.
- [ ] Staging/prod notes: `MAIL_TRANSPORT=mailpit` is local-only by design; `AI_BUDGET_MS=20000` must never land on Netlify prod (10s cap); `VITE_ENABLE_EXTRACT` should be `true` in staging/prod env files if not already.
- [ ] The local DB is now repaired; if another `migrate-from-supabase.sh` restore re-breaks auth ownership, `up.sh`'s db-passwords run re-heals it (verify).
- [ ] The subagent left the `.kilo/worktrees/summer-surgeon` worktree untouched — confirm it stays out of any future diff scope.
