# workflow-implementation-and-optimization — branch readiness review

> Date: 2026-08-02
> Reviewer: Mavis (orchestrator)
> Branch base: `main`@`cd9995d` (PR #42)
> Branch head: `0e295a4` (post-merge: `5ee53b9`)
> Status: Code + tests + docs are ready. Configuration + e2e are NOT.

---

## 0. What was done in this session

| # | Action | Result |
|---|---|---|
| 1 | `git merge origin/main` into `Integration-with-outside-ecosystem` | ✅ Merged as `2af296e`. 1 conflict in `supabase/migrations/run-all.sql` (header + body) — kept both 0018 (none) and 0019/0020/0021 sections. 117 files changed, +11130/-468. |
| 2 | `git merge origin/main` into `workflow-implementation-and-optimization` | ✅ Merged as `5ee53b9`. 6 conflicts resolved (see conflict notes below). 128 files changed, +11803/-449. |
| 3 | Test run on workflow branch | ✅ `npm run test:unit` 1639/1639 · `npm run test:contract` 968/968 (14 skipped, conditional) · `npm run test:integration` 280/280 · `npm run build` clean. |
| 4 | Production-readiness audit | ⚠️ 4 pass · 3 warn · 0 fail. No blockers. |

### Conflicts resolved during the workflow merge

| File | Resolution |
|---|---|
| `netlify/functions/scheduled-runner.js` | Kept BOTH `workflowEnqueue` (this branch) and `slackFormatter` / `monitoringModel` / `jobControl` (main) imports. |
| `src/App.jsx` | Kept all 4 admin routes: `automation` (this branch) + `monitoring` + `health` (main) + `general` (both). |
| `src/components/Icon.jsx` | Merged icon imports, deduped `Activity`, added workflow icons (`RotateCcw`, `Timer`, `RefreshCw`, `MousePointerClick`) + ops icons (`Server`, `Gauge`). |
| `src/pages/admin/AdminLayout.jsx` | Kept this branch's `/admin/automation` nav item (renamed label to `Workflows` to avoid the duplicate `Automation` label main uses for `/admin/monitoring`) + main's `/admin/monitoring` + `/admin/health` + `/admin/general`. |
| `src/styles/screens.css` | Appended both branches' CSS blocks: 7.6KB of `automation-*` rules (this branch) + 15.6KB of `ops-*` rules (main). No shared selectors. |
| `supabase/migrations/run-all.sql` | Kept BOTH 0018 sections in the file. The `0018_workflow_events` and `0018_ops_monitoring` migrations do NOT reference each other's tables (verified), so the order is documentation-only. Header comment updated to list both with a note. |

### Conflicts resolved during the integration merge

| File | Resolution |
|---|---|
| `supabase/migrations/run-all.sql` | Used main as the base (0018_ops_monitoring) and appended 0019_api_keys / 0020_integration_connections / 0021_zapier_events from the integration branch. Header comment updated to list all four. |

---

## 1. What's READY on workflow-implementation-and-optimization

### 1.1 Code — all 7 phases shipped + the latest commit layered on

| Phase | Files | Status |
|---|---|---|
| Phase 1 — Schema + orchestrator | `supabase/migrations/0018_workflow_events.sql`, `netlify/functions/lib/workflowEnqueue.js`, `netlify/functions/lib/workflowOrchestrator.js`, `netlify/functions/lib/n8nSignature.js`, `netlify/functions/workflow-orchestrator.js` | ✅ Present |
| Phase 2 — scheduled-runner rewire | `netlify/functions/scheduled-runner.js` (modified to enqueue instead of direct Resend/Slack) | ✅ Present |
| Phase 3 — Self-hosted n8n | `n8n/{docker-compose.yml,.env.example,Caddyfile,backup.sh,restore.sh}` | ✅ Present |
| Phase 4 — 17 workflow JSONs | `n8n/workflows/*.json` (16 generated + 1 hand-written smoke test) | ✅ Present, `node scripts/generate-n8n-workflows.mjs` is idempotent |
| Phase 5 — MCP server | 11 MCP tool workflows in `n8n/workflows/datiq_*.json` | ✅ Present |
| Phase 6 — Admin observability | `src/pages/admin/AdminAutomation.jsx`, `netlify/functions/admin-automation.js` | ✅ Present + merged with main's `AdminMonitoring`/`AdminHealth` |
| Phase 7 — Docs | `docs/{N8N-WORKFLOWS,N8N-OPERATIONS,MCP-TOOLS}.md`, `docs/V2-IMPLEMENTATION-GUIDE.md`, `docs/WORKFLOW-IMPLEMENTATION-PLAN.md`, `docs/SESSION-HANDOFF-2026-07-27-V2-WORKFLOWS.md` | ✅ Present |
| Layered commit — per-user webhook UI | `src/lib/userWebhook.js`, `src/components/WebhookSetupModal.jsx` | ✅ Present (commit `0e295a4`) |
| Layered commit — _ctx refactor | `netlify/functions/lib/workflowOrchestrator.js` + 17 n8n workflow JSONs (no more `{{SUPABASE_URL}}` placeholders) | ✅ Present (commit `0f7bb2b`) |

### 1.2 Tests — all green

| Suite | Count | Status |
|---|---|---|
| Unit | 1639 passed | ✅ |
| Contract (netlify) | 968 passed, 14 skipped | ✅ (the 14 skipped are conditional tests for the n8n JSON shape; the existing 173 JSON-shape tests pass) |
| Integration | 280 passed | ✅ |
| Build | `vite build` | ✅ clean (1 warning: chunk > 500 KB, pre-existing) |
| Production-readiness audit | 4 pass · 3 warn · 0 fail | ✅ no blockers |

The 3 audit warnings are pre-existing on main and not workflow-related:
- Screenshot integrity (UI source newer than screenshots — regenerate via `node docs/capture-screenshots.mjs`)
- Pricing coherence (`Go` tier not mentioned on `/help/billing` — confirm surface)
- Gallery / persona coverage (runtime-populated, can't verify from source)

### 1.3 Docs — complete

- `docs/V2-IMPLEMENTATION-GUIDE.md` — 715 lines, covers sections 1-13 (pre-reqs, migration, env vars, n8n setup, credentials, workflow import, manual testing, deploy, ops, troubleshooting, file pointers, acceptance checklist)
- `docs/WORKFLOW-IMPLEMENTATION-PLAN.md` — 51 KB architecture doc
- `docs/N8N-WORKFLOWS.md` — workflow inventory + import/edit guide
- `docs/N8N-OPERATIONS.md` — runbook
- `docs/MCP-TOOLS.md` — 11-tool reference with Claude Desktop / Claude Code / mavis setup
- `docs/SESSION-HANDOFF-2026-07-27-V2-WORKFLOWS.md` — session close
- `n8n/ops/{DEPLOY,BACKUPS,UPGRADES,SECRETS}.md` — operator runbook

---

## 2. What's NOT ready (gaps that block end-to-end testing)

### 2.1 Configuration gaps — 5 items

| # | Gap | Where to fix | Effort |
|---|---|---|---|
| C1 | **`workflow-orchestrator` not registered as a scheduled function in `netlify.toml`.** Per the load-bearing comment block (lines 12-34) of `netlify.toml`, every cron needs `[functions."NAME"] schedule = "..."` declared here — otherwise it never fires. Right now the function has `export const config = { schedule: "*/5 * * * *" }` in the source, but that export is IGNORED (see the comment: it is only honoured for v2 `export default` handlers, ours are v1 `export const handler`). | Add to `netlify.toml`: ```[functions."workflow-orchestrator"]\n  schedule = "*/5 * * * *"\n``` | 5 min |
| C2 | **`.env.example` does not document the new env vars** (`N8N_BASE_URL`, `N8N_WEBHOOK_SECRET`, `WORKFLOW_ORCHESTRATOR_TOKEN`). The code reads them (see `netlify/functions/workflow-orchestrator.js:28-31`) but the file is the canonical reference for new operators. | Append to `.env.example` after the webhook section | 5 min |
| C3 | **`scripts/env/production.env` and `scripts/env/staging.env` have no N8N/MCP env entries.** Real secret values live in Netlify, but the local scripts/env files are the "what env vars exist per context" reference. | Add placeholder rows in both files; fill the production value via Netlify's CLI when ready | 5 min |
| C4 | **`scripts/netlify-toml.test.mjs` has no guard test for `[functions."workflow-orchestrator"] schedule = "*/5 * * * *"`.** The pattern in the comment says "if you remove a block here, that function silently stops being a cron. There is no build error and no runtime error — it just never fires again." A guard test would catch removal in PR review. | Append a test that asserts the schedule block exists | 5 min |
| C5 | **n8n instance env (`n8n/.env`) is not committed (gitignored — correct), but the documented `N8N_BASE_URL`/`SITE_URL` in `n8n/.env.example` are placeholders.** The reference n8n at `https://n8n-dev-692109205619.asia-south1.run.app` already exists per the docs, but the env file on the host needs real values for `N8N_ENCRYPTION_KEY` (generated), `DATIQ_N8N_API_KEY` (generated, must match `N8N_WEBHOOK_SECRET` in Netlify). | Operator action on the Hostinger VPS — generate secrets, fill `n8n/.env` | 15 min |

### 2.2 E2E test gaps — 3 items

| # | Gap | Where to fix | Effort |
|---|---|---|---|
| E1 | **No e2e smoke test for `/admin/automation` page.** The page is wired in `App.jsx` (route `automation` under admin), in `AdminLayout.jsx` (nav item), and unit-tested by `AdminAutomation.integration.test.jsx` (11 tests pass). But there's no Playwright spec in `e2e/smoke/` that visits the page in a real browser. The existing `e2e/smoke/admin-monitoring.spec.js` covers `/admin/monitoring` and `/admin/health` — it does NOT cover `/admin/automation`. | Add `e2e/smoke/admin-automation.spec.js` that visits the page, asserts KPI cards + table render, clicks an event row, and clicks "Run now" | 30 min |
| E2 | **No e2e for the workflow-orchestrator HTTP endpoints** (`/api/workflow-orchestrator/run-now`, `/api/workflow-orchestrator/dispatch`). The contract tests cover the function logic, but there's no end-to-end that verifies the route is wired through Netlify's functions router. | Add a Playwright spec that hits the function with a Bearer token, asserts 200, and verifies a `workflow_events` row is enqueued. Needs `WORKFLOW_ORCHESTRATOR_TOKEN` in the staging env. | 30 min |
| E3 | **No e2e for the MCP tools reachable from an MCP client.** The `docs/V2-IMPLEMENTATION-GUIDE.md` §7.2 walks through Claude Desktop / Claude Code / mavis setup, but there's no automated test that confirms the 11 tools are listed and call successfully. | Add `e2e/smoke/mcp-tools.spec.js` — a minimal spec that uses `npx @modelcontextprotocol/inspector` to list tools and call `datiq_list_pending_workflows`. | 1-2 hours (the inspector binary adds setup overhead) |

### 2.3 Netlify-side env setup (operator action, not code) — 4 items

These are not code changes; they're the operator dance to make the function runnable on the live deploy. The implementation guide §3 covers them in full, listing them here for the readiness checklist.

| # | Item | Where |
|---|---|---|
| N1 | Set `N8N_BASE_URL=https://n8n-dev-692109205619.asia-south1.run.app` in **production** and **staging** Netlify contexts. Deploy-preview can stay empty. | Netlify dashboard → Site → Settings → Environment |
| N2 | Set `N8N_WEBHOOK_SECRET` in **production** and **staging** to the SAME value as `DATIQ_N8N_API_KEY` in `n8n/.env`. Mismatch = 401 on every dispatch. | Netlify dashboard |
| N3 | Set `WORKFLOW_ORCHESTRATOR_TOKEN` (separate, `openssl rand -hex 32`) in **production** and **staging**. Empty in deploy-preview. | Netlify dashboard |
| N4 | Verify the 4 scheduled functions are registered: `netlify functions:list` should show `workflow-orchestrator` with a schedule AFTER C1 is fixed. Today (pre-C1) only 5 cron functions are registered. | `netlify functions:list` or Netlify dashboard |

### 2.4 n8n-side setup (operator action) — 4 items

| # | Item | Where |
|---|---|---|
| K1 | Confirm n8n at `https://n8n-dev-692109205619.asia-south1.run.app` is running, healthy, and reachable. | `curl -I https://n8n-dev-692109205619.asia-south1.run.app/` |
| K2 | Import the 17 workflow JSONs (if not already imported). | `npx n8n import:workflow --input=n8n/workflows/ --separate` |
| K3 | Create the 4 n8n credentials: `datiq-resend`, `datiq-slack-monitoring`, `datiq-supabase-service`, `datiq-orchestrator`. Bind to the relevant nodes in each workflow. | n8n UI → Settings → Credentials |
| K4 | Activate the 17 workflows. The smoke test (`00_datiq_smoke_test`) should be the first one activated — it pings the orchestrator every 5 min and confirms the whole path. | n8n UI → Workflows → Active toggle |

### 2.5 Testing not done — 6 items

| # | Test | Doc reference | Time |
|---|---|---|---|
| T1 | **Run the smoke test workflow** — wait 5 min, check `n8n UI → Executions tab`, confirm green. | `docs/V2-IMPLEMENTATION-GUIDE.md` §6.6 | 5 min |
| T2 | **End-to-end happy path** — sign in, create a schedule, wait for runner → orchestrator → n8n → Slack + email, verify event row goes to `done` in `workflow_events`. | `docs/V2-IMPLEMENTATION-GUIDE.md` §7.1 | 30 min |
| T3 | **MCP path** — from Claude Desktop (or Code, or mavis), ask "list the 5 most recent DatIQ workflow events." Verify the response. | `docs/V2-IMPLEMENTATION-GUIDE.md` §7.2 | 15 min |
| T4 | **Admin path** — visit `/admin/automation`, verify KPIs render, click "Run now", click a row → detail panel → "Retry" or "Cancel". | `docs/V2-IMPLEMENTATION-GUIDE.md` §7.3 | 10 min |
| T5 | **Retry path** — break Resend key on purpose, create a schedule, watch 5 failed attempts, fix the key, click "Retry", confirm Slack + email arrive. | `docs/V2-IMPLEMENTATION-GUIDE.md` §7.4 | 20 min |
| T6 | **Cancel path** — in `/admin/automation`, find a `pending` event, click "Cancel" → confirm, verify `state=cancelled`. | `docs/V2-IMPLEMENTATION-GUIDE.md` §7.5 | 5 min |

---

## 3. Step-by-step plan to get the branch ready for merge

The full end-to-end path. Each step unblocks the next.

### Phase A — code/config fixes (you can do this in 30 min)

1. **C1 — register the cron in `netlify.toml`.** Add after the existing `[functions."health-monitor"]` block:
   ```toml
   [functions."workflow-orchestrator"]
     schedule = "*/5 * * * *"
   ```
2. **C4 — add a guard test in `scripts/netlify-toml.test.mjs`.** Append a `describe("netlify.toml — scheduled functions", ...)` block that reads the file and asserts the schedule block exists. Pattern after the existing SECRETS_SCAN_OMIT_KEYS test.
3. **C2 — document the new env vars in `.env.example`.** Append after the webhook section:
   ```bash
   # ── n8n workflow orchestrator (v2 plan) ─────────────────────────────────
   # N8N_BASE_URL              - public URL of the self-hosted n8n instance
   # N8N_WEBHOOK_SECRET        - shared secret = DATIQ_N8N_API_KEY on n8n side
   # WORKFLOW_ORCHESTRATOR_TOKEN - separate admin token for the /api/workflow-orchestrator HTTP trigger
   N8N_BASE_URL=
   N8N_WEBHOOK_SECRET=
   WORKFLOW_ORCHESTRATOR_TOKEN=
   ```
4. **C3 — add placeholder rows in `scripts/env/production.env` and `scripts/env/staging.env`** with comments explaining the values are set in Netlify, not locally.
5. Run `npm run test:contract` to confirm the netlify-toml guard test passes.
6. Commit: `chore(workflows): register cron + env + guard test (config gap)`.

### Phase B — e2e test additions (1-2 hours)

7. **E1 — add `e2e/smoke/admin-automation.spec.js`.** Pattern after `e2e/smoke/admin-monitoring.spec.js`. Assert the page loads, KPI cards render, the events table is visible, clicking an event row opens the detail panel.
8. **E2 — add an e2e for the workflow-orchestrator HTTP endpoint.** Add a Bearer-token request to `/api/workflow-orchestrator/run-now`, assert 200, assert the response has the `scanned/dispatched/failed/requeued` shape.
9. **E3 — defer (mark as v1.1 follow-up).** The MCP inspector setup is non-trivial; track in the v1.1 backlog alongside the per-user MCP keys work.
10. Run `npm run test:e2e:smoke` locally. Confirm both new specs pass against a local `npm run dev`.
11. Commit: `test(e2e): admin/automation + workflow-orchestrator smoke`.

### Phase C — operator setup (Netlify + n8n, ~45 min)

12. **N1-N3** — set the 3 Netlify env vars in production and staging (not deploy-preview).
13. **N4** — confirm `workflow-orchestrator` now shows up in `netlify functions:list` with a schedule.
14. **K1** — confirm n8n is reachable.
15. **K2** — import the 17 workflow JSONs.
16. **K3** — create the 4 credentials in n8n, bind them.
17. **K4** — activate the 17 workflows, smoke test first.

### Phase D — manual end-to-end testing (1.5 hours)

18. **T1** — confirm the smoke test fires after K4.
19. **T2** — happy path. This is the load-bearing one.
20. **T3** — MCP path.
21. **T4** — admin path.
22. **T5** — retry path. (Optional but recommended.)
23. **T6** — cancel path.

### Phase E — merge + deploy

24. Push the branch: `git push origin workflow-implementation-and-optimization`.
25. Open the PR to `main` (or merge directly if that's the team pattern).
26. Run `npm run readiness` to confirm no new audit warnings.
27. Phase-gate CI runs the production gates.
28. Per the 2026-07-26 handoff, production is locked by default. Need to "Unlock" in Netlify UI and `approved` on the GitHub approval issue.

---

## 4. Acceptance criteria — when is the branch DONE?

Per `docs/V2-IMPLEMENTATION-GUIDE.md` §13 (the existing acceptance checklist in the guide), V2 is "done for production" when ALL of the following are true:

- [ ] C1-C5: configuration gaps closed
- [ ] E1-E2: e2e smoke tests added
- [ ] N1-N4: Netlify env + schedule registration done
- [ ] K1-K4: n8n setup done
- [ ] T1-T6: manual end-to-end tests pass
- [ ] All 1619 (now 2887 after this branch) tests pass
- [ ] `node scripts/smoke-prod.mjs https://datiq.app` → 10/10 green
- [ ] Production locked after deploy (Netlify UI)
- [ ] Daily backup cron installed on n8n host
- [ ] Off-host backup configured (Tigris / S3)
- [ ] PR merged to main
- [ ] CLAUDE.md updated to reflect v2 ship (already done in commit `eebafcf`)
- [ ] Session handoff doc committed (already done as `SESSION-HANDOFF-2026-07-27-V2-WORKFLOWS.md`)

---

## 5. What the user (Vikash) needs to do

Short version: **5 code/config changes (~30 min) + 2 e2e tests (~1 hour) + Netlify + n8n operator setup (~45 min) + manual end-to-end tests (~1.5 hours) = ~4 hours total** to get this branch from "merged with main" to "ready for production deploy."

The code is ready. The config + ops setup is not.

---

*Last updated: 2026-08-02 by Mavis after the main-merge review.*
