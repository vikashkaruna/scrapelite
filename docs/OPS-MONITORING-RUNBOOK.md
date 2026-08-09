# Ops Monitoring Runbook — `/admin/monitoring` + `/admin/health`

> **Audience: operators.** INTERNAL — this document names internal job ids,
> env vars and failure modes. It must never be summarised into `public/help/`.
> The readiness audit (`npm run readiness`) fails the build if admin/internal
> terms appear on a customer-facing surface.
>
> Added 2026-07-28 on branch `monitoring-services-in-admin-module`.

---

## 1. What this feature is for

Before it, three operational questions had no answer anywhere in the product:

| Question | Why it mattered |
|---|---|
| Did the cron actually run? | All four crons sat **unscheduled from R19 until 2026-07-27** and nothing noticed. `billing-cron_runs` stores only the LAST SUCCESS, so a job failing for six days looks identical to one that was never deployed. |
| Is Supabase / Netlify / the mail provider up, and how fast? | The only signal was a customer complaint. |
| Who stopped that job, and why? | Nothing could be stopped, so nothing was recorded. |

Two admin pages answer them:

* **`/admin/monitoring`** — platform crons and every user's monitoring schedule:
  execution status, last success, next run, run history, and start/stop control.
* **`/admin/health`** — hosting, database, identity and third-party services:
  reachability, latency benchmarks and uptime.

---

## 2. The two rules that shape everything

### 2.1 "Not checked" is never "down"

`src/lib/healthModel.js` keeps four states, and the distinction between the last
two is the whole point:

| State | Meaning |
|---|---|
| `ok` | Answered, within its latency budget. |
| `degraded` | Answered, but slowly — or a status page reports a partial incident. |
| `down` | We asked, and it did not answer. |
| `unknown` | **We never asked**, or could not. |

`unknown` is excluded from the headline verdict *and* from uptime — in both
directions. A dashboard that paints "Razorpay: DOWN" because nobody set the key
sends an operator chasing an outage that isn't happening; one that paints it
green because the probe was skipped is worse. Both are how monitoring gets muted.

Uptime applies the same rule: an hour with no sample is an hour with **no
evidence**, not an hour of downtime. `computeUptime` returns `null` — the UI
shows "no data", never "0%".

### 2.2 The kill switch fails OPEN

`isJobEnabled()` returns **true** when Supabase is unreachable, the config row
is malformed, or the fetch times out. Same asymmetry as `requireEntitlement.js`
and `reserveCoupon`. **Do not "harden" this:**

* Failing **closed** means a Supabase blip silently stops billing, dunning and
  every user's monitoring — with no error anywhere, because "not running" is
  exactly what a kill switch looks like. That is the R19 bug reintroduced as a
  feature.
* Failing **open** means a job you stopped might run once more during an outage.
  Every job is idempotent or interlocked against that.

For a stop that cannot fail open, use `OPS_JOBS_DISABLED` (read from the process
environment — see §6).

---

## 3. What is monitored

### 3.1 Platform jobs (`src/lib/monitoringModel.js` → `AUTOMATION_JOBS`)

| Job | Schedule | Destructive | Manual run | Notes |
|---|---|---|---|---|
| `scheduled-runner` | `@hourly` | no | ✅ | Runs every due user schedule. |
| `reengagement` | `@daily` | no | ✅ | ⚠️ **Known defect — see §7.** |
| `billing-lifecycle` | `@daily` | no | ✅ | Critical: the purge interlock reads its freshness. |
| `billing-purge` | `@daily` | **YES** | ❌ **refused** | Five interlocks, ships disarmed. |
| `health-monitor` | `@hourly` | no | ✅ | New. Samples health, alerts on transitions. |

> ⚠️ **This registry is the EXPECTATION. `netlify.toml` is the reality.**
> Netlify reads only its `[functions."<name>"] schedule` blocks — the
> `export const config = { schedule }` in each function is **ignored** for v1
> handlers. Adding a job to the registry does **not** schedule it. Adding it to
> `netlify.toml` without adding it here means it runs unmonitored.

### 3.2 Health components (`src/lib/healthModel.js` → `HEALTH_COMPONENTS`)

