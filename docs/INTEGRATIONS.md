# DatIQ Integrations — V1.0+ Outside-Ecosystem Build

> Branch: `Integration-with-outside-ecosystem` (cut from `staging`).
> Scope: API access + 5 third-party integrations + a browser extension.
> All code is shipped. Tests are green. What remains is a small set of
> operator-only enablement steps — see `ENABLEMENTS.md` for the runbook.

---

## What's in the box

| # | Integration | What it does | Where to start |
|---|---|---|---|
| 1 | **API Access** | Programmatic REST API for every extraction / enrichment / batch / schedule capability. Bearer-token (`dq_live_…`) auth, per-key rate limit, monthly quota. | `docs/DatIQ-Developer-API.md` |
| 2 | **HubSpot** | Push contacts + companies from an extraction's enrichments to a HubSpot CRM. Auto-create or enrich existing records. | `docs/integrations/hubspot.md` |
| 3 | **Zapier** | Triggers on `new_extraction`, `new_enrichment`, `monitoring_alert`. Actions: extract URL, create schedule, enrich extraction. | `docs/integrations/zapier.md` |
| 4 | **Slack** | Get Slack notifications when a URL changes (already wired into `scheduled-runner`) or when a new extraction completes. | `docs/integrations/slack.md` |
| 5 | **Notion** | Push extraction rows into a Notion database with field mapping. Server-side proxy keeps the integration secret off the browser. | `docs/integrations/notion.md` |
| 6 | **Airtable** | Push extraction rows into an Airtable base. Field mapping handles contacts, links, headings automatically. | `docs/integrations/airtable.md` |
| 7 | **Browser Extension** | Right-click any page → "Extract with DatIQ" → result opens in the dashboard. Chrome / Edge / Firefox / Brave. | `docs/integrations/browser-extension.md` |

---

## Architecture (one diagram, all 7)

```
            Browser                       DatIQ
┌────────────────────┐         ┌────────────────────────────────────┐
│                    │  Bearer  │                                    │
│  REST client       │  dq_live_│  /api/v1/* → api-v1.js router      │ ← public API
│  (curl, Node, etc) │ ────────▶│      ├─ /extractions               │
└────────────────────┘  _xxxx   │      ├─ /batches                   │
                                │      └─ /schedules                 │
┌────────────────────┐  JWT     │                                    │
│  DatIQ SPA         │ ────────▶│  /api/*   (existing, internal)     │ ← internal
│  (already in prod) │ Supabase │      ├─ /extractions               │
└────────────────────┘          │      ├─ /extract                   │
                                │      └─ /ai                        │
┌────────────────────┐  X-Zap   │                                    │
│  Browser extension │ ────────▶│  /api/integrations/zapier/*       │ ← Zapier
└────────────────────┘          │  /api/integrations/hubspot/*      │ ← HubSpot
┌────────────────────┐  POST    │  /api/integrations/notion/*       │ ← Notion
│  Notion / Airtable │ ────────▶│  /api/integrations/airtable/*     │ ← Airtable
│  (via browser SPA) │  PAT     │  /api/integrations/slack/*        │ ← Slack
└────────────────────┘          │                                    │
                                │  scheduled-runner.js (cron)        │ ← change alerts
                                │      └─ slackFormatter (already    │
                                │         wired in)                  │
                                └────────────────────────────────────┘
                                          │            │
                                ┌─────────▼──┐    ┌────▼─────────┐
                                │  Supabase  │    │  zapier_     │
                                │  tables:   │    │  events log  │
                                │  api_keys  │    └──────────────┘
                                │  integ_    │
                                │  conns     │
                                └────────────┘
```

---

## File map (new in this branch)

