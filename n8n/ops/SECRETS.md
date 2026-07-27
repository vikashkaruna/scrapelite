# n8n Secrets Management

> **v2 plan:** `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` §4.4, §9.5
> **Audience:** You (Vikash). Documented for reproducibility.

The n8n deployment has three categories of secrets, each with different rotation rules.

> **How per-environment config works (see WORKFLOW-IMPLEMENTATION-PLAN.md §9.5 for the full design):**
> The Supabase URL, the DatIQ site URL, and the git branch are NOT in this file. They are per-event and flow through `$json._ctx.*` — the orchestrator reads them from `process.env` at enqueue time, puts them in the event payload as `_ctx`, and n8n reads them back from `$json._ctx.*` in URL/header expressions. The only host-shaped env vars on the n8n host are the ones n8n itself needs: `N8N_BASE_URL` (its own URL) and `SITE_URL` (DatIQ site, used by the schedule-triggered smoke test only).

---

## 1. The two non-rotation-critical secrets

These are environment variables set once at install time. They don't rotate, but you should keep a copy in your password manager (1Password, Bitwarden, etc.) in case the VPS dies.

### `N8N_ENCRYPTION_KEY`
- **What it is:** 32 random bytes (hex) that encrypt every credential stored in the n8n database.
- **Where it's set:** `n8n/.env` on the VPS only.
- **What happens if you lose it:** **Every credential in n8n becomes unreadable.** You have to re-create each one (Resend, Slack, Supabase) by hand. Workflows themselves are fine — they reference credentials by name, not by encrypted content.
- **Rotation policy:** **Don't rotate.** There's no migration path; rotating means re-creating all credentials.

### `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` (if used)
- **What it is:** HTTP basic auth in front of the n8n UI (only if you picked Choice B in `n8n/.env.example`).
- **Where it's set:** `n8n/.env` on the VPS only.
- **Rotation policy:** Rotate quarterly, or immediately if leaked.

---

## 2. The shared DatIQ ↔ n8n secret

### `DATIQ_N8N_API_KEY` (on n8n) ↔ `N8N_WEBHOOK_SECRET` (on Netlify)
- **What it is:** A 32-byte hex string used as a Bearer token. The Netlify orchestrator sends it on every dispatch to n8n; n8n's webhook trigger validates it.
- **Where it's set:**
  - `n8n/.env` on the VPS as `DATIQ_N8N_API_KEY`
  - Netlify → Site → Settings → Environment as `N8N_WEBHOOK_SECRET` (per context)
  - **Both must be the same value.** A mismatch causes 401s on every dispatch.
- **Rotation policy:** Rotate every 6 months, or immediately if leaked.

#### How to rotate

1. **Generate a new value:** `openssl rand -hex 32`
2. **Update n8n:** edit `n8n/.env`, change `DATIQ_N8N_API_KEY`, restart: `docker compose restart n8n`
3. **Update Netlify:** change `N8N_WEBHOOK_SECRET` in all 3 contexts (production, staging, deploy-preview)
4. **Verify:** trigger a manual orchestrator run from the n8n side:
   ```bash
   curl -X POST https://datiq.app/api/workflow-orchestrator/run-now \
     -H "Authorization: Bearer $WORKFLOW_ORCHESTRATOR_TOKEN"
   ```
   Look for `dispatched: 1` in the response.
5. **Update the backup's `.env`:** the daily backup copies `.env`; once the rotation is confirmed working, the next backup will have the new value. Old backups still have the old value, but they're only useful for restoring the data dir, not for the secret.

---

## 3. The admin token (orchestrator HTTP trigger)

### `WORKFLOW_ORCHESTRATOR_TOKEN` (on Netlify only)
- **What it is:** A separate 32-byte hex string used to authenticate manual HTTP calls to the orchestrator (`/run-now` and `/dispatch`).
- **Where it's set:** Netlify env only. The orchestrator function reads `WORKFLOW_ORCHESTRATOR_TOKEN` first, then falls back to `ADMIN_TOKEN_SECRET`, then `ADMIN_PIN_HASH`.
- **Why it's separate from the n8n secret:** defence in depth. Compromising the n8n secret lets the attacker trigger webhooks; compromising the orchestrator token lets the attacker trigger the orchestrator. Keeping them separate limits blast radius.
- **Rotation policy:** Rotate every 6 months, or immediately if leaked.

