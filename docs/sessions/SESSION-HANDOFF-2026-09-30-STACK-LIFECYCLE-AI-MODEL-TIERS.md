# Session Handoff — 2026-09-30 — Data-Safe Local Stack Lifecycle + Parameterized AI Model Tiers

> **Branch:** `docker-desktop-build` @ HEAD (this commit; prior commit `2f9a9f4d` lands the 2026-09-29/30 ops-hardening working tree as-found)  
> **Target:** feature branch only — **no staging / no main / no deploys**  
> **Verification:** unit 9404 ✓ · contract 5560 ✓ · deployment vitest 20 ✓ · e2e-ai 28 ✓ · parameterisation gate ✓ · build ✓ · live stack smoke 17/17 ✓

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-30 |
| **Branch** | `docker-desktop-build` |
| **HEAD SHA** | this commit (parent: `2f9a9f4d`) |
| **Status** | Complete & verified |
| **Pre-Push Gates** | unit + contract + deployment vitest + e2e-ai + parameterisation gate + build all green; full `test:all` not re-run this session |
| **Active Focus** | (1) local Docker containers stop/pause-able with data-safe down; (2) AI model tiers fully parameterized, refreshed to current generations, priority OpenAI → Gemini → Claude |

## 2. What Was Accomplished

### Container lifecycle (local Docker)
- **`deployment/scripts/down.sh` is data-safe by default (owner decision):** plain `down.sh [env] [unit...]` now runs `docker compose stop` — containers are RETAINED (databases included), so local test data survives; removal is always an explicit flag: `-r/--remove` (containers + networks, volumes kept) and `-v/--wipe` (containers + volumes = local DB gone; unchanged semantics, loud warning).
- **New `deployment/scripts/stack.sh`** — lifecycle verbs without touching images/volumes: `start|stop|pause|unpause|restart|status [unit...]` (`status` shows stopped containers via `ps -a`; `start` after `down.sh -r` fails with a "recreate with up.sh" hint).
- **Restart policies:** every long-running service in `deployment/compose/compose.yaml` + `compose.local.yaml` was already `restart: unless-stopped` — the correct policy for stop/pause (a container you stopped/paused stays down across Docker Desktop restarts). Header comment documents why; n8n compose also verified.
- **New `deployment/tests/compose-policy.test.mjs`** (9 tests, in `vitest run deployment`): locks `unless-stopped` on all long-running services, one-shots stay one-shots (`db-passwords` `"no"`, `migrator` none), forbids `restart: always`, `bash -n` on up/down/stack + executable bit on stack.sh.
- **Docs:** runbook 10 §4 rewritten (stop default, -r/-v, pause/resume); `deployment/README.md` quickstart/commands/layout updated.

