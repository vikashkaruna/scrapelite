# Session handoff — 2026-08-26 (later) — Team Workspaces + OAuth redirect investigation

> Continuation of the same-day session that shipped the AI-era Discoverability
> module (see the entry above this one in `CLAUDE.md`, and
> [docs/DISCOVERABILITY-MODULE.md](DISCOVERABILITY-MODULE.md)). Two threads,
> one shipped and merged, one analysis-only and still open.

---

## 1. Team Workspaces — shipped, merged to `staging`

### Why

`/workspace` has always been a single-owner dashboard — nobody could be
invited into it — despite `pricingConfig.js` already selling **"5 client
workspaces"** on Agency and a paid **"Extra Workspace"** add-on. The user
asked for an analysis of whether that gap and the Discoverability module's
own `workspace_id` hook could converge. The analysis (published as an
artifact, not saved to the repo) corrected two premises in the request
before finding the real gap:

- **Discoverability does NOT have its own workspaces table.** It
  deliberately doesn't — it only carries a nullable `workspace_id` on six
  tables, reserved for exactly this day, matching DatIQ's own pattern.
- **The "separate auth system" PRD item was already closed.** No second
  login system was ever built; every discoverability route already resolves
  identity through the same Supabase JWT as the rest of DatIQ.

The real, unbuilt gap: **no `workspaces` table existed anywhere in the
schema**, core or discoverability. `entitlementModel.js` already had a
`workspace.team_seats` case ready for one; nothing had ever called it.

### What shipped

- **`0031_team_workspaces.sql`** — `workspaces` + `workspace_members` (role:
  owner/admin/member; **seat count includes the owner**, a documented
  convention choice) + `workspace_invites` (64-hex token, 14-day expiry, one
  pending invite per email per workspace). Four RPC functions
  (`create_workspace`, `create_workspace_invite`, `accept_workspace_invite`,
  `remove_workspace_member`). Same posture as `0029_referrals.sql`:
  service-key-only RLS, no anon/authenticated policy — the browser only ever
  reaches Supabase through `apiClient.js` → Netlify Functions.
  **60 tables / 28 functions / 11 triggers.**
- **`netlify/functions/workspaces.js` + `lib/workspaces.js`** — the handler.
  Two new `entitlementModel.js` capabilities gate it: `workspace.create`
  (base `plan.limits.workspaces` + purchased Extra-Workspace bundles) and
  the now-actually-enforced `workspace.team_seats`.
- **Client:** `workspacesService.js` (never-throws wrapper, matches
  `referralService.js`), six new `apiClient.js` methods, a **"Team" tab** on
  `/workspace` (`TeamTab.jsx` — switcher, create form, member list with
  role badges, invite form with a once-only copy-link box, pending-invite
  list with revoke), and `PendingWorkspaceInviteFlush.jsx` +
  `pendingWorkspaceInvite.js` (mirrors `PendingReferralFlush` — `?invite=`
  is stashed in sessionStorage and redeemed once a session exists, because
  acceptance is signed-in-only and email-bound to the accepting account's
  own JWT email).

### A real, pre-existing bug caught by being the first real caller

`workspace.team_seats` already existed in `entitlementModel.js` but had
never been exercised — nothing called it, because the primitive didn't
exist yet. It read:

```js
const cap = L.team_seats || 0;
return cap > 0 ? ok(cap - seatsUsed) : deny(...)
```

This returns `ok()` **even when `seatsUsed >= cap`** — a workspace already
full, or one over its cap after a downgrade, was reported as allowed with a
zero-or-negative `remaining`. My own contract test caught it (expected 402,
got 409 — the invite silently reached the database instead of being
denied). Fixed to check `remaining <= 0` explicitly, matching every other
quota case in the file. Regression-tested in both `entitlementModel.test.js`
and `netlify/__tests__/workspaces.test.js`.

### Deliberately not done this session, and why

