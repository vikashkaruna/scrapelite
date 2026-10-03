# 10 — Local Deploy Runbook (Docker Desktop, `local` env)

**Scope:** the local stack (`deployment/compose/`), the lowest-risk
rehearsal environment. Contract: `deployment/env/.env.local` (gitignored;
`.env.local.example` documents every key).
**Fast path:** most days you only need §3 (up) and §4 (down).

---

## 1. Pre-validations (before touching the stack)

```bash
npm run test:all            # full gate: readiness, unit/contract/integration/
                            # system, deployment config, db, vuln+defect gates,
                            # build, prerender, security, Playwright smoke
npm run test:all -- --quick # pre-push subset (no e2e smoke)
```

A local `test:all` green is the same bar CI enforces before any deploy.

Env-file sanity:

```bash
npm run verify:supabase -- local   # offline ref match (live probe only for
                                   # *.supabase.co URLs; local-db mode skips it)
bash deployment/scripts/check-parameterisation.sh   # doc 06 §9 gate
```

## 2. First-time setup

```bash
cp deployment/env/.env.local.example deployment/env/.env.local   # then fill it
gcloud auth login                # only needed for shared-db / GCP steps
```

`.env.local` must define at least: `COMPOSE_PROJECT_NAME`, `DATA_MODE`,
`JWT_SECRET`, `POSTGRES_PASSWORD`, `JOBS_TOKEN`, `LOCAL_GATEWAY_PORT`,
`PUBLIC_BASE_URL` (up.sh fails fast listing any missing ones).

## 3. Bring the stack up

```bash
bash deployment/scripts/up.sh                 # full: gen-config → npm install
                                              # check → web build → compose up
                                              # → migrations → stack smoke
bash deployment/scripts/up.sh local web       # INCREMENTAL: rebuild + restart
                                              # only these units
SKIP_BUILD=1 bash deployment/scripts/up.sh local   # restart, no rebuilds
```

Valid units: `gateway web admin trackers api jobs scheduler db auth rest
mailpit pg-meta studio` (compose service names).

**Env-value change (incremental):** edit `deployment/env/.env.local` →
`up.sh local <affected units>`. Config generation runs every time; api/jobs get
their env via `generated/api-keys.env` (mode-aware, regenerated).

## 4. Stop, pause, or remove the stack

`down.sh` is **data-safe by default**: it STOPS the containers and retains
them — databases included — so local test data survives. Removing anything
(containers or data) is always an explicit flag:

```bash
bash deployment/scripts/down.sh            # stop; containers + volumes retained
bash deployment/scripts/down.sh local api  # stop only these units
bash deployment/scripts/down.sh -r         # remove containers+networks; volumes (data) KEPT
bash deployment/scripts/down.sh -v         # remove containers AND volumes —
                                           #   the local DB data is GONE
```

Finer lifecycle verbs — `deployment/scripts/stack.sh` (start/pause/resume/
inspect without touching images or volumes):

```bash
bash deployment/scripts/stack.sh status    # one row per container (stopped included)
bash deployment/scripts/stack.sh start     # resume a stopped stack
bash deployment/scripts/stack.sh pause     # freeze processes; memory state kept
bash deployment/scripts/stack.sh unpause   # resume after pause
bash deployment/scripts/stack.sh restart web api   # bounce named units
```

Every long-running service is `restart: unless-stopped`
(`deployment/tests/compose-policy.test.mjs` guards this): a container you
stopped or paused stays down across Docker Desktop restarts — only
containers that were RUNNING when the daemon died come back automatically.
After `down.sh -r` the containers no longer exist — recreate with `up.sh`,
not `stack.sh start`.

## 5. Post-validations (after up)

```bash
bash deployment/tests/stack-smoke.sh    # edge: redirects, routing, headers
bash deployment/tests/signon-e2e.sh     # full auth loop (local-db mode)
curl -s http://localhost:8080/api/health 2>/dev/null || \
  curl -s http://localhost:${LOCAL_GATEWAY_PORT:-8080}/healthz
```

Manual: app at `PUBLIC_BASE_URL`, admin at `/admin/` (PIN from `.env.local`),
Mailpit at `:8025`, Studio at `:54328` (local-db mode).

## 6. DB rehearsal (staging Supabase → local)

```bash
# put the session-pooler URI in .env.local as SOURCE_DB_URL, then:
bash deployment/scripts/migrate-from-supabase.sh local
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `up.sh` says node_modules incomplete | let it run `npm install` (it self-heals) |
| Web bundle points at the wrong Supabase | never `docker compose up --build` manually — the web image is built BY up.sh from `.env.local` |
| Gateway 502 right after start | upstreams resolve lazily (docker-DNS); wait 2s, re-run the smoke |
| auth/rest errors in local-db mode | `docker compose logs auth rest` — usually JWT_SECRET mismatch vs `generated/api-keys.env` |
