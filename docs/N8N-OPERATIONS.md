# n8n Operations Runbook — DatIQ

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4
> **Audience:** You (Vikash) running the Hostinger-hosted n8n instance

The detailed operations (deploy, backups, upgrades, secrets) are in `n8n/ops/`. This runbook is the higher-level "what to do when X" guide.

---

## Daily checks (2 minutes)

- **Open `/admin/automation` on datiq.app** — verify the "Pending" KPI is 0-5. If it's growing, jump to "Pending queue is growing" below.
- **Slack `#datiq-alerts`** — should be quiet. If there are messages, the failure-alert workflow fired; click through to `/admin/automation` to see the failed events.
- **Email** — no action needed unless the failure alert emails are piling up.

---

## Weekly checks (5 minutes)

- **Backup log** — `cat /var/log/datiq-n8n-backup.log | tail -20`. The last line should be `[DatIQ] backup complete: /var/backups/datiq-n8n/<timestamp> (<size>)`.
- **Off-host sync log** — verify the rclone/S3 sync ran successfully.
- **n8n version** — `docker exec datiq-n8n n8n --version`. Compare to the pinned version in `n8n/docker-compose.yml`. Bump if a minor is out (see `n8n/ops/UPGRADES.md`).
- **Disk space** — `docker system df` and `df -h /var/lib/datiq-n8n`. Alert at > 70%.

---

## Common incidents

### Pending queue is growing

**Symptom:** `/admin/automation` shows 20+ pending events.

**Possible causes:**
1. **n8n is down.** Check: `curl -I https://n8n-dev-692109205619.asia-south1.run.app/`. If 5xx, the orchestrator is dispatching but n8n is failing.
2. **The orchestrator is down.** Check: `curl -X POST https://datiq.app/api/workflow-orchestrator/run-now -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"`. If 5xx, Netlify's function is broken.
3. **A specific kind is broken.** Check the "Events by kind" chips on the admin page. If one kind is dominating, the matching workflow is the issue.
4. **All events failing.** Look at "Failed (24h)". Click one. Look at the runs. If `response_status: 500` from n8n, the workflow is broken. If `network: ECONNREFUSED`, n8n is unreachable.

**Resolution:**
- For 1: SSH to Hostinger, `docker compose -f /opt/datiq-n8n/docker-compose.yml up -d`. Watch logs.
- For 2: Check the Netlify function logs. The orchestrator is a Netlify Scheduled Function; Netlify dashboard → Functions → `workflow-orchestrator` → Logs.
- For 3: Open the failing workflow in n8n, look at the most recent execution, fix.
- For 4: Click "Retry" on the failed event in `/admin/automation` (or call `datiq_retry_workflow_event` from MCP). The orchestrator will pick it up on the next 5-min run.

---

### Schedule changes are silent (no Slack / no email)

**Symptom:** A schedule was set to detect changes; nothing happens when the content changes.

**Possible causes:**
1. **The orchestrator isn't running.** See above.
2. **The `datiq_schedule_changed_router` workflow isn't activated.** Open n8n → Workflows → find it → toggle on.
3. **The Slack / Resend credentials are misconfigured.** Open the workflow, click each red "?" node, verify the credential is bound.
4. **`SCHEDULE_ALERT_WEBHOOK` env var is wrong.** Check Netlify env vs `n8n/.env` `DATIQ_N8N_API_KEY`. They must match.

**Resolution:** Fix the workflow, then go to `/admin/automation` → find a failed `schedule.changed` event → click "Retry".

---

### "n8n is not configured" errors

**Symptom:** `/admin/automation` shows "Failed (24h) > 0" with `last_error: "N8N_BASE_URL not configured"` or similar.

**Cause:** The Netlify function can't find the n8n URL. The env var is missing in the Netlify context.

**Resolution:**
1. Netlify dashboard → Site → Settings → Environment variables
2. Verify `N8N_BASE_URL` and `N8N_WEBHOOK_SECRET` are set in the current context (production, staging, etc.)
3. Trigger a redeploy or call `/api/workflow-orchestrator/run-now` to force a fresh config read
4. Click "Retry" on the failed events

---