| Component | Group | Critical | Probe |
|---|---|---|---|
| `netlify-site` | platform | ✅ | Netlify API — published deploy state/branch/age |
| `netlify-platform` | platform | — | netlifystatus.com Statuspage |
| `functions-runtime` | platform | ✅ | The running function itself (context, region, deploy id) |
| `supabase-db` | database | ✅ | **HEAD on `app_config`** — a real PostgREST round trip |
| `supabase-auth` | database | ✅ | `GET /auth/v1/health` (GoTrue) |
| `supabase-platform` | database | — | status.supabase.com Statuspage |
| `email-resend` | services | — | `GET /domains` — proves reachability *and* key validity |
| `payments-razorpay` | services | — | status.razorpay.com Statuspage |
| `ai-providers` | services | — | Key presence only (probing costs tokens) |
| `scrape-providers` | services | — | Key presence only |

Two deliberate choices:

* **The DB probe queries a table, not the API root.** The root answers from the
  gateway and stays green while Postgres behind it is unreachable.
* **Only `critical` components can make the platform `down`.** Resend being
  unreachable stops alert mail — real, and not an outage of the product. It caps
  the verdict at `degraded`.

---

## 4. Daily use

### Reading `/admin/monitoring`

* **Healthy** — a run succeeded within 2.5× the job's own interval. (1× would
  alarm on healthy systems: Netlify's firing times drift, and a cold start plus
  a slow Supabase pushes an hourly job past the hour.)
* **Stale** — measured from the last **success**, not the last run. A job whose
  every attempt is skipped has run recently and achieved nothing.
* **Stuck** — started, never finished. Only an append-only run log can show
  this; a last-success-only table cannot.
* **Never run** — no history at all. **First thing to check: does
  `netlify.toml` declare its schedule?**
* **Stopped** — an operator stopped it. Reported *instead of* stale on purpose:
  once you have deliberately stopped something, "it has not run" is noise.

### Stopping a job

1. Click the pause icon → a reason dialog opens.
2. **The reason is mandatory.** Rejected at three layers: the dialog's confirm
   button, the handler, and a `CHECK` constraint on `ops_audit_log`.
3. It takes effect on the job's **next scheduled fire** — it does not
   unschedule the cron. The job still fires and records a `skipped` run, so you
   can see it is stopped rather than broken.

> ⚠️ **Stopping `billing-lifecycle` silently disarms `billing-purge`**, because
> the purge refuses to delete anything unless the lifecycle succeeded within 48
> hours. That is the safe direction to fail, and the dialog warns you.

### Running a job by hand

Allowed for everything except `billing-purge`. The refusal is enforced twice,
independently: the UI disables the button (`manualRunAllowed`), and the handler
returns **403**. `billing-purge` is not even in `admin-monitoring.js`'s
`RUNNABLE` map — a module that is never imported cannot be invoked by a typo.

Every other control here is reversible; deletion is not, so it keeps exactly one
trigger path: its schedule.

### Pausing a user's schedule

`status` (the user's intent) and `system_paused` (the platform's) are separate
columns — see `0015_scheduler_hardening.sql`. An admin pause is tagged
`system_pause_reason = 'admin_paused'`, distinct from the lifecycle's
`'subscription_suspended'`, so:

* a subscription reactivation will **not** un-pause something you stopped; and
* resuming yours will **not** restart a schedule the user paused themselves —
  the response says so explicitly.

---

## 5. Database objects (migration `0018_ops_monitoring.sql`)

| Table | Purpose | Pruned? |
|---|---|---|
| `job_runs` | One row per execution **attempt**. `status` starts `running` and is patched at the end. | Yes, 30d |
| `health_samples` | One row per component per probe. The series behind uptime and latency. | Yes, 30d |
| `ops_audit_log` | Every operator intervention. `reason` is `NOT NULL` **and** `CHECK (length(btrim(reason)) > 0)`. | **Never** |

All three are RLS-enabled with **no policy** — service key only.

`ops_audit_log` is deliberately never pruned: it is the record of who turned the
billing cron off, and a retention job that quietly erases that is precisely what
an audit trail exists to prevent.

```sql
-- Retention. Not scheduled by anything yet; run it from the SQL editor.
select public.prune_ops_history(30);
```

`prune_ops_history` will **not** delete a row still marked `running`: that row is
the only evidence of a job that died mid-flight and must survive long enough for
someone to see it.

