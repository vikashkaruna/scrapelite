# SESSION-HANDOFF-2026-07-25-BRANCH-CLEANUP-AND-GATE.md

> **Session date:** 2026-07-25
> **Branches at end of session:** `main` = `staging` = same commit, in sync with `origin`, trees clean. **Only `main` and `staging` exist** — every other branch was deleted, locally and on `origin`.
> **Status at handoff:** Staging Gate is GREEN on all three code checks. One check (`Deployed & Smoke Tested`) is RED for a **credential mismatch that cannot be fixed in this repo** — see "The one open failure" below.
> **Next session entry point:** read `AGENTS.md` → `CLAUDE.md` → `git log --oneline -10` → `git status`

---

## TL;DR

Two jobs: collapse the branch list down to `main` + `staging`, and get the
Staging Gate green. The branch work was trivial (everything was already merged).
The gate work uncovered **four independent failures stacked behind one another** —
each one was only visible after the one in front of it was fixed.

| # | Commit | What |
|---|---|---|
| 1 | `0676ed1` | **fix(ci):** accept dev-proxy gateway errors in the `/api/stats` claim; bump actions to v5 |
| 2 | `372c29a` | **fix(ci):** smoke-test the staging host that actually exists |
| 3 | `af4dc5c` | **fix(ci):** run the gate's e2e smoke on chromium only, as its config already claims |
| 4 | `61e8167` | merge PR #16 `staging` → `main` |
| 5 | `bded77d` | merge PR #17 `staging` → `main` |

**Test Suites went from a 25-minute timeout to 10m51s.**

---

## 1. Branch cleanup

All six non-`main`/`staging` branches were **already fully merged** into
`staging` — every one measured 0 commits ahead of it. Nothing needed merging;
the merge check was the whole job.

| Branch | SHA at deletion | Ahead of staging |
|---|---|---|
| `Integrate-web3forms-contactdatiq` | `031b16d` | 0 |
| `chore/react-router-v7-security-upgrade` | `3df0b90` | 0 (identical to staging) |
| `claude/branch-cleanup-merge-check-e1e8ec` | `3325587` | 0 |
| `claude/production-readiness-skill-cfe3d8` | `0024a4a` | 0 |
| `claude/web3forms-contact-diq-51904b` | `b35c32d` | 0 |
| `improve-extract-progress` | `eb805a5` | 0 |

All six deleted locally; the two that existed on `origin`
(`Integrate-web3forms-contactdatiq`, `chore/react-router-v7-security-upgrade`)
deleted there too. No open PRs were affected. **Any of them is recoverable from
the SHA above** — `git branch <name> <sha>` — until git GCs the objects.

### Side effect worth knowing

The main repo `/Users/vikash/Extracta` had `chore/react-router-v7-security-upgrade`
checked out with uncommitted changes (`package.json`, `package-lock.json`,
`public/favicon.png`, untracked `ai-powered-growth-stack-playbook.md`). Deleting
a checked-out branch is impossible, so its HEAD was **detached** at the same
commit first — byte-identical tree, uncommitted work preserved. It may still be
detached. To reattach, free `staging` from the other worktree first:

```bash
git worktree remove /Users/vikash/Extracta/.claude/worktrees/production-readiness-skill-cfe3d8
git switch staging   # from /Users/vikash/Extracta
```

---

## 2. The four stacked gate failures

Each fix exposed the next. This is why the gate needed four passes, not one.

### 2a. `/api/stats` e2e claim rejected 502 (`0676ed1`)

`Staging Gate: Test Suites` failed on all three browsers at
`e2e/smoke/claims-verification.spec.js:112` — expected `[200, 500, 503]`, got
**502**.

Playwright's `webServer` starts `npm run dev` **alone**, so nothing listens on
the functions port `:9999` that `vite.config.js` proxies `/api` to. The proxy
answers `ECONNREFUSED` with 502. Reproduced locally:

```
/api/stats        -> 502
/api/og-preview   -> 502   (already whitelisted 502, so it passed)
/not-a-real-route -> 200   (SPA fallback)
```