### Netlify Edge Access SSO Redirect (curl returns Login Redirect HTML)

**Symptom:** `curl -X POST https://<preview>--datiqapp.netlify.app/...` returns `<title>Login Redirect</title>`.

**Cause:** Netlify draft/preview deployments enforce Edge Access Team SSO on unauthenticated external HTTP requests.

**Resolution:**
1. Add `/.netlify/functions/*` and `/api/*` to Netlify Edge Access Bypass.
2. Or run the local end-to-end simulation: `npm run test:workflow`.

---

### Admin / Automation Unauthorized (401) on refresh

**Symptom:** `/admin/automation` displays an error banner saying "unauthorized" or "Missing admin token".

**Cause:** The admin session token in `localStorage` expired (8h TTL) or was created with an outdated key.

**Resolution:**
1. Click the **"Re-enter PIN"** button directly inside the red error banner on `/admin/automation` (or click "Exit admin" at the bottom-left of the sidebar).
2. Enter your admin PIN (default demo PIN: `ADMIN123`).

---

### Verifying Primary n8n Route vs Fallback

**Goal:** Ensure events are processed by n8n on Cloud Run and did NOT fall back to direct Netlify functions.

**Resolution:**
1. Query Supabase: `SELECT state, attempts FROM workflow_events WHERE id = '<EVENT_ID>';` — state must be `'done'`.
2. Query Runs: `SELECT channel, status, response_status FROM workflow_runs WHERE event_id = '<EVENT_ID>';` — channel must be `'n8n'` and status `'success'`.
3. Check n8n Executions: Open `https://n8n-dev-692109205619.asia-south1.run.app/executions` to view the live execution trace.

---

## Automated Pipeline Testing & Cloud Run Import

### 1. Test Pipeline End-to-End
```bash
npm run test:workflow
```
Simulates the full 5-stage pipeline: Enqueue (`_ctx`) → Claim → HMAC Dispatch → Exponential Backoff → Server Callback (`done`) → `workflow_runs` audit log.

### 2. Bulk Import Workflows to Cloud Run
```bash
N8N_API_KEY=<your-n8n-api-key> npm run import:cloudrun
```
Imports all 17 workflow JSON files directly to Cloud Run via the n8n REST API.

---

## The cron truth

| What | Cron | Where |
|---|---|---|
| DatIQ hourly schedule runner | `@hourly` | Netlify Scheduled Function `scheduled-runner.js` |
| DatIQ workflow orchestrator | every 5 min | Netlify Scheduled Function `workflow-orchestrator.js` |
| DatIQ daily digest email | `0 21 * * *` UTC | n8n `datiq_daily_digest` |
| n8n daily backup | `0 3 * * *` | host cron |
| n8n smoke test | every 5 min | n8n `00_datiq_smoke_test` |

The smoke test fires every 5 min just to confirm n8n is alive and can reach the DatIQ orchestrator. If it stops appearing in `/admin/automation` → "Recent events" → "kind: op.alert" (or in n8n's Executions tab), n8n is down or unreachable.

---

## Capacity planning

Current V1 sizing (1 CPU / 1 GB RAM, SQLite):
- ~50 concurrent workflow executions
- ~10k workflow runs / month before SQLite starts slowing

If you hit either limit:
1. Migrate to Postgres (the docker-compose `n8n_data` volume becomes a Postgres volume)
2. Bump the resource limits in `docker-compose.yml`
3. Enable n8n queue mode (main + worker)

**Don't migrate preemptively.** Wait for a real signal.

---

## Contact for help

You're solo on this. The runbook above is designed to be self-sufficient. If something's not covered:

1. Check `n8n/ops/*.md` (4 detailed docs)
2. Check `docs/N8N-WORKFLOWS.md`
3. Check `docs/MCP-TOOLS.md`
4. As a last resort, ask Mavis (this agent) to investigate — I have the codebase context and the MCP tools to read the queue.

---

## What this runbook is NOT

- Not a substitute for `n8n/ops/UPGRADES.md` (read that before any version bump)
- Not a substitute for `n8n/ops/SECRETS.md` (read that before rotating any credential)
- Not a substitute for `n8n/ops/BACKUPS.md` (read that before any restore)
