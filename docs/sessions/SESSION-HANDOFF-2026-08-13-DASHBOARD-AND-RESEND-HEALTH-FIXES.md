# Session Handoff — 2026-08-13 — Dashboard Disappearing-Extractions + Resend Health False-Positive

> **Read first next session.** Branch `claude/extractions-missing-dashboard-0ur53y`
> was created off `main` @ `83bc2a1` (already had the six-mobile-bug-fix session
> merged in via PR #85), got two independent bug fixes (commits `6fd4745`,
> `7834a44`), and **was merged into `staging` this session** (fast-forward, no
> conflicts — `staging` was a strict ancestor of this branch). `main` was **not**
> touched — only `staging` was updated, per explicit user instruction. No deploy
> was triggered.

## What this session was

Two unrelated bug fixes, reported and fixed independently in the same session:

1. A mobile screenshot showing `/dashboard` loading saved extractions and then
   flipping to the empty state ("Nothing saved yet").
2. `/admin/health` reporting **Email (Resend) — Down — "RESEND_API_KEY was
   rejected — no mail can be sent"** when the key was, in fact, working.

## Fix 1 — Dashboard extractions load then disappear (commit `6fd4745`)

**Root cause**: `Dashboard.jsx` paints `items` instantly from the `datiq.saved`
localStorage cache (`useState(readLocalItems)`), then a mount effect calls
`listExtractions()` and does `setItems(rows)` **unconditionally** — same pattern
in the "Refresh" button. `extractionsRepo.listExtractions()` only fell back to
localStorage when the API call **threw**; a **successful** `GET
/api/extractions` that legitimately returns `[]` for the current account was
trusted as authoritative and returned as-is, wiping the cards that were just
shown.

The trigger: extractions saved while unauthenticated fall into the
localStorage-only path in `saveExtraction()` (401 with no bearer token → the
`shouldFallback` branch) and never reach Supabase. Once the browser is
authenticated, `GET /api/extractions` filters strictly by `user_id` and
correctly returns `[]` for an account with no synced rows — a real, non-error
empty result — but Dashboard treated it as "the truth" and discarded the
cached items. The persona `<h1>` (e.g. "Prospect Research" for the sales
persona) never changed through this because it's sourced from a separate
provider (`PersonaProvider`), unrelated to the extraction list — which is why
the header looked populated while the body went empty.

This is exactly the class of bug the code's own `getOwnerId()` comment
describes and excuses itself from: *"Items that predate this change … are
hidden from the per-user widget — they still appear in the full Dashboard."*
The full Dashboard is documented to show every local item regardless of
ownership, unlike the owner-filtered Home "Recent Extractions" widget. The
implementation just didn't honor that once a network fetch succeeded.

**Fix**: `listExtractions()` in `src/lib/extractionsRepo.js` now **merges**
server rows with local-only items (by id) instead of replacing wholesale. One
shared function — `Dashboard.jsx` (mount effect + `refreshData`),
`Workspace.jsx`, `CollectionsTab.jsx`, `collectionsService.js`, and
`tagsService.js` all call it, so every consumer is fixed at once with no
per-file changes. `RecentExtractions.jsx` on Home is untouched — it reads
`datiq.saved` directly with its own separate owner filter, never calling
`listExtractions()`.

Tests added in `src/lib/extractionsRepo.test.js`: empty server response with
local items present → merges instead of dropping; partial server response →
local-only items appended; matching id → server row wins, no duplicate.

## Fix 2 — Resend health probe false "Down" (commit `7834a44`)

**Root cause**: `probeResend()` in `netlify/functions/lib/healthProbes.js`
tests `RESEND_API_KEY` with `GET https://api.resend.com/domains` and treated
**any** 401/403 as "key rejected — no mail can be sent." Resend has two API
key permission levels — **Full access** and **Sending access** (the
least-privilege choice for a key that only ever sends mail, which is all this
app does with `RESEND_API_KEY`). A sending-access key is *correctly* rejected
from `GET /domains` (a Full-access-only endpoint), and Resend names that exact
case in the response body: `{ "name": "restricted_api_key", "message": "This
API key is restricted to only send emails" }` — distinct from a genuinely
invalid/revoked key. The probe conflated the two, so a securely-scoped,
fully-functional key was reported as a total outage. Confirmed via web search
against Resend's own error-reference docs (`missing_api_key` /
`invalid_api_key` / `restricted_api_key` are three separate named errors);
`resend.com` itself was unreachable through this session's egress proxy, so
the fix leans on the corroborated `name` field rather than the HTTP status
code alone (status-code mapping between the two cases was inconsistently
reported across sources — the `name` field was not).

**Fix**: on a 401/403, the probe now parses the JSON body. If
`body.name === "restricted_api_key"`, it reports the component as
reachable/healthy (no explicit `status` → classifies to `OK`) with a note that
domain-verification status can't be checked from a sending-scoped key — honest
about what wasn't verified, without calling it down. Any other 401/403
(unparseable body, a different `name`, or none at all — the ordinary shape of
an actually-bad key) still reports `down`, unchanged.

Tests added in `netlify/__tests__/lib/healthProbes.test.js`: a
`restricted_api_key` body → reports healthy with the sending-access note; a
different/unknown 401 body (e.g. `invalid_api_key`) → still reports down. The
pre-existing test in `admin-health.test.js` that mocks a **plain, empty-body**
401 still passes unchanged (falls through to the same "down" branch it always
did).

⚠️ **If `/admin/health` still shows Resend as Down after this ships**, the key
genuinely is invalid/revoked (or Resend changed their error shape) — this fix
only removes the false positive for the secure, sending-only key type Resend
itself recommends; it does not manufacture health where none exists.

## Verified

- `npx vitest run` — **225 files / 3420 passed / 14 skipped / 0 failed** (+5 new
  tests this session: 3 in `extractionsRepo.test.js`, 2 in
  `healthProbes.test.js`).
- `npm run build` — clean (same pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` /
  chunk-size warnings as before, unrelated to this session).
- No live Netlify/Supabase/Resend access in this sandbox — both fixes verified
  by targeted unit tests against mocked `fetch`/API responses, not against
  live production data.

## Next session entry point

```bash
cd /home/user/scrapelite
git checkout staging
git pull origin staging
npm ci && npm run build && npm test
```

`staging` now has everything `main` had (through PR #85) plus these two fixes.
`main` is untouched — merge `staging` → `main` (or open a PR) when the user
wants this in production. No deploy was triggered this session.
