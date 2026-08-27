# Session handoff — 2026-08-28: the Quick enrichment tab that deleted itself

**Branch:** `claude/quick-enrichment-display-bug-0d948f` (cut from `main` @ `24985b0`)
**Merged to:** `origin/staging` — fast-forward `97d005f..298189f`
**`main`:** deliberately untouched, still `24985b0`, now **27 commits behind staging**

```
298189f  chore(prerender): regenerate the 23 static pages after the staging merge
7548eb8  Merge origin/staging into claude/quick-enrichment-display-bug-0d948f
d6b1c6a  fix(extraction): a late auto-save no longer deletes the Quick enrichment tab
```

---

## 1. The report

> "Home screen and Preview screen → Quick enrichment & content → don't fetch anything
> or does not appear / loads on screen. **Run says success but nothing displayed.**"

Five capabilities named: Find Contact Info, Leadership & Board, Social Links, Company
Mission, Pricing & Plans.

## 2. The cause — it was not the enrichment

The enrichment was succeeding every time. **The extraction's own auto-save was deleting
the result a second later.**

`extract()` fires `saveExtraction(result)` fire-and-forget and, when it resolved,
committed `{ ...result, _saved: true }` — the snapshot taken **before** the user ever
reached `/preview`. That save is a real round trip (owner lookup → `POST
/api/extractions` → Supabase insert), so it is routinely still in flight while the user
is already clicking a capability:

1. Enrichment returns, commits its tab, toast says **"Find Contact Info ready"** ✅
2. A second later the auto-save resolves and re-commits the stale snapshot
3. `current.enrichments` reverts to `{}` — tab gone, button loses its ✓

It dropped `_provenance` for the same reason (the commit passed `result`, not the
`withProv` wrapper), so the AI-summary source badge silently vanished too.

### Why nobody caught it in dev

With Supabase unconfigured, `saveExtraction` falls back to a **synchronous localStorage
write**. The dev path closes the window that production leaves open. Mock mode also
never exercises it, because `hasFirecrawl` is driven by `VITE_ENABLE_EXTRACT` alone.

### The mirrored half

`enrich()` and `enrichWithContent()` read `current` from the closure captured **before**
their own `await`. A capability finishing *after* the save therefore reverted the
`_saved` flag — and `_saved` is what gates the Supabase sync of every later tab. Losing
it is invisible until tabs stop appearing on another device.

> **The rule worth carrying:** `useCallbackSafe`'s ref keeps the *handler identity*
> stable and reads like it keeps closures fresh. It does — at **call** time. It cannot
> keep a variable fresh across an `await` **inside** that call. Every `async` function in
> `ExtractionProvider` was re-committing state it had captured before its own suspension
> point.

## 3. The fix

A `currentRef` mirror maintained by `commitCurrent`, so anything resolving late merges
onto what `current` **is** rather than what it **was**.

| Change | Why |
|---|---|
| Auto-save merges `_saved` onto the latest `current` | Never re-commit the snapshot |
| Guarded on `latest.id === result.id` | A late save must not stamp a *different* extraction the user has since opened |
| Honours `saved?._saved !== false` | A save refused by the free saved-searches cap returns `_saved: false`; claiming otherwise offered "View Dashboard" for a row never written, then synced against a missing id |
| `enrich` / `enrichWithContent` read `current` **after** their await | Closes the mirrored direction |

### Enrichment sync queue

A capability run during the save window has an id but **no server row**, so the sync was
simply skipped: the tab lived in localStorage, rendered correctly in that browser for
ever, and was **absent on the user's other devices** — with nothing on screen to say so,
for a tab they had spent a credit on.

Three functions, all in `ExtractionProvider.jsx`:

- `sendEnrichments(id, map)` — the fire-and-forget PATCH.
- `syncOrQueueEnrichments(target, map)` — syncs if the row exists, else parks it in a
  `Map` keyed by extraction id. Replaces both old `if (target._saved && target.id)` sites.
- `settlePendingEnrichSync(id, persisted)` — called once per auto-save, on **both** the
  `.then` **and** the `.catch`.

Design points that matter if you touch it:

- **Flush runs before the `current` guard.** A parked enrichment belongs to that row
  whether or not the user is still looking at it.
- **`persisted: false` drops the parked map** rather than PATCHing at nothing. A save
  that was rejected or cap-refused wrote no row; the tab stays in localStorage, which is
  the honest state for a row that does not exist.
- **Bounded by construction.** Each save settles its own key on both settle paths, and
  the parked value is the **complete** map (not a delta), so two capabilities in one
  window overwrite to a single PATCH rather than queueing two.
