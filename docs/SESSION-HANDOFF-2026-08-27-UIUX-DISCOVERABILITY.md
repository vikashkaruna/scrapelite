# Session handoff — UI/UX and discoverability improvement (2026-08-27)

Branch: `UI-UX-and-discoverability-improvement`, cut from `origin/staging` (`24985b0`).
**Pushed. NOT merged.** `staging` and `main` untouched.

## ▶ Where to pick this up

The owner asked to **review the branch locally before it goes to staging**. So:

* **Do not merge anything** until they say so.
* When they do: `staging` first, confirm the Staging Gate is green **on its own
  fix** (this branch changes that workflow, and its first genuine run IS the
  merge — nothing else can exercise it), then `main`.
* ⚠️ **Before `main`: apply migration `0032` to the production Supabase project.**
  It has only ever run against WASM Postgres via `npm run test:db`, which has no
  GoTrue, no PostgREST and shimmed Supabase roles.

17 commits · 116 files · +7,383 / −301. Every gate green at
`0f32c80` (the pre-push hook ran them for real on the last push).

---

## The four things that prompted this

1. **The Staging Gate was red on a bug, not a regression.**
2. **`https://datiq.app` scored AEO 25.4 because `/` served no content.**
3. **The discoverability module lost data every time an audit was read back.**
4. **A large amount of shipped server capability was unreachable from the UI.**

---

## 1. The Staging Gate (`35acb36`)

`staging-gate.yml:301` required the NEWEST staging deploy's `commit_ref` to
EQUAL `$GITHUB_SHA`. That is not flaky — it is **unsatisfiable** the moment
staging moves, because the newest deploy only ever gets newer.

Run 32995206476 gated `c4330e8` while staging had advanced to `24985b0`, a
**descendant** containing every byte of it. All 30 attempts printed
`latest_staging=24985b0 state=ready` and the gate failed on a deploy strictly
better than the one it demanded.

**The structural cause will recur:** `24985b0` was docs-only, so it matched the
workflow's `paths-ignore` and started NO GitHub run — `concurrency:
cancel-in-progress` had nothing to cancel and the doomed run was never
superseded. Netlify has no `paths-ignore` and deployed it regardless.

Fixed by asking the right question — "has a healthy staging deploy shipped this
commit's content?" — via `git merge-base --is-ancestor`, the pattern
`phase-gate.yml:206-248` already uses. **One-directional**, unlike phase-gate's:
this workflow runs ON staging, so an ancestor deploy is an older build and
proves nothing.

⚠️ **Verified under `bash`, not `zsh`.** zsh does not word-split unquoted
expansions, and the first verification run silently inverted the result because
of it. Anything that tests workflow shell must run under bash.

### The pre-push hook was stale, and could not be fixed from a worktree

`.git/hooks/pre-push` did not contain the prerender staleness gate at all, so
that gate had never run on this machine. `npm run ci:install-hook` was
`cp … .git/hooks/…`, which fails with "Not a directory" in a worktree — where
`.git` is a FILE. **Every Claude session in this repo works in a worktree**, so
the only people positioned to notice the rot were the only ones who could not
fix it. Replaced with `scripts/install-hook.mjs` (resolves `--git-common-dir`),
and the hook now warns when the installed copy has drifted.

The prerender gate also lived INSIDE the `PREPUSH_FORCE` block, so
`PREPUSH_FORCE=1` — a flag whose purpose is to make MORE checks run — silently
switched it off.

### Two more holes, both found by watching the hook report success

**A brand-new branch was pushed with NO gate run at all.** On a first push
`origin/<branch>` does not exist, so the diff base fell back to `HEAD~1` and the
branch was compared against its own last commit. If that commit touched only
docs — which, for a branch ending in a CLAUDE.md or handoff update, it almost
always does — the docs-only skip fired and the whole branch went out under a
green tick. Measured on this branch: **1 file / 0 non-docs** under the old logic,
**116 files / 108 non-docs** under the new one. CLAUDE.md had carried this as a
known trap for weeks; it is now fixed rather than documented.

**Deleting a branch ran the whole suite.** `git push --delete` sends an all-zero
`local_sha` — no tree, nothing to test. Three concurrent deletes contended for
resources, reported failures, and the deletions were refused. The obvious
workaround is `--no-verify`, and that is precisely the habit this repo has an
incident about: **a hook that fires where it cannot usefully check is a hook
people learn to bypass where it can.** It now skips deletions and says so.

### `scripts/check-prerender-assets.mjs` — the gate that cannot cry wolf

The string heuristic cannot see drift a MERGE brought in, which is the case that
got past it twice. This one is deterministic: after a build, every `/assets/`
URL referenced by a committed static page must exist in `dist/`. No browser, so
no false positives from a different Chrome build — **a gate that cries wolf gets
bypassed, and that is how this reached production the first time.**

Wired into `test:all`, `test:prepush`, the hook, and the Staging Gate. It caught
real staleness on its first use in this session.

---

## 2. SEO / AEO / GEO (`81cd55e`, `7ac1607`)

`/` served `<div id="root"></div>`. Every other public route gets prerendered
HTML because Vite copies `public/<route>/index.html` into `dist/` and a real file
beats the non-forced SPA fallback. The homepage could not use that — its output
would be `public/index.html`, clobbering Vite's entry — so it was excluded, with
the note "it needs no help".

**That was true of the `<head>` only.** Measured: 10 rendered words, no H1, no
headings. Googlebot renders JS eventually; GPTBot, ClaudeBot, PerplexityBot and
CCBot largely do not.

Now renders to `public/home/index.html`, served at `/` by a **forced** 200
rewrite. ⚠️ `force = true` is required and is the only rule in netlify.toml that
needs it: `dist/index.html` is a real file at `/`, so without it the rewrite
silently does nothing.

`generatedFileFor()` still throws for anything deriving `public/index.html`.

**Measured before → after: 0 → 1 H1, 0 → 4 H2, ~10 → 894 words.** React boots
over it with one `#root` child; SPA navigation still works.

