# n8n / MCP workflow pipeline — deployment status

> **Last verified: 2026-09-06.** Supersedes the 2026-08-29 version, which listed
> four things that "could not be confirmed from the repo". All four are now
> confirmed. It also supersedes `WORKFLOW-BRANCH-READINESS-2026-08-02.md`, which
> was deleted this session: its C1–C5 / E1–E3 / N1–N4 / K1–K4 checklists were
> either closed or, in two cases, actively wrong (C3 pointed at `scripts/env/`,
> a directory that does not exist; C1's advice would have broken the n8n
> integration — see "The cron/HTTP split" below).
>
> Architecture: `WORKFLOW-IMPLEMENTATION-PLAN.md`. Operator stand-up:
> `V2-IMPLEMENTATION-GUIDE.md`. Post-deploy manual pass:
> `POST-DEPLOYMENT-MANUAL-TEST.md`.

## Status at a glance

| Area | State |
|---|---|
| Code (queue, orchestrator, HMAC, admin UI, 18 workflow JSONs) | ✅ shipped, on `staging` and `main` |
| Migration `0022_workflow_events.sql` | ✅ applied |
| Netlify env `N8N_BASE_URL` / `N8N_WEBHOOK_SECRET` / `WORKFLOW_ORCHESTRATOR_TOKEN` | ✅ set (N1–N3) |
| n8n instance reachable | ✅ (K1) |
| 18 workflows imported | ✅ (K2) |
| Credentials + instance env | ✅ (K3) |
| Workflows activated | ✅ (K4) |
| **The dispatch cron** | ✅ **scheduled 2026-09-06 — it had never once fired before that** |
| End-to-end verified against real traffic | ⏸ **outstanding — `POST-DEPLOYMENT-MANUAL-TEST.md` T1–T6** |

## The cron/HTTP split — read this before touching netlify.toml

Until 2026-09-06 the pipeline's dispatch loop had **never run on a cron**.
`workflow-orchestrator.js` declared `export const config = { schedule }` in its
own source, which Netlify honours only for v2 `export default` handlers; every
function here is v1. It was in neither `netlify.toml` nor `AUTOMATION_JOBS`, so
nothing fired and nothing reported it missing.

The fix is **not** to add `[functions."workflow-orchestrator"]`. Declaring a
schedule makes Netlify refuse public HTTP access to that function, and this one
has three live HTTP callers:

* `n8n/workflows/00-datiq-smoke-test.json` → `/api/workflow-orchestrator/ping`
* `n8n/workflows/datiq_process_pending_workflow.json` → `/api/workflow-orchestrator/dispatch`
* the operator smoke test → `/api/workflow-orchestrator/run-now`

Scheduling it would start the cron and simultaneously 404 all three. So the cron
lives in **`workflow-orchestrator-cron.js`** and the HTTP surface stays in
`workflow-orchestrator.js`; both call the same `runOnce()`, so there is no second
copy of the poll to drift from the one n8n exercises.
`netlify/__tests__/audit/orchestrator-route-parity.test.js` fails the build if
anyone re-merges them.

## Credentials — one, not four

Earlier docs claimed four n8n credentials (`datiq-resend`,
`datiq-slack-monitoring`, `datiq-supabase-service`, `datiq-orchestrator`) and
elsewhere three. Parsing all 18 workflow JSONs, exactly **one** is bound:

* **`datiq-slack-monitoring`** — type `slackOAuth2Api`, used by 3 workflows.
  The name must match exactly; the workflows bind by name.

The others were never credentials. Resend is a plain HTTP request to
`api.resend.com` authenticated from `$env.RESEND_API_KEY`; there is no
`supabase.co` host in any workflow (they call back to DatIQ's own API instead);
and `datiq-orchestrator` appears nowhere.

What K3 actually requires is **13 env vars on the n8n host**:

| Var | Refs | Note |
|---|---:|---|
| `SITE_URL` | 6 | |
| `DATIQ_N8N_API_KEY` | 4 | 🔴 must equal `N8N_WEBHOOK_SECRET` in Netlify — a mismatch is a 401 on every dispatch |
| `N8N_WEBHOOK_SECRET` | 4 | |
| `N8N_BASE_URL` | 2 | |
| `ALERT_EMAIL_FROM` | 2 | |
| `RESEND_API_KEY`, `CONTACT_EMAIL_FROM`, `WEBHOOK_URL`, `VITE_CONTACT_WEBHOOK_URL`, `VITE_WEBHOOK_URL`, `ERROR_ALERT_EMAIL`, `OPS_ALERT_EMAIL`, `NODE_ENV` | 1 each | |

⚠️ `VITE_CONTACT_WEBHOOK_URL` and `VITE_WEBHOOK_URL` in that list are read by
n8n's own `$env`, **not** by Netlify. Setting them in Netlify does nothing for
the `datiq_contact_router` workflow's "Forward to CRM" node.

## Two different n8n instances — do not conflate them

| Instance | Host | Used by |
|---|---|---|
| **Self-hosted (GCP Cloud Run)** | `n8n-dev-692109205619.asia-south1.run.app` | the v2 pipeline: `N8N_BASE_URL`, the 18 workflows, MCP tools |
| **n8n Cloud** | `vkaruna.app.n8n.cloud` | the legacy browser-side webhook, hardcoded in `public/runtime-config.js` |

The second is easy to miss: `VITE_WEBHOOK_URL` is **not set in any Netlify
context**, yet the webhook is live, because `runtime-config.js` hardcodes the
n8n Cloud URL and `config.js`'s `endpoint()` prefers the runtime override over
the env var. Checking `netlify env:list` alone would tell you the webhook is
off. It is not.

## How to check where it actually stands

```bash
# 1. Is the self-hosted instance reachable?
curl -sf https://n8n-dev-692109205619.asia-south1.run.app/healthz

# 2. Does the HTTP surface still answer? (must NOT 404 — see the split above)
curl -sS -X POST https://datiq.app/api/workflow-orchestrator/ping

# 3. Has the cron actually run? /admin/monitoring -> "Workflow dispatch loop"
#    A row reading "never run" more than ~10 min after a deploy means the
#    schedule did not take. Cross-check: netlify functions:list

# 4. Has anything ever been queued?
#    SELECT state, count(*), max(created_at) FROM workflow_events GROUP BY state;
```
