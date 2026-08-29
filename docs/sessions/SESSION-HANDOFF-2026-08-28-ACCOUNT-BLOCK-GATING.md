# Session handoff — 2026-08-28 — Account-deletion billing error, and early account-block gating

**Branch:** `claude/account-deletion-billing-error-79ff77` (deleted from remote after merge into `staging`; fully contained, safe).
**Merged to `staging`:** fast-forward `990544c` → `57eb03a` → `deaf27f`.
**PR to `main`:** [#123](https://github.com/vikashkaruna/scrapelite/pull/123) — open, not yet merged. `main` untouched at `550905e`, now 10 behind.
**Migration `0035`:** applied to staging Supabase (`aubwooslkkrprdxuiyvj`) by the user, confirmed working live. **Not yet applied to production Supabase** — apply before/with the `main` merge.

---

## Part 1 — "we could not find a billing record for this account"

Reported: freezing or deleting a **free** account failed with that message and appeared to do nothing. Same symptom for both actions.

**Root cause:** `entitlements` only ever gets a row for a user through a billing event — claiming a paid session (`0012`), a referral bonus (`0029`), or an admin coupon grant (`0027`). A free user who never bought, was never referred, and never got a coupon — the overwhelmingly common case — has **no entitlements row at all**. `set_account_frozen` and `request_account_deletion` did a plain `UPDATE … WHERE user_id = …`, found zero rows, and returned `not_found`, which `account-state.js` turns into the billing-record message. It wasn't silently deleting anyway — the account genuinely was never touched; a 2.6s auto-dismissing toast just made a real refusal look like nothing happened.

**Fix:** [`supabase/migrations/0035_account_state_bootstrap_entitlements.sql`](../supabase/migrations/0035_account_state_bootstrap_entitlements.sql) — both functions now bootstrap a default row (`plan_id='free', status='active'`, the table's own defaults) for any real signed-in user before acting. A `p_user_id` that isn't a real `auth.users` row still reports `not_found` (the bootstrap insert's FK violation is caught), so the existing "freezing an unknown user" contract in `scripts/db-verify.mjs` is unchanged. New tests confirmed to fail against the pre-fix functions (`got="not_found" want="ok"`) before being accepted. 271/271 db assertions green.

---

## Part 2 — frozen/deletion-pending accounts could still extract/enrich, spending real provider calls

Follow-up report: an account already scheduled for deletion could still click Extract/Enrich, run the full scrape + AI call, and *only then* get a 402 refusal — rendered as a generic "Something went wrong" with a raw minified stack under "technical details". Asked for the check to happen early (before any cost is incurred) with a clear message, and for the same discipline on frozen accounts and paused team members.

**Three separable bugs found, all in the same gate:**

1. **The client pre-flight was a no-op for this class of block.** `BillingProvider.jsx`'s `entitlement` object — the one every client-side check (`checkCanExtract`, `checkCanEnrich`, `checkCanBatch`, `checkCanExtractBatch`) decides against via `can()` — was rebuilt from the server row but **dropped `frozen_at`/`deletion_requested_at`/`frozen_reason`/`deletion_purge_after` entirely**. `can()`'s freeze/deletion branch (`entitlementModel.js` §1b) reads those fields directly, so it could never fire client-side. The request always looked clean and only the server (which reads the real row) ever refused it — after the cost was already spent. Server-side gate ORDER was already correct everywhere checked (`extract.js`, `ai.js`, `discoverability.js` all check entitlement before any provider call) — this was purely a client-visibility gap.
2. **Wrong message/CTA on denial.** Both the pre-flight and the discoverability audit-error mapper treated every denial as a plan/quota problem — appending "Upgrade your plan to continue" and routing to `/pricing`, which is nonsensical for "your account is frozen" (the fix is in Account, not Pricing).
3. **`errorMessages.js` had no classification for these codes**, so a 402 that did reach the catch block fell through to the generic default with a stack trace attached — same shape as the earlier robots.txt-refusal-reported-as-a-crash bug.

**Fix, one shared primitive:** `ACCOUNT_BLOCKED_CODES`/`isAccountBlocked()` in [`entitlementModel.js`](../src/lib/entitlementModel.js) — `FROZEN, DELETION_PENDING, MEMBER_PAUSED, SUSPENDED, DEACTIVATED, GRANT_EXPIRED, PURGED`. Used everywhere a denial becomes UI copy:
- `BillingProvider.jsx` — entitlement object now carries the missing fields.
- `ExtractionProvider.jsx`, `Batch.jsx` — pre-flight denials for a blocked-account code show the server's own message and route to `/account`; everything else keeps the existing upgrade-to-`/pricing` behavior.
- `errorMessages.js` — `classifyError`/`formatDetail` recognize these codes first (before the regex categories), render the server's own message verbatim, and suppress the stack trace.
- `requireEntitlement.js` — `denyBody`'s `lifecycle` flag now covers the whole `ACCOUNT_BLOCKED_CODES` set (was `SUSPENDED`/`DEACTIVATED`/`PURGED` only) — this one-line change also fixes `discoverabilityClient.js`'s `describeAuditError`, which already branches on `err.lifecycle` but only ever saw it for a lapsed subscription, never a freeze/deletion.
- `DangerZone.jsx` — every successful freeze/unfreeze/delete/cancel now calls `refreshEntitlement()`, so the change is visible to pre-flight checks immediately instead of waiting out the entitlement cache's 60s TTL.

Two new `BillingProvider.suspension.integration.test.jsx` tests confirmed to fail against the pre-fix entitlement object (`extract` read `"true"` instead of `"false"` for a frozen/deletion-pending row) before being accepted. Full local suite green: unit 2376, contract 1586 (+14 skipped), integration 356, db 271/35, build, check:prerender, security.

### 🔴 Explicitly NOT fixed — flagged, not silently expanded

**Per-seat workspace member pause is not actually enforced anywhere.** `entitlementModel.js`'s `can()` already has a `ctx.memberPaused` branch (tested in `entitlementModel.test.js`), but **no server endpoint ever populates it** — grepping `netlify/functions` for `memberPaused` finds zero real callers. `extract.js`/`ai.js`/`discoverability.js` have no notion of "which workspace is this request happening under" at all — this is the same deliberately-deferred gap CLAUDE.md already documents from the Team Workspaces session ("wiring extractions/schedules/batch runs/audits to actually SAVE under a workspace ... needs a global 'which workspace am I working in' concept that doesn't exist anywhere in the app yet"). Enforcing a paused seat for real needs that workspace-context concept designed first — a UI toggle that occupies a seat and looks enforced but isn't is worse than no toggle, so this is worth its own session before anyone relies on it.

### Naming (resolved, no change made)

User asked whether "Freeze" should be "Pause" instead, since Freeze sounds administrator-initiated. Confirmed via AskUserQuestion: **keep as-is**. The codebase already has three distinct, non-colliding terms: `suspended` = billing lifecycle (system/admin-driven dunning + purge), `paused` = a workspace owner/admin acting on *someone else's* seat, `frozen` = the account owner acting on *their own* usage (the DangerZone button). No DatIQ-staff-initiated account freeze exists to collide with "Freeze account" — revisit only if/when a support-side account lock ships (suggested word if it does: "Lock", not "Freeze" or "Pause").

---

## Environment notes for next session

- **Shared `/Users/vikash/Extracta` node_modules was stale against THIS worktree's package.json** (`@vitejs/plugin-react` 5.2.0 installed vs this branch's declared `^6.1.0`) — but the shared root checkout is on branch `node-24-upgrade`, which itself declares the OLDER `^5.2.0` and has its own consistent lockfile. Running `npm ci` in the root checkout is **not** the fix when worktree branches disagree on dependency versions like this — it just re-confirms the root's own (older) tree. The correct, non-disruptive fix (matching prior documented precedent) is `npm install --no-save <pkg>@<range>` **from inside the affected worktree** — this places the correct versions in that worktree's own (otherwise near-empty) `node_modules`, which Node's resolution prefers over the shared parent directory, with zero effect on the root checkout or any other worktree.
- ⚠️ **A `git stash` recovery mid-session went briefly wrong**: after `git stash apply <sha>` restored a temporarily-reverted file (to prove a test fails pre-fix), a reflexive `git checkout -- <file>` immediately discarded the just-restored fix again. Caught immediately by re-running `git diff` and re-applying from the still-present stash entry before dropping it — but the lesson: after `stash apply` to restore working-tree changes, verify with `git diff` before touching the file with anything else, `checkout --` included.
- `main` still needs migration `0035` applied to **production** Supabase before or alongside merging PR #123.

## Next session entry point

1. Check PR #123 status — merge to `main` when ready (owner's call, not automatic).
2. Apply migration `0035` to production Supabase before/with that merge.
3. If the workspace member-pause gap above is worth closing, that is its own scoped session: design "which workspace is this request against" first, then wire `ctx.memberPaused` into `extract.js`/`ai.js`/`discoverability.js`.
