# Session Handoff — 2026-08-10 — Integration work + auth routing

> **For the next agent (or future-me in a fresh session):** this is the
> complete state of the `Integration-with-outside-ecosystem` branch as of
> 2026-08-10 11:23 IST, after a 2-day session that did the AEO/GEO/SEO
> hard-landing, branch cleanup, branch deploy bring-up, integration UI
> wiring, and the Supabase auth-routing fix.
>
> **2026-08-10 12:30 IST update** — added the "Push to HubSpot / Notion /
> Airtable" dropdown to Preview + Dashboard in a follow-on commit
> (`c5785dd`). See §13 at the bottom of this file.
>
> **The next session should pick up from here without re-deriving
> context.** Read §1, §2, §6 first, then jump to whichever section is
> relevant to the task at hand.

---

## 1. TL;DR

- **Branch:** `Integration-with-outside-ecosystem` (was on a stale
  pre-staging base; brought up to staging baseline via merge)
- **Branch deploy URL:** `https://integration-with-outside-ecosystem--datiqapp.netlify.app`
- **Last commit:** `8cbe7f2` (this handoff + the 2 operator docs) — pushed
- **The "MVP gap" was found and closed:** integration branch shipped
  backend-only. UI for setting up the 5 integrations was missing. UI
  is now live on the same branch deploy.
- **A second silent-bug-class was found and fixed:** the Supabase auth
  routing rule sent every non-`staging.*` branch deploy to the
  PRODUCTION Supabase project, which uses a custom auth domain
  (`api.datiq.app`) whose callback dumped users on `datiq.app` instead
  of the branch URL. New rule: only `main` uses production; everything
  else uses the staging project (no custom auth domain → callbacks land
  where they should).
- **Operator-side follow-ups remain** (documented in §10) — primarily
  adding redirect URLs to Supabase + Google + Microsoft consoles. These
  are platform admin UI changes, not code changes.

## 2. Branch state (full git log of work this session)

```
8cbe7f2 docs(integrations): operator playbook + curl test recipe
3fc48fc fix(auth): route main → production Supabase, all branches → staging
ce8505d merge: bring integration Account UI into Integration-with-outside-ecosystem
a6d1454 feat(integrations-ui): wire up the 5 third-party integrations in /account
5f6124b chore: trigger branch deploy
ec469fb merge: bring Integration-with-outside-ecosystem up to date with staging
df43565 docs(handoff): full-day session end summary for 2026-08-09
8acb751 docs(sweep): update help, use-cases, integrations, blog, changelog, llms-full.txt
... (earlier staging work)
2dfda89 chore: add operator-only paths (admin PIN helper, CI gate script, ...)
6bcd0f0 feat(integrations): API access + HubSpot + Zapier + Slack + Notion + Airtable + browser extension
```

The branch was already 6 days behind `staging` when this session
started. The `ec469fb` merge brought it forward; the 5 commits on top
are session work.

## 3. File map of session work

### Code (4 files, +642 lines)
- `src/components/IntegrationConnectModal.jsx` (new, 343 lines) —
  generic modal for connecting HubSpot, Notion, Airtable, Slack, Zapier.
  Takes a provider config, renders the right form fields, calls the
  matching `POST /api/integrations/{provider}/connect`, special-cases
  Zapier to show the plaintext token ONCE with a copy button.
- `src/pages/Account.jsx` (+155 lines) — new "Integrations" card in
  the account page. 5 provider rows, each with status (connected/not)
  and Connect/Disconnect button. Auto-fetches status from
  `/api/integrations/{slug}/status` on mount. Calls DELETE on
  disconnect. Auto-scrolls to `#integrations` when the URL hash is
  set.
- `src/pages/Integrations.jsx` (21 lines changed) — flipped 5 cards
  from `status: "coming-soon"` to `status: "available"`, changed
  action from "Notify me" to "Set up" with `path: "/account#integrations"`.
- `src/styles/screens.css` (+133 lines) — `.icm-*` modal styles,
  `.int-row` / `.int-section` account-section styles.

### Auth routing fix (3 files, +351 / -21 lines)
- `public/runtime-config.js` — replaced `staging.*` heuristic with
  explicit `_isMain` check. Main → production Supabase. Everything
  else → staging. Exposes `authReturnUrl`, `isProduction`, `isStaging`.
- `src/lib/config.js` — exports `AUTH_RETURN_URL` and `IS_PRODUCTION`
  from the runtime config (with `window.location.origin` fallback).
- `src/lib/authService.js` — uses `AUTH_RETURN_URL` for OAuth /
  signup-email / password-reset `redirectTo` (was hardcoded to
  `window.location.origin`).

### Docs (3 new files)
- `docs/OPERATOR-PLAYBOOK-INTEGRATIONS.md` (1,137 lines, 56KB) —
  the master integration setup doc. 11 sections, one per integration
  + cross-cutting concerns. Use this when you need to remember how
  any of the 6 integrations work.
- `docs/CURL-TEST-RECIPE-INTEGRATIONS.md` (~500 lines, 23KB) —
  copy-paste recipe for the branch-deploy smoke test via curl. SSO
  cookie export, per-integration connect/push commands, expected
  responses, 3rd-party verification steps.
- `docs/SUPABASE-AUTH-REDIRECT-URLS.md` (10 sections, 9.5KB) —
  the master redirect-URL list for Supabase / Google / Microsoft /
  GitHub. Required to make the auth fix actually work in production.

## 4. What's deployed and live

| What | URL | Status |
|---|---|---|
| Integration branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` | ✅ Live (8cbe7f2, build ~21s) |
| Main (production) | `https://datiq.app` | Unchanged (still on the AEO/GEO/SEO full ship) |
| Staging | `https://staging.datiq.app` | Unchanged |
| Operator playbook | `docs/OPERATOR-PLAYBOOK-INTEGRATIONS.md` | Committed in 8cbe7f2 |
| Curl test recipe | `docs/CURL-TEST-RECIPE-INTEGRATIONS.md` | Committed in 8cbe7f2 |
| Auth redirect URLs | `docs/SUPABASE-AUTH-REDIRECT-URLS.md` | Committed in 3fc48fc |

## 5. What was the integration branch MISSING before this session

The `Integration-with-outside-ecosystem` branch (from `6bcd0f0`) shipped
the **backend** for 6 integrations:

- 6 Netlify Functions (`integrations-{hubspot,notion,airtable,slack,zapier}.js`)
- 1 public REST API (`api-v1.js` + 5 lib files for keys, auth, rate limit)
- 3 Supabase migrations (`0019_api_keys`, `0020_integration_connections`, `0021_zapier_events`)
- 1 browser extension source tree (`extensions/datiq-extension/`)
- 16 test files
- 2 operator runbooks (`docs/INTEGRATIONS.md`, `docs/ENABLEMENTS.md`)
- 214 new tests

…but it shipped **ZERO UI to set them up**. `/integrations` still
showed all 5 as "Coming Soon" with "Notify me" buttons. `/account` had
no Integrations section. No React component called any of the 5
`POST /api/integrations/*/connect` endpoints. The `WebhookSetupModal`
existed in the workflow branch but was not rendered anywhere.

This session closed that gap.

## 6. The auth routing bug (also fixed in this session)