#### How to rotate

1. Generate a new value: `openssl rand -hex 32`
2. Update Netlify: `WORKFLOW_ORCHESTRATOR_TOKEN` in all contexts
3. Update your password manager with the new value
4. **No other side has it** — the n8n instance never sees this token

---

## 4. Credentials stored inside n8n (per workflow)

These are set via the n8n UI → Settings → Credentials. They're encrypted at rest with `N8N_ENCRYPTION_KEY`. n8n displays a friendly name (e.g., `datiq-resend`) and you reference that name in workflow nodes.

| Credential name | What it stores | Where to rotate |
|---|---|---|
| `datiq-resend` | Resend API key | Resend dashboard → API Keys → Revoke + create new → update in n8n UI |
| `datiq-slack-monitoring` | Slack incoming webhook URL | Slack → Apps → Incoming Webhooks → Regenerate → update in n8n UI |
| `datiq-supabase-service` | Supabase service-role key | Supabase → Settings → API → Roll service key → update in n8n UI |

**Important:** when you rotate any of these in the upstream service, the **old** key still works until you remove it. The n8n UI lets you edit the credential in place without re-binding the workflow (because workflows reference by name).

### How to rotate a credential in n8n

1. n8n UI → Settings → Credentials → click the credential
2. Edit the field(s) with the new value
3. Save
4. No workflow changes needed — they pick up the new value on next execution

### What happens if a credential is revoked upstream but not updated in n8n

- The next execution of any workflow using it returns 401/403 from the upstream
- The workflow's error branch fires → updates the `workflow_events` row to `failed`
- n8n retries with backoff (1m, 5m, 30m, ...)
- After `max_attempts` (default 5), the event is marked `failed` permanently
- You see it in `/admin/automation` → "Failed events (24h)" → click → "View attempts" → see the 401

**To recover:** rotate the credential in n8n, then click "Retry" on the failed event in `/admin/automation` (or call the MCP tool `datiq_retry_workflow_event`).

---

## 5. Where the secrets live (cheat sheet)

| Secret | VPS `/opt/datiq-n8n/.env` | Netlify env | n8n UI | 1Password |
|---|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | ✅ | ❌ | ❌ | ✅ (do not lose) |
| `DATIQ_N8N_API_KEY` / `N8N_WEBHOOK_SECRET` | ✅ (`DATIQ_N8N_API_KEY`) | ✅ (`N8N_WEBHOOK_SECRET`) | ❌ | ✅ |
| `WORKFLOW_ORCHESTRATOR_TOKEN` | ❌ | ✅ | ❌ | ✅ |
| Resend API key | ❌ | ✅ (for `welcome-email`, `contact-email`, `reengagement`) | ✅ (`datiq-resend`) | ✅ |
| Slack webhook URL | ❌ | ✅ (for `slackFormatter.js`) | ✅ (`datiq-slack-monitoring`) | ✅ |
| Supabase service key | ❌ | ✅ | ✅ (`datiq-supabase-service`) | ✅ |

---

## What you should NOT do

- **Don't commit any of these to git.** `.env` and `.env.example` are different; only `.env.example` is committed.
- **Don't share `N8N_ENCRYPTION_KEY` between n8n instances.** It locks the data to that instance. If you ever set up a second n8n, generate a fresh key.
- **Don't reuse `DATIQ_N8N_API_KEY` for any other purpose.** It's a Bearer token; the narrower the use, the safer.
- **Don't log secrets.** The orchestrator's `workflow_runs.request.body` field stores a truncated copy of every dispatch payload. Make sure no payload contains a secret. The n8n workflows should never log the Authorization header.
