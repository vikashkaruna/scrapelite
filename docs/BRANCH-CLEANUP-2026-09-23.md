# Branch cleanup — 2026-09-23

> Every branch below was verified **contained in `origin/staging`** before it was
> deleted, and every SHA is recorded so any of them can be restored.
>
> **Restore any branch with:**
> ```bash
> git push origin <sha>:refs/heads/<name>
> ```

`origin/staging` at the time of the sweep: `581ffb35` ·
`origin/main`: `1ea08f51`

---

## Deleted — nothing unique to any of them

The test applied was `git rev-list --count --no-merges origin/staging..<branch>`
— **how many authored commits exist on the branch that staging does not have**.
All of these read **0**.

⚠️ That is a stricter question than `git diff`, which reports a branch 44
commits *behind* as "different" simply because staging has moved on. A branch
can differ from staging in thousands of lines and still contain nothing staging
lacks.

| Branch | SHA | Behind staging | Contained |
|---|---|---|---|
| `claude/credits-unification` | `38d9df3c` | 2 | ancestor |
| `claude/discoverability-loop-fixes` | `766964a8` | 11 | ancestor |
| `claude/entity-approval-diagnosis` | `46564132` | 6 | ancestor |
| `claude/discoverability-loop-completion` | `f5866b06` | 15 | ancestor |
| `docs/discoverability-handoff` | `55d3731b` | 22 | ancestor |
| `feat/discoverability-audit-improvements` | `a993eabf` | 25 | ancestor |
| `feat/plausible-analytics` | `2fd6067a` | 29 | ancestor |
| `docs/session-handoff-2026-09-20` | `13426c6f` | 31 | ancestor |
| `fix/workflows-pipelines-enrichment` | `f7666d3d` | 44 | ancestor |
| `workflow-implementation-and-optimization` | `1a05bc4b` | 187 | see below |

### `workflow-implementation-and-optimization` needed a second check

It was **not** a strict ancestor of staging, because its tip is a merge commit
(`git merge-base --is-ancestor` said no). But it had **0 non-merge commits
ahead**, which means every authored change on it was already in staging.

⚠️ **A merge commit can still introduce content** — a conflict resolution that
matches neither parent, sometimes called an *evil merge* — so "0 non-merge
commits" is not on its own sufficient. `git diff-tree --cc` showed resolutions
in six files, and each was checked:

- Three pricing visual snapshots: **byte-identical to staging**.
- Two home visual snapshots and `e2e/smoke/topbar.spec.js`: differ from staging,
  but staging carries **the same seven tests** and the three differing lines are
  an **older** version of a tolerance assertion staging has since changed.

So the differences are staging having moved on, not the branch holding
something back. **This branch has been in exactly this state before** — CLAUDE.md
records a prior sweep finding its one extra commit was a duplicate of work
already on staging.

---

## Kept — real work that is NOT in staging

### `feat/prospect-engagement-engine` — `0c084bb1`

**5 authored commits, 44 files, ~9,000 lines, and it is genuinely net-new.** The
only files matching "engagement" on staging are the unrelated `reengagement`
email cron (`0011_reengagement_log.sql`); nothing of the Prospect Engagement
Engine is there.

What it adds: `/engagement` page, Kanban board, prospect timeline drawer, AI
message generator, channel router, a state machine, sync connectors, and
`0048_prospect_engagement_engine.sql`.

🔴 **IT CANNOT BE MERGED AS-IS, AND THE MIGRATION IS THE REASON.** It carries
`supabase/migrations/0048_prospect_engagement_engine.sql` while staging already
has `0048_discoverability_evidence.sql`. **Both files exist side by side on the
branch today**, so the duplicate is already there: `migrate:prod` and
`db-verify` walk the directory lexically, which makes the ordering *deterministic
but meaningless*, and the numbering convention — one migration per number,
applied in order — is broken. It needs renumbering to the next free number
(**`0081`** as of this sweep), and `run-all.sql` regenerating with it.

⚠️ **It is also 52 commits behind and conflicts in three files**: a trial merge
into staging leaves conflicts in `scripts/db-verify.mjs`,
`src/components/TopBar.jsx` and `src/styles/screens.css`.

**Not attempted here.** Renumbering a migration, resolving three conflicts and
re-verifying 9,000 lines of feature work against a staging that has moved 52
commits is a scoped piece of work, not a cleanup step — and merging it blind
would put an ambiguous migration number into the one directory where ordering
decides what a database ends up containing.
