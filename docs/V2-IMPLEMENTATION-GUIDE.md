# DatIQ v2 Implementation Guide — n8n + MCP Server Workflow Pipeline

> **Audience:** Anyone (you, a future co-founder, a contractor) who needs to stand up, configure, test, and operate the v2 workflow pipeline from scratch.
> **Read time:** 25 min for the full guide; 2 hours to do everything end-to-end.
> **Pre-requisites:** DatIQ V1.0 already deployed and working at `https://datiq.app` (per the 2026-07-26 handoff). Supabase project + service-role key. A self-hosted n8n instance (you already have one at `https://n8n-k8q6.srv1738397.hstgr.cloud`).
> **Companion docs:** `WORKFLOW-IMPLEMENTATION-PLAN.md` (the why), `N8N-WORKFLOWS.md` (workflow inventory), `N8N-OPERATIONS.md` (the runbook), `MCP-TOOLS.md` (MCP tool reference), `SESSION-HANDOFF-2026-07-27-V2-WORKFLOWS.md` (session close).

---

## 0. What this guide is for (purpose)

The v2 plan replaces DatIQ's old "send email + post to Slack + post to webhook directly from the scheduled-runner" pattern with a queue + orchestrator + n8n pipeline. The reasons are:

1. **No retries** — old code dropped alerts on a 5xx. New code retries with exponential backoff (1m, 5m, 30m, 2h, 12h).
2. **No observability** — old code had no log of what was sent. New code has `workflow_events` + `workflow_runs` tables, plus an `/admin/automation` page.
3. **No programmatic access** — old code was a one-way push. New code exposes 11 MCP tools so any AI agent (Claude Desktop, Claude Code, mavis) can read state, manage schedules, and process the queue.
4. **No multi-channel** — old code was hard-coded to Resend + Slack. New code can add Discord / Telegram / webhooks by editing a workflow JSON.

The work happens in three places: **Supabase** (the queue table), **Netlify** (the orchestrator function + the rewire of the existing scheduled-runner), and **n8n** (the workflow engine + MCP server). This guide walks through all three, in order.

---

## 1. Pre-requisites (what must exist before you start)

Check each item. If any is missing, stop and address it first.

| # | Requirement | How to verify |
|---|---|---|
| 1 | DatIQ V1.0 deployed at `https://datiq.app` and serving real traffic | `curl -I https://datiq.app` returns 200 |
| 2 | Netlify CLI auth'd for the `datiqapp` project | `npx netlify status` shows the project name |
| 3 | Supabase project + `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in Netlify env | Netlify dashboard → Environment → these two are set in production |
| 4 | n8n instance running and reachable at `https://n8n-k8q6.srv1738397.hstgr.cloud` | Browser → login works |
| 5 | Resend account with `RESEND_API_KEY` | Netlify env has it; domain `datiq.app` is verified in Resend |
| 6 | Slack workspace with an incoming webhook for `#monitoring` (and `#datiq-support`, `#datiq-alerts` if you want them) | Slack → Apps → Incoming Webhooks → URLs are saved in 1Password |
| 7 | `RESEND_API_KEY` set in Netlify env | Netlify dashboard → Environment |
| 8 | You have `git`, `node 20+`, `npm`, and (optionally) `npx n8n` CLI installed | `node -v` shows ≥ 20 |
| 9 | The 6 pre-existing cron presets (`0 */6 * * *` etc.) in the codebase | They are; see `src/lib/schedulerService.js` SCHEDULE_PRESETS |
| 10 | The R19 scheduler migration (`scripts/scheduler.sql`) has been applied to your Supabase | `select count(*) from public.scheduled_tasks;` returns a number |

If all 10 are green, proceed to section 2.

---

## 2. Apply the Supabase migration

**Purpose:** Create the three new tables (`workflow_events`, `workflow_runs`, `workflow_subscriptions`) that back the queue. Without these, the orchestrator and n8n workflows have nothing to read or write.

### 2.1 Migration file

`supabase/migrations/0018_workflow_events.sql` — idempotent, safe to re-run.