**The control case is the point:** an *unwired* path falls through to the SPA and
returns 200 HTML, so a 502 is positive evidence the proxy rule matched. The claim
is that the route is wired, not that a backend answered. The neighbouring
`og-preview` claim already accepted 502 — the two lists had simply drifted apart.
Both now accept `502` and `504`, with a comment saying to keep them in sync.

Also bumped `actions/checkout` and `actions/setup-node` v4 → v5 across both
workflows, clearing the "Node.js 20 is deprecated" annotations. **That warning is
about the actions' own runtime** — the `node-version: "20"` input is a separate
choice and was left unchanged (see "Deferred" below).

### 2b. Smoke tested a hostname that doesn't exist (`372c29a`)

With Test Suites green, `Deployed & Smoke Tested` ran for the first time and
failed **all 12 probes** with `ERR_TLS_CERT_ALTNAME_INVALID`.

The deploy was never broken — the job's "Wait for Netlify staging deploy to
converge" step **passed**. Only the vanity hostname is broken, in two ways:

```
staging.datiq.app  ->  CNAME staging--datiq.netlify.app   ->  404
                                     ^^^^^ wrong site slug
                       staging--datiqapp.netlify.app      ->  200  (real deploy)
```

1. The site was renamed to `datiqapp` (recorded in `CLAUDE.md`) but DNS still
   points at slug `datiq`.
2. Because no Netlify site claims the hostname, the edge serves its default cert
   — verified as `O=Netlify, Inc, CN=*.netlify.app`. A `*.netlify.app` wildcard
   cannot cover a `.datiq.app` name. **No amount of retrying would ever pass.**

Fix: the smoke target is now the `STAGING_URL` **repo variable**, defaulting to
`https://staging--datiqapp.netlify.app`. Verified before committing by running
the real suite against it: `10 passed, 0 failed`.

**To move back to the vanity domain — no code change needed:**
1. Netlify → site `datiqapp` → Domain management → add `staging.datiq.app` as an
   alias, target the `staging` branch.
2. Repoint the CNAME to `staging--datiqapp.netlify.app`. Cloudflare must be
   **DNS-only / grey cloud** or Let's Encrypt provisioning fails.
3. Once the cert issues, set repo variable `STAGING_URL=https://staging.datiq.app`.

**Tradeoff accepted:** the gate now verifies the deployed artifact rather than the
public URL. Strictly better than before (where it verified nothing), but a future
custom-domain misconfiguration won't be caught until step 3 is done.

### 2c. Test Suites blew its 25-minute cap (`af4dc5c`)

Next run: `exceeded the maximum execution time of 25m0s`. The prior run had
passed at 24m20s — the job had been riding the limit for a while.

```
npm ci + readiness + unit + contract + integration + system + build   ~4m
e2e smoke                                                            20m45s
```

`playwright.config.js` already documented the intent — *"The CI gate uses
chromium for speed"* — but **listing a project in `projects` does not make it
opt-in**. `playwright test` with no `--project` runs **every** listed project.
So `test:e2e:smoke` (no flag) and `test:e2e:smoke:all-browsers` (`--project` ×3)
were running the identical 294 tests, making the "all-browsers" script
meaningless. Confirmed with `--list`:

```
no --project        -> Total: 294 tests
--project=chromium  -> Total:  98 tests
```

Two things confirm drift rather than intent: the workflow installs **only**
chromium (firefox/webkit ran purely because they're preinstalled on the runner
image), and `use.browserName: "chromium"` was written as though it narrowed the
project list, which it does not.

Fix: `test:e2e:smoke` now passes `--project=chromium`. **Result: 10m51s.**
`timeout-minutes` left at 25 deliberately — at ~2× headroom it still catches a
real slowdown, which raising it would mask.

> ⚠️ **Coverage gap this creates.** The gate no longer runs firefox/webkit on
> every push. `playwright.config.js` referred to "a separate nightly workflow"
> covering them — **no such workflow exists** (only `staging-gate.yml` and
> `phase-gate.yml`). That gap pre-dated this change but is now load-bearing. The
> comment was corrected to stop describing something that isn't there. **Adding
> the nightly workflow was offered and is still unanswered** — see "Open
> decisions".

