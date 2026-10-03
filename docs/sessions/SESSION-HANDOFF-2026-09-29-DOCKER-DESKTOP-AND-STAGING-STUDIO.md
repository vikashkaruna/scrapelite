# Session Handoff — 2026-09-29 — Docker Desktop Fixes & Staging Supabase Studio Deploy

> **Branch:** `docker-desktop-build`  
> **Target:** `docker-desktop-build`  
> **Status:** Complete & verified — Studio live on Cloud Run staging, local Option C confirmed, all test gates green  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `docker-desktop-build` |
| **Status** | Complete & verified |
| **Pre-Push Gates** | Parameterisation gate green, Vitest unit suite (9,380 tests / 539 files passed), browser env allowlist (33 passed), Gemini model tests (18 passed), production build clean (1.51s) |
| **Active Focus** | Local Docker Desktop auth/AI fixes, retired Gemini model cleanup, private Supabase Studio Cloud Run staging deployment with Cloud SQL connectivity and proxy tooling, Carry project container identification, and Section 8 domain mapping documentation. |

---

## 2. What Was Accomplished

### 1. Local Docker Desktop Stack & Option C Confirmation
- **Dedicated Stack (Option C)**: Confirmed DatIQ's dedicated local-db stack on ports `54329` (Postgres) and `54328` (Studio) remains isolated with zero risk of schema or credential collisions.
- **Identified Host Container `qclaxjtwbbkigfuyrhpv`**:
  - Found to belong to `/Users/vikash/Carry` (`/Users/vikash/Carry/supabase/config.toml`: `project_id = "qclaxjtwbbkigfuyrhpv"`).
  - Runs on ports `54322` (DB) and `54321` (API). No conflict with DatIQ.
- **GoTrue Auto-Confirm**:
  - Parameterised `GOTRUE_MAILER_AUTOCONFIRM` across `.env.local.example`, `.env.staging.example`, `.env.prod.example`, `.env.example`, compose files, and deploy scripts.
- **Anthropic API Key Standardisation**:
  - Parameterised `ANTHROPIC_API_KEY` across `.env.staging.example`, `.env.prod.example`, secrets manifest, and `netlify/functions/lib/aiProviders.js` (with backward-compatible fallback to `AI_API_KEY`).
- **Retired Gemini Model Cleanup**:
  - Replaced retired Gemini 2.x models with `gemini-2.5-flash` in `providerRegistry.js` and configurations.
  - Added unit test suite `netlify/__tests__/aiGeminiStructuredOutput.test.js` and live verification script `scripts/verify-ai-models.mjs`.

### 2. Supabase Studio on Cloud Run (Staging & Prod Parity)
- **Artifact Registry Mirroring**:
  - Created `deployment/gcp/cloudbuild/third-party/studio.Dockerfile` and `pg-meta.Dockerfile`.
  - Built and pushed `datiq-vsp-ctr-studio:staged` and `datiq-vsp-ctr-pg-meta:staged`.
- **Cloud Run Deployment (`datiq-vsp-run-studio-stg`)**:
  - Multi-container architecture: `studio` (frontend, port 3000) with `pg-meta` (backend, port 8080) sidecar.
  - Connected directly to Cloud SQL `datiq-vsp-sql-datiq-stg` via Unix socket `/cloudsql/vikash-saas-project:asia-south1:datiq-vsp-sql-datiq-stg`.
  - Configured with `tcpSocket.port=8080` startup probe on `pg-meta` satisfying Cloud Run multi-container container dependency requirements.
  - Strictly private: deployed with `--no-allow-unauthenticated` (IAM-authenticated only).
- **Local Access via Cloud Run Proxy**:
  - Created `deployment/scripts/gcp/proxy-studio.sh` (`./deployment/scripts/gcp/proxy-studio.sh staging [--port 54328]`) wrapping `gcloud run services proxy`.
- **Production Parity**:
  - Parameterised Studio and pg-meta configurations across `.env.staging.example`, `.env.prod.example`, and `deploy-run.sh`.

### 3. Docker Web Build Vite Fix (`scripts/build-docker-web.mjs` & `deployment/scripts/up.sh`)
- **Root Cause**: `build-docker-web.mjs` was calling `npx vite build --config <generated-config>`. `npx vite` downloads a standalone `vite` binary into an isolated temp cache that lacks visibility into the project's `node_modules` dependencies (e.g. `@vitejs/plugin-react`, `vitest/config`), producing `[UNRESOLVED_IMPORT]` warnings and `Cannot find package 'vite' imported from .../vite.docker.config.mjs` failures.
- **Fix**:
  - Replaced `npx vite` invocation with the project-local `node_modules/.bin/vite` binary so all dependencies resolve within the project dependency tree.
  - Added pre-flight check in `build-docker-web.mjs` ensuring the local Vite binary exists with clear error guidance.
  - Stripped unused `test` block from the generated wrapper config in `build-docker-web.mjs`.
  - Added automatic `npm install` check in `deployment/scripts/up.sh` to self-heal fresh clones or worktrees missing `node_modules`.
- **Cross-Environment Safety**: Standardised across local, staging, and CI Docker builds.

### 4. Documentation Updates
- Updated `docs/plans/gcp-docker-migration/README.md`:
  - Added Section 8: "Domain Mapping: Staging vs Production Details" detailing URLs, Firebase Hosting sites, Cloud SQL instances, custom domains, and DNS records.
  - Updated Table of Contents.
- Updated `docs/plans/gcp-docker-migration/08-STAGING-DEPLOY-RUNBOOK.md` with Studio service, image, and secret specifications.

---

## 3. Verification Evidence

- `bash deployment/scripts/check-parameterisation.sh`: **PASS** (0 forbidden literals).
- `npx vitest run scripts/browser-env-allowlist.test.mjs`: **33/33 passed**.
- `npx vitest run netlify/__tests__/aiGeminiStructuredOutput.test.js`: **18/18 passed**.
- `npm run test:unit`: **539 test files passed, 9,380 tests passed**.
- `npm run build`: **PASS** (1.51s, 35 prerendered pages synced).

---

## 4. Operator Instructions

### Accessing Supabase Studio on Staging:
```bash
# Run authenticated proxy on local port (default 54328)
./deployment/scripts/gcp/proxy-studio.sh staging

# Open in browser:
http://localhost:54328
```