### 2.2 Apply via the Node runner (preferred — works on any machine, no psql required)

```bash
# From the repo root on your local machine
export PROD_SUPABASE_DB_URL="postgresql://postgres:PASSWORD@db.XXX.supabase.co:5432/postgres"
npm run migrate:prod
```

The runner discovers every `00*.sql` in `supabase/migrations/`, prints them in order, runs each in its own transaction, and exits non-zero on any error. Expected output:

```
[prod-migrate] target: postgresql://postgres:***@db.XXX.supabase.co:5432/postgres
[prod-migrate] 11 migration file(s) queued
[prod-migrate] applied supabase/migrations/0001_core_tables_and_billing.sql
[prod-migrate] applied supabase/migrations/0002_pricing_and_coupons.sql
...
[prod-migrate] applied supabase/migrations/0018_workflow_events.sql
[prod-migrate] ✓ done. applied=11, skipped=0, total=11
```

### 2.3 Apply via the Supabase SQL Editor (alternative)

If you'd rather paste, open the dashboard → SQL Editor → New query → paste the contents of `0018_workflow_events.sql` → Run. It's idempotent so re-running is safe.

### 2.4 Verify

```sql
-- Should return 0 (empty table on a fresh DB)
select count(*) from public.workflow_events;

-- Should return the 5 expected columns
select column_name from information_schema.columns
  where table_name = 'workflow_events' and table_schema = 'public'
  order by ordinal_position;
-- expected: id, kind, ref_id, user_id, payload, channels, state, attempts,
--           max_attempts, next_attempt_at, started_at, finished_at, last_error,
--           created_at, updated_at
```

If those 15 columns are present, move to section 3.

---

## 3. Set the new Netlify env vars

**Purpose:** Tell the orchestrator function where n8n is, and give it a separate admin token for the manual HTTP trigger. Both must be set in each Netlify context (production, staging, deploy-preview).

### 3.1 Generate the secrets

```bash
# Orchestrator admin token (separate from the existing admin token)
openssl rand -hex 32
# Save the output as N8N_WEBHOOK_SECRET in n8n AND as WORKFLOW_ORCHESTRATOR_TOKEN in Netlify
# (same value in both places)

# n8n encryption key (32 random bytes; encrypts every credential stored in n8n)
openssl rand -hex 32
# Save as N8N_ENCRYPTION_KEY in n8n's .env
```

### 3.2 Set in Netlify

Netlify dashboard → Site → Settings → Environment variables → add the following per context:

| Variable | Production | Staging | Deploy preview |
|---|---|---|---|
| `N8N_BASE_URL` | `https://n8n-k8q6.srv1738397.hstgr.cloud` | same | same |
| `N8N_WEBHOOK_SECRET` | (value from 3.1) | same | empty (skip) |
| `WORKFLOW_ORCHESTRATOR_TOKEN` | (separate value from 3.1) | separate | empty (skip) |

**Important:** The Netlify-side `N8N_WEBHOOK_SECRET` must equal the n8n-side `DATIQ_N8N_API_KEY`. They are the same secret, just different names per side. Mismatches cause 401s on every dispatch.

### 3.3 Verify

```bash
# Trigger a one-time orchestrator run. Should 200 with "skipped" or a summary.
WORKFLOW_ORCHESTRATOR_TOKEN=...
curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
  -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
```

Expected: `{"ok":true,"scanned":0,"dispatched":0,"failed":0,"requeued":0}` or HTTP 200 with "skipped (no N8N_BASE_URL)" if you haven't set that yet.

If you get `401 unauthorized`, the token is wrong. If you get `503 supabase not configured`, the Supabase env vars are missing. If you get `200 skipped (no N8N_BASE_URL)`, section 3 isn't done.

---

## 4. Set up the n8n instance

**Purpose:** Configure the existing n8n instance with the right env, encryption key, credentials, and workflow imports.

### 4.1 Find the data dir and current .env

SSH to the Hostinger VPS:

```bash
ssh user@n8n-k8q6.srv1738397.hstgr.cloud
sudo -i
ls -la /opt/datiq-n8n/  # or wherever the existing instance lives
```

