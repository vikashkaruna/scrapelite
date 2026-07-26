# Session handoff — 2026-07-26 · CI gate unblock (staging → production path)

> **State at close:** `main` and `staging` both at `5bcbfa1`, in sync with origin.
> Only two branches exist. All Staging Gate checks are **GREEN, including
> `Deployed & Smoke Tested` at 12/12** — the check that had been red at 11/12
> since 2026-07-25.
>
> **Production has NOT shipped yet.** `datiq.app` still serves `527a8ee`
> (2026-07-19). The final blocker was found and fixed this session, but the
> resulting Phase-Gate run needs a human approval before it deploys.
> **Next action: approve the newest Phase-Gate run on `main`.**

---

## What was broken, and what fixed it

Four separate defects, each hiding the next. They had to be peeled in order.

### 1. Integration suite exited 1 while reporting 180/180 passed

`6d25423` — `fix(tests): guard async setState after unmount`

Vitest exits non-zero on unhandled rejections. Two components started async work
on mount and called `setState` when it resolved, with no unmount guard. On a
loaded CI runner the promise settled *after* the test file's jsdom environment
was torn down, so React's `dispatchSetState` reached for a `window` that no
longer existed:

```
ReferenceError: window is not defined
  at getCurrentEventPriority (react-dom)
  at dispatchSetState (react-dom)
```

- `src/components/BillingProvider.jsx` — four mount fetches (`getRates`,
  `fetchUsageFromDb`, `fetchSubscriptionFromDb`, `fetchPaymentHistory`) now
  share a `cancelled` flag released by the effect cleanup.
- `src/pages/admin/AdminRevenue.jsx` — `load()` is also driven by the Refresh
  button, so a click-started fetch can outlive the component. Needs an `alive`
  ref, not an effect-scoped flag.

In the app this path is only a setState-on-unmounted no-op, which is why it went
unnoticed. **It was flaky, not deterministic** — pre-fix local runs produced
1, 0, then 2 unhandled rejections; post-fix, 0 across five runs. Don't trust a
single green run when re-testing this class of bug.

### 2. Phase gate rejected a valid staging→main ancestry

`2770fb7` — `fix(ci): accept either-direction staging/main ancestry`

`Staging Released & Tested` read only the newest ready staging deploy and
required it to be an *ancestor* of the main commit under test. Run #22 gated
`bded77d` while staging had already advanced to `14dd570`, which **contains**
`bded77d` — the policy was satisfied, just in the opposite direction.

Now accepts either direction (`staging ⊆ main` or `main ⊆ staging`, both prove
the content was deployed and tested on staging) and scans every ready staging
deploy rather than `.[0]`.

### 3. Staging admin PIN — a long detour, worth reading before touching PINs

`Deployed & Smoke Tested` failed its 12th probe with `BAD_PIN`. The mechanics:

| variable | lives in | holds |
|---|---|---|
| `STAGING_ADMIN_PIN` | GitHub repo secret | the **plaintext** PIN |
| `ADMIN_PIN_HASH` | Netlify env, per context | **SHA-256 hex** of that PIN |

`netlify/functions/admin-auth.js:59` computes `sha256Hex(pin)` and compares it
to `ADMIN_PIN_HASH`. The two variables are therefore **never** the same value.

Things learned the hard way:

- **Netlify marks `ADMIN_PIN_HASH` `is_secret: true`, so the API returns a
  masked placeholder, not the value.** An early diagnosis in this session was
  built on those masks and was wrong — it concluded no PIN could ever
  authenticate, while production `/admin` was working fine. **Do not infer
  anything about a secret env var's contents from the Netlify API.**
- **Netlify bakes env vars in at deploy time.** Changing `ADMIN_PIN_HASH`
  does nothing until that context redeploys. Two failures this session were
  purely this: the value was correct and simply hadn't shipped. Branch deploys
  rebuild on push, so an empty commit is the reliable trigger.
- **Netlify resolves the most specific scope.** `staging--datiqapp.netlify.app`
  reads `branch:staging`, never the generic `branch-deploy` value. There is no
  "staging" *context* to create — contexts are a fixed set
  (`production`, `deploy-preview`, `branch-deploy`, `dev`); what you add is a
  branch-specific value under Branch deploys.
- **Neither GitHub environment (`staging-release`, `production-release`) has
  scoped secrets**, so both workflows read the same repo-level
  `STAGING_ADMIN_PIN`. Scope is not a variable here.
- `shasum` prints `<hash>  -`. Pasting the trailing `  -`, or letting `echo`
  append a newline, silently changes the digest. Use
  `printf '%s' 'PIN' | shasum -a 256` and paste only the 64 hex chars.

**Debug procedure that actually works** — change ONE side, prove it, then the
other. Changing both at once means every failure has two possible causes, which
is what stretched this out:

```bash
curl -s -X POST https://staging--datiqapp.netlify.app/.netlify/functions/admin-auth \
  -H 'content-type: application/json' -d '{"pin":"THE_PIN"}'
# {"ok":true,...,"demo":false}  → Netlify side correct; suspect the GitHub secret
# {"ok":true,...,"demo":true}   → no PIN env at all; demo mode, only ADMIN123 works
# {"ok":false,...}              → the Netlify hash does not match this PIN
```

