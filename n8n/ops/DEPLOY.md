# n8n Deployment Guide (Hostinger VPS)

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4
> **Audience:** You (Vikash), the only operator. Documented for reproducibility, not for handing off to a team.

The user already has an n8n instance running at `https://n8n-k8q6.srv1738397.hstgr.cloud/`. This guide covers both **first-time setup** (if you need to re-provision) and **adding the DatIQ workflows** to an existing instance.

---

## TL;DR (existing instance)

If you already have n8n running and just want to add the DatIQ workflows:

```bash
# From the repo root, on your local machine
cd /Users/vikash/Extracta
npx n8n import:workflow --input=n8n/workflows/   # imports all 11+5+1 workflows
```

Then in the n8n UI:
1. Create an API key for MCP clients: Settings → API → Create API Key
2. Set the key in Netlify env as `N8N_WEBHOOK_SECRET` (same value)
3. Add the 3 credentials: Resend (outbound), Slack (workspace webhook), Supabase (service key)
4. Open each workflow and bind the credentials to the relevant nodes

That's it. The orchestrator will start dispatching events.

---

## First-time setup (re-provisioning from scratch)

Hostinger VPS, fresh, Ubuntu 22.04+.

### 1. Install Docker + Docker Compose

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# log out + back in for the group to take effect
```

### 2. Create the n8n user / directory

```bash
sudo useradd -r -s /bin/false n8n || true
sudo mkdir -p /opt/datiq-n8n /var/lib/datiq-n8n
sudo chown -R $USER:$USER /opt/datiq-n8n /var/lib/datiq-n8n
```

### 3. Copy the repo's n8n/ files into place

```bash
cd /opt/datiq-n8n
git clone https://github.com/vikashkaruna/scrapelite.git datiq-src
cd datiq-src
cp ../../n8n/docker-compose.yml  /opt/datiq-n8n/
cp ../../n8n/Caddyfile           /opt/datiq-n8n/        # only if using a custom domain
cp ../../n8n/backup.sh          /opt/datiq-n8n/
cp ../../n8n/restore.sh         /opt/datiq-n8n/
chmod +x /opt/datiq-n8n/backup.sh /opt/datiq-n8n/restore.sh
```

### 4. Configure secrets

```bash
cd /opt/datiq-n8n
cp n8n/.env.example n8n/.env
nano n8n/.env
```

Fill in:
- `N8N_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `DATIQ_N8N_API_KEY` — `openssl rand -hex 32`
- `WEBHOOK_URL` and `N8N_BASE_URL` — your public URL (kept in sync)
- `SITE_URL` — `https://datiq.app` (used by the schedule-triggered smoke test)
- `GENERIC_TIMEZONE` — `Asia/Kolkata`

The Supabase URL, the DatIQ site URL, and the git branch are NOT in
this file — they are per-event and flow through `$json._ctx.*` (the
orchestrator reads them from `process.env` and puts them in the
event payload). The only host-shaped env vars on the n8n host are
the ones n8n itself needs (its own URL and, for the smoke test, the
DatIQ site). See `n8n/ops/SECRETS.md` and `n8n/.env.example` for the
full per-variable list.

Lock down the file:
```bash
chmod 600 n8n/.env
```

### 5. Boot

```bash
cd /opt/datiq-n8n
docker compose up -d
docker compose logs -f n8n
```

Watch for `n8n ready on ::, port 5678` then `Ctrl-C`.

### 6. First-time admin user

Open `https://n8n-k8q6.srv1738397.hstgr.cloud/` (or your URL) in a browser.
Create the first owner user. **Use a strong password; this is the only admin account.**

### 7. Import the DatIQ workflows

From your local repo:
```bash
# In one terminal — start an SSH tunnel so the local CLI can reach the VPS
ssh -L 5678:127.0.0.1:5678 user@n8n-k8q6.srv1738397.hstgr.cloud

# In another terminal — install n8n CLI locally if not already
npm install -g n8n   # the CLI (separate from the Docker image)

# Authenticate
n8n export:credentials --all  # (no — this is for export, not auth)
# n8n doesn't ship a CLI auth command; use the UI to import instead.
```