Wiring extractions/schedules/batch runs/audits to actually **save** under a
workspace (the roadmap's Phase 2/3) needs a global "which workspace am I
working in" concept that doesn't exist anywhere in the app yet — no
`WorkspaceContext`, no switcher in `TopBar`. Half-wiring that across four
save paths without designing the switcher first was judged worse than
shipping the primitive alone. **Next session's concrete starting point:**
design the switcher (where does it live — `TopBar`? a `WorkspaceContext`
provider above the router, same layer as `BatchRunProvider`?), then
backfill `workspace_id` on `extractions` / `scheduled_tasks` (new nullable
columns — they don't have one today) and on the six discoverability tables
that already reserve it.

### Verified

`npm test` **256 files / 4008 passed / 14 skipped / 0 failed** (+54 new),
db **31 migrations / 215 + 17 assertions, 0 failed** (19 new), `npm run
build` clean, readiness 6 pass/1 warn/0 fail, security clean, e2e smoke 125
passed/1 skipped/0 failed (unchanged — no new e2e added; the authenticated
invite/accept flow needs a real Supabase session this sandbox doesn't have,
so it's proven at the contract-test layer only — worth closing before this
ships further).

### Merged to `staging`

Branch `claude/datiq-discoverability-module-542c4a` pushed to origin, then
merged into `staging` via an isolated temporary worktree (so the working
worktree's own checkout was never disturbed). One conflict, in `CLAUDE.md`'s
header only (both branches had independently prepended a new "Last updated"
entry) — resolved by hand, both session records preserved in order. No code
conflicts. The merged tree was independently re-verified (fresh
`npm install`, build, full suite, db-verify, readiness, security) before
pushing — not just trusted from the merge. `origin/staging` is now
`846bf86`. `main` was **not** touched, per explicit instruction, and is
confirmed unchanged at `069df45`.

⚠️ **Environment trap worth carrying forward:** this worktree's own
`node_modules` was empty on session start — each git worktree needs its own
`npm install`, it does not inherit the main checkout's. And the shell's
default Node was **v26.7.0** against this project's pinned `>=24 <25`,
which silently breaks jsdom's `localStorage` polyfill and cascades into
~1478 unrelated-looking test failures with no obvious connection to Node
version in the output. Fixed via `nvm use 24` (24.17.0 was already
installed via nvm). **This bit the `git push` step too** — the pre-push
hook spawns its own gate-running subprocess, and since each Bash tool call
is a fresh shell, `nvm use 24` from an earlier command does not carry into
a later `git push` call unless both are chained in the same invocation. A
push that reports ~1478 hook failures is very likely this, not a real
regression — check `node --version` first.

---

## 2. OAuth redirect investigation — Google Auth on branch deploys, OPEN

### The report

Every branch build/deploy, when a user authenticates via Google, lands back
on `staging.datiq.app` instead of returning to the branch it started on.

### What's already ruled out

The application code is correct and was already fixed in a prior session
(`public/runtime-config.js` v3, 2026-08-10): `authReturnUrl` is computed
per-branch (`main` → fixed `https://datiq.app`, everything else →
`window.location.origin`), and `authService.js` passes it as
`redirectTo`/`emailRedirectTo` on every call. Google/Microsoft's OAuth
console config was also confirmed correct in concept and not the cause —
they only ever see Supabase's own fixed callback URL
(`https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback` for
staging/branch deploys), never the branch URL directly, so per-branch
entries there would be both unnecessary and impossible (Google doesn't
support wildcards). This is documented in
[docs/SUPABASE-AUTH-REDIRECT-URLS.md](SUPABASE-AUTH-REDIRECT-URLS.md).

Two specific hypotheses were raised and ruled out by the user directly:
- The wildcard `https://*--datiqapp.netlify.app/**` is confirmed **present**
  in Supabase's Additional Redirect URLs.
- It's confirmed on the **correct** (staging/dev,
  `aubwooslkkrprdxuiyvj`) project, not production.

### What's still open

The remaining, unconfirmed leading hypothesis: **Supabase's wildcard
matcher may not resolve Netlify's `<branch>--<site>.netlify.app` URL shape
the way the entry assumes**, even though the entry is present and on the
right project. This can only be confirmed by watching a live OAuth
round-trip: on a branch deploy, DevTools → Network (Preserve log on) →
click "Sign in with Google" → capture two things:

1. The first request's `redirect_to` query param
   (`GET .../auth/v1/authorize?provider=google&redirect_to=...`) — confirms
   the client is sending the right value.
2. The `Location` response header on the 302 from
   `GET .../auth/v1/callback?code=...&state=...` — this is GoTrue's actual
   decision, and tells us definitively whether it honored `redirect_to` or
   fell back to the project's Site URL.

Supabase's Authentication → Logs section was not available in the user's
dashboard (only "Audit Logs", which tracks dashboard config changes, not
runtime auth requests, and was off — irrelevant to this even if turned on).
The DevTools trace above is the substitute and doesn't need it.

**No code or config changes were made for this thread — analysis only, as
requested.** Next session: get the DevTools trace above, then decide
between (a) a working-but-syntactically-different wildcard pattern, (b)
checking the staging project's Site URL isn't itself defaulted to
`staging.datiq.app`, or (c) GitHub OAuth's known, accepted limitation
(single callback URL, pinned to production — not a bug, a scope decision
if branch-deploy GitHub sign-in is ever wanted).

---

## 3. Two real bugs fixed, later the same day — shipped, merged to `staging`

The OAuth investigation above was interrupted by two concrete, reproducible
bug reports on `/discoverability` itself, both fixed and shipped.

### 3a. "Unknown endpoint" on every audit run

Running an audit against a real URL (e.g. `https://datiq.app`) returned
*"Something went wrong / Unknown endpoint"* — every time, and "Try again"
reproduced it exactly, which was the tell: a routing failure, not a
transient one.

**Root cause:** `netlify.toml` forwarded `/api/discoverability/*` and
`/api/v1/*`'s sub-path as a **query param** (`?splat=:splat`). That exact
substitution was already found to silently fail on an **explicit-prefix
wildcard rule** in production once before — it's what broke every
integrations provider (HubSpot, Notion, Airtable, Slack, Zapier), fixed in
commit `87f5597` by switching to path-based forwarding
(`/.netlify/functions/<fn>/:splat`) plus a path-based fallback in each
handler. `discoverability.js` and `api-v1.js` use the identical rule shape
(`from = "/api/discoverability/*"`, a fixed prefix + wildcard — not the
"generic wildcard router path" the original bug report says still worked)
and never received that fix. Result: `event.queryStringParameters.splat`
comes back empty on a real request, `parsePath` returns `[]`, routing falls
through every branch to the "Unknown endpoint" 404.

**Fix:** both redirects now forward the splat as a path segment
(`to = "/.netlify/functions/discoverability/:splat"`), matching the
integrations fix exactly, and both `discoverability.js` and `api-v1.js`
gained a `resolveSplat(event)` helper that tries the query param first
(still needed — `api-v1.js`'s in-process delegation into
`discoverability.js` sets it directly, bypassing Netlify's redirect engine
entirely) and falls back to parsing `event.path`'s tail when it's empty.

New tests in `netlify/__tests__/audit/discoverability-api.test.js` and
`netlify/__tests__/api-v1.test.js` construct an event exactly the way a
real post-fix request looks (`queryStringParameters: {}`, `path:
"/.netlify/functions/<fn>/<sub-path>"`) and assert the route resolves.
**Confirmed to fail against the pre-fix code** (via a temporary `git
stash` of just the fix, re-run, then restored) before being accepted.

### 3b. Sign-in interruption loses the screen and the URL

Clicking Run audit while signed out correctly opened the auth modal — but
after completing sign-in, the user did not land back on `/discoverability`,
and the URL they had typed was gone.

**Root cause:** Google/Microsoft sign-in is a full-page navigation away
(to the provider) and back, which discards every bit of React state —
including `AuditComposer`'s local `url` field. `run()` simply called
`openAuth("signup")` and returned, keeping nothing. Separately, the OAuth
`redirectTo` is just the app's origin (`window.location.origin`), never a
specific path, so even a successful round trip could land the user
anywhere, not necessarily back on `/discoverability`.

**Fix, mirroring the referral/workspace-invite pattern exactly:**
- `run()` now stashes the full request (`target_url` + advanced options)
  to sessionStorage via a new `src/lib/pendingAudit.js` before opening
  auth — sessionStorage survives the OAuth round trip that component state
  doesn't.
- A new global `PendingAuditFlush.jsx`, mounted in Shell next to
  `PendingReferralFlush`/`PendingWorkspaceInviteFlush`, watches for a
  session and, once one exists, navigates to `/discoverability` with the
  stashed request in router `state` — regardless of which page the OAuth
  callback actually landed on.
- `Discoverability.jsx` has ONE resume effect keyed on
  `location.state?.resumeAudit`, guarded against double-firing. It covers
  both interruption paths identically: the OAuth full-navigation case
  (fresh mount, state arrives via the flush component's navigate) and the
  in-page email/password-modal case (component never unmounts, `user`
  flips true, the SAME flush component still does the navigate — this
  page was already mounted, so React Router just delivers new state to it)
  — there is no separate code path for "which auth method was used".
- `AuditComposer` gained `defaultProfile`/`defaultDevice`/`defaultPageType`
  alongside the existing `defaultUrl`, and the call site now passes a
  `key` that only changes on a resume (`"composer"` otherwise) — forcing a
  remount so the composer picks up the resumed request rather than
  starting blank. A normal run never changes the key, so typing, Advanced
  options etc. behave exactly as before.

New tests in `src/pages/Discoverability.integration.test.jsx`: the request
is stashed and the API is never called while signed out; an empty
submission never stashes anything; a resumed request both calls the API
AND shows its URL back in the input; the resume cannot double-fire on a
re-render. **Confirmed to fail against the pre-fix code** the same way —
3 of the 4 new tests failed pre-fix (the 4th asserts a property that was
already true, by design, and correctly stayed passing on both sides).

**Verified:** `npm test` **256 files / 4016 passed / 14 skipped / 0
failed** (+8 over the team-workspaces baseline above), db unchanged (no
schema touched — **31 migrations / 215 + 17 assertions, 0 failed**),
`npm run build` clean, readiness **5 pass / 2 warn / 0 fail** (same
pre-existing warns), security clean, e2e smoke **125 passed / 1 skipped /
0 failed** (unchanged). A live browser check confirmed the client-side
behaviour directly (auth modal opens, sessionStorage stash captured
correctly) — full end-to-end verification of the routing fix against a
real deployed backend wasn't possible in this sandbox (no live Netlify
Functions server, no Supabase), so that half rests on the test suite
reproducing the exact reported symptom plus the proven precedent from the
integrations fix, not a live network trace.

Merged to `staging` the same way as the team-workspaces merge above: push
the branch, merge into `staging` via an isolated temporary worktree (this
worktree's own checkout untouched throughout), independently re-verify the
merged tree (fresh install, full suite, db-verify, build, readiness,
security — not just trusted from the merge), then push. `main` untouched.