`gh secret set STAGING_ADMIN_PIN --body 'THE_PIN'` avoids the newline that a
UI paste can introduce.

Helper scripts written this session live in the session scratchpad, not the
repo: `gen-admin-pin.sh` (generates a PIN + its hash per stage) and
`check-admin-pin.sh` (probes all four contexts in one run). Recreate if needed.

### 4. Production deploys were LOCKED — the real reason nothing ever shipped

`83f0bba` (merged as `5bcbfa1`) — `fix(ci): let the phase gate unlock
production before deploying, then re-lock`

With every gate green and the release approved, `Deploy to Production` died:

```
⬥ Deployments are "locked" for production context of this project
› Error: Deployments are "locked" for production context of this project.
```

The workflow header instructed the operator to turn OFF Netlify auto-publishing
so pushes to `main` can't bypass the gate. **That setting locks the published
production deploy, and a lock blocks every publish path — including the gate's
own `netlify deploy --prod`.** The protection and the deploy mechanism were
mutually exclusive; the gate could never ship. This is why `datiq.app` sat at
`527a8ee` from 2026-07-19 while `main` advanced several merges ahead: each
approved release died at this one step.

The gate now owns the lock:

- `deploy-production` gained an **Unlock production deploys** step, running only
  after all four gates *and* the human approval have passed.
- New **`relock-production`** job (`needs: [deploy-production,
  smoke-production]`, `if: always()`) restores the lock at the end of the run.

Re-locking must wait for `smoke-production` because `netlify rollback` also
publishes a deploy and is equally blocked by a lock — locking earlier would
silently disarm the auto-rollback.

> **Do NOT "fix" this with `--prod-if-unlocked`,** which the CLI suggests in its
> own error message. While locked, that produces a **draft** deploy; the smoke
> job then tests the still-old production and passes, and the run reports a
> successful release that never shipped. There is a comment in the workflow
> saying so. Failing loudly is correct; silently not shipping is not.

**Residual risk:** if a run is cancelled between unlock and re-lock, production
is left unlocked and the next push to `main` would auto-publish, bypassing the
gate. Re-lock by hand: Netlify → Deploys → published deploy → *Stop auto
publishing*. Narrowing that window needs a Netlify "publish this specific
deploy" primitive rather than a global lock.

---

## Verified state at close

| | |
|---|---|
| `origin/main` / `origin/staging` | both `5bcbfa1`, identical |
| Branches | only `main` + `staging` |
| Staging Gate on `5bcbfa1` | all 4 jobs green; smoke **12 passed, 0 failed** |
| Test suites | unit 1005 · contract 382 · system 7 · integration 180 |
| Readiness audit | 5 pass · 2 warn · 0 fail |
| `datiq.app` | **still `527a8ee` (2026-07-19)** — awaiting approval |

Merged this session: PR #18, #20, #21, #23.

---

## Next actions

1. **Approve the newest Phase-Gate run on `main`** (Actions → Phase-Gate
   Production Deploy → the run for `5bcbfa1` → the approval issue it opens →
   comment `approved`). This is the first run that can actually publish.
   Watch `Deploy to Production` → `Smoke Test — Production` →
   `Re-lock Production`. Confirm afterwards that
   `published_deploy.locked` is `true` again.
   Note this ships ~7 days of accumulated merges in one release; be at the
   keyboard for it. Auto-rollback covers a failed smoke.
2. ⚠️ **Replace staging's admin PIN if it is still `ADMIN123`.** That is the
   documented demo PIN, published in `CLAUDE.md` and in
   `netlify/functions/admin-auth.js` as `DEMO_PIN`; its SHA-256 is trivially
   computed. Anyone reading the repo can open staging's admin console.
3. **Separate `deploy-preview` from staging's PIN.** The same `ADMIN_PIN_HASH`
   value covers `branch:staging`, `deploy-preview` and `branch-deploy`. Preview
   URLs are publicly reachable and guessable.
4. **Phase gate still allows a stale main commit to deploy.** A queued or
   manually re-run *older* `main` commit passes the ancestry check and would
   roll production backwards. Fix: compare `GITHUB_SHA` against `origin/main`'s
   tip before the approval step.
5. Pre-existing, untouched: `/Users/vikash/Extracta` (the non-worktree checkout)
   sits on detached `3df0b90` with 6 dirty files (`package.json`,
   `package-lock.json`, `public/favicon.png`, plus untracked `HASHED-PIN/`,
   `ai-powered-growth-stack-playbook.md`, `step.sh`). Not mine; left alone.

## Test-hygiene follow-ups (visible in CI logs, not failures)

- `ExtractionProvider.integration.test.jsx` — `No "apiClient" export is defined
  on the "../lib/apiClient.js" mock`. The test passes via the AI fallback path,
  so it asserts less than it appears to.
- `Collections.integration.test.jsx` — `Failed to parse URL from
  /api/extractions`; expected localStorage-fallback noise.
