# Session handoff — 2026-08-28

## The production deploy died on a package published 27 minutes earlier

**Branch:** `claude/netlify-deploy-version-error-2a72ca` (cut from `origin/staging` @ `0aba153`)
**Merged to:** `staging`
**`main`:** untouched

---

## 1. What failed

[Phase-Gate Production Deploy](https://github.com/vikashkaruna/scrapelite/actions/workflows/phase-gate.yml),
run `33111154623`, job **Deploy to Production**, on the PR #121 merge to `main`:

```
Run npx --yes netlify-cli deploy \
npm error code ETARGET
npm error notarget No matching version found for @netlify/ai@^1.0.1.
```

37 seconds. Nothing was published. Production was left on the previous release.

## 2. Root cause

`npx --yes netlify-cli` resolves **`latest`, plus every one of its ~1,160 transitive
`^` ranges**, against the live npm registry — at deploy time, on every release.

| time (UTC) | event |
|---|---|
| 2026-08-26 13:34:27 | `netlify-cli@27.4.0` published, depending on `@netlify/dev@^5.0.1` |
| 2026-08-27 **19:43:59** | `@netlify/dev@5.0.4` published, depending on `@netlify/ai@^1.0.1` |
| — | **`@netlify/ai@1.0.1` has never been published.** `1.0.0` (2026-08-18) is the newest |
| 2026-08-27 **20:10:53** | `Deploy to Production` ran → `ETARGET` |

Verified against the registry, and reproduced locally byte-for-byte:

```
npm install --dry-run netlify-cli@27.4.0
npm error code ETARGET
npm error notarget No matching version found for @netlify/ai@^1.0.1.
```

**No commit in this repository was involved.** A third party published a broken
package 27 minutes before the deploy, and the release consumed it directly.

### The part that makes this worth fixing rather than re-running

The deploy step is the **only** place in the entire pipeline that installs an
unpinned third-party package, and it sits at the single least recoverable moment:

- after all four production gates went green,
- after a human commented `approved` on the approval issue,
- after an operator hand-unlocked production in the Netlify UI and was waiting.

A re-run today would succeed — `@netlify/dev@5.0.4` is still broken, but only
`27.3.0`+ pull it. That is luck, not a fix, and it will recur.

### 🔴 Pinning `netlify-cli@<version>` would NOT have prevented this

The break arrived through a **floating transitive range**
(`@netlify/dev@^5.0.1` → `5.0.4`), not through the top-level one. `npx` re-resolves
the whole tree regardless of how precisely the top-level spec is pinned. **Only a
lockfile freezes the tree.** This is the single most important thing to carry
forward, because the obvious fix is the one that does not work.

## 3. The fix

### `tools/netlify-cli/` — a lockfile-pinned deploy toolchain

`package.json` (exact, no range) + a committed `package-lock.json` — **1,161
packages frozen**, with `@netlify/dev` held at `4.18.13` where it can never float
to the broken `5.0.4`.

- Pinned to **`netlify-cli@27.1.2`**, the newest version whose tree resolves today.
  `27.3.0`, `27.3.1` and `27.4.0` all fail (measured, one by one).
- **Deliberately not in the root `package.json`** — it is ~1,160 packages nothing
  outside the production deploy needs, and adding it would slow every developer
  install, every CI test job and the pre-push hook to pin a tool none of them run.

The workflow now runs `npm ci --prefix tools/netlify-cli --ignore-scripts` as its
**own step before the deploy**, then invokes the local binary. A toolchain problem
is now reported as a toolchain problem, with production untouched.

⚠️ **`--ignore-scripts` is deliberate and is load-bearing for reliability.** The
tree carries native postinstall builds (`sharp`, `unix-dgram`) that belong to
`netlify dev` — the local dev server and its image transforms. `netlify deploy`
uploads a directory and never loads them. Skipping them takes the install from
minutes to **~7 seconds** and removes node-gyp and prebuilt-binary downloads from
the release path. A `Verify the deploy toolchain runs` step then loads
`netlify --version` and `netlify deploy --help` — which exercises the deploy
command's own module graph — so the trade is proven before production is touched,
not assumed.

*(Measured on macOS arm64: with scripts, `sharp` fell back to node-gyp and the
install failed outright; with `--ignore-scripts`, 1,101 packages in 7s and
`netlify-cli/27.1.2` runs. The lockfile records all 24 `@img/sharp-*` platform
variants including `linux-x64`, so the Ubuntu runner is not relying on that path
either way.)*

### 🔴 And a second, older bug found while verifying the first

**`netlify rollback` is not a command. It never was.**

```
$ ./tools/netlify-cli/node_modules/.bin/netlify rollback ; echo $?
2                      # generic help text, unknown command
$ grep -ri rollback tools/netlify-cli/node_modules/netlify-cli/dist/
                       # one hit, in an unrelated Postgres file
```

The CLI's own command list is `agents api blobs build claim clone completion create
database deploy dev env functions init link login logs open recipes serve sites
status switch teams unlink watch`. No `rollback`.

So `Auto-rollback on smoke failure` — **the one safety net that pulls a bad release
off `datiq.app`** — has only ever printed a usage message and failed the step,
leaving the bad build live. It has never fired successfully. It was never noticed
because it only runs `if: failure()`, and production smoke has been passing.

Replaced with the documented REST endpoint, confirmed against Netlify's own
`open-api.netlify.com/swagger.json`:

```
POST /sites/{site_id}/deploys/{deploy_id}/restore   →  restoreSiteDeploy
```

which is the same style this workflow already uses for the lock check and the
re-lock. It:

1. reads the currently published (bad) deploy id,
2. picks the newest **`ready`** production deploy that is **not** that one —
   restoring the deploy that just failed its own smoke test would report a
   successful rollback while leaving the bad build live,
3. restores it,
4. **asserts `published_deploy` actually moved**, and fails loudly with manual
   instructions if it did not. A rollback that claims success without changing
   what production serves is worse than one that fails, because nobody looks.

It needs **no toolchain at all**, so the recovery path can no longer be taken out
by an npm install — which is precisely how the deploy step died.

⚠️ **Not verified against the live Netlify account.** The endpoint and payload are
confirmed against Netlify's published spec and the shape matches the two API calls
this workflow already makes successfully, but no production smoke failure has
exercised it. It is strictly better than what it replaces (which cannot work at
all), and it fails loudly rather than silently.

## 4. Why this is verifiable from `staging` at all

The production deploy job only ever runs on `main`, so the fix itself cannot be
exercised before it ships. `scripts/deploy-toolchain.test.mjs` closes that gap:
**13 tests** asserting the shape of the fix — the pin is exact, the lockfile exists
and agrees with `package.json`, the transitive tree is frozen, the workflow installs
with `npm ci` and never through `npx`, the CLI is proven to run before production is
touched, and the rollback calls a command that exists. It lives in `scripts/`, which
`npm run test:unit` covers, so the **Staging Gate and the pre-push hook both enforce
it** — long before `main`.

**Every behavioural test was confirmed to fail against the pre-fix code first**:
8/8 red with `tools/` absent, and 8 of 13 red with the pre-fix workflow restored.

⚠️ One of them was **green against the very code it was written to catch** on the
first attempt: `never calls netlify rollback` matched `/netlify\s+rollback/`, and
the old line read `npx --yes netlify-cli rollback` — no whitespace after `netlify`.
Tightened to `/netlify(-cli)?\s+rollback/` and re-checked red. *A green test that
asserts nothing is worse than no test.*

## 5. Verification

| gate | result |
|---|---|
| unit | **2353 / 141 files** (was 2340 / 140 — +13, the new file) |
| contract | **1532** passed + 14 skipped / 81 files |
| integration | **354** / 43 files |
| system | **8** / 5 files |
| db | **252 assertions / 32 migrations**, + 17 referral |
| build | clean; prerender sync 23 pages, **0 references repointed** |
| check:prerender | 23 pages, **92 asset references, all present** |
| security | clean |
| readiness | 5 pass / 2 warn / 0 fail (both pre-existing) |
| `npm ci --prefix tools/netlify-cli --ignore-scripts` | 1,101 packages, 7s |
| `netlify --version` | `netlify-cli/27.1.2` |
| `netlify deploy --help` | exit 0 |
| `phase-gate.yml` | parses; step order verified |

`npm run test:prepush` exits **0** end to end. Nothing was bypassed.

## 6. Open

- **`main` still carries both defects** — the unpinned `npx --yes netlify-cli`
  deploy and the rollback that cannot work. They ship when `staging` is promoted.
- **The restore path is untested against the live account** (§3).
- **`netlify-cli` cannot currently be bumped past `27.1.2`** until Netlify either
  publishes `@netlify/ai@1.0.1` or yanks `@netlify/dev@5.0.4`. Re-check before
  bumping; `tools/netlify-cli/README.md` carries the procedure.
- The same `npx --yes <pkg>` shape is still used for Playwright in
  `scripts/setup-runner.sh`, but there it is version-pinned *and* not on the
  release path, so it was left alone.
