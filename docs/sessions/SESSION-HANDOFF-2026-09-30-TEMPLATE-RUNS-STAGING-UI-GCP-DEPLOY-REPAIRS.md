# Session Handoff — 2026-09-30 — Template runs, staging UI, GCP deploy repairs

> **Branch:** `docker-desktop-build` @ `66f6ac62` (pushed `caf926d3..66f6ac62`, branch only)
> **Target:** `docker-desktop-build` — no staging/main merges (branch-discipline rule holds)
> **Verification:** unit 9419/9419 · contract 5569/5569 · integration green after flake fix · e2e template matrix 428/428 local + all 4 reported templates green on stg · parameterisation gate green · build clean · GCP staging smoke 13/13

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-30 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | `66f6ac62` |
| **Status** | Complete & verified; GCP staging redeployed and smoke-green |
| **Pre-Push Gates** | 100% green (final push ran the full gate incl. security after axios fix) |
| **Active Focus** | User-reported template-run failures (local + staging), invisible staging inputs, blank staging /admin, `up.sh staging` Cloud Build failures |
| **Staging state** | `stg.datiq.app` serves api/jobs/admin/trackers @ image tag `3ac24f8c` (admin @ `730aa7b0`); hosting dist current; `EXTRACT_BUDGET_MS=45000` / `AI_BUDGET_MS=30000` live on api+jobs |

---

## 2. What Was Accomplished

### Core features — templates (local issues 1 & 2, fixed earlier in session, verified now)
- Template runs now honor the template's own `extraction_schema` and every Customize input (`custom_fields`, `custom_prompt`, `ai_depth`, `extra_subpages`) — see commit `84391eb1`. Server accepts sanitized caller schemas; `talent` related-page bucket for `recruiter_talent_sourcing`; per-field absent reporting replaces the blanket "run is incomplete" banner.

### Bug fixes — this session's root causes
1. **"Run is incomplete" on heavy inputs (local + staging).** `extract.js` sizes its deadline from `EXTRACT_BUDGET_MS` (default **8000**, Netlify-tuned) — raising `AI_BUDGET_MS` alone did nothing. Locally `.env.local` now sets `EXTRACT_BUDGET_MS=45000` + `AI_BUDGET_MS=30000`. On staging the deeper cause: **`deploy-run.sh` env whitelist never passed `AI_BUDGET_MS` to Cloud Run at all** (dead config since it was added) — both vars now propagate (`e38f48a7`), applied live via `update-env.sh` and verified in the service spec.
2. **Staging /admin blank white.** The admin container baked a copy of `dist/` whose HTML referenced root-absolute `/assets/<entry>.js`; on GCP those URLs are answered by Firebase Hosting from the WEB dist — a different build whose entry hash diverged → SPA-fallback HTML for a JS file. Fixed structurally: admin payload is now built with `vite --base=/admin/` (`dist-admin/`), mounted at `html/admin/`, so every admin asset URL resolves through the `/admin/**` rewrite to the admin container itself (`730aa7b0`). Verified: all `/admin/assets/*` return `application/javascript`.
3. **`up.sh staging` Cloud Build failures — three distinct:**
   - `INVALID_ARGUMENT: key in the template "_IMG_"` — Cloud Build templates dollar-signs **even inside comments**; the report-digests comment's `$_IMG_*` glob parsed as an unmatched substitution key (`3ac24f8c`).
   - DB rehearsal died on `SET transaction_timeout` (newer-Postgres GUC, unrecognized by Cloud SQL) — now stripped alongside `session_replication_role`; and `--data-only` dumps now include `auth.*`/`storage.*` sections the public-only rehearsal can't restore — data dump restricted to `--schema public` (`d8fa9cd7`).
   - `grep -c || echo 0` captures `0\n0` on zero matches (exit-1 quirk) → a CLEAN FK re-add reported `0/230 could NOT be re-added`, and the no-match `grep -oE` pipeline killed the script under `pipefail` (`14a8a1e0`).
