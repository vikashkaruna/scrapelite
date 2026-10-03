---
name: datiq-deployment-standards
description: Enforce DatIQ's deployment conventions when writing or reviewing deployment scripts, Docker builds, env files and docs (env-file contract, resource naming, parameterisation gate, documentation rules).
---

# DatIQ Deployment Standards

Use this skill when writing, editing or reviewing anything under
`deployment/` (scripts, Dockerfiles, compose files, Cloud Build YAML, GCP
deploy scripts), `.github/workflows/gcp-*.yml`, or the migration plan docs in
`docs/plans/gcp-docker-migration/`.

Authoritative docs (read first when unsure):
- `docs/plans/gcp-docker-migration/06-NAMING-AND-ENV-CONVENTIONS.md` — the env-file contract + resource naming
- `docs/plans/gcp-docker-migration/05-IMPLEMENTATION-PLAN.md` — plan of record + deviations (includes the NOT-IMPLEMENTED Terraform note)
- `docs/plans/gcp-docker-migration/08-STAGING-DEPLOY-RUNBOOK.md` — as-built staging + operator checklist
- `deployment/README.md` — how the local stack and deploys work

## Golden rules (never violate)

1. **Values live ONLY in `deployment/env/.env.<env>` files.** Changing a
   deployment never touches a script, compose file, Dockerfile or workflow —
   operators edit the env file and re-run. `.env.<env>.example` files are the
   ONLY committed files allowed to carry real literals (project ids, regions,
   resource names, URLs).
2. **Every env var is documented** in the `.example` files as:
   `[purpose] · [how to obtain] · DO / DON'T` — each on its own comment line(s)
   **above** the `KEY=value` line. Inline `# trailing comments` on value lines
   are FORBIDDEN: the deploy tooling parses env files and strips only
   whole-line comments (a parsed value poisoned with `"… # comment"` broke a
   firebase.json render). Consecutive keys each need their own comment.
3. **Resource names are composed, never literal** in scripts: images
   `datiq-<code>-ctr-<unit>:<tag>`, Cloud Run `datiq-<code>-run-<unit>-<suffix>`,
   Scheduler `datiq-<code>-sch-<fn>-<suffix>`, secrets
   `datiq-<code>-sm-<key-dashed>-<suffix>`, local containers `datiq-local-ctr-*`.
   See doc 06 for every pattern; compose them from env vars.
4. **Run the parameterisation gate before committing:**
   `bash deployment/scripts/check-parameterisation.sh` — must stay green. If a
   new forbidden literal lands in a deployable, add it to the gate's FORBIDDEN
   list (or move the value into an env example).
5. **Secrets never in committed files.** Real secret values go in the gitignored
   `.env.<env>` actuals (and Secret Manager via `bootstrap-secrets.sh`). The
   gate forbids key prefixes (`sk-ant`, `fc-`, `rzp_`, …).

## Bash/script conventions

- `#!/usr/bin/env bash`, `set -euo pipefail`, `source lib-gcp.sh` / `lib/env-loader.sh` for env loading. All scripts are **bash 3.2 safe** (macOS default): no `${var,,}`, no associative arrays, no exported arrays, no mapfile.
- Derived resource names go in the shared lib (`lib-gcp.sh` `load_gcp_env`), never per-script.
- Never pipe large bodies into `grep -q` under pipefail (SIGPIPE 141 false negative — grep a temp file; `tests/stack-smoke.sh` documents the pattern).
- Unquoted expansions only where empty-safe is required (e.g. `$API_SECRETS` in `deploy-run.sh` — a quoted empty string is a literal positional arg to gcloud).
- Idempotency: every deploy script must be re-runnable (describe-or-create, upserts).
- Fail loud on data paths: DB restores use `ON_ERROR_STOP=1` + FK park/restore — never `… || true` that swallows row failures (that bug silently dropped audit data on staging).

## Docker/nginx conventions

- One Dockerfile per surface (`deployment/docker/{api,web,admin,trackers,gateway}`); jobs/scheduler reuse the **api image** with different commands.
- Gateway/web/admin/trackers config is GENERATED from `netlify.toml` + `scripts/site-routes.mjs` at build (gen-gateway-conf.mjs) — never hand-edited nginx redirect lists; edge parity is the goal (redirects, headers, precedence, trailing-slash behavior).
- Upstreams resolve at request time (docker-DNS `resolver 127.0.0.11` + variable `proxy_pass`) so restarts don't kill nginx.

## GCP conventions

- `deploy-staging.sh` orchestrates; every step individually skippable via `SKIP_*`.
- `deploy-run.sh`: api/admin/trackers `--allow-unauthenticated` (Netlify parity), jobs/auth/rest `--no-allow-unauthenticated` (Scheduler OIDC / IAM). Adapter's jobs mode is fail-closed (no JOBS_TOKEN → 503, never open dispatch).
- Smoke must FAIL the deploy (`deploy-staging.sh` runs `smoke.sh` without `|| true`); environment-specific skips print a SKIP line, never a fake pass.
- Cron ownership rule (parallel run): `OPS_JOBS_DISABLED=1` until cutover — GCP and Netlify must never own crons simultaneously.
- Cloud SQL: the local cloud-sql-proxy download maps `uname -m` x86_64→amd64 (release asset names, not uname).

## CI (.github/workflows/gcp-staging.yml)

- Non-secret values come from the env example (grep-append), never hardcoded in the workflow. Secrets only from the GitHub Environment.
- `RUNTIME_ENV_FILE=deployment/env/.env.staging` (the CI-written file) — bootstrap-secrets falls back to the deploy env when the operator file is absent.
- Env heredoc uses a QUOTED delimiter (`<<'ENV'`) so `$`/backticks in secrets are written verbatim.
- The parameterisation gate runs in CI.
- Push triggers skip the DB step (`SKIP_DB=1` — no Supabase CLI/rehearsal dumps on runners).

## Docs

- Plan docs live in `docs/plans/gcp-docker-migration/` (numbered 01–09); keep the deviations section of 05 current when reality diverges from the plan.
- Session handoffs live in `docs/sessions/` (use the session-handoff-management skill).
- The runbook (08) and cutover runbook (09) must reflect what the scripts actually do — a script that references a runbook requires that runbook to exist.

## Review checklist (apply on every change)

- [ ] Parameterisation gate green; no new literals outside env examples.
- [ ] Every new/modified env var documented (purpose · obtain · DO/DON'T) above its line in the `.example`; no inline comments on value lines.
- [ ] Resource/image/job/secret names match doc 06 patterns.
- [ ] Scripts: bash 3.2 safe, `set -euo pipefail`, idempotent, fail-loud on data paths, empty-safe quoting.
- [ ] Docker/nginx: generated configs only; docker-DNS resolver; image reuse for jobs.
- [ ] CI workflow: no hardcoded contract values, quoted heredoc, gate wired in, push-trigger safe.
- [ ] Docs updated (plan deviations, runbook, README) and consistent with the code.