If you're using Docker Compose, the env file is `docker-compose.yml`'s `env_file:` path. If you're running n8n as a systemd service, look in `/etc/n8n.conf` or wherever the systemd unit specifies.

### 4.2 Update .env (or systemd unit)

Add or update these variables. See `n8n/.env.example` for the full template.

```bash
# Required
WEBHOOK_URL=https://n8n-k8q6.srv1738397.hstgr.cloud
GENERIC_TIMEZONE=Asia/Kolkata
N8N_ENCRYPTION_KEY=<from step 3.1>
DATIQ_N8N_API_KEY=<same value as N8N_WEBHOOK_SECRET in Netlify>

# Auth
N8N_USER_MANAGEMENT_DISABLED=false   # you chose n8n built-in user accounts

# Execution pruning (keeps SQLite small)
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168            # 7 days
EXECUTIONS_DATA_SAVE_ON_ERROR=all
EXECUTIONS_DATA_SAVE_ON_SUCCESS=all
EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS=true

# Optional
N8N_TELEMETRY_DISABLED=true
N8N_LOG_LEVEL=info
```

### 4.3 Restart n8n

```bash
# Docker compose
cd /opt/datiq-n8n
docker compose restart n8n
docker compose logs -f n8n   # watch for "n8n ready on ::, port 5678"

# systemd
sudo systemctl restart n8n
sudo journalctl -u n8n -f
```

### 4.4 Verify

```bash
# In a browser, open https://n8n-k8q6.srv1738397.hstgr.cloud/ and log in.
# Then in n8n, go to Settings → API → Create API Key (name: "DatIQ MCP").
# Copy the key. It becomes DATIQ_N8N_API_KEY (if not already set) and N8N_WEBHOOK_SECRET in Netlify.
```

---

## 5. Create the 3 n8n credentials

**Purpose:** Bind real secrets to the 3 named credentials that the workflow JSONs reference by name. Without these, every workflow run fails on the first node that needs auth.

In the n8n UI, Settings → Credentials → Create credential:

### 5.1 `datiq-resend` (for Resend API calls)

