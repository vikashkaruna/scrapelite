# Branch cleanup record — 2026-08-27T06:45:08Z

Every branch below was verified fully contained in `origin/staging` (`24985b0`)
with `git merge-base --is-ancestor <branch> origin/staging` before deletion.
To restore any of them: `git branch <name> <sha>`.

| Branch | SHA | Scope |
|---|---|---|
| `AI-era-discoverability-intelligence` | `06085b255f1de74ed914306bed6ab108234e820c` | local |
| `claude/ai-era-discoverability-intelligence-1af447` | `b946d07c2d9d5308e1086186e4e267ccba96df62` | local |
| `claude/audit-storage-error-003fa6` | `6cfd74ee5e35a1943a5eecb29b6a72f9e5fcadfb` | local |
| `claude/consolidate-parallel-runs-4c34b7` | `478a30727dd3cf1fabbf26e7bbc3f2984f704478` | local |
| `claude/datiq-discoverability-module-542c4a` | `4193a8a517e0ae64967c053d980912dcc3d226a9` | local |
| `claude/global-skill-deployment-ddb9db` | `c6178f476b3b798621f7e03ab149e1319c820186` | local |
| `claude/node-24-upgrade-phase-5-5d22d9` | `9dbddda44828a9f5ef103aa87cc0260da7e07a3e` | local |
| `codex/airtable-schema-endpoint` | `f5c8b2153f70352e811760eeee2afc8f6b38ddbe` | local |
| `node-24-upgrade` | `75d0cf4d10abe61ad2a1948ee1c3f9b1ed6532a1` | local |
| `claude/staging-build-prerender-plan-5f1eef` | `24985b03e10ca38844dd6f358418a73d0aeedb12` | local |
| `origin/AI-era-discoverability-intelligence` | `06085b255f1de74ed914306bed6ab108234e820c` | remote |
| `origin/claude/audit-storage-error-003fa6` | `2c4928b1ec82fcae8952205c1a90344d1db78983` | remote |
| `origin/claude/datiq-discoverability-module-542c4a` | `4193a8a517e0ae64967c053d980912dcc3d226a9` | remote |

## Deleted (local)

`claude/ai-era-discoverability-intelligence-1af447`, `claude/consolidate-parallel-runs-4c34b7`,
`claude/global-skill-deployment-ddb9db`, `claude/node-24-upgrade-phase-5-5d22d9`,
`codex/airtable-schema-endpoint`, `claude/staging-build-prerender-plan-5f1eef`.

## NOT deleted — checked out by another worktree

These are fully contained in `origin/staging` and are safe to delete, but each is the
checked-out branch of a live worktree. Deleting them here would have required removing
or re-pointing someone else's working copy, which this session deliberately did not do —
this repo has a documented history of parallel sessions.

| Branch | Worktree holding it |
|---|---|
| `node-24-upgrade` | `/Users/vikash/Extracta` (the MAIN checkout) |
| `AI-era-discoverability-intelligence` | `.claude/worktrees/consolidate-parallel-runs-4c34b7` |
| `claude/audit-storage-error-003fa6` | `.claude/worktrees/audit-storage-error-003fa6` |
| `claude/datiq-discoverability-module-542c4a` | `.claude/worktrees/datiq-discoverability-module-542c4a` |

To finish the cleanup once those sessions are done:

```bash
git worktree remove .claude/worktrees/<name>       # or: git -C <path> switch main
git branch -d <branch>
```

The main checkout should be switched to `main` or `staging` rather than removed.

## Remote branches

`origin/AI-era-discoverability-intelligence`, `origin/claude/audit-storage-error-003fa6`
and `origin/claude/datiq-discoverability-module-542c4a` are all contained in
`origin/staging`. They are deleted only after this branch has been merged, so the
cleanup and the release are not entangled.

## Carried forward — nothing, after all

`workflow-implementation-and-optimization` reads as 1 commit ahead of `staging`
(`1a13eda`, "docs: save Node 24 session handoff"). It is **not** ahead by content:
that same file is already on `staging` as `4e1d24b`, and
`git diff 1a13eda:<file> origin/staging:<file>` is empty. The two commits are
byte-identical duplicates with different SHAs — the change reached `staging` by a
separate route and the branch was never fast-forwarded.

So there was nothing to move. Cherry-picking it was attempted, produced an empty
commit, and was aborted. The branch can simply be fast-forwarded to `staging`
whenever convenient:

```bash
git branch -f workflow-implementation-and-optimization origin/staging
```

**Net result: all four keep-branches are content-equivalent to `staging`, and every
other branch is fully contained in it. No work was stranded anywhere.**