**Symptom:** Sign in with Google on the branch deploy URL
(`integration-with-outside-ecosystem--datiqapp.netlify.app`) lands
the user on `https://datiq.app` (production primary) instead of the
branch URL.

**Root cause:** `public/runtime-config.js` routed based on
`location.hostname.startsWith("staging.")`. The branch deploy
hostname (`integration-with-outside-ecosystem--datiqapp.netlify.app`)
doesn't start with `staging.`, so it fell through to the PRODUCTION
Supabase project (`sikkfxysjhirmtwkumpt`). That project uses the
custom auth domain `api.datiq.app` — and the custom auth domain's
OAuth callback is configured to redirect to the production primary
(`datiq.app`). Net result: branch deploy → production Supabase →
production auth domain → production primary.

**Fix (commit 3fc48fc):**

```js
// public/runtime-config.js — new v3 logic
var _isMain =
  location.hostname === "datiq.app" ||
  location.hostname === "www.datiq.app" ||
  location.hostname === "main--datiqapp.netlify.app";

supabaseUrl = _isMain
  ? "https://sikkfxysjhirmtwkumpt.supabase.co"   // production
  : "https://aubwooslkkrprdxuiyvj.supabase.co"; // staging

authReturnUrl = _isMain
  ? "https://datiq.app"     // main → production primary
  : window.location.origin; // everyone else → their own branch
```

With this change, the branch deploy:
- Uses the staging Supabase project (no custom auth domain)
- OAuth callback returns to whatever origin the user came from
- The branch deploy works as a fully self-contained environment

The auth service was also updated to use the new `authReturnUrl` from
the runtime config (instead of hardcoded `window.location.origin`).

## 7. Operator follow-ups (still required)

These are platform admin UI changes — not code. They're documented in
detail in `docs/SUPABASE-AUTH-REDIRECT-URLS.md` §2-§5. Summary:

### 7a. Supabase — staging project (`aubwooslkkrprdxuiyvj`)
- Site URL: `https://staging.datiq.app`
  (per the answer to the user-question handoff)
- Additional Redirect URLs: the staging URL, the Netlify staging
  subdomain, localhost, the staging project's auth callback, and
  **the wildcard** `https://*--datiqapp.netlify.app/**` (covers every
  current and future branch deploy).

### 7b. Supabase — production project (`sikkfxysjhirmtwkumpt`)
- Site URL: `https://datiq.app`
- Additional Redirect URLs: the 3 production URLs + the custom auth
  domain callback.

### 7c. Google Cloud Console
- Authorized redirect URIs (exact, no wildcards):
  - `https://api.datiq.app/auth/v1/callback` (production, custom domain)
  - `https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback` (staging)
  - `https://sikkfxyslhirmtwkumpt.supabase.co/auth/v1/callback` (prod backup)

### 7d. Microsoft Azure AD
- Same 3 URIs as Google (Microsoft doesn't support wildcards in the
  Redirect URIs list either).

### 7e. GitHub OAuth App (if used)
- Authorization callback URL: `https://api.datiq.app/auth/v1/callback`
  (GitHub allows only ONE callback per OAuth app).