- **Guests flush once and are dropped.** `PATCH /api/extractions` is auth-gated and
  scoped `.eq("user_id", userId)`; a guest row has no `user_id`, so there is no account
  to attach it to. The repo already treats that 401 as "keep it local". **Do not add a
  retry** — it can never succeed.

## 4. "Will the result load back on screen?"

Asked during the session; the answer differs by surface and is worth keeping:

| Where | Before | After |
|---|---|---|
| Same session | Yes — instantly | Yes. Rendering never waited on the sync |
| Reload / back-nav, same browser | Yes (`datiq.current` + `datiq.enrichments`) | Yes, unchanged |
| **Another device, signed in** | **No** | **Yes** — this is what the flush buys |
| Signed out (guest) | No | Still no, correctly |

Verified end to end in a browser, not only in jsdom: enrichment run inside a 9s save
window → `PATCH /extractions … keys=['contacts']` observed after the save landed →
**entire localStorage wiped** → `/dashboard` reloaded → row opened → tab and its data
came back from the server row alone.

## 5. The test harness (reusable — this is the reason the bug was findable)

Mock mode hides this class of bug entirely. To drive the **real** extraction path locally
with **no API keys and no network**:

1. `printf 'VITE_ENABLE_EXTRACT=true\n' > .env.local` — flips `hasFirecrawl`.
2. Run a stub on **9999** (the port `vite.config.js` proxies `/api/*` to). A copy lives in
   the session scratchpad; ~60 lines of `node:http`.
3. `npm run dev`.

Stub gotchas that cost time:

- **Route `/extractions` BEFORE `/extract`** — `"/extractions".includes("/extract")` is
  `true`, so a naive router answers the save with an extract-shaped body and the race
  silently cannot reproduce.
- Give the stub a `SAVE_DELAY` env var. `SAVE_DELAY=9000` makes the race deterministic;
  `SAVE_DELAY=0` hides it completely.
- Have it **remember rows** in a `Map` so `GET /extractions` can serve back what `POST`
  and `PATCH` wrote — that is what makes the "another device" test possible.

⚠️ **Reset `datiq.usage` / `datiq.guestTrial` between runs.** After ~6 extractions the
free enrichment quota denies the call *before* any fetch, `enrich()` returns `null`, and
the symptom looks identical to the bug under test. This wasted one full diagnostic cycle.

⚠️ **Delete `.env.local` before building or running prerender** — otherwise
`VITE_ENABLE_EXTRACT` is baked into the artifact.

## 6. Verification

Every behavioural test was **confirmed to fail against the pre-fix code** before being
accepted. The two queue tests were re-checked by restoring the old skip-if-unsaved line
and watching them go red.

`src/components/ExtractionProvider.autosave-race.integration.test.jsx` — 9 tests:
late save keeps the tab · late enrichment keeps `_saved` · cap-refused save does not
claim `_saved` · queued tab is PATCHed once the row exists · two capabilities produce one
complete PATCH · no PATCH when the cap refused the row · no PATCH and no leak when the
save rejects · already-saved path still syncs immediately · a synced tab reloads from the
server row with an empty local cache.

Full `test:prepush` on the merged tree, **exit 0**:

| Gate | Result |
|---|---|
| readiness | 5 pass · 2 warn · 0 fail (both pre-existing) |
| unit | 140 files / 2340 |
| contract | 81 files / 1532 (+14 skipped) |
| integration | 43 files / 354 |
| system | 5 files / 8 |
| db | 32 migrations · 252 assertions · 0 failed (+17 referral) |
| build · check:prerender · test:security | clean |

Pre-push hook re-ran everything on push: **all gates green in 31s**. Nothing bypassed —
no `--no-verify`, no `PREPUSH_SKIP_PRERENDER`.

⚠️ **The first `test:prepush` run had 10 contract failures**, all 5s timeouts in
`complianceEngine.test.js` and four neighbours. Two subsequent full runs were clean.
These specs hit **real DNS** — the trap already documented in CLAUDE.md, where a
fail-open path can *invert* an assertion when the network is slow. They cannot touch
`ExtractionProvider`. Worth pinning with a mocked `publicUrl.js`, as the LinkedIn suite
already was.

## 7. Merge mechanics — `staging` was checked out in another worktree

`git checkout staging` is **impossible here**: the branch is held by the worktree
`branch-deploy-test-9894f8`, and git refuses a second checkout of the same branch.

The way through, without disturbing that worktree:

```bash
git merge --no-edit origin/staging      # merge staging INTO the feature branch
# … regenerate prerender, run gates …
git push origin HEAD:staging            # explicit refspec, fast-forwards origin/staging
```