Content: a 52-word answer block, question-phrased H2s, a `WebPage` block with a
named author and `dateModified`, a visible "Last updated", and BreadcrumbList on
all 22 sub-pages.

⚠️ **Two near-misses worth knowing:**
* Eight pages in `pageSeo.js` ALREADY hand-write a BreadcrumbList; the first
  version produced duplicates on them. A page asserting two positions in the
  hierarchy is worse than one asserting none.
* The app has TWO SEO mechanisms — `useSeo()` and `setMeta()`. Wiring only the
  first left a hole shaped like exactly the nine pages that use the second. That
  is the same hole the missing-canonical bug sat in.

⚠️ **The content date is the COMMIT date, not the build date.** A build timestamp
would make `prerender --check` report all 23 pages stale on every run.

**Ops, not code:** set `PAGESPEED_API_KEY` in Netlify. LCP/INP/CLS read "not
measured" without it, which costs evidence coverage on every audit.

---

## 3. Discoverability data integrity (`6db146d`, `4193fff`)

**One omission explains most of what was reported.** `audit_signals` stores only
`signal_code` — correctly, since codes are the public contract — and
`rehydrate()` rebuilt each signal by hand without mapping the code back to its
label, nor carrying pillar `coverage` or `weight`.

So a FRESH audit rendered perfectly and a STORED one did not: **the worst shape
a bug can take, because it never reproduces while you are looking at it.**
Symptoms: `| undefined | 0 | 25% |` in every exported report, blank signal names
on any audit opened from History, null coverage in JSON, and the "based on X% of
signals" copy vanishing.

Fixed by routing stored values back through `scorePillar()` — the same pure
function the pipeline uses — so the two paths are identical **by construction**.

🔴 **The PDF's "Ready-to-paste assets" section had NEVER rendered.** It filtered
on `implementationAsset.content`; every template emits `body`.

Exports now all carry every segment. CSV gained `rows=signals|scores|all`, and
an unmeasured signal exports BLANK, never 0 — a 0 in a spreadsheet gets averaged.

**Executive summary:** generated lazily on first report view and cached.
⚠️ Deliberately NOT in the audit run: `AUDIT_BUDGET_MS` is 8000ms against
Netlify's 10s timeout, and the August 504 came from exactly this shape of
mistake.

---

## 4. Unreachable capability