`billing_cron_runs` (0017) is **not** replaced. The purge interlock still reads
it, and that interlock keeps its own minimal dependency.

Verify locally — no Docker, no network, ~5s:

```bash
npm run test:db
```

---

## 6. Environment variables

All optional. Every one defaults safely.

| Var | Effect if unset |
|---|---|
| `OPS_ALERT_EMAIL` | **No alert mail, ever.** Sampling still runs. Comma-separated for several recipients. |
| `OPS_JOBS_DISABLED` | Nothing stopped. Comma-separated job ids; a break-glass stop that **cannot fail open** because it is read from the process environment. Jobs stopped this way show `source: "env"` and cannot be started from the UI. |
| `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` | `netlify-site` reports `unknown` (not `down`). |
| `RESEND_API_KEY` | `email-resend` reports `unknown`; also required for alert mail. |
| `ALERT_EMAIL_FROM` | Defaults to `DatIQ Alerts <alerts@datiq.app>` — the machine-alert sender, per the one-env-var-per-sender rule. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | No run history, no uptime history, no kill-switch persistence. Both pages still work and say so explicitly. |

---

## 7. Known issues surfaced rather than hidden

**`reengagement` is a silent no-op in production.** It selects a `user_email`
column that `0004_scheduler.sql` never creates; the query 400s and the error is
swallowed, so the job reports **success while sending nothing**.

Rather than let a green row contradict that, the defect is carried as an
explicit `caveat` on the job in `monitoringModel.js` and rendered next to its
status. Monitoring that lies by omission is worse than none.

Fixing the underlying query is out of scope for this branch and remains on the
outstanding list in `CLAUDE.md`.

---

## 8. Verifying after deploy

⚠️ **Netlify runs scheduled functions for the PRODUCTION deploy only.** A branch
deploy returning 200 on a cron endpoint proves nothing.

1. **Apply the migration.** `npm run migrate:prod` (or paste
   `supabase/migrations/0018_ops_monitoring.sql`). Expect **29 tables / 10
   functions**.
2. **Confirm the new cron is scheduled.** `health-monitor` must appear with a
   non-null `schedule`, and `GET /.netlify/functions/health-monitor` must return
   **404** — a registered scheduled function is not HTTP-invocable. A **200 means
   it is not scheduled.**
3. **Open `/admin/monitoring`.** On a fresh database every job reads "never run"
   — correct, and the page says so rather than implying an outage.
4. **Wait one hour**, then confirm `scheduled-runner` and `health-monitor` have
   run, and `/admin/health` shows samples.
5. **Arm alerting last.** Set `OPS_ALERT_EMAIL` only once you have watched the
   dashboard for a cycle and trust the readings.

---

## 9. Test coverage

| Layer | File | What it pins down |
|---|---|---|
| Unit | `src/lib/monitoringModel.test.js` | Cron matching, next-run, status derivation, the destructive-job rule |
| Unit | `src/lib/healthModel.test.js` | ok/degraded/down/**unknown**, per-component latency budgets, uptime |
| Unit | `src/lib/monitoringService.test.js` | Server refusal messages reach the UI intact |
| Contract | `netlify/__tests__/jobControl.test.js` | Fail-open, run logging, monitoring never breaks the job |
| Contract | `netlify/__tests__/lib/healthProbes.test.js` | Every probe, timeouts, `configured:false` ≠ `down` |
| Contract | `netlify/__tests__/admin-monitoring.test.js` | Auth, reason enforcement, destructive-job refusal |
| Contract | `netlify/__tests__/admin-health.test.js` | Classification, uptime windows, sample recording |
| Contract | `netlify/__tests__/health-monitor.test.js` | Transition-only alerting, disarmed by default |
| Integration | `src/pages/admin/AdminMonitoring.integration.test.jsx` | Reason gate, disabled destructive button |
| Integration | `src/pages/admin/AdminHealth.integration.test.jsx` | "Not checked" is visually its own state |
| E2E | `e2e/smoke/admin-monitoring.spec.js` | Both routes in a real browser |
| DB | `scripts/db-verify.mjs` | CHECK constraints, retention, stranded-run survival |

```bash
npm run test:unit && npm run test:contract && npm run test:integration \
  && npm run test:db && npm run build && npm run test:e2e:smoke
```
