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

- **Directory**: All session handoffs and session records **must** be stored in `docs/sessions/`.
- **Filename Convention**:
  - Handoff records: `docs/sessions/SESSION-HANDOFF-YYYY-MM-DD-<TOPIC-SLUG>.md`
  - Milestone wrap-ups / cutovers: `docs/sessions/SESSION-END-YYYY-MM-DD-<TOPIC-SLUG>.md`
- **Never place loose session files in `docs/` root**.
- **Archive & Index**: `docs/sessions/README.md` maintains a categorized reverse-chronological index of all session records.

---

## 2. Standard Session Handoff Template

Every new session record must follow this structured markdown template:

```markdown
# Session Handoff — YYYY-MM-DD — <Headline / Summary Topic>

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

### 1. Generating a New Handoff
To create a pre-populated session handoff file with current git branch and status:
```bash
node .agents/skills/session-handoff-management/scripts/new-session.mjs --title "<topic-name>"
```

### 2. Updating the Session Index
To regenerate the index in `docs/sessions/README.md`:
```bash
node .agents/skills/session-handoff-management/scripts/index-sessions.mjs
```

---

## 4. Updating Pointers in `CLAUDE.md` and `AGENTS.md`

Whenever completing a session:
1. Place the new handoff in `docs/sessions/SESSION-HANDOFF-YYYY-MM-DD-<TOPIC>.md`.
2. Update the `Active handoff` pointer in `AGENTS.md` and `CLAUDE.md` to reference `docs/sessions/...`.
3. Update `docs/sessions/README.md` index.