The whole discoverability monitoring stack was built and shipped —
`audit_schedules`, the `@daily` cron, the `audit.schedule` entitlement,
compliance re-checks, auto-pause on a robots refusal, alert emails — and
**`discoverability.createSchedule` had zero callers.**

Now creatable from `/schedules` (a "What to run" selector), listed there and on
the Workspace Discoverability tab, and visible in `/admin/monitoring` — which
had been able to see only half the platform's scheduled work.

---

## New in this branch

| | |
|---|---|
| Migration | `0032_account_state_and_audit_summary.sql` — additive columns, 4 functions. **60 tables / 32 functions / 11 triggers** |
| Endpoints | `/api/account-state`, `POST /api/discoverability/audits/{id}/summary`, `set_member_paused` on `/api/workspaces` |
| Components | `DangerZone`, `DiscoverabilityStats`, `PersonaUsage`, `AuditHeader`, `workspace/DiscoverabilityTab` |
| Scripts | `check-prerender-assets.mjs`, `install-hook.mjs` |

### 🔴 Freeze is a SEPARATE AXIS from `entitlements.status`

`status = 'suspended'` is the BILLING lifecycle: it starts dunning and the day-90
purge countdown. A user freeze means nearly the opposite — "keep charging me,
keep my data, just stop anyone consuming units". **Reusing `suspended` would
enrol a paying customer in a dunning sequence and start a deletion clock on data
they explicitly asked to keep.** Same shape as `scheduled_tasks.system_paused`.

### 🔴 Nothing here deletes anything

`request_account_deletion` records intent and freezes. `billing-purge.js` — five
interlocks, disarmed by default, dry-run, blast-radius cap — remains the only
destructive path.

---

## Verified

unit **2329** · contract **1532** (+14 skipped) · integration **345** · system
**8** · db **252 assertions / 32 migrations** · e2e smoke **130 / 1 skipped /
0 failed** · build clean · security clean · readiness **5 pass / 2 warn / 0 fail**
(both pre-existing) · prerender **23 rendered / 0 stale**.

**Every behavioural test was confirmed to fail against pre-fix code first:**
8/11 staging-gate, 9/11 rehydrate, 17/21 exports, 5/6 pillars, 3/7 entitlement,
2/5 schedule expiry.

Browser-verified against the real build through a local simulation of the
netlify.toml rules — not only jsdom.

---

## Branch cleanup

Recorded in `docs/BRANCH-CLEANUP-2026-08-27.md` with SHAs for restoring any of
them. Four branches could NOT be deleted: each is the checked-out branch of a
live worktree, and `node-24-upgrade` is the MAIN checkout's. Left alone
deliberately — this repo has a documented history of parallel sessions.

`workflow-implementation-and-optimization` is **not** really ahead: its one extra
commit is a byte-identical duplicate of one already on staging.

**Remote branches are now exactly the four asked for**, plus this working branch:

```
origin/main
origin/staging
origin/Integration-with-outside-ecosystem
origin/workflow-implementation-and-optimization
origin/UI-UX-and-discoverability-improvement   ← this branch
```

`origin/AI-era-discoverability-intelligence`, `origin/claude/audit-storage-error-003fa6`
and `origin/claude/datiq-discoverability-module-542c4a` were re-verified contained
in `origin/staging` immediately before deletion and are gone. SHAs are in the
cleanup doc; `git branch <name> <sha>` restores any of them.

---

## Open items

1. **`PAGESPEED_API_KEY`** — unset, so Core Web Vitals read "not measured".
2. **Four worktree-held branches** — `node-24-upgrade` (the MAIN checkout),
   `AI-era-discoverability-intelligence`, `claude/audit-storage-error-003fa6`
   and `claude/datiq-discoverability-module-542c4a` still exist LOCALLY because
   each is the checked-out branch of a live worktree. Their remote counterparts
   are deleted. See the cleanup doc for the two-line fix per worktree.
4. **Admin monitor controls** — `/admin/monitoring` lists discoverability
   monitors read-only. Pausing one needs the same mandatory-reason +
   `ops_audit_log` path the extraction schedules have; a control that writes no
   audit row would be worse than no control.
5. **PageSpeed reports** — item 2 of the request referenced attached PSI
   reports; only the discoverability audit arrived. The SEO work was planned
   from that plus a direct read of `index.html`.