### AI model tiers (parameterized + refreshed)
- **New env vars** (tier-specific, per provider; legacy generic pins preserved): `OPENAI_MODEL_FAST/_DEEP`, `ANTHROPIC_MODEL_FAST/_DEEP` (legacy `AI_MODEL` still pins both tiers), `PERPLEXITY_MODEL_FAST/_DEEP`; `AI_PROVIDER_ORDER` now documented in the examples. Precedence: tier env → generic env → **area default** → registry pin.
- **Registry pins refreshed** (`src/lib/providerRegistry.js`): OpenAI → **`gpt-6-luna`** (fast + deep; catalogue adds `gpt-6-sol`, `gpt-5.6-luna`) — GPT-6 Sol/Luna launched 2026-09-22, Luna = "efficient GPT-6 for focused, high-volume tasks" (matches extraction/enrichment intent). Gemini fast `gemini-3.8-flash` / deep `gemini-pro-latest` unchanged, catalogue += `gemini-3.5-flash-lite`. Claude pins already correct: Haiku 4.5 (`claude-haiku-4-5-20251001`) fast / Sonnet 5 deep.
- **"Lightweight automation"** (owner spec) = classification area: new optional `FUNCTION_AREAS[*].defaultModels` layer ships `gemini-3.5-flash-lite` as the Gemini default for classification (link tagging / bulk). `defaultModel()` gained a `pillar` arg; `modelForTier(chain, provider, tier, pillar)` discriminates an explicit admin pin (differs from the pillar-less default) from a baked default so the area default is reachable without letting it override env/admin.
- **Priority order (owner spec):** `DEFAULT_ORDER` and all four AI area chains (`enrichment`, `synthesis`, `classification`, `discoverability`) = **openai → gemini → anthropic**. `citations` untouched (perplexity→gemini answer engines). Unset OpenAI key degrades safely (runChain skips no-key providers).
- **Env examples** (committed, documented `purpose · HOW TO OBTAIN · DO/DON'T`): `.env.example`, `deployment/env/.env.local.example` (full model-tier blocks), `.env.staging.example`, `.env.prod.example`. Operator actuals untouched — registry defaults cover them.
- **Cloud Run passthrough:** `deploy-run.sh` APP_ENV_VARS += the 7 new model/order vars (empty-safe), so prod can pin from `.env.<env>`; `update-env.sh` inherits via deploy-run. Local Docker picks them up via compose `env_file` automatically.
- **Admin/AI (production runtime override, already built):** `app_config['ai']` still overrides env per provider/area; GET now passes the pillar so effective per-area models show the area defaults; catalogue refresh flows into the picker.
- **Copy/dedup:** `healthModel.js` chain description → "OpenAI → Gemini → Claude"; `config.js` `AI_MODEL` fallback now imports the registry pin (no duplicated literal).

## 3. Root Cause Analysis

- **Stale `scripts/e2e-ai.mjs` (not a regression of this change — it was already red at HEAD, unwired into CI):** asserted a pre-redaction 502 body (`detail.attempts`, "providers failed" copy), a bare-token admin GET (now 401), and always-on demo admin tokens (now requires `DATIQ_ALLOW_DEMO_ADMIN=1`/dev context). Updated to the current contracts; assertions now derive the OpenAI default model from the registry instead of a literal.
- **Env leakage between test files:** an existing `aiProviders.test.js` spec sets `process.env.GEMINI_MODEL` without cleanup; the new `modelForTier` describe needed a defensive `beforeEach` reset.

## 4. Verification Evidence

- `npm run test:unit` — 539 files / **9404 tests passed**
- `npm run test:contract` — 311 files / **5560 tests passed**
- `npx vitest run deployment` — 2 files / **20 tests passed** (incl. 9 new compose-policy)
- `node scripts/e2e-ai.mjs` — **28/28 passed**
- `bash deployment/scripts/check-parameterisation.sh` — **green**
- `npm run build` — clean (2.01s; prerender 35 pages synced)
- **Live lifecycle (local stack):** `stack.sh status` ✓ → `down.sh` stopped all 14 containers, **all 14 retained** (`docker ps -a`, zero removed) → `stack.sh start` resumed all → `stack-smoke.sh` **17/17** → `stack.sh pause/unpause trackers` ✓ (healthy again after).

## 5. Operator Deployment Tasks & Open Items for Next Session

- [ ] **Verify `gpt-6-luna` against the live OpenAI API** — id derived from the documented `gpt-5.6-luna` convention; wrong id = `bad_model` on openai, chain degrades to Gemini (never breaks). Fix without deploy: `OPENAI_MODEL_*` env or /admin/ai (Test button validates live).
- [ ] Live-verify the new Gemini/OpenAI pins per env: `scripts/verify-ai-models.mjs` (Gemini) + /admin/ai Test button (all providers).
- [ ] Optional: pin explicit model vars in the gitignored operator actuals (`.env*`) — not required; registry defaults cover unset vars.
- [ ] Prior session's open items still stand (JOBS_TOKEN + SUPABASE_ACCESS_TOKEN rotation, stg redirect allowlist, Netlify Edge `/api/*` bypass) — see `SESSION-HANDOFF-2026-09-29-STG-ANONKEY-INCIDENT-GCP-OPS-HARDENING.md`.
- [ ] `.zcode/` (local tooling dir) is untracked — decide whether to gitignore.