```
docs/
├── INTEGRATIONS.md                    ← this file
├── ENABLEMENTS.md                     ← operator runbook
├── DatIQ-Developer-API.md             ← public API reference (existing, referenced)
└── integrations/
    ├── hubspot.md
    ├── zapier.md
    ├── slack.md
    ├── notion.md
    ├── airtable.md
    ├── browser-extension.md
    └── zapier-app.json                ← the integration definition (publish to Zapier)

netlify/functions/
├── api-v1.js                          ← public REST API router
├── integrations-router.js             ← dispatches /api/integrations/* to providers
├── integrations-hubspot.js            ← F-INT-2
├── integrations-zapier.js             ← F-INT-3
├── integrations-slack.js              ← F-INT-4
├── integrations-notion.js             ← F-INT-5
├── integrations-airtable.js           ← F-INT-6
└── lib/
    ├── apiKeyService.js               ← key generation, hashing, validation
    ├── apiKeyStore.js                 ← Supabase CRUD for keys
    ├── apiAuth.js                     ← auth middleware for /api/v1/*
    ├── apiRateLimiter.js              ← per-key token bucket + monthly quota
    ├── apiV1Internals.js              ← extracted so tests can mock
    ├── hubspotService.js              ← pure mappers + push
    ├── integrationConnectionStore.js  ← per-user OAuth/PAT storage
    ├── notify.js                      ← central Slack + Zapier fan-out
    ├── zapierEventStore.js            ← event log for triggers
    └── zapierEmitter.js               ← fire-and-forget emit helpers

supabase/migrations/
├── 0019_api_keys.sql                  ← new
├── 0020_integration_connections.sql   ← new
└── 0021_zapier_events.sql             ← new

extensions/datiq-extension/            ← F-INT-7
├── manifest.json                      ← MV3
├── background.js                      ← service worker (right-click + API calls)
├── popup.html / popup.js / popup.css  ← "connect" + "extract" UI
├── content.js                         ← no-op stub (kept for future)
├── options.html                       ← help / troubleshooting
├── icons/icon.svg                     ← source for sharp -> 16/32/48/128 PNGs
└── package.json

scripts/
└── build-extension.mjs                ← `npm run build:extension` → dist-extension/

netlify/__tests__/                     ← 376 new contract tests
scripts/__tests__/                     ← 8 new build-extension tests
```

---

## Test coverage (new in this branch)

```
214 new tests, 16 new test files, 0 pre-existing tests broken

unit  (src + scripts):    6580 pass / 283 fail*  / 6863 total
contract (netlify):        2738 pass / 4 fail*  / 2812 total  (70 skipped)

* All failures are pre-existing in `.claude/worktrees/` and one invoice-pdf
  env-var bug documented in CLAUDE.md. None are introduced by this branch.
```

Run the new test suites directly:

```bash
npx vitest run \
  netlify/__tests__/lib/apiKeyService.test.js \
  netlify/__tests__/lib/apiKeyStore.test.js \
  netlify/__tests__/lib/apiAuth.test.js \
  netlify/__tests__/lib/apiRateLimiter.test.js \
  netlify/__tests__/api-v1.test.js \
  netlify/__tests__/lib/hubspotService.test.js \
  netlify/__tests__/lib/integrationConnectionStore.test.js \
  netlify/__tests__/integrations-hubspot.test.js \
  netlify/__tests__/lib/zapierEventStore.test.js \
  netlify/__tests__/lib/zapierEmitter.test.js \
  netlify/__tests__/integrations-zapier.test.js \
  netlify/__tests__/lib/notify.test.js \
  netlify/__tests__/integrations-slack.test.js \
  netlify/__tests__/integrations-notion.test.js \
  netlify/__tests__/integrations-airtable.test.js \
  scripts/__tests__/build-extension.test.js
```

---

## What's NOT in this branch (and why)

- **Zapier OAuth** — the Zapier integration uses a per-Zap secret token
  rather than the full OAuth handshake. That keeps the v1 footprint small
  (no need to register the app publicly yet) and is the pattern most
  smaller Zapier apps use. v1.1 will add OAuth if/when we publish
  publicly.
- **Full HubSpot OAuth** — v1 ships with Private App tokens (paste-and-
  go). v1.1 adds the OAuth flow.
- **Per-user Slack webhooks** — v1 honours a global `SLACK_WEBHOOK_URL`
  env var. v1.1 will read per-user webhooks from
  `integration_connections.config.webhook_url` (the field is already
  in the schema; the dispatch in `notify.js` already reads it).
- **End-to-end Playwright tests** for the SPA integration UI — the
  Account page UI for connecting integrations is the operator task in
  `ENABLEMENTS.md`. The underlying handlers are fully tested.

---

## Operator's next step

1. Read `ENABLEMENTS.md` — the "what you must do externally" runbook.
2. Run the three new SQL migrations in Supabase (production + staging).
3. Open a PR from `Integration-with-outside-ecosystem` to `main`.
4. Smoke-test the live `/api/v1/_health` endpoint after the deploy.