- Type: **HTTP Header Auth** (not Resend's built-in node type — we use HTTP Request nodes throughout for consistency)
- Header name: `Authorization`
- Header value: `Bearer re_xxxxxxxxxxxxxxxxxxxx` (your Resend API key)

### 5.2 `datiq-slack-monitoring` (for Slack messages)

- Type: **Slack OAuth2 API** (recommended) OR **HTTP Header Auth** with `Authorization: Bearer xoxb-...`
- For OAuth: connect your Slack workspace; pick the channels `#monitoring`, `#datiq-support`, `#datiq-alerts`
- For webhook: paste the incoming webhook URL

### 5.3 `datiq-supabase-service` (for all Supabase reads/writes)

- Type: **HTTP Header Auth**
- Header name: `apikey`
- Header value: `<your Supabase service-role key>` (the long `eyJ...` from Supabase → Settings → API)
- The same credential is used for both the `apikey` and `Authorization` headers (the workflow JSONs set both to `$credentials['datiq-supabase-service'].value`).

### 5.4 `datiq-orchestrator` (for the force-dispatch MCP tool)

- Type: **HTTP Header Auth**
- Header name: `Authorization`
- Header value: `Bearer <WORKFLOW_ORCHESTRATOR_TOKEN>` (the value you set in Netlify in section 3.2)

### 5.5 Verify

In n8n, for each credential, click it and "Test" (n8n shows a green "Connection successful" if the cred works). For Supabase, the test is implicit — the first workflow that uses it will surface a 401 if the key is wrong.

---

## 6. Import the 17 n8n workflow JSONs

**Purpose:** Register all 11 MCP tool workflows + 5 automation flows + 1 smoke test in the n8n instance.

### 6.1 Get the JSONs

If you have the tarball from the v2 ship:
```bash
cd /Users/vikash/Extracta
tar xzf n8n-workflows.tar.gz
ls n8n/workflows/
# 17 .json files + 00-datiq-smoke-test.json
```

If you don't have it, get the latest from the branch:
```bash
git fetch origin
git checkout workflow-implementation-and-optimization
ls n8n/workflows/
```

### 6.2 Bulk import

The `n8n` CLI's `import:workflow` command takes a directory of JSONs:

```bash
npm install -g n8n     # if you don't have it; otherwise skip
npx n8n import:workflow --input=n8n/workflows/ --separate  # --separate makes each file its own workflow
```

For each import, n8n prints the workflow name. Expected: 17 successful imports.

### 6.3 Alternative — import via the UI

If the CLI doesn't work for you (firewall, version mismatch), import via the UI:

For each of the 17 JSON files:
1. n8n UI → Workflows → ⋮ → Import from File
2. Select the JSON file
3. Click "Import"

### 6.4 Set placeholders in the URLs

The generator emits `{{SUPABASE_URL}}`, `{{SITE_URL}}`, and `{{WEBHOOK_URL}}` as placeholders. After import, do a project-wide find-and-replace in the n8n UI:

- For each imported workflow, open it
- Find every `{{SUPABASE_URL}}` and replace with your Supabase URL (e.g. `abc.supabase.co`)
- Find every `{{SITE_URL}}` and replace with `datiq.app` (without `https://` because the URL is `https://{{SITE_URL}}/...`)
- Find every `{{WEBHOOK_URL}}` and replace with `n8n-k8q6.srv1738397.hstgr.cloud`

A faster way: edit the JSONs locally with `sed`, then re-import:

```bash
cd n8n/workflows
sed -i '' 's|{{SUPABASE_URL}}|abc.supabase.co|g' *.json
sed -i '' 's|{{SITE_URL}}|datiq.app|g' *.json
sed -i '' 's|{{WEBHOOK_URL}}|n8n-k8q6.srv1738397.hstgr.cloud|g' *.json
# then re-import
npx n8n import:workflow --input=n8n/workflows/ --separate
```

### 6.5 Bind credentials + activate

For each workflow, open it in the n8n UI:

1. Click any node that has a red "?" — that's an unbound credential. Pick the right one (`datiq-resend`, `datiq-slack-monitoring`, `datiq-supabase-service`, `datiq-orchestrator`).
2. Click the "Active" toggle in the top-right to turn the workflow on.
3. The smoke test (`00_datiq_smoke_test`) should be the first one you activate — it pings the orchestrator every 5 min and confirms the whole path works.

### 6.6 Verify the smoke test

Wait 5 minutes (or click "Execute Workflow" in the n8n UI to run it immediately).

Then in the DatIQ orchestrator logs (Netlify dashboard → Functions → workflow-orchestrator → Logs), you should see a new log line:

```
[DatIQ] orchestrator: scanned=0 dispatched=0 failed=0 requeued=0
```

This doesn't mean the smoke test ping is logged here (the smoke test hits `/api/workflow-orchestrator/ping`, not `/api/workflow-orchestrator/run-now`). To verify the smoke test actually fired:

- n8n UI → Executions tab → see the latest run of `00_datiq_smoke_test`
- Or check the n8n logs: `docker logs datiq-n8n --tail 50`

If you see executions, the smoke test is healthy.

---

## 7. Manual testing — end-to-end

**Purpose:** Verify the full path works: schedule create → content change → queue enqueue → orchestrator dispatch → n8n workflow → Slack + email → mark done.

### 7.1 The happy path

1. **Sign in** to datiq.app as a real user (e.g., the one you used during V1.0 testing).
2. **Go to /schedules** and create a new schedule:
   - Type: "track a page"
   - Target: a URL you control. For testing, use `https://example.com/` (steady content) or a page you can edit.
   - Cadence: "Daily" (cron `0 9 * * *`)
   - Intent: "summary"
   - Alert email: an email you check
   - Label: "v2 smoke test"
3. **Wait for the schedule to land in Supabase.** It should be in `public.scheduled_tasks`:
   ```sql
   select id, status, cron, data->>'label' as label from public.scheduled_tasks order by created_at desc limit 5;
   ```
4. **Force a runner cycle** so the schedule executes immediately (instead of waiting for the next hourly cron):
   ```bash
   # In Netlify, there's no manual trigger for scheduled-runner, but you can wait
   # or temporarily change the schedule to fire every minute. Or, for testing,
   # the easiest is to create a schedule with cron "*/5 * * * *" and wait.
   # Alternatively, just create a schedule and wait for the next hourly run.
   ```
5. **Manually trigger the scheduled-runner** (one-time): Netlify doesn't expose a manual trigger for Scheduled Functions, so the realistic path is:
   - Wait for the schedule to run on its cron (or change to `*/5 * * * *` for testing)
   - OR: temporarily deploy a quick "run-now" endpoint (out of scope for this guide; covered in `n8n/ops/DEPLOY.md` if you need it)
6. **Once the schedule fires** and the content hash differs from the previous run, the runner enqueues a `schedule.changed` event:
   ```sql
   select id, kind, state, attempts, last_error from public.workflow_events order by created_at desc limit 5;
   -- should see a new row with state='pending' (or 'done' if the orchestrator has run)
   ```
7. **Wait for the orchestrator** (every 5 min), or force it:
   ```bash
   curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
     -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
   # → {"ok":true,"scanned":1,"dispatched":1,"failed":0,"requeued":0}
   ```
8. **Check n8n**:
   - Executions tab → see the latest run of `datiq_schedule_changed_router` → all green
   - In Slack: a message in `#monitoring` with the schedule label, target, intent, hash diff
   - In your email: a "DatIQ — content changed: v2 smoke test" message
9. **Check the event row in Supabase**:
   ```sql
   select id, state, finished_at, last_error from public.workflow_events
   where kind = 'schedule.changed' order by created_at desc limit 1;
   -- should show state='done', finished_at recent, last_error=null
   ```
10. **Check `/admin/automation`** on datiq.app (after signing in as admin):
    - Pending: 0
    - Done (24h): incremented
    - The event appears in the "Recent events" table with state "done"
    - Clicking the event shows the payload, channels, and a "runs" list with the success

If all 10 steps pass, the happy path is working.

### 7.2 The MCP path

Verify that an MCP client can call the 11 tools.

#### 7.2.1 Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "datiq": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sse"],
      "env": {
        "MCP_SERVER_URL": "https://n8n-k8q6.srv1738397.hstgr.cloud/mcp",
        "MCP_API_KEY": "<DATIQ_N8N_API_KEY>"
      }
    }
  }
}
```

Restart Claude Desktop. In a new chat, you should see the 11 `datiq_*` tools in the tools list (click the "🔨" icon).

Test:
- Ask Claude: "List the most recent 5 DatIQ workflow events."
- Claude calls `datiq_list_pending_workflows` with `limit=5`
- You should see the JSON response

#### 7.2.2 Claude Code

Add a `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "datiq": {
      "type": "sse",
      "url": "https://n8n-k8q6.srv1738397.hstgr.cloud/mcp",
      "headers": { "Authorization": "Bearer <DATIQ_N8N_API_KEY>" }
    }
  }
}
```

In Claude Code: `/mcp` to list tools. Test by running a prompt that uses one.

#### 7.2.3 mavis session

The Mavis agent in this codebase already has the connection wired when `DATIQ_MCP_API_KEY` is set in the agent's env. Verify with:

```bash
# In a mavis session
echo "Use the datiq_list_pending_workflows tool to show me the queue."
```

The agent should call the tool and return the response.

### 7.3 The admin path

1. Sign in to datiq.app as admin (PIN = the configured `ADMIN_PIN` or the demo `ADMIN123`).
2. Click "Automation" in the left nav.
3. **Verify KPI cards** show non-zero values (after a few hours of operation, you'll have events).
4. **Click "Run now"** → toast "Orchestrator poll triggered." → wait ~3 sec → the KPI cards refresh.
5. **Click a row** in the events table → detail panel opens → click "Retry" or "Cancel" → toast confirms the action.
6. **Switch the filter** to "failed" → if any events show, click one → "View attempts" surface the runs log.

### 7.4 The retry path (deliberately break something)

To verify the retry logic:

1. Temporarily rotate the Resend API key in n8n to a bad value.
2. Create a new schedule.
3. Wait for the runner → orchestrator → n8n → Resend call to fail.
4. The orchestrator marks the event as `processing` then back to `pending` with a bumped `attempts` count.
5. Repeat. After 5 attempts, the event is `failed` permanently.
6. Open `/admin/automation` → filter "failed" → click the event → see the 5 failed runs.
7. Fix the Resend key in n8n.
8. Click "Retry" on the failed event.
9. Wait for the next orchestrator poll (or click "Run now") → the event dispatches successfully.
10. Confirm: Slack + email arrive; the event is now `done`.

### 7.5 The cancel path

1. In `/admin/automation`, find a `pending` event.
2. Click "Cancel" → confirm.
3. The event's `state` becomes `cancelled`, `last_error` becomes "cancelled by admin".
4. The orchestrator skips it on subsequent polls.

### 7.6 The MCP force-dispatch path

From Claude Desktop, ask: "Force-dispatch the event wfe_xyz." Claude calls `datiq_process_pending_workflow` with the event id. The orchestrator re-claims and dispatches it immediately, bypassing the 5-min poll.

---

## 8. Deploy to production

**Purpose:** Get the v2 code live on `datiq.app` (currently on v1.0) and verify it works under production traffic.

### 8.1 Pre-flight

Before opening the PR, verify:

- [ ] All 7 phases of the v2 plan are merged into `main` (the branch `workflow-implementation-and-optimization` is ready to merge).
- [ ] All Netlify env vars are set in **production** context (section 3).
- [ ] The n8n instance has the 17 workflows imported and active (section 6).
- [ ] The 4 n8n credentials exist and are tested (section 5).
- [ ] The Supabase migration is applied to production (section 2).
- [ ] All 1619 tests pass on the latest commit.

### 8.2 Open the PR

```bash
git push origin workflow-implementation-and-optimization
# On github.com/vikashkaruna/scrapelite, open a PR to main
# Title: "feat(workflows): n8n + MCP server pipeline (v2 plan)"
# Body: paste from the handoff doc
```

The phase-gate CI will run. The existing gate (per the 2026-07-26 handoff) does:
- test (vitest, playwright)
- smoke-staging
- manual-approve
- deploy-prod
- smoke-prod + auto-rollback

### 8.3 The production unlock dance

Per the 2026-07-26 handoff, production is locked by default. The new `fix/phase-gate-manual-unlock` (commit `dc49cc9`) added a manual unlock step. You need to:

1. Netlify UI → Site → Deploys → find the locked `deploy-production` job → click "Unlock"
2. Comment `approved` on the approval issue (or click Approve in the GitHub Action UI)
3. The job proceeds to deploy to `datiq.app`

### 8.4 Post-deploy verification

Within 5 minutes of deploy:

```bash
# Check the orchestrator function exists and is responsive
curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
  -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