**Easier path — use the UI:**
1. Open n8n in your browser
2. Settings → Import from File → upload each `n8n/workflows/*.json` from the repo
3. Or: Workflows → ⋮ → Import → select the file

After import, open each workflow and:
- Bind the `Resend`, `Slack`, and `Supabase` credentials (see §8)
- Activate the workflow (toggle in the top-right)

### 8. Create the 3 credentials

In n8n UI → Settings → Credentials → Create:

| Name | Type | Fields |
|---|---|---|
| `datiq-resend` | HTTP Header Auth | Header name: `Authorization`, Value: `Bearer re_xxxxxxxx` (your Resend API key) |
| `datiq-slack-monitoring` | Slack | OAuth or webhook URL — use the `https://hooks.slack.com/services/...` for the #monitoring channel |
| `datiq-supabase-service` | HTTP Header Auth | Header name: `apikey`, Value: `eyJ...` (your Supabase **service_role** key) |

For Resend, the workflow actually does a `HTTP Request` node instead of using the Resend cred type — the credential above is referenced for the auth header. Same for Supabase.

### 9. Netlify env

In Netlify → Site → Settings → Environment, add per context:

| Variable | Production | Staging | Deploy preview |
|---|---|---|---|
| `N8N_BASE_URL` | `https://n8n-k8q6.srv1738397.hstgr.cloud` | same | same |
| `N8N_WEBHOOK_SECRET` | value of `DATIQ_N8N_API_KEY` on the n8n side | same | same |
| `WORKFLOW_ORCHESTRATOR_TOKEN` | `openssl rand -hex 32` (separate) | separate | empty (skip) |

### 10. Smoke test

```bash
# From your local machine, verify the orchestrator can reach n8n:
curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
  -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
# → 200 with body like {"ok":true,"scanned":0,"dispatched":0,"failed":0,"requeued":0}
```

Then create a test schedule in the DatIQ UI, change the target page, wait for the next hourly runner, and check:
1. n8n UI → Executions → see the workflow fire
2. Your Slack channel → see the message
3. Your email → see the alert
4. `/admin/automation` (Phase 6) → see the event as `done`

---

## If you don't want to re-provision (use existing instance)

Just follow §7–§10 above. The existing instance is already running; you only need to:
1. Import the workflow JSONs
2. Create the 3 credentials
3. Set the Netlify env vars
4. Smoke test

---

## Common operations

- **Logs:** `docker compose -f /opt/datiq-n8n/docker-compose.yml logs -f n8n`
- **Restart:** `docker compose restart n8n`
- **Shell into the container:** `docker exec -it datiq-n8n sh`
- **Update the image:** see `n8n/ops/UPGRADES.md`
- **Backups:** see `n8n/ops/BACKUPS.md`
- **Secrets rotation:** see `n8n/ops/SECRETS.md`

---

## What can go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `n8n ready on ::, port 5678` never appears | Memory or CPU too low | Check `docker stats datiq-n8n`; raise the limits in `docker-compose.yml` |
| Webhook returns 401 | `DATIQ_N8N_API_KEY` mismatch between n8n and Netlify | Verify both env vars are identical (no trailing whitespace) |
| Workflows import but don't activate | Credentials not bound | Open each workflow, click the red "?" on the credential node, pick the right cred |
| Orchestrator dispatches but n8n 4xx | Webhook URL changed in n8n but not in Netlify `N8N_BASE_URL` | Re-deploy Netlify with the new `N8N_BASE_URL` |
| Daily digest never fires | `DAILY_DIGEST_HOUR_UTC` not set, or the cron trigger is misconfigured | See the daily-digest workflow JSON; the cron is in the Schedule trigger node |