### 2d. The one open failure — admin PIN mismatch (NOT fixable here)

```
POST /.netlify/functions/admin-auth ... ✗
    HTTP 401 Unauthorized — {"ok":false,"error":"Incorrect PIN.","code":"BAD_PIN"}
[smoke] 11 passed, 1 failed
```

Failed identically on a re-run, so it is **not transient**.

Both sides are configured; the values simply disagree:

- The probe is gated on `if (ADMIN_PIN)` (`scripts/smoke-prod.mjs:266`) — an
  unset secret makes it **skip**. It *ran*, so `STAGING_ADMIN_PIN` **is** set and
  non-empty. **CI wiring is correct.**
- `admin-auth.js` only falls back to demo mode (`ADMIN123`) when neither
  `ADMIN_PIN_HASH` nor `ADMIN_PIN` is set. It returned `BAD_PIN` instead of
  accepting, so staging **does** have a real PIN configured.

**Nothing in this repo can reconcile that.** Fix in the consoles:

```bash
printf '%s' 'your-staging-pin' | shasum -a 256
```

Hash → Netlify site `datiqapp`, **branch-deploy/staging context**,
`ADMIN_PIN_HASH`. Same plaintext → GitHub → Secrets → `STAGING_ADMIN_PIN`.
**Most likely cause:** the secret matches the *production* PIN while staging
carries a different one, or the Netlify var is set at production scope only.

This failure was deliberately **not** silenced. The gate is correctly reporting
that staging's admin auth rejects the PIN CI holds — making the probe advisory
would suppress a true finding. Ask explicitly if you want it non-blocking.

---

## Files changed this session

| File | Change |
|---|---|
| `e2e/smoke/claims-verification.spec.js` | `/api/stats` + `/api/og-preview` claims accept `502`/`504`, with a why-comment |
| `.github/workflows/staging-gate.yml` | actions → v5; `STAGING_URL` env + `environment.url`; smoke uses `"$STAGING_URL"` |
| `.github/workflows/phase-gate.yml` | actions → v5; smoke-staging uses `STAGING_URL` |
| `package.json` | `test:e2e:smoke` → `--project=chromium` |
| `playwright.config.js` | corrected the projects comment (the "nightly workflow" it named does not exist) |
| `docs/PHASE-GATE.md` | documents `STAGING_URL` and why `staging.datiq.app` is unusable |

---

## Gate status at handoff

| Check | Status |
|---|---|
| Staging Gate: Test Suites | ✅ **10m51s** (was: 25m timeout) |
| Staging Gate: Vulnerabilities | ✅ |
| Staging Gate: Open Issues/Defects | ✅ |
| Staging Gate: Deployed & Smoke Tested | ❌ 11/12 — admin PIN mismatch (console fix, §2d) |

---

## Open decisions (all awaiting the user — none are blocked on code)

1. **Nightly all-browsers workflow** — restore firefox/webkit coverage without
   slowing the gate. Would run `test:e2e:smoke:all-browsers` on a schedule.
   *Offered twice, still unanswered.*
2. **`node-version: "20"`** in both workflows — Node 20 is EOL (April 2026).
   Bumping to 22 changes the runtime the tests actually execute on, so it was
   deliberately left alone as a separate decision from the v4→v5 action bump.
3. **Admin PIN** — reconcile the two values (§2d), or say the word to make the
   probe advisory.
4. **`staging.datiq.app`** — wire it up per §2b, or leave the gate pointed at the
   branch-deploy host indefinitely.

---

## Verification notes for the next session

Everything claimed above was checked, not assumed:

- 502 root cause reproduced locally by starting Vite alone and curling `/api/stats`
  (502), `/api/og-preview` (502) and an unwired path (200 SPA fallback).
- Certificate confirmed with `openssl s_client` — `CN=*.netlify.app` on
  `staging.datiq.app`.
- Branch-deploy host validated by running `scripts/smoke-prod.mjs` against it:
  10 passed, 0 failed.
- Browser-count claim proven with `playwright test --list`: 294 → 98.
- Both workflow YAMLs re-parsed after editing.
- Final CI result read back from the run, not inferred: Test Suites 10m51s ✅.
