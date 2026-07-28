# Session handoff — 2026-07-28 — Ops monitoring in the admin module

**Branch:** `monitoring-services-in-admin-module` (off
`claude/monitoring-services-admin-module-ec6757`). **Not merged.**

**Ask:** automation/scheduled-task monitoring with execution status, active/
inactive, last and next run, and start/stop control; plus a quick monitoring
view of servers, databases, services and connectivity — Netlify, Supabase,
platform status, benchmarks and health parameters. With tests and docs.

---

## What shipped

### `/admin/monitoring` — automation

* All **five** platform crons: status, last **success**, next run, cron
  expression, expandable run history.
* **Start/stop** per job, **run now** (except the destructive one),
  **pause/resume** any user's monitoring schedule.
* Every user schedule across all accounts, filterable, with the two pause axes
  (`status` = user intent, `system_paused` = platform intent) kept distinct.
* Recent operator actions from `ops_audit_log`.
* Summary tiles: healthy / failing+stuck / stale / stopped / active schedules /
  system paused.

### `/admin/health` — infrastructure

* Ten components across three groups, each with status, latency (graded against
  its **own** budget), uptime and probe detail.
* Headline verdict + a benchmarks table with a switchable 1h/24h/7d/30d window.
* Probes: Netlify API (published deploy state, branch, age), netlifystatus.com,
  the functions runtime itself, Supabase PostgREST (a **real table** round trip),
  GoTrue health, status.supabase.com, Resend `/domains`, status.razorpay.com,
  and the AI/scrape chains by key presence.

### Making it real rather than decorative

Three things had to exist for the dashboard not to be theatre:

1. **`job_runs`** (migration 0018) — an append-only run log. `billing_cron_runs`
   stores only the last success, so a job failing for six days looked identical
   to one never deployed. A row that stays `running` is now the signal that a
   job died mid-flight.
2. **`jobControl.withJobRun`** — wraps all five crons. Reads the kill switch,
   opens and closes the run row, and can never break the job it wraps.
3. **`health-monitor` `@hourly`** — a fifth cron, declared in `netlify.toml`,
   storing one sample per component so uptime is a measurement, not a guess.

---

## Decisions worth knowing

| Decision | Why |
|---|---|
| **Kill switch fails OPEN** | Failing closed means a Supabase blip silently stops billing, dunning and every user's monitoring — with no error, because "not running" is what a kill switch looks like. That is the R19 bug as a feature. `OPS_JOBS_DISABLED` gives an env-based stop that cannot fail open. |
| **`unknown` ≠ `down`** | An unconfigured probe reports `unknown`, excluded from the verdict **and** from uptime. Inventing outages from missing config, or hiding them behind a skipped probe, both end with the dashboard muted. |
| **`billing-purge` is not hand-runnable** | Blocked three ways: `manualRunAllowed:false`, a 403 in the handler, and absence from `RUNNABLE` (never imported → not invokable by typo). Everything else there is reversible; deletion is not. |
| **Reason mandatory, enforced three times** | Dialog button, handler, and a DB `CHECK`. Stopping the billing cron is read about months later during an incident. |
| **`ops_audit_log` is never pruned** | It records who stopped what. A retention job erasing that is what an audit trail exists to prevent. |
| **Cron matcher de-duplicated** | `scheduled-runner.js` now imports `cronMatchesHour` from `monitoringModel.js` instead of keeping a copy. Two implementations of the same grammar eventually disagree, and the dashboard would predict runs that never come. |
| **`reengagement`'s defect is displayed, not hidden** | It selects a non-existent `user_email` column, 400s, swallows the error, and reports success. Carried as a `caveat` beside the green status. |
| **Alerting ships disarmed, fires only on transitions** | No `OPS_ALERT_EMAIL` → no mail. A component that stays down sends one email, not one an hour — idempotent without a dedup table, and deliberately unlike `reengagement.js`'s anchor-on-today bug. |

---

## Test results

| Suite | Before | After |
|---|---|---|
| Unit | 1436 | **1559** (+123, 1 pre-existing failure — see below) |
| Contract | 496 | **666** passed + 14 skipped |
| Integration | 205 | **257** (+52) |
| System | 7 | 7 |
| DB (`test:db`) | 89 assertions | **101** |
| E2E smoke | 98 | **110** (+12, 1 pre-existing failure) |
| Build | clean | clean |
| Readiness | — | **6 pass / 1 warn / 0 fail** |

### Bugs the tests caught in my own code, and the fixes

1. `gradeLatency(null)` graded a missing measurement as **"fast"** —
   `Number(null)` is `0`. Guarded before conversion.
2. `formatDuration(null)` rendered a confident **"0s"** for the same reason.
3. `runAllProbes` derived a rejected probe's id from the function name, producing
   `"netlifysite"` and orphaning the observation. Ids are now explicit.
4. `writeJobEnabled` collapsed "no database" and "the write failed" into one
   result, so the handler returned 503 for both. Split via `configured`, giving
   503 vs 502 — different problems, different places to look.

### ⚠️ One pre-existing failure, not from this branch

`src/pages/About.jsx` carries an **uncommitted** rename of the founder block from
"Vikash Karuna" to "Axiom Minds Private Limited" without the matching test
update. It fails `src/pages/static-pages.test.jsx` and `e2e/smoke/about.spec.js`.
It was in the worktree before this session and was deliberately left alone —
whether the source or the tests are correct is not this branch's call.

---

## Before merging

1. Apply `0018_ops_monitoring.sql` (**29 tables / 10 functions** after).
2. Verify `health-monitor` is scheduled — **on `main` only**; expect a **404** on
   `/.netlify/functions/health-monitor`. A 200 means it is not scheduled.
3. Leave `OPS_ALERT_EMAIL` unset for the first cycle.
4. Optionally set `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` for the site probe.
5. Schedule `prune_ops_history(30)` once volume justifies it.

Full detail: [`docs/OPS-MONITORING-RUNBOOK.md`](OPS-MONITORING-RUNBOOK.md).