# → {"ok":true,...}
```

```bash
# Run the full smoke test
node scripts/smoke-prod.mjs https://datiq.app
# → 10/10 green
```

```sql
-- Check the orchestrator's tables are queryable
select count(*) from public.workflow_events;  -- should be 0 or low
```

Open `/admin/automation` in production. The page should render (KPI cards, table, filters).

### 8.5 Lock production again

After verification: Netlify UI → Deploys → find the post-deploy job → "Re-lock production." This is the steady state. Next deploy needs a fresh manual unlock.

---

## 9. Operations (after deploy)

### 9.1 Daily (2 minutes)

- Open `/admin/automation` on datiq.app
- "Pending" KPI should be 0-5. If it's > 20, see troubleshooting §11.1.
- Check `#datiq-alerts` Slack channel — should be quiet.

### 9.2 Weekly (5 minutes)

- Check the n8n backup log:
  ```bash
  ssh user@n8n-k8q6.srv1738397.hstgr.cloud
  tail -20 /var/log/datiq-n8n-backup.log
  ```
- Verify the off-host copy (Tigris / S3) ran:
  ```bash
  rclone ls tigris:datiq-n8n-backups/ | tail -5
  ```
- Check disk: `df -h /var/lib/datiq-n8n` and `docker system df`. Alert at > 70%.