Same end state, no merge commit on staging, nothing else touched. The merge was clean —
no commit on staging had ever touched `ExtractionProvider.jsx`.

⚠️ **The other worktree's local `staging` is now 3 commits behind `origin/staging`.** A
live session there needs `git pull --ff-only` before doing anything.

## 8. The prerender pipeline changed underneath this work

Staging had already reworked it (PR #119), and the two checks now **disagree by design**:

- `npm run build` runs `scripts/sync-prerender-assets.mjs`, repointing `/assets/`
  references in **`dist/`** to what this build actually produced.
- **`npm run check:prerender` is the authoritative gate.** Deterministic, no browser.
- **`npm run prerender -- --check` reported `23 stale` while everything was current.**
  `check-prerender-assets.mjs` documents why it was replaced: re-rendering through a real
  browser is not a pure function, and *a gate that cries wolf gets bypassed*.

**The old command's output looks alarming and is not.** Trust `check:prerender`.

The 23 pages were still regenerated and committed, because the pre-push hook's string
heuristic (`src/` changed, no `public/*/index.html` changed) fires on exactly this diff
shape — and should. The diff was 26 lines across 23 files, asset-hash repoint only, zero
content drift. Confirmation it was right: the push's own build reported **`0
reference(s) repointed`**.

## 9. A correction worth recording

Asked whether the **Account danger zone / delete** was implemented, this session first
answered **"not implemented"**. That was wrong about the repo and right only about `main`.

It **is** implemented — `5706ce3 feat(account): the danger zone, and a pause for a single
team seat`, on `staging` via PR #118: `DangerZone.jsx`, `netlify/functions/account-state.js`,
migration `0032`, 31 tests. The search had been run against this worktree's branch, which
sits at `main`'s tip.

> **Lesson:** in this repo `main` is far behind `staging` for long stretches. "Does X
> exist?" must be answered with `git grep <ref>` **across every ref**, not against the
> checked-out tree. A one-line loop over `git branch -a` would have got it right first
> time.

## 10. Open items

🔴 **`billing-purge.js` cannot fulfil the deletion the UI now promises.** Checked on
staging:

- `PURGE_TABLES` is still `extractions · scheduled_tasks · analytics_events ·
  summary_feedback · public_reports` — **5 tables**.
- Migrations `0029`–`0031` added **18 user-content tables** (13 audit, 3 workspace, 2
  referral). **None are listed.**
- `billing-purge.js` contains **no reference to `deletion_purge_after`**. The only hit for
  `deletion_`/`requested`/`scheduled` is the string `"scheduled_tasks"`.

So a user can request deletion, `0032` records `deletion_requested_at` /
`deletion_purge_after`, the UI counts down 30 days — and **nothing reads that column**.
The two halves of a deliberately-split design (endpoint records intent, interlocked cron
performs the act) do not touch. Same shape as the `AUTOMATION_JOBS` vs `netlify.toml` gap:
one side declares, the other executes, nothing asserts they agree, and the failure is
silence. Nothing deletes today either way (`PURGE_ENABLED` ships unset), so this is not
live breakage — but it is a public DPDP commitment in `Privacy.jsx` with no code behind it.

**Suggested:** a parity test asserting every user-scoped table is either in `PURGE_TABLES`
or on an explicit retain list, mirroring `cron-registry-parity.test.js`.

Carried forward from the staging session, still open:

- **Migration `0032` has only ever run against WASM Postgres.** Apply to staging Supabase
  (`aubwooslkkrprdxuiyvj`), and to production before `main`.
- **`main` is 27 behind** and still carries the prerender asset-hash defect on its 22
  marketing pages (not fatal there — `/` still serves Vite's own entry on `main`).
- **`PAGESPEED_API_KEY` unset** — LCP/INP/CLS read "not measured" on every audit.

## 11. Environment notes for the next session here

- **Node:** shell default is **v26.7.0** against a pinned `>=24 <25`. `source ~/.nvm/nvm.sh
  && nvm use 24` **before** anything, including `git push` — the hook runs with whatever
  is on `PATH`. `node_modules` in this worktree is present and correct; the merge changed
  `package.json` **scripts only**, no dependencies.
- **Screenshots via the browser tool returned blank/black** for this pane the whole
  session. `read_page`, `javascript_tool` and DOM assertions worked fine — verify through
  the DOM rather than fighting the screenshot.
- The composer's Extract control is `.hero-action-btn`. A `[...document.querySelectorAll('button')]
  .find(b => b.textContent.trim() === 'Extract')` grabs the **nav link** instead, which
  looks like a no-op click.