4. **Staging smoke ping 401.** The orchestrator authorizes `WORKFLOW_ORCHESTRATOR_TOKEN || ADMIN_TOKEN_SECRET`; staging mounts a dedicated orchestrator token that differs from the admin secret, so the smoke's admin bearer 401'd a healthy service. Smoke now sends the orchestrator secret with admin fallback (`c6ca26e9`). Final smoke: **13/13**.
5. **Local gate flake + audit.** `Account.integration.test.jsx` I-39 waitFor flaked twice under gate load → 5s timeout (both trees; main committed). `npm audit` high advisories via razorpay → axios 1.20.0 (`940db409`).

### Staging UI (user reports 1)
- `.input` controls had **no CSS at all** (Tailwind preflight transparency) — real tokens added (`810da5de`), plus `color-scheme` per theme for native widgets. Verified live in-browser: dark-theme controls render `rgb(242,245,250)` text on `rgb(17,23,38)` surfaces with branded borders.

### Tooling
- `scripts/e2e-templates.mjs`: added **deep-subpages** maximal variant (deep + extra subpages + custom fields + custom prompt — the exact user-reported failing stack); remote-base support (healthz→/ fallback); honest-refusal acceptance for brief-family templates on the example.com empty control (`66f6ac62`).
- `publicUrl.js`: one DNS retry before rejecting a host (transient resolver hiccups were failing valid domains).
- `.env.local.example` / `.env.staging.example`: budget vars documented with DO/DON'T (Netlify 10s cap vs Cloud Run 300s).

---

## 3. Verification Evidence

- `npm run test:unit`: **9419/9419** · `npm run test:contract`: **5569/5569** · integration green after flake fix · `test:security` green after axios fix
- `node scripts/e2e-templates.mjs` (local, full matrix incl. deep-subpages): earlier run **428/428**; post-variant spot-runs green
- **Staging (real runs against `https://stg.datiq.app`)**: `account_brief` 44/0 · `agency_client_teardown` 50/0 · `competitor_pricing_tracker` 49/0 · `ai_visibility_brief` 37/0 — all four user-reported templates green, including deep-subpages and custom-field variants
- Staging smoke: **13 passed, 0 failed** (`https://datiq-vsp-fhs-stg.web.app`)
- Browser-verified on staging: `/admin/` renders the Admin Access PIN gate; `/templates` controls branded + visible in dark theme
- Full pipeline `up.sh staging` completed: bootstrap → secrets → images → Cloud Run → Cloud SQL dump/restore rehearsal (230 FK constraints restored) → scheduler (13 jobs) → hosting → smoke

---

## 4. Operator Notes & Open Items for Next Session

- [ ] **Prod carry-over:** the deploy-run.sh env whitelist, admin base=/admin/ build, smoke token fix, and migrate-db fixes ALL apply to `up.sh prod` when the prod shadow runs — do not re-derive them.
- [ ] Staging budgets are set for Cloud Run's 300s timeout; if any surface ever moves back to Netlify hosting, revert `EXTRACT_BUDGET_MS`/`AI_BUDGET_MS` to ≤8000 there (platform kills the function first) — documented in both example env files.
- [ ] `update-env.sh staging` note printed: changed VITE_/runtime values also need `deploy-hosting.sh` (static payload) — keep in mind for future VITE_ overrides.
- [ ] The 4 staged template keys were verified with the harness's own domain matrix (axiomminds.ai / datiq.app / example.com). The user's exact competitor list (browser.ai, clay.com) was not replayed — spot-check in UI if desired.
- [ ] GitHub Dependabot reports 10 vulnerabilities on the DEFAULT branch (main) — pre-existing, separate from this branch (axios fixed here).
- [ ] Pre-existing local vitest quirk: bare `npx vitest run` scoops `.kilo/worktrees` Playwright specs (50 suite-level collection errors, tests unaffected) — canonical gates are the scoped `test:unit`/`test:contract`.