### 9.3 Monthly (30 minutes)

- Review failed events in `/admin/automation` — patterns in `last_error` text indicate a config issue worth fixing at the source.
- Check n8n version vs pinned in `n8n/docker-compose.yml`. Bump if a minor is out (see `n8n/ops/UPGRADES.md`).
- Verify the `datiq_n8n_api_key` and `WORKFLOW_ORCHESTRATOR_TOKEN` haven't been used in unexpected places. If leaked, rotate per `n8n/ops/SECRETS.md`.

### 9.4 Quarterly

- Rotate `DATIQ_N8N_API_KEY` (= `N8N_WEBHOOK_SECRET` in Netlify). Procedure: `n8n/ops/SECRETS.md` §"How to rotate".
- Rotate `WORKFLOW_ORCHESTRATOR_TOKEN` in Netlify.
- Bump n8n to the latest patch release (read changelog first; pin to a minor for V2).

---

## 10. Monitoring & alerts (set up later)

Out of scope for V2; documented for V2.1:

- Slack `#datiq-alerts` channel — auto-create a cron that posts a daily digest at 09:00 UTC (use the `datiq_daily_digest` workflow as the template).
- Email alert when `state='failed' AND created_at > now() - 1 hour` > 0.
- Uptime monitoring on `https://n8n-k8q6.srv1738397.hstgr.cloud/`. Use Better Uptime, UptimeRobot, or Cloudflare Analytics.
- A `failed_attempts` alert: if any event has `attempts > 3` and `state='pending'`, post to Slack.