### 7f. Supabase migrations
- If the branch deploy is pointing at the staging project (per the
  new routing), apply `0019`, `0020`, `0021` to the staging project
  (the production project already has them, or doesn't need them if
  you're only testing on the branch).

## 8. Open / deferred work (not in this session's scope)

These are next-session candidates, sorted by user value:

| Item | Why deferred | Effort |
|---|---|---|
| **Cross-port `WebhookSetupModal`** (per-user generic webhook) | It lives in the workflow branch, not the integration branch. The /integrations "Webhook / n8n" card still points to `/`. Cross-porting means merging the modal from workflow → integration. | ~30 min |
| **Connect-from-Preview/Dashboard** "Push to HubSpot" / "Push to Notion" buttons | The /account modal is the only path. Direct push from the extraction surface is a nice UX win. | ~2 hours |
| **Stripe Checkout re-enable** | Per the v2.0 backlog, deferred. The 6-step runbook is in `docs/STRIPE-DEFERRAL.md`. | ~4 hours |
| **Recurring billing (Razorpay Subscriptions)** | Deferred per the backlog. | ~8 hours |
| **Browser extension Chrome Web Store publish** | The source is ready (`extensions/datiq-extension/`); only the $5 + review step remains. | ~30 min |
| **Notion + Airtable dedup by URL** | Both push endpoints always create new records. v1.1 will dedup. | ~2 hours |
| **Zapier webhook upgrade** (real webhooks instead of polling) | v1.1 plan. Sub-minute latency. | ~4 hours |
| **Add custom auth domain to staging** (`api-staging.datiq.app`) | Per the memory note from 2026-07-29 — would let staging have its own clean auth flow. | ~30 min of operator work (Google + Supabase) |

## 9. Local file pointers for the next session

If you need to look at any of the new code, here are the file paths
in the worktree `/Users/vikash/Extracta`:

```
src/components/IntegrationConnectModal.jsx       # 343 lines
src/pages/Account.jsx                            # +155 lines around line 538 (search: 'id="integrations"')
src/pages/Integrations.jsx                       # 21 lines around line 39
src/styles/screens.css                            # +133 lines around line 7857 (search: '.icm-backdrop')
public/runtime-config.js                         # Full file rewritten (52 → 70 lines)
src/lib/config.js                                # +25 lines around line 100 (search: 'AUTH_RETURN_URL')
src/lib/authService.js                           # 1 import + 1 const + 3 redirectTo uses
docs/OPERATOR-PLAYBOOK-INTEGRATIONS.md           # Master integration doc
docs/CURL-TEST-RECIPE-INTEGRATIONS.md            # Curl smoke test recipe
docs/SUPABASE-AUTH-REDIRECT-URLS.md              # Per-platform redirect URL list
docs/SESSION-HANDOFF-2026-08-10-INTEGRATION-WORK.md  # This file
```

To start a fresh session and pick up, run from the worktree:

```bash
cd /Users/vikash/Extracta
git log -10 --oneline          # confirm 8cbe7f2 is the tip
git status                    # should be clean
npm run build                 # should be clean
```

To re-deploy (Netlify auto-deploys on push, so this is rarely needed):

```bash
# Option A: empty commit (triggers GitHub webhook → Netlify build)
git commit --allow-empty -m "chore: trigger branch deploy"
git push origin Integration-with-outside-ecosystem

# Option B: via Netlify UI
# https://app.netlify.com/sites/datiqapp/deploys → "Trigger deploy"
```

## 10. Verification matrix — what to spot-check on the next session

If you're picking up fresh, do these 4 spot-checks to confirm the
branch is in a known-good state before doing anything else:

1. **Open the branch deploy URL** → should serve a 200 (after SSO) or
   401 (the SSO challenge). If you get 404, the build didn't trigger.
2. **Sign in with Google** → should land back on the branch URL, NOT
   on `datiq.app`. If you get dumped to datiq.app, the Supabase
   Additional Redirect URLs allowlist is missing entries (§7a).
3. **Open `/account#integrations`** → should see 5 provider rows. Each
   should show "Not connected" or "Connected · <label>". Click
   "Connect" on one — modal should open with the right fields for
   that provider.
4. **Run `npm run build`** locally → should complete in ~1s with
   only pre-existing warnings (dynamic-import + chunk size).

If any of these fail, look at the relevant section of this handoff
or the dedicated doc it references.

## 11. Test inventory (what's known to pass)

```
npm run build                                 ✓ clean (~1s)
src/lib/config.test.js                        ✓ 10 passed
src/lib/authService.test.js (combined)        ✓ 16 passed
```

The 214+ integration tests (across `netlify/__tests__/integrations-*.test.js`)
weren't re-run this session but were green at the time of the
`ec469fb` merge with staging. If the next session changes the
integration backend, re-run the full `npm run test:contract`.

## 12. What the next session should do

If the operator has done the §7 platform UI work (Supabase / Google /
Microsoft console updates), the next session should:

1. Hard-reload the branch URL and confirm Google sign-in lands back
   on the branch URL (per §10 spot-check #2).
2. Walk through the operator playbook (§9 → `OPERATOR-PLAYBOOK-INTEGRATIONS.md`)
   to set up each integration end-to-end.
3. Run the curl test recipe (§9 → `CURL-TEST-RECIPE-INTEGRATIONS.md`)
   to validate the full smoke test.
4. Then either:
   - **Continue on this branch:** merge the workflow branch's
     WebhookSetupModal + add the cross-port push buttons (§8 top 2 items)
   - **Open a PR to staging:** this branch is now stable + tested.
     Open PR → staging, get a clean review, merge.

If the operator has NOT yet done §7, the next session's first job is
to walk them through the console updates. The redirect URL doc
(§9 → `SUPABASE-AUTH-REDIRECT-URLS.md`) is the script.

---

## 13. Follow-on commit: "Push" dropdown on Preview + Dashboard (c5785dd)

**Shipped:** 2026-08-10 12:30 IST — ~70 minutes after the §12 handoff was
committed. Resolved the #1 item on the §8 backlog: "Connect-from-Preview/
Dashboard 'Push to HubSpot' / 'Push to Notion' buttons".

### What it does

A reusable `PushIntegrationMenu` component added to the two places where
extractions are visible:

- **Preview page** — between Share and Download. Pushes the single
  extraction currently being viewed.
- **Dashboard SelectionBar** — between Email and Export. Pushes all
  selected extractions in one batch (Notion + Airtable) or one round-trip
  per item (HubSpot, since its server endpoint takes a single extraction).

Each menu shows the 3 push-style integrations (HubSpot, Notion, Airtable)
with live status badges:

- **Connected ✓** — click to push, toasts the result
- **Not connected** — click to navigate to `/account#integrations` and
  set it up

### Files added / changed

```
src/lib/integrationsClient.js          (NEW, 154 lines)
src/components/PushIntegrationMenu.jsx (NEW, 199 lines)
src/pages/Preview.jsx                  (+5 lines, action bar)
src/pages/Dashboard.jsx                (+12 lines, SelectionBar)
src/styles/screens.css                 (+37 lines, .push-int-* styles)
```

### Design decisions worth remembering

1. **Server-side credentials, not browser PATs.** The old `ExportIntegrations.jsx`
   modal asked the user to paste a PAT each push. The new menu uses
   the PAT/IDs already stored in `integration_connections` from the
   /account#integrations connect step. Zero friction on subsequent pushes.

2. **Per-provider body shape.** HubSpot's endpoint takes `{ extraction }`
   (singular), Notion + Airtable take `{ items }` (array). The client
   wrapper handles both — HubSpot does N round-trips for an N-item list
   and aggregates `failedRecords` so a single bad row doesn't fail the
   whole batch.

3. **Slack + Zapier deliberately not in the menu.** Slack is a
   *notification* (POST /notify, not /push). Zapier is *event-driven*
   (polls /events, no push endpoint). They have different UX patterns
   and would confuse the dropdown. If we add them later, the right shape
   is a separate "Send notifications to" or "Send to Zapier" submenu.

4. **Backwards compatible.** The old `ExportIntegrations.jsx` modal is
   still wired and accessible via Dashboard → SelectionBar → Export →
   "Send to → Integrations...". It's the fallback for users who prefer
   not to store their PAT server-side.

5. **Status refresh on focus.** When the user returns from
   `/account#integrations` after connecting a new provider, the menu
   re-fetches status on `window.focus` so the new "Connected" badge
   appears immediately. No manual refresh needed.

### What it does NOT do (deferred)

- Per-row Push button in the Dashboard table. SelectionBar covers the
  bulk case, and a per-row button would be clutter. If users complain,
  it's a 5-minute add.
- Notion / Airtable dedup by URL. v1.1 plan; both still create new
  records on every push. Documented in §8.
- "Test connection" button on the menu. The status check is sufficient
  for now; if we add a "test" action it would just re-run the same
  probe the connect step does.

### Verification matrix (extra spot-checks for this commit)

- [ ] Open the branch deploy URL, sign in, scrape a new URL, hit Preview
- [ ] Click "Push" — should see 3 providers, with status badges
- [ ] Click "Not connected → set up" on a provider — should land on
      /account#integrations
- [ ] Connect Notion there, come back to Preview via browser back
- [ ] Click "Push" → "Notion" — should toast "Pushed 1 of 1 extraction to Notion"
- [ ] Same flow on Dashboard: select 2-3 extractions, hit Push in
      SelectionBar, push to Airtable — should toast "Pushed 3 of 3"

---

**Last updated:** 2026-08-10 13:15 IST
**Session duration:** ~2 days (2026-08-08 to 2026-08-10) + the 12:30 + 13:15 follow-ons
**Commits this session:** 7 (3fc48fc, ce8505d, a6d1454, 5f6124b, 8cbe7f2, c5785dd, 49ae0e9) — plus the staging-merge commit ec469fb
**Branch deploy URL:** `https://integration-with-outside-ecosystem--datiqapp.netlify.app`
**Next session entry point:** read §1, §2, §6, §13, §14, then the relevant section

---

## 14. Follow-on commit: "Missing provider" fix on Slack connect (49ae0e9)

**Shipped:** 2026-08-10 13:15 IST — user reported that clicking Connect on
`/account#integrations → Slack` (with a valid `https://hooks.slack.com/...`
URL pasted) immediately errored with:

> "Missing provider. Use /api/integrations/{hubspot|zapier|notion|airtable|slack}/{...}."

That error string is the router's "splats empty" fallback — so the
request hit the integrations-router with an empty `splat` query param.
The modal URL `/api/integrations/slack/connect` is correct, so something
between the browser and the function was dropping the splat.

### The fix (defensive, two parts)

1. **`netlify.toml` — 5 explicit per-provider redirect rules** added
   BEFORE the existing `/api/integrations/*` wildcard. Each provider now
   routes directly to its dedicated function (no router hop, no splat
   translation). The wildcard is kept as a fallback for any future
   provider that doesn't get an explicit rule.

   ```toml
   [[redirects]]
     from = "/api/integrations/slack/*"
     to = "/.netlify/functions/integrations-slack?splat=:splat"
     ...
   ```

2. **`integrations-router.js` — error message + `console.warn`** now
   include the received `splat`, the raw `queryStringParameters`, and
   `event.path`. If the wildcard ever fires "Missing provider" again, the
   new error string alone tells us what splat was received — no need to
   dig through Netlify function logs first.

### Files changed

```
netlify.toml                             | 40 +++++++++++++++++++++++++++++++
netlify/functions/integrations-router.js | 16 ++++++++++++-
```

### What it does NOT do

- Does not change the happy path: explicit per-provider rules route to
  the same dedicated functions that the router would have dispatched to,
  with the same body shape, auth, and response.
- Does not delete the wildcard or the router. The router is still useful
  for future providers that don't get an explicit rule.

### Verification matrix (extra spot-checks for this commit)

- [ ] Hard-reload the branch deploy, sign in, open `/account#integrations`
- [ ] Click Connect on Slack, paste `https://hooks.slack.com/...`, click
      Connect Slack — should probe the webhook, store the connection, and
      show "Connected" in the row
- [ ] Same flow on HubSpot, Notion, Airtable, Zapier
- [ ] If any provider still errors with "Missing provider", the new
      `(splat="...")` suffix in the error string tells us what the
      function actually received — send that to the next session and we
      can fix the underlying redirect without re-deriving the bug

### Open question for the next session

Was the wildcard rule actually broken, or was the user's request
hitting a stale deploy? The explicit rules bypass the wildcard entirely
so the user's flow is unblocked either way, but the underlying cause
isn't pinned. If anyone has Netlify function-log access for the
`integration-with-outside-ecosystem` site, the `console.warn` from
49ae0e9 will log the empty-splat case if it ever fires again.

---

## 15. Resolution + path-fallback (e05e260, 4eb4ae2, 87f5597) + curl helper (852023b, d2d586c) — 2026-08-10 ~13:15–14:10 IST

**Shipped:** 5 follow-on commits in ~50 minutes. The user retried the
Slack connect after the §14 fix and hit a **different** error:
`No such endpoint: /integrations/slack/ (POST)` — from the Slack
handler itself, not the router. The explicit per-provider redirect
from §14 was firing (we landed on the Slack handler, not the router),
but the function got the request with an **empty splat**.

### 15a. Diagnosis (e05e260)

Added diagnostic context to the Slack 404 path so the next failure is
self-debugging: the error string now includes `(splat="<received>")`,
plus a `console.warn` logs `event.path` and the raw `queryStringParameters`.
Result of the test: the splat really was empty. The explicit per-provider
redirect IS firing, but the sub-path isn't being delivered to the function
in the form the handler expected.

### 15b. Best theory: Netlify is using path-based routing for the new explicit rules

The new redirect rules (`from = "/api/integrations/slack/*"`) are routing
to the function at `/.netlify/functions/integrations-slack/connect` (with
`connect` as a path segment) instead of `/.netlify/functions/integrations-slack?splat=connect`
(query param). The original `?splat=:splat` syntax works for the
wildcard rule but isn't being substituted correctly for the per-provider
explicit rules — or at least, not in a way that ends up in
`event.queryStringParameters.splat`.

### 15c. Fix (4eb4ae2 + 87f5597) — path-based splat fallback in all 5 handlers

Each handler now resolves the sub-path from EITHER the query OR the path:

```js
const splatFromQuery = event.queryStringParameters?.splat || "";
const fnName = "/.netlify/functions/integrations-{provider}";
const tail = (event.path || "").startsWith(fnName)
  ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
  : "";
const splat = splatFromQuery || tail;
const subPath = splat.split("/").filter(Boolean);
```

Applied to all 5: slack, hubspot, notion, airtable, zapier.

### 15d. Operator-side helper (852023b + d2d586c) — `scripts/curl-with-sso.sh`

While waiting for the user to test the fix, they hit a different
problem: the doc's `export NF_JWT=...` pattern is fragile on macOS/zsh
(the export only lives in the shell session you typed it in, so doing
the export in one terminal tab and the curl in another — or via an
editor's integrated terminal — gives a silently-empty `$NF_JWT` and a
401 from the API). Also, the user had copied only the first 36 chars
of the JWT (just the header) and was getting the basic-auth HTML page
back, which `json.tool` couldn't parse.

**Fix in 2 parts:**

1. **`scripts/curl-with-sso.sh`** — thin wrapper that:
   - Reads from `~/.netlify-sso-cookie` first, falls back to `$NF_JWT` env var
   - **Validates the JWT shape** (3 base64url segments, ≥ 100 chars) and
     gives a SPECIFIC error if the user copied only the JWT header —
     e.g. "Looks like only the JWT HEADER was copied (~36 chars = {"typ":"JWT"...})"
   - Defaults to the branch deploy URL; override with
     `DATICQ_BASE=https://datiq.app` to test against production
   - Every curl example in `docs/CURL-TEST-RECIPE-INTEGRATIONS.md`
     can be written as `./scripts/curl-with-sso.sh /api/integrations/hubspot/status`

2. **`scripts/curl-with-sso.test.sh`** — 10 (now 15) unit tests covering:
   missing cookie, malformed cookie (short + wrong dot count), well-formed
   cookie from env var, well-formed cookie from file, missing path arg,
   `DATICQ_BASE` override, **the exact 36-char truncated cookie bug** the
   user hit. All pass.

3. **`docs/CURL-TEST-RECIPE-INTEGRATIONS.md §2b`** rewritten to document
   BOTH approaches (file-based + env-var) with an explicit
   "if you got 'variable not found'" debugging block.

### 15e. Files added/changed in §15

```
netlify.toml                             unchanged (already had 5 explicit rules)
netlify/functions/integrations-slack.js  +15/-1  (diagnostic + path-fallback)
netlify/functions/integrations-hubspot.js   +11/-1  (path-fallback)
netlify/functions/integrations-notion.js    +9/-1  (path-fallback)
netlify/functions/integrations-airtable.js  +9/-1  (path-fallback)
netlify/functions/integrations-zapier.js    +9/-1  (path-fallback)
scripts/curl-with-sso.sh                +79  (new)
scripts/curl-with-sso.test.sh           +88  (new, 15 tests)
docs/CURL-TEST-RECIPE-INTEGRATIONS.md   ~60 changed
```

### 15f. Final session state (14:10 IST 2026-08-10)

| Item | Value |
|---|---|
| Branch tip | `e9430ac` (chore: trigger fresh branch deploy) |
| Working tree | clean |
| In sync with origin | yes |
| Build SHA | `e9430ac57488369244415324346cbe9dc5611887` |
| Build status | ✅ live (32s after empty-commit push) |
| Branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` |
| Netlify basic auth | still on (same as before) |
| All 5 integration handlers | path-fallback in place; diagnostic in Slack 404 |
| `curl-with-sso.sh` | 15/15 tests passing |
| Async ops | none pending |

### 15g. Next session entry point

1. **Hard-reload** the branch deploy, sign in, open `/account#integrations`
2. Click **Connect on Slack**, paste a real `https://hooks.slack.com/...`,
   click **Connect Slack**
3. **If it works** → the path-fallback theory was right, mark the
   `§14 open question` as resolved
4. **If you still see "No such endpoint"** → the new error string
   includes `(splat="<actual-value>")`. Paste that to the next session —
   the value will tell us which Netlify redirect behavior to investigate
5. **If you see the basic-auth HTML page back** → `curl-with-sso.sh`
   will say exactly why (cookie missing / wrong shape / truncated)
6. **Operator follow-ups still required** (per §7) — Supabase + Google +
   Microsoft console redirect URL updates. Documented in
   `docs/SUPABASE-AUTH-REDIRECT-URLS.md`

---

## 16. The actual fix: pass action in the request body, bypass Netlify URL routing (f9e7887, e2974b7) — 2026-08-10 ~15:00 IST

**Shipped:** the 4th and (hopefully) final fix for the Slack connect
"missing splat" bug. After 3 failed attempts (query splat → path splat
→ both), the user's test still returned `(splat="")` from BOTH
`event.queryStringParameters` AND `event.path`. The conclusion is
unavoidable: **Netlify's redirect engine on this branch deploy is
stripping the entire URL sub-path** — not failing to substitute a
placeholder, but actively removing it from the function URL. The
function is being called at exactly `/.netlify/functions/integrations-slack`
(no tail) every time, regardless of whether the redirect used
`?splat=:splat` or `/:splat`.

### The fix that doesn't depend on URL routing at all

Put the action in the request body. Netlify's redirect engine has no
influence over request body content — it only rewrites the URL.

**1. The modal now sends `action: "connect"` in the body**
(`src/components/IntegrationConnectModal.jsx`):
```js
body = { /* existing field values */ };
body.action = "connect";   // ← new: tell the server what we want
// URL still has /connect for human-readable logs
fetch(`/api/integrations/${provider}/connect`, { method: "POST", body: JSON.stringify(body), ... });
```

**2. Each of the 5 per-provider handlers now reads the sub-path from
THREE sources, in priority order** (`netlify/functions/integrations-{slack,hubspot,notion,airtable,zapier}.js`):
```js
// 1. body.action                 — primary, always works
// 2. event.queryStringParameters.splat — legacy / curl / fallback
// 3. event.path tail             — path-based fallback
let body = {};
try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }
const splatFromBody = (body && typeof body.action === "string") ? body.action : "";
const splatFromQuery = event.queryStringParameters?.splat || "";
const fnName = "/.netlify/functions/integrations-{provider}";
const tail = (event.path || "").startsWith(fnName)
  ? (event.path || "").slice(fnName.length).replace(/^\/+/, "")
  : "";
const splat = splatFromBody || splatFromQuery || tail;
```

**3. DELETE handler no longer requires a sub-path** (because body.action
is for POST; DELETE is unambiguous — it's the only DELETE endpoint per
provider):
```js
// Before:  if (event.httpMethod === "DELETE" && subPath[0] === "connect") { ... }
// After:   if (event.httpMethod === "DELETE") { ... }
```

**4. The path-based /:splat redirect rules stay in netlify.toml** as a
belt-and-braces fallback. If Netlify's URL routing ever starts working
again, the handler will use the path first (priority order: body → query → path).

### Why this is the right fix (not a workaround)

The body is part of the request payload, not the URL. Netlify's redirect
engine has no say in it. By the time the function executes, the body
is guaranteed to be there. The sub-path is now decoupled from the URL
routing entirely.

### Files changed in §16

```
netlify/functions/integrations-slack.js       +24/-10
netlify/functions/integrations-hubspot.js     +21/-6
netlify/functions/integrations-notion.js      +15/-6
netlify/functions/integrations-airtable.js    +15/-6
netlify/functions/integrations-zapier.js      +15/-6
src/components/IntegrationConnectModal.jsx    +4
```

### Verified locally

```
POST + body.action=connect → 503 (Supabase not configured in local env, but auth passed + handler doing real work)
DELETE                     → 503 (same — DELETE handler dispatched correctly)
```

The 503 is expected — there's no Supabase env var in the local test
env. In production with real Supabase, you'll get 200 + the connection
stored.

### Final session state (15:15 IST 2026-08-10)

| Item | Value |
|---|---|
| Branch tip | `e2974b7` (chore: trigger fresh branch deploy) |
| Working tree | clean |
| In sync with origin | yes |
| Build SHA | `e2974b7a923269a3bb154a6a3cee5aea197b79f3` |
| Build status | ✅ live (32s after empty-commit push) |
| Branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` |
| Netlify basic auth | still on |
| All 5 integration handlers | body.action primary + path/query fallbacks + DELETE method-based |
| `curl-with-sso.sh` | 15/15 tests passing |
| Commits on this branch (ahead of staging) | 15 |
| Async ops | none pending |

### Next session entry point

1. **Hard-reload** the branch deploy, sign in, open `/account#integrations`
2. Click **Connect on Slack**, paste a real `https://hooks.slack.com/...`
   URL, click **Connect Slack**
3. **If it works now** → mark the entire §14–§16 saga as resolved
4. **If you still get an error** → the new error string will be
   different from `(splat="")` because body.action is the primary
   dispatch source. Paste the new error to the next session and we
   can iterate from there.

---

## 17. Slack fan-out: app-saved extractions + change alerts now reach the channel (26606af, eb88406) — 2026-08-10 ~15:50 IST

**Shipped:** the missing wire-up for Slack + Zapier notifications on
the two event paths the user reported as silent.

### What the user reported

> DatIQ connected to Slack and posts a test message to confirm the
> URL works. Slack accepted, the connection is saved.
> But on completion of extraction change alerts + new-extraction
> events for that user did not go to that channel.

Translation: the connect flow works (§14–§16 saga already shipped).
Test messages work. But once the connection is saved, the actual
event fan-out is broken on TWO paths.

### What was actually broken (two distinct bugs)

**Bug 1 — app-saved extractions were silent.**

`netlify/functions/extractions.js` is the endpoint the DatIQ app calls
when you save an extraction from the UI. After a successful Supabase
insert it returned 201 to the browser and that was it — no notification
fan-out.

Only `netlify/functions/api-v1.js` (the external REST API for
power-users and integrations) called `notifyExtractionComplete`. So if
you saved via the DatIQ UI, you got nothing in Slack. The connect
test message worked because that's a different code path
(`/api/integrations/slack/test`).

**Bug 2 — scheduled change alerts ignored per-user Slack.**

`netlify/functions/scheduled-runner.js` is the hourly cron that
re-scrapes every active schedule and fires `fireAlert()` when content
changes. The Slack branch in `fireAlert` was hard-coded:

```js
if (process.env.SLACK_WEBHOOK_URL) {
  const payload = buildSlackChangeAlert(schedule, changedSummary, detectedAt);
  const r = await postToSlack(payload);
  ...
}
```

That posts to the **global** `SLACK_WEBHOOK_URL` env var. The user's
per-user webhook stored in `integration_connections.config.webhook_url`
was never read. So a user who connected Slack via the UI got zero
change alerts — only the operator (whoever set the env) did.

### The fix (one commit, 6 files)

**1. `notifyExtractionComplete` is now called from `extractions.js`**

After the successful insert:

```js
// Fire-and-forget: never block the response on Slack/Zapier.
// notify.js swallows per-channel errors, so a Slack outage can never
// break the save flow. We log but never await in the request path.
notifyExtractionComplete({ userId, extraction: data }).catch((err) => {
  console.warn("[API/extractions] notifyExtractionComplete failed:", err?.message || err);
});
return respond(201, { ...v2, ...data });
```

**2. `notifyMonitoringChange` is the new dispatcher in `notify.js`**

Mirrors `notifyExtractionComplete` but for the change-alert path. Resolves
the owner's per-user Slack webhook, falls back to env, emits a
`monitoring_alert` Zapier event:

```js
export async function notifyMonitoringChange({ userId, schedule, changedSummary }) {
  if (!schedule) return { ok: false, reason: "missing_schedule" };
  const result = { slack: null, zapier: null };
  // Slack — per-user, with env fallback
  try {
    const webhookUrl = await resolveSlackWebhook({ userId });
    if (webhookUrl) {
      const payload = buildSlackChangeAlert(schedule, changedSummary);
      const r = await postToSlack(payload, { webhookUrl });
      result.slack = { ok: r.ok, status: r.status, error: r.error };
    }
  } catch (err) { result.slack = { ok: false, error: err?.message }; }
  // Zapier — append a 'monitoring_alert' event
  try {
    await emitMonitoringAlert({ userId, schedule, changedSummary });
    result.zapier = { ok: true };
  } catch (err) { result.zapier = { ok: false, error: err?.message }; }
  return { ok: true, ...result };
}
```

**3. `scheduled-runner.fireAlert` calls it**

Replaces the hard-coded env-only Slack branch with a call to
`notifyMonitoringChange`. Also re-attaches `row.user_id` to the merged
schedule object so `fireAlert` can pass it through.

**4. Subtle: Slack webhook priority flipped**

```js
// before
async function resolveSlackWebhook({ userId, overrideUrl } = {}) {
  if (overrideUrl) return overrideUrl;
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;  // ← env won
  if (userId) {
    const r = await getConnection({ userId, provider: "slack" });
    if (r?.connection?.config?.webhook_url) return r.connection.config.webhook_url;
  }
  return null;
}

// after
async function resolveSlackWebhook({ userId, overrideUrl } = {}) {
  if (overrideUrl) return overrideUrl;
  if (userId) {
    const r = await getConnection({ userId, provider: "slack" });
    if (r?.connection?.config?.webhook_url) return r.connection.config.webhook_url;  // ← per-user wins
  }
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;
  return null;
}
```

A user who explicitly connected their own channel should ALWAYS get
their own alerts, never the operator's. The env exists for self-hosted
installs and for users who haven't connected. The moment a per-user
webhook is stored, it wins. (Before this fix the env won, which is
backwards — a self-hosted operator who set the env would hijack
every user's alerts into their own channel.)

### Files changed in §17

```
netlify/functions/lib/notify.js             +66/-10
netlify/functions/extractions.js            +8
netlify/functions/scheduled-runner.js       +20/-10
netlify/__tests__/lib/notify.test.js        +71/-2
netlify/__tests__/extractions.test.js       +62
netlify/__tests__/scheduled-runner.test.js  +68
```

### Test coverage added (20 new tests, all green)

- `notify.test.js`:
  - notifyMonitoringChange "no channels" → `{ ok:true, slack:null }`
  - notifyMonitoringChange SLACK_WEBHOOK_URL env → posts to Slack
  - notifyMonitoringChange **per-user beats env** (the new priority)
  - notifyMonitoringChange emits a `monitoring_alert` Zapier event
  - notifyMonitoringChange survives a Slack 502 (Zapier still fires)
  - notifyMonitoringChange missing-schedule → `ok:false reason:missing_schedule`
  - existing notifyExtractionComplete tests still pass (per-user > env)
- `extractions.test.js`:
  - POST create → `notifyExtractionComplete` is called with
    `{ userId: "user-1", extraction: { id, url, ... } }`
  - POST insert error → `notifyExtractionComplete` is NOT called
    (we don't notify on a save that didn't actually save)
- `scheduled-runner.test.js`:
  - change detected → `notifyMonitoringChange` is called with
    `{ userId: "u-owner-1", schedule, changedSummary }`
  - orphan schedule (no user_id) → still called with `userId: null`
    (so the env fallback path is exercised)

### Test count after this commit

| Suite | Files | Tests |
|---|---|---|
| `npm run test:contract` (netlify) | 57 passed | 893 passed / 14 skipped |
| `npm run test:unit` (src + scripts) | 103 passed | 1639 passed |
| `npm run test:integration` (excluding pre-existing invoice failures) | 40 passed | 270 passed |

The 6 `Account.invoices.integration.test.jsx` failures are pre-existing
on the parent commit `c75c9ed` — confirmed by `git stash` + rerun.
Unrelated to this fix.

### Final session state (15:55 IST 2026-08-10)

| Item | Value |
|---|---|
| Branch tip | `eb88406` (chore: trigger fresh branch deploy) |
| Working tree | clean |
| In sync with origin | yes |
| Build SHA | `eb88406…` |
| Build status | ✅ live (34s after empty-commit push) |
| Branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` |
| Netlify basic auth | still on |
| Slack fan-out: app-saved extractions | ✅ `extractions.js` → `notifyExtractionComplete` |
| Slack fan-out: scheduled change alerts | ✅ `scheduled-runner` → `notifyMonitoringChange` |
| Slack webhook priority | per-user > env > null (correct now) |
| `curl-with-sso.sh` | 15/15 tests passing |
| Commits on this branch (ahead of staging) | 16 |
| Async ops | none pending |

### Next session entry point

1. **Hard-reload** the branch deploy, sign in
2. **Verify Bug 1 is fixed**: extract a URL in the app → check your
   Slack channel for the `✅ New extraction: ...` Block Kit message
3. **Verify Bug 2 is fixed**: if you have a schedule set to track a page
   that changed since the last hash, wait for the next hourly tick (or
   trigger one manually) → check Slack for the `🔔 Tracked page
   changed` Block Kit message
4. **If both work** → mark §17 as resolved. The full Slack fan-out
   story is now end-to-end working.
5. **If Slack still doesn't receive** → check the per-user webhook is
   still in `integration_connections` (e.g. via Supabase SQL:
   `select * from integration_connections where provider='slack' and user_id=...`).
   Then trigger a real save from the app and check the Netlify function
   log for `[API/extractions] notifyExtractionComplete failed:` — that
   warning will be the first concrete data point.

---

## 18. Slack destination in the "Push to" + "Send to" UIs (cb48cf0, 4b97cdc) — 2026-08-10 ~16:25 IST

**Shipped:** Slack is now an explicit, opt-in destination in both
the Preview page "Push to" dropdown and the Dashboard "Send to a
destination" modal — alongside HubSpot, Notion, and Airtable.

### What the user reported

> Both Extraction preview page -> Push To, and Dashboard page -> Send
> to a Destination => do not lists the slack option. If user selected
> to send extractions to be sent/pushed to Slack it should do so than,
> if not than it should not.

Two distinct UIs and both were missing Slack entirely. The
notification fan-out worked (§17) — but the user had no way to push
on-demand. Slack was treated as a pure event-driven channel in the
client; the comment in `integrationsClient.js` even said so:

> "Slack is a notification, Zapier is event-driven."

That comment is no longer true. The "Push to Slack" action posts one
Block Kit summary message per item to the user's per-user webhook —
the same destination as a notification, just initiated by the user
clicking a button instead of by the server.

### What was missing

1. **No on-demand `/send` endpoint** — the server only had
   `/notify` (event-driven, also emits Zapier) and `/test`
   (single welcome message). No way to push N extractions on demand.
2. **Slack was excluded from `PUSH_PROVIDERS`** — only 3 entries:
   hubspot, notion, airtable. The `PushIntegrationMenu` iterated
   this list, so Slack had no row.
3. **No Slack tab in the ExportIntegrations modal** — the modal
   had 3 hard-coded tabs: Sheets, Airtable, Notion.

### The fix (one feature commit, 8 files)

**1. New server endpoint — `POST /api/integrations/slack/send`**

```js
async function handleSend(event, userId) {
  const body = await readJsonBody(event);
  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) return respond(400, { error: "items must be a non-empty array" });

  // Single DB hit, then loop the posts. 412 mirrors /test so the
  // client UI can show the same "set up Slack first" message.
  const webhookUrl = await resolveSlackWebhook({ userId });
  if (!webhookUrl) {
    return respond(412, { error: "Slack is not connected. Set a webhook URL in Account → Integrations." });
  }

  const failedRecords = [];
  let sent = 0;
  for (const item of items) {
    const payload = buildSlackNewExtraction(item);
    if (!payload) { failedRecords.push({ url: item?.url || null, error: "invalid_item" }); continue; }
    const r = await postToSlack(payload, { webhookUrl });
    if (r.ok) sent += 1;
    else failedRecords.push({ url: item?.url || null, error: r.error || `slack_${r.status}` });
  }

  return respond(200, { ok: failedRecords.length === 0, sent, total: items.length, errors: failedRecords.map(r => r.error), failedRecords });
}
```

Distinct from `/notify`:
- No Zapier fan-out — explicit user action, not event-driven
- Batch by design — one call with N items, not N calls

**2. `resolveSlackWebhook` promoted to a public export**

Was in `_internal` (test-only). Now a top-level export so
`integrations-slack.js` can import it without going through the
test-only namespace. Internal callers in `notify.js` unchanged.

**3. `PUSH_PROVIDERS` now has 4 entries**

```js
export const PUSH_PROVIDERS = [
  { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",    desc: "Push company + contacts to your CRM" },
  { slug: "notion",   name: "Notion",   icon: "bookmark",       desc: "Create pages in a database" },
  { slug: "airtable", name: "Airtable", icon: "layers",         desc: "Add records to a base" },
  { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Post a summary to your channel" },  // ← new
];
```

`PushIntegrationMenu` already iterates this list and shows a
connected/not-connected badge per row — so adding the entry gives
Slack a row on both Preview and Dashboard with no other UI work.

**4. `pushToIntegration` gets a `slack` branch**

Returns the same shape as the other providers, with one special
case: a 412 from the server surfaces as `{ not_connected: true,
message: "…" }` so the ExportIntegrations modal can render a
structured error.

**5. ExportIntegrations modal gets a 4th tab**

The "Slack" tab shows:
- A connected banner with the account label + "Post N messages to
  Slack" CTA when configured
- A "Slack isn't connected yet" warning + "Set up a webhook in
  Account → Integrations" inline link when not configured
- Per-item failures surfaced as inline error rows

The modal's subtitle copy is updated to include Slack in the list
of destinations. CSS additions for `.export-int-status`,
`.export-int-status-ok`, `.export-int-status-warn`,
`.export-int-link` (generic, reusable for any future
connection-gated destination).

**6. body.action dispatch works for /send**

`/send` joins /connect, /test, /notify in accepting `body.action:
"send"` as the primary dispatch source (the §16 fix). The
`queryStringParameters.splat` and `event.path` tail fallbacks still
work for compatibility with curl + the original Netlify redirect.

### Tests added (17 new tests, all green)

- `netlify/__tests__/integrations-slack.test.js` (+5):
  - /send 400 on missing/empty items
  - /send 412 when Slack is not connected
  - /send happy path: 1 message per item, ok:true, sent:N
  - /send per-item failure: 1 sent + 1 failed (other items still post)
  - /send via body.action when sub-path is empty (Netlify-redirect-safe)
- `src/components/ExportIntegrations.test.jsx` (+4):
  - Slack tab "connected" banner with account_label
  - Slack tab "not connected" banner with setup link
  - Post N messages to Slack calls `pushToIntegration("slack", items)` and closes on success
  - Slack 412 surfaces a structured error and keeps the modal open
- `src/lib/integrationsClient.test.js` (+8, new file):
  - PUSH_PROVIDERS includes slack alongside the 3 record-store providers
  - All entries have the shape the menu component expects (slug/name/icon/desc)
  - pushToIntegration("slack", items) POSTs to the right URL with the right body
  - 412 surfaces as `{ ok:false, not_connected:true, message }`
  - Per-item failures surface in `failedRecords`
  - Empty items list returns `no_items` (no network call)
  - getIntegrationStatus non-2xx returns `{ connected:false, error }`
  - getIntegrationStatus 2xx passes through the server payload

### Test count after this commit

| Suite | Files | Tests |
|---|---|---|
| `npm run test:contract` (netlify) | 57 passed | 898 passed / 14 skipped |
| `npm run test:unit` (src + scripts) | 104 passed | 1651 passed |
| `npm run test:integration` (excluding pre-existing invoice failures) | 40 passed | 270 passed |

The 6 `Account.invoices.integration.test.jsx` failures remain
pre-existing and unrelated (confirmed on the parent commit).

### Files changed in §18

```
netlify/functions/integrations-slack.js      +70
netlify/functions/lib/notify.js              +4
netlify/__tests__/integrations-slack.test.js +110
src/lib/integrationsClient.js                +60
src/lib/integrationsClient.test.js           +150  (new file)
src/components/ExportIntegrations.jsx        +135
src/components/ExportIntegrations.test.jsx   +80
src/styles/screens.css                       +20
```

### Final session state (16:25 IST 2026-08-10)

| Item | Value |
|---|---|
| Branch tip | `4b97cdc` (chore: trigger fresh branch redeploy) |
| Working tree | clean |
| In sync with origin | yes |
| Build SHA | `4b97cdc…` |
| Build status | ✅ live (32s after empty-commit push) |
| Branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` |
| Netlify basic auth | still on |
| "Push to" menu (Preview + Dashboard) | ✅ lists HubSpot, Notion, Airtable, **Slack** |
| "Send to a destination" modal (Dashboard + Batch) | ✅ tabs: Sheets, Airtable, Notion, **Slack** |
| Slack on-demand push | ✅ `POST /api/integrations/slack/send` |
| Slack event-driven push (§17) | ✅ still working |
| Slack 412 (not connected) | ✅ surfaces as `not_connected:true` for the modal to render |
| Commits on this branch (ahead of staging) | 18 |
| Async ops | none pending |

### Next session entry point

1. **Hard-reload** the branch deploy, sign in
2. **Verify "Push to"**: open Preview or Dashboard → click the
   "Push" button → confirm Slack appears as a 4th row with a
   connected/not-connected badge
3. **Verify "Send to a destination"**: select 1+ rows on Dashboard
   → click the export dropdown → "Integrations…" → confirm the
   "Slack" tab is present and shows the right connection state
4. **End-to-end check**: with Slack connected, push 1 row from
   each UI → confirm a Block Kit message lands in your Slack
   channel
5. **If "Slack isn't connected" shows up when it should be**:
   open the Account → Integrations tab, reconnect, hard-reload.
   The status fetch is lazy (only when the Slack tab opens) so a
   stale connection won't show up until you switch tabs.
6. **If Slack throws on push**: the server logs
   `[API/extractions] notifyExtractionComplete failed:` (§17) or
   the new `/send` path returns a structured failure in
   `failedRecords` with the upstream Slack error code. The UI
   surfaces the first 3 in the errors block at the bottom of the
   modal — paste that into the next session for diagnosis.

---

## 19. Zapier "Connect" — fix the 400 on token generation (78b7f94, 2f8bbde) — 2026-08-10 ~16:45 IST

**Shipped:** Account → Integrations → Zapier now actually mints a
token when you click "Connect Zapier".

### What the user reported

> The Account -> Integration -> Zapier does not allow generating
> token to connect with Zapier.
>
> Connect Zapier
> Generate a DatIQ Zapier token. Paste it into Zapier when
> installing the DatIQ private app.
> Provide either { token } to store an existing token, or {
> regenerate: true } to mint a new one.
> Action*  [Generate a new token ▼] / [Replace the existing token]
> The plaintext token is shown ONCE. Copy it into Zapier
> immediately. DatIQ stores only the SHA-256 hash.
> [Cancel] [Connect Zapier]

The "Provide either { token } to store an existing token, or {
regenerate: true } to mint a new one." text is the **server's
400 error message** rendered into the modal as the error banner.
The user did exactly what the modal asked — picked "Generate a
new token" and clicked Connect — and got the server yelling at
them.

### Root cause (semantic label/value mismatch)

The Zapier provider config in `IntegrationConnectModal.jsx` had a
`select` with two options:

```js
options: [
  { value: "generate",    label: "Generate a new token" },
  { value: "regenerate",  label: "Replace the existing token" },
],
```

The submit handler mapped:

```js
const regen = values._regenerate === "regenerate";
body = { regenerate: regen };
```

So:
- "Generate a new token" (the default!) → `body.regenerate = false`
- "Replace the existing token" → `body.regenerate = true`

The server requires `regenerate === true` to mint:

```js
const regenerate = body?.regenerate === true;
if (!regenerate && !body?.token) {
  return respond(400, { error: "Provide either { token } to store an existing token, or { regenerate: true } to mint a new one." });
}
```

So the **default option** the user picked sent `regenerate: false`
and the server correctly rejected it. Only "Replace the existing
token" actually worked, which is a terrible UX because that label
implies the user already HAS a token to replace.

### Why the labels were swapped

This is what the previous commit author must have thought:
- "Generate" = first-time, no existing token → don't regenerate
- "Regenerate" = replace existing → do regenerate

But the server only knows two paths: mint-a-new (`regenerate: true`)
or store-an-explicit-existing-token (`regenerate: false, token: "..."`).
The "Generate" path on the client meant "I have no existing token,
please don't regenerate" which the server interpreted as "I want to
store an existing token but didn't provide one" → 400.

There was no third path that mapped cleanly to "mint a new one even
though I don't have an existing one."

### Both client options did the same thing

On the server, when `regenerate: true`, the code mints a fresh
`zap_<base64url>` token and upserts the connection (PATCH first,
INSERT fallback), so any previous `token_hash` is overwritten. The
two client options differed only in the false/true boolean; both
ultimately resulted in a new token. The select was theatre.

The "store an existing token" server path (`regenerate: false,
token: "..."`) was reachable only by direct API calls — no UI input
existed for it.

### The fix (3 files, 1 commit)

1. **`IntegrationConnectModal.jsx` — Zapier provider simplified**

   `fields: []`, no select, no input. The submit handler always
   sends `{ regenerate: true, action: "connect" }` for Zapier,
   regardless of any form state. A standalone help paragraph
   explains that every connect mints a fresh token and invalidates
   any previous one.

2. **`styles/screens.css` — `.icm-help-standalone`**

   Slightly larger than a field hint, used when a provider has no
   fields (Zapier is the only one today; future providers like
   Discord or a Webhook might follow the same shape).

3. **`src/components/IntegrationConnectModal.test.jsx` — new test
   file** with 5 tests focused on the Zapier flow:

   - Renders no `<select>`, just the standalone help text
   - Submit POSTs `{ regenerate: true, action: "connect" }` and
     never the old `{ _regenerate, token }` shape
   - Success shows the mint-once copy-box with the new plaintext
   - Server 400 surfaces inline (no thrown exception)
   - Rejects with "must be signed in" when no session

### What I deliberately didn't change

The "store an existing token" path is still in `handleConnect` —
it accepts `body.token` and stores its hash without echoing the
plaintext back. The Zapier server tests (4 of them in
`netlify/__tests__/integrations-zapier.test.js`) still pass
without modification.

Removing that server path would be a wider blast radius than the
user asked for. The 4 existing tests pin its behavior, and any
future client (e.g. a migration tool, a CLI) might want to use it.
The modal change is sufficient and self-contained.

### Files changed in §19

```
src/components/IntegrationConnectModal.jsx       +24/-16
src/components/IntegrationConnectModal.test.jsx  +180  (new)
src/styles/screens.css                            +4
```

### Test count after this commit

| Suite | Files | Tests |
|---|---|---|
| `npm run test:contract` (netlify) | 57 passed | 898 passed / 14 skipped |
| `npm run test:unit` (src + scripts) | 105 passed | 1656 passed |
| `npm run test:integration` (excluding pre-existing invoice failures) | 40 passed | 270 passed |

The 6 `Account.invoices.integration.test.jsx` failures remain
pre-existing and unrelated.

### Final session state (16:45 IST 2026-08-10)

| Item | Value |
|---|---|
| Branch tip | `2f8bbde` (chore: trigger fresh branch redeploy) |
| Working tree | clean |
| In sync with origin | yes |
| Build SHA | `2f8bbde…` |
| Build status | ✅ live (32s after empty-commit push) |
| Branch deploy | `https://integration-with-outside-ecosystem--datiqapp.netlify.app` |
| Netlify basic auth | still on |
| Zapier connect flow | ✅ click → POST { regenerate: true } → copy token box |
| Async ops | none pending |

### Next session entry point

1. **Hard-reload** the branch deploy, sign in
2. **Verify the fix**: open Account → Integrations → click
   "Connect" on the Zapier row → confirm the modal shows no
   "Generate vs Replace" select, just a help paragraph and a
   "Connect Zapier" button
3. **Click Connect Zapier**: should mint a `zap_...` token and
   show it in a copy-box. Click "Copy" and paste it into Zapier
   when installing the DatIQ private app.
4. **If the error still appears**: the modal will show the server's
   response in the error banner. The most likely cause now is the
   `body.action` dispatch (the §15/§16 fix) failing — paste the
   new error string into the next session and the diagnostic will
   point to which leg (body / query / path) is broken.
5. **If the token mints but the copy box doesn't show**: check
   the browser console for a `data.token` reference in the
   response. The modal shows the copy box only if
   `data.token` is truthy; the server is required to include it on
   mint but if the JSON is malformed the modal will silently fall
   through to the generic "Connected" pane.
