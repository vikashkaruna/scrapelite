---
name: session-handoff-management
description: >-
  Manages, structures, organizes, and indexes DatIQ session handoffs, session records,
  and work wrap-ups in docs/sessions/. Use this skill whenever concluding a coding session,
  preparing a handoff for the next session or agent, saving the session state, archiving
  historical handoffs, or creating a fresh-start summary for a new iteration.
---

# DatIQ Session Handoff & Record Management

In this codebase, continuous multi-agent and multi-session development relies on clear, structured, and discoverable session records. Session handoffs serve as the permanent source of truth for:
1. What was built, why, and what was tested.
2. Root causes of complex bugs and architectural decisions.
3. The exact branch state, commit hashes, and verification evidence.
4. Concrete operator deployment steps and open TODOs for the next agent/developer.

---

## 1. Storage Standards & File Organization

> **⚠️ CONVENTION CHANGED 2026-09-02. Read this before writing anything.**
>
> The old rule — one `SESSION-HANDOFF-YYYY-MM-DD-<TOPIC>.md` per session — is
> **retired**. It produced 70+ archived records plus a growing tail of loose
> files, and the owner reported it as unmanageable. Session records are read
> newest-first far more often than individually, so the format now matches that.

- **Directory**: `docs/sessions/` — and it contains exactly **three** files:

  | File | Role |
  |---|---|
  | `SESSION-LOG.md` | **The active log.** Newest entry first. Append here. |
  | `SESSIONS-HISTORY.md` | Frozen deep archive (70 sessions to 2026-08-30). Never append. |
  | `README.md` | Index + this convention. |

- **To record a session**: **PREPEND** a `## YYYY-MM-DD HH:MM TZ — <headline>`
  block to `SESSION-LOG.md`, directly under the file header. Use the entry
  template at the bottom of that file.

- **DO NOT create a new `SESSION-HANDOFF-*.md` file.** If you find one, fold it
  into `SESSION-LOG.md` and delete it.

- **DO NOT rewrite an existing entry** except to correct a factual error, and
  say so inline when you do. A record that quietly changes is worse than none.

- **Never place loose session files in `docs/` root.**

## 2. Standard Session Entry Template

Every new entry prepended to `SESSION-LOG.md` follows this shape:

```markdown
## YYYY-MM-DD HH:MM TZ — <Headline / Summary Topic>

> **Branch:** `<branch-name>` @ `<commit-hash>`  
> **Target:** `<staging | main | feature-branch>`  
> **Verification:** All test suites green (<N> unit, <N> contract, <N> integration, <N> e2e smoke, DB verify, build clean)  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | YYYY-MM-DD |
| **Branch** | `<branch-name>` |
| **HEAD SHA** | `<commit-sha>` |
| **Status** | Complete & verified / In progress |
| **Pre-Push Gates** | 100% green (`npm run test:all` / `npm run test:prepush`) |
| **Active Focus** | <1-line summary of what this session tackled> |

---

## 2. What Was Accomplished

Group accomplishments by functional area:
- **Core Features**: Changes to extraction, workflows, discoverability, etc.
- **Architectural Refactors**: Queue plumbing, service layer, auth/session handling.
- **Bug Fixes**: Exact symptoms, root causes, and solutions.
- **Tooling & DX**: Scripts, pre-push hooks, tests, documentation.

---

## 3. Root Cause Analysis (When Fixing Bugs)

For any bug fix or regression:
1. **Symptom**: What failed, where, and what was the error message.
2. **Root Cause**: The technical mechanism of why it failed (code location, variable, timing/race, dependency drift).
3. **Resolution**: How the fix was applied and why it prevents future recurrence.

---

## 4. Verification Evidence

Document the exact test execution results:
- `npm run test:unit`: N files / N tests passed
- `npm run test:contract`: N files / N tests passed
- `npm run test:integration`: N files / N tests passed
- `npm run test:db`: N migrations / N assertions passed
- `npm run test:security`: passed
- `npm run build && npm run check:prerender`: N pages synced / N asset refs verified
- `npm run test:e2e:smoke`: N passed

---

## 5. Operator Deployment Tasks & Open Items for Next Session

Actionable checklist for the next session or operator:
- [ ] Supabase migrations to execute on staging/prod (`supabase/migrations/*.sql`)
- [ ] Environment variables to set in Netlify / Hosting
- [ ] Workflows to import or crons to configure
- [ ] Deferred features or follow-up items
```

---

## 3. Automation Scripts

### 1. Generating a New Entry
⚠️ `scripts/new-session.mjs` still writes a **separate file**, which is the retired
convention. Either prepend to `SESSION-LOG.md` by hand, or use the script and
immediately fold its output into `SESSION-LOG.md` and delete the file it made.

### 2. Updating the Session Index
⚠️ **`scripts/index-sessions.mjs` is RETIRED — do not run it.** It indexes one
file per session, which no longer exists, so it overwrites the README that
documents this convention with a two-row table reading *"Total Sessions
Archived: 2"* (verified 2026-09-03). `docs/sessions/README.md` is hand-written
and needs **no** per-session edit: it indexes the log, not individual files.

---

## 4. Updating Pointers in `CLAUDE.md` and `AGENTS.md`

Whenever completing a session:
1. **Prepend** the entry to `docs/sessions/SESSION-LOG.md` (newest first).
2. Update the `Last updated` pointer at the top of `CLAUDE.md` to summarise the
   session and link to `docs/sessions/SESSION-LOG.md`.
3. `docs/sessions/README.md` needs no per-session edit — it indexes the log, not
   individual files.