---

## 11. Troubleshooting

### 11.1 "Pending queue is growing"

**Symptom:** `/admin/automation` shows 20+ pending events.

**Causes & fixes:**

1. **n8n is down.** `curl -I https://n8n-k8q6.srv1738397.hstgr.cloud/`. If 5xx, SSH in and `docker compose -f /opt/datiq-n8n/docker-compose.yml up -d`. Watch logs.
2. **The orchestrator is down.** Netlify dashboard → Functions → `workflow-orchestrator` → Logs. Look for 5xx in the most recent run.
3. **A specific workflow is broken.** `/admin/automation` → "Events by kind" chips → find the dominant kind → open that workflow in n8n → check the most recent execution's error.
4. **All events failing the same way.** Click one failed event → see the runs → identify the error pattern. Common:
   - `network: ECONNREFUSED` → n8n unreachable
   - `n8n 401` → `DATIQ_N8N_API_KEY` mismatch
   - `n8n 500` → workflow has a bug; check n8n logs
5. **All events timing out.** Network issue between Netlify and Hostinger. Check Hostinger status page.

**Recovery:** fix the cause, then `/admin/automation` → click "Run now" → wait for the queue to drain.

### 11.2 "n8n is not configured" in `last_error`

**Cause:** `N8N_BASE_URL` missing in Netlify env.

**Fix:** Netlify dashboard → Site → Settings → Environment → add `N8N_BASE_URL=https://n8n-k8q6.srv1738397.hstgr.cloud` → trigger a redeploy OR call `/api/workflow-orchestrator/run-now` to force a fresh env read.

Then `/admin/automation` → click "Retry" on the failed events.

### 11.3 "Schedule changed but no Slack / no email"

**Causes:**

1. `datiq_schedule_changed_router` not activated in n8n → toggle it on
2. Slack / Resend credentials not bound → open the workflow, click the red "?" nodes
3. `SCHEDULE_ALERT_WEBHOOK` mismatch → verify `N8N_WEBHOOK_SECRET` (Netlify) = `DATIQ_N8N_API_KEY` (n8n)

**Fix:** fix the cause, then `/admin/automation` → click "Retry" on the failed events.

