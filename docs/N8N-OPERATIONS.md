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

### MCP server connection fails (Claude Desktop)

**Symptom:** Claude Desktop shows "Failed to connect to MCP server" or "tool not found."

**Possible causes:**
1. **Wrong URL or API key.** Verify `MCP_SERVER_URL` in `claude_desktop_config.json` is `https://n8n-dev-692109205619.asia-south1.run.app/mcp` (no trailing slash, no path).
2. **n8n is down.** Check the URL in a browser; should redirect to the n8n login.
3. **Workflows aren't imported.** Open n8n → Workflows. The `datiq_*` workflows should be present and active. If not, re-import.
4. **MCP server trigger not enabled.** n8n Settings → MCP Server. Verify it's enabled.

**Resolution:** Fix the config, restart Claude Desktop.

---

### Credentials expired / rotated

**Symptom:** A workflow that was working suddenly returns 401/403 from an upstream service (Resend, Slack, Supabase).

**Resolution:** See `n8n/ops/SECRETS.md` for the rotation procedure. After updating, retry the failed events in `/admin/automation`.

---

### n8n version upgrade failed

**Symptom:** n8n is up but workflows return 500s.

**Resolution:** See `n8n/ops/UPGRADES.md` §"Rollback". Roll back to the previous image, then restore the data dir from the pre-upgrade backup.

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
