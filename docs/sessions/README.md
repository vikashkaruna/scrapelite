# DatIQ Session Records

> **Convention changed 2026-09-02: one consolidated log, not one file per session.**

## Where things are

| File | What it is |
|---|---|
| [`SESSION-LOG.md`](./SESSION-LOG.md) | **The active log.** Newest entry first. Every new session **prepends** an entry here. |
| [`SESSIONS-HISTORY.md`](./SESSIONS-HISTORY.md) | Frozen deep archive — 70 sessions up to 2026-08-30. Do not append to this. |

That is the whole directory, and it is meant to stay that way.

## Why this changed

The old rule was one `SESSION-HANDOFF-YYYY-MM-DD-<TOPIC>.md` per session. By
September 2026 that had produced 70 archived records plus a growing tail of
loose files, and answering *"what happened to X?"* meant grepping a directory
rather than reading a log.

Session records are read **newest-first**, far more often than they are read
individually. The format now matches that access pattern.

## Adding a session record

1. Open [`SESSION-LOG.md`](./SESSION-LOG.md).
2. **Prepend** a new `## YYYY-MM-DD HH:MM TZ — <headline>` block directly under
   the file header, above the previous newest entry.
3. Use the entry template at the bottom of that file.
4. Update the *Last updated* pointer at the top of `CLAUDE.md`.

**Do not** create a new `SESSION-HANDOFF-*.md`. If you find one, fold it into
`SESSION-LOG.md` and delete it.

**Do not** edit an existing entry except to correct a factual error — and when
you do, say so inside the entry rather than silently rewriting history. A record
that quietly changes is worse than no record.

## A note on links inside `SESSIONS-HISTORY.md`

That archive still contains links to `SESSION-HANDOFF-*.md` files that no longer
exist — they were folded into it by an earlier consolidation. Those are left
**deliberately unrewritten**: the archive is a record of what was written at the
time, and silently editing historical text to make links resolve would falsify
it. The content those links point at is in the same file, reachable from its
Master Table of Contents.

Live documents (`CLAUDE.md`, `AGENTS.md`, `docs/*.md`) carry **no** dead session
links — those were repaired on 2026-09-02 to point at the archive anchor or at
`SESSION-LOG.md`.