### 11.4 "Claude Desktop can't find the MCP tools"

**Causes:**

1. Wrong URL → should be `https://n8n-k8q6.srv1738397.hstgr.cloud/mcp` (no trailing slash, no path)
2. Wrong API key → `DATIQ_N8N_API_KEY` is the API key from n8n Settings → API
3. Workflows not imported → re-import (section 6)
4. MCP server trigger not enabled in n8n → n8n Settings → MCP Server

**Fix:** restart Claude Desktop after config change.

### 11.5 "Test failed" on a credential in n8n

The Resend / Supabase credentials use HTTP Header Auth type, so the "Test" button does a fake request that may not work. The real test is: trigger a workflow that uses the credential and watch it succeed.

### 11.6 "`update updated_at` trigger error"

You're trying to PATCH a row that doesn't have a `updated_at` column, or the trigger function isn't installed. Re-run the migration (it's idempotent).

### 11.7 "n8n upgrade broke a workflow"

Roll back per `n8n/ops/UPGRADES.md` §"Rollback":

```bash
sed -i 's/n8nio\/n8n:1.95.4/n8nio\/n8n:1.95.3/' /opt/datiq-n8n/docker-compose.yml
docker compose pull n8n
docker compose down && docker compose up -d
# If the schema changed, restore from the pre-upgrade backup
```

---

## 12. File pointers

| Doc | What it covers |
|---|---|
| `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` | The architecture (v2 plan, 14 sections) |
| `docs/N8N-WORKFLOWS.md` | The 17 workflow JSONs + how to import/edit |
| `docs/N8N-OPERATIONS.md` | The on-call runbook (incidents, daily/weekly checks) |
| `docs/MCP-TOOLS.md` | All 11 MCP tools (input, return, use cases) |
| `docs/SESSION-HANDOFF-2026-07-27-V2-WORKFLOWS.md` | What was done in this session |
| `n8n/ops/DEPLOY.md` | n8n-specific deployment (from-scratch) |
| `n8n/ops/BACKUPS.md` | Daily backup + recovery |
| `n8n/ops/UPGRADES.md` | Bumping n8n versions |
| `n8n/ops/SECRETS.md` | Rotating credentials |
| `scripts/generate-n8n-workflows.mjs` | Edit this to change 14 of the 17 workflows |

---

## 13. Acceptance checklist

V2 is "done for production" when ALL of the following are true:

- [ ] Supabase migration 0012 applied to production
- [ ] 3 Netlify env vars set in production context (`N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `WORKFLOW_ORCHESTRATOR_TOKEN`)
- [ ] n8n instance has `N8N_ENCRYPTION_KEY` set and is restarted
- [ ] 4 credentials created in n8n (`datiq-resend`, `datiq-slack-monitoring`, `datiq-supabase-service`, `datiq-orchestrator`)
- [ ] 17 workflow JSONs imported into n8n, credentials bound, all activated
- [ ] 3 placeholders replaced (`{{SUPABASE_URL}}`, `{{SITE_URL}}`, `{{WEBHOOK_URL}}`)
- [ ] Smoke test workflow runs successfully (Executions tab shows green)
- [ ] End-to-end manual test (§7.1) passes: schedule → change → queue → orchestrator → n8n → Slack + email → done
- [ ] MCP tools callable from Claude Desktop / Claude Code / mavis
- [ ] `/admin/automation` renders + filterable + actions work
- [ ] All 1619 tests pass
- [ ] `node scripts/smoke-prod.mjs https://datiq.app` → 10/10 green
- [ ] Production locked after deploy (Netlify UI)
- [ ] Daily backup cron installed
- [ ] Off-host backup configured
- [ ] PR merged to main
- [ ] CLAUDE.md updated to reflect v2 ship
- [ ] Session handoff doc committed

When all boxes are checked, V2 is in production and you can move on to the V2 follow-ups (Razorpay, per-context admin pin, etc.).

---

*Last updated: 2026-07-27. Companion to the v2 plan commit on `workflow-implementation-and-optimization`.*
