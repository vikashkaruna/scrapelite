# FIREBASE-MIGRATION.md

> **Status:** Pre-migration · Draft · Plan-of-record for moving DatIQ production from Netlify to Google Cloud (Firebase Hosting + Cloud Functions 2nd gen).
>
> **Scope:** Production only. Netlify remains the build/test target for all development branches and PR previews. Only `main` deployments are gated through this migration.
>
> **Last updated:** 2026-07-18
>
> **See also:**
> - `CLAUDE.md` — full project context, env vars, Netlify setup, function inventory
> - `AGENTS.md` — agent onboarding
> - `README.md` — local dev quickstart
> - `docs/PRODUCTION-RELEASE-V1.0.md` — current production release runbook (Netlify, baseline)

---

## Table of contents

1. [Pre-flight sanity check](#0-pre-flight--one-sanity-check)
2. [What moves where — the mapping](#1-what-moves-where--the-mapping)
3. [Pre-requisites](#2-pre-requisites)
4. [Bootstrap the project](#3-bootstrap-the-project)
5. [Code refactor — Netlify functions → Firebase functions](#4-code-refactor--netlify-functions--firebase-functions)
6. [`firebase.json` — full file](#5-firebasejson--full-file)
7. [Secrets — the full mapping](#6-secrets--the-full-mapping)
8. [Auth & authorization](#7-auth--authorization)
9. [Scheduled functions — Netlify → Cloud Scheduler](#8-scheduled-functions--netlify--cloud-scheduler)
10. [Razorpay webhook — single URL update](#9-razorpay-webhook--single-url-update)
11. [Custom domain & DNS](#10-custom-domain--dns)
12. [CI/CD pipeline](#11-cicd-pipeline)
13. [Pre-prod checklist](#12-pre-prod-checklist-do-all-of-these-before-cutover)
14. [The automated sanity test](#13-the-automated-sanity-test)
15. [Post-cutover — first 72 hours](#14-post-cutover--first-72-hours)
16. [Rollback plan](#15-rollback-plan)
17. [Cost estimate (rough)](#16-cost-estimate-rough)
18. [Common pitfalls](#17-common-pitfalls)
19. [Sequencing — the actual order](#18-sequencing--the-actual-order)
20. [After it ships — update `CLAUDE.md`](#19-after-it-ships--update-claudemd)
21. [TL;DR — if you only do 3 things right now](#20-tldr--if-you-only-do-3-things-right-now)

---

## 0. Pre-flight — one sanity check

DatIQ is already production-grade on Netlify. Moving to Firebase/GCP is worth it only if one of these is true:

- **Data residency in India** (Razorpay, Supabase, scraping egress closer to `asia-south1`)
- **Other GCP services in the stack** (BigQuery, Cloud Storage, Vertex AI later)
- **Cost at scale** (Firebase Hosting + Functions is cheaper than Netlify once you're past ~500k requests/mo)
- **Vendor de-risking** (Netlify-only today)

If you just want "GCP on the resume", push back — keep Netlify. If you have a real reason, the rest of this doc is the runbook.

**One assumption to validate:** keep Supabase as the database and auth. It's already managed Postgres + Auth, works from GCP over HTTPS, and migrating to Firestore or Cloud SQL is a 3–4 week project for zero functional benefit. This plan treats Supabase as an external service the Firebase Functions connect to via the service key.

If you need a GCP-native DB instead, the only sane option is **Cloud SQL for PostgreSQL** (managed Postgres on GCP). Firestore is a document store, not relational, and would force a full schema rewrite. Decision is yours; the rest of this doc assumes Supabase stays.

---

## 1. What moves where — the mapping

| Layer | Today (Netlify) | Tomorrow (Firebase/GCP) | Action |
|---|---|---|---|
| Static SPA | Netlify CDN (publishes `dist/`) | **Firebase Hosting** (also publishes `dist/`) | Move |
| API functions | `netlify/functions/*.js` (esbuild) | **Cloud Functions 2nd gen** (Node 20, ESM) | Move + refactor signature |
| Scheduled job | Netlify Scheduled Function (`scheduled-runner.js`) | **Cloud Scheduler → Pub/Sub → onSchedule handler** | Move |
| Database | Supabase Postgres | **Supabase Postgres (unchanged)** | Keep |
| Auth | Supabase Auth | **Supabase Auth (unchanged)** | Keep, just add new domain to redirect URLs |
| Payment webhook | Razorpay → Netlify | **Razorpay → Firebase Function URL** | Update webhook URL only |
| Secrets | Netlify env vars | **Firebase Secrets Manager** (`firebase functions:secrets:set`) | Move |
| Build | `npm run build` | `npm run build` (unchanged) | Keep |
| Test suite | vitest + Playwright | vitest + Playwright (unchanged) | Keep |
| Dev branches auto-deploy | Netlify | **Netlify (unchanged)** | Keep |
| `main` auto-deploy | Netlify | **Netlify for staging, Firebase for prod (gated)** | Add gate |

The frontend code (`src/**`) needs **zero changes** — `apiClient.js` already calls relative `/api/*` and Firebase Hosting can serve that with a rewrite.

### Function inventory (migrate all 16)

From `netlify/functions/` (per `CLAUDE.md`):

| File | Endpoint | Notes |
|---|---|---|
| `ai.js` | `POST /api/ai` | Multi-provider fallback; normalizes to Anthropic shape |
| `admin-ai-config.js` | `GET/POST /api/admin-ai-config` | Token-gated |
| `admin-auth.js` | `POST /api/admin-auth` | Server PIN verify (HMAC session token) |
| `admin-general-config.js` | `GET/POST /api/admin-general-config` | Token-gated; sanitizes 4 integer fields |
| `admin-revenue.js` | `GET /api/admin-revenue` | Token-gated; live Supabase aggregate |
| `admin-users.js` | `GET/PATCH/POST /api/admin-users` | Token-gated; Supabase Auth Admin |
| `create-checkout.js` | `POST /api/create-checkout` | Stripe / Razorpay / demo |
| `extract.js` | `POST /api/extract` | Firecrawl→Spider→Jina→Direct chain |
| `extractions.js` | `GET/POST/PATCH/DELETE /api/extractions` | Supabase proxy |
| `og-preview.js` | `GET /api/og-preview?url=` | Server-side OG metadata |
| `payment-webhook.js` | `POST /api/payment-webhook` | Stripe + Razorpay |
| `reengagement.js` | n/a (re-engagement emails) | Standalone function |
| `scheduled-runner.js` | cron `@hourly` | See §8 for scheduler migration |
| `schedules.js` | `CRUD /api/schedules` | Per-user schedule CRUD |
| `stats.js` | `GET /api/stats` | Aggregate; 5-min CDN cache |
| `verify-payment.js` | `GET/POST /api/verify-payment` | Stripe / Razorpay HMAC verify |
| `lib/*` | shared modules | Pure JS, no handler signature |

`lib/*` has no `export const handler` — safe to keep as-is (no Netlify function name violation). The `*.test.js` files in `lib/` must move to `netlify/__tests__/lib/` (already done per the v1.0 release `5a05f62`; mirror to `functions/__tests__/lib/` if you want Firebase-side tests).

---

## 2. Pre-requisites

### 2.1 Local tooling

```bash
# Install (or update) the Firebase + GCP CLIs
brew install firebase-cli/google-cloud-platform/google-cloud-sdk   # macOS, both
# OR
npm i -g firebase-tools
gcloud components install gcloud gsutil

# Login + project wiring
gcloud auth login
gcloud auth application-default login        # for ADC in scripts
firebase login
```

Pin versions in `package.json` devDeps so CI matches local:

```bash
npm i -D firebase-tools@^14.0.0
# (gcloud isn't in npm — pin in CI image, e.g. google/cloud-sdk:485.0.0)
```

### 2.2 Accounts / billing

| Need | Where | Notes |
|---|---|---|
| GCP project | https://console.cloud.google.com | Create it; note the project ID (e.g. `datiq-prod`) |
| Firebase project on Blaze plan | https://console.firebase.google.com | **Required** for outbound network (Firecrawl/Supabase) and 2nd-gen functions |
| Billing account | Linked to GCP project | Budget alerts at $50 / $200 / $500 |
| Firebase Admin SDK service account | Project Settings → Service Accounts → Generate | JSON key, store in GitHub Actions secret |
| Domain on Cloud DNS (optional) | Cloud DNS | Or keep DNS where it is; Firebase Hosting accepts any DNS |

### 2.3 IAM roles you (or your CI bot) need

```
roles/firebase.admin
roles/cloudfunctions.admin
roles/run.admin              # for 2nd-gen functions runtime
roles/iam.serviceAccountUser
roles/cloudscheduler.admin
roles/secretmanager.admin
roles/cloudbuild.builds.editor
roles/artifactregistry.admin
roles/storage.admin          # for the function source bucket
```

For the **runtime service account** (default `<project>@appspot.gserviceaccount.com` — grant `roles/secretmanager.secretAccessor` so it can read secrets):

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 2.4 Cost ceiling

Set a budget alert before shipping anything:

```bash
gcloud billing budgets create \
  --billing-account=$BILLING_ACCOUNT_ID \
  --display-name="DatIQ prod budget" \
  --budget-amount=500 \
  --threshold-rule=0.5 \
  --threshold-rule=0.9
```

---

## 3. Bootstrap the project

### 3.1 Create GCP project + link Firebase

```bash
gcloud projects create datiq-prod --name="DatIQ Prod"
gcloud config set project datiq-prod
gcloud beta billing projects link datiq-prod --billing-account=$BILLING_ACCOUNT_ID

# Enable the APIs you need
gcloud services enable \
  firebase.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  firebasehosting.googleapis.com \
  identitytoolkit.googleapis.com
```

In the Firebase console (https://console.firebase.google.com) → "Add project" → pick `datiq-prod` → upgrade to **Blaze** plan. Enable **Firebase Hosting** and **Cloud Functions**. You do **not** need Analytics, Auth, Firestore, or Storage — none of those are used.

### 3.2 Initialize Firebase in the repo

```bash
cd /Users/vikash/Extracta
firebase login
firebase use --add            # pick datiq-prod
firebase init
```

When the wizard asks:

- **Which features?** → `Hosting`, `Functions`
- **Project?** → `datiq-prod`
- **Hosting public dir?** → `dist`  ← same as Netlify's `publish`
- **Configure as SPA?** → **Yes** (adds the `**` → `/index.html` rewrite; you'll edit it to add the `/api/**` rewrite)
- **Functions language?** → **JavaScript** (no TypeScript refactor)
- **ESLint?** → **No** (we lint in CI, not here)
- **Install deps now?** → **No** (you'll move them yourself)

This creates `firebase.json`, `.firebaserc`, `functions/package.json`, `functions/index.js`, `functions/.gitignore`.

### 3.3 Update `.gitignore`

Add to the repo root `.gitignore`:

```
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
functions/node_modules/
```

---

## 4. Code refactor — Netlify functions → Firebase functions

### 4.1 The signature change

Netlify functions export:

```js
export const handler = async (event, context) => ({
  statusCode: 200,
  headers: {...},
  body: JSON.stringify({...})
});
```

Firebase 2nd-gen functions use Express-style `(req, res)` (or `onCall` for callable functions, but we want HTTP for parity):

```js
const fn = (req, res) => {
  res.status(200).json({...});
};
exports.endpoint = onRequest({ region: "asia-south1", cors: true }, fn);
```

### 4.2 The cleanest pattern: single Express-routed `api` function

Rather than refactoring 16 handlers one by one, write a thin adapter that runs **all** of them through one Express app. This matches the Netlify "one function per file" mental model and is the smallest possible diff.

```js
// functions/api.js  (NEW)
import { onRequest } from "firebase-functions/v2/https";
import express from "express";
import cors from "cors";
import { createRequest, createResponse } from "./_adapter.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));

// Import the existing handlers as plain modules
import * as extract from "../netlify/functions/extract.js";
import * as ai from "../netlify/functions/ai.js";
import * as extractions from "../netlify/functions/extractions.js";
import * as createCheckout from "../netlify/functions/create-checkout.js";
import * as verifyPayment from "../netlify/functions/verify-payment.js";
import * as paymentWebhook from "../netlify/functions/payment-webhook.js";
import * as adminAuth from "../netlify/functions/admin-auth.js";
import * as adminAiConfig from "../netlify/functions/admin-ai-config.js";
import * as adminGeneralConfig from "../netlify/functions/admin-general-config.js";
import * as adminRevenue from "../netlify/functions/admin-revenue.js";
import * as adminUsers from "../netlify/functions/admin-users.js";
import * as ogPreview from "../netlify/functions/og-preview.js";
import * as stats from "../netlify/functions/stats.js";
import * as schedules from "../netlify/functions/schedules.js";
import * as reengagement from "../netlify/functions/reengagement.js";

const wrap = (handler, method = "ANY") => (req, res) => {
  const event = createRequest(req, method);
  handler(event, {})
    .then((r) => createResponse(res, r))
    .catch((err) => res.status(500).json({ error: err.message }));
};

app.all("/api/extract",                wrap(extract.handler));
app.all("/api/ai",                     wrap(ai.handler));
app.all("/api/extractions",            wrap(extractions.handler));
app.all("/api/create-checkout",        wrap(createCheckout.handler));
app.all("/api/verify-payment",         wrap(verifyPayment.handler));
app.all("/api/payment-webhook",        wrap(paymentWebhook.handler));
app.all("/api/admin-auth",             wrap(adminAuth.handler));
app.all("/api/admin-ai-config",        wrap(adminAiConfig.handler));
app.all("/api/admin-general-config",   wrap(adminGeneralConfig.handler));
app.all("/api/admin-revenue",          wrap(adminRevenue.handler));
app.all("/api/admin-users",            wrap(adminUsers.handler));
app.all("/api/og-preview",             wrap(ogPreview.handler));
app.all("/api/stats",                  wrap(stats.handler));
app.all("/api/schedules",              wrap(schedules.handler));
app.all("/api/reengagement",           wrap(reengagement.handler));

export const api = onRequest(
  {
    region: "asia-south1",
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 60,
    secrets: [
      "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FIRECRAWL_API_KEY", "JINA_API_KEY",
      "SPIDER_API_KEY", "GEMINI_API_KEY", "AI_API_KEY", "OPENAI_API_KEY",
      "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RESEND_API_KEY",
      "SCHEDULE_ALERT_WEBHOOK", "ALERT_EMAIL_FROM", "ADMIN_PIN_HASH",
      "ADMIN_TOKEN_SECRET", "VITE_RAZORPAY_KEY_ID", "VITE_WEBHOOK_URL",
    ],
  },
  app
);

// Scheduled function — replaces Netlify's @hourly (see §8)
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as scheduledRunner from "../netlify/functions/scheduled-runner.js";

export const hourlyRunner = onSchedule(
  {
    schedule: "0 * * * *",
    region: "asia-south1",
    timeZone: "Asia/Kolkata",
    secrets: [
      "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "FIRECRAWL_API_KEY",
      "RESEND_API_KEY", "SCHEDULE_ALERT_WEBHOOK", "ALERT_EMAIL_FROM",
    ],
  },
  async (context) => {
    const event = { httpMethod: "POST", scheduled: true, body: null };
    const result = await scheduledRunner.handler(event, context);
    console.log("scheduled-runner result", result);
  }
);
```

### 4.3 The adapter (`functions/_adapter.js`)

The minimum-viable Netlify-event shim:

```js
// functions/_adapter.js
export function createRequest(req, method) {
  // Coerce body to a string the way Netlify expects
  const rawBody = req.rawBody ?? (Buffer.isBuffer(req.body) ? req.body : null);
  const body = rawBody
    ? rawBody.toString("utf8")
    : (req.body && typeof req.body === "object"
        ? JSON.stringify(req.body)
        : req.body ?? null);
  return {
    httpMethod: method === "ANY" ? req.method : method,
    path: req.path,
    headers: req.headers,
    queryStringParameters: req.query && Object.keys(req.query).length ? req.query : null,
    multiValueQueryStringParameters: req.query ?? null,
    body,
    isBase64Encoded: false,
  };
}

export function createResponse(res, result) {
  const status = result?.statusCode ?? 200;
  if (result?.headers) {
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
  }
  // Express handles string vs object automatically
  res.status(status).send(result?.body ?? "");
}
```

If any existing handler uses `event.multiValueQueryStringParameters` or `event.path` in non-trivial ways, extend the adapter — most don't.

### 4.4 Migrate handler-by-handler (the one-by-one path)

If the express-adapter approach is too magical, refactor each handler individually. Pattern:

```js
// Before (netlify/functions/extract.js)
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsResponse();
  const body = JSON.parse(event.body || "{}");
  // ...
  return { statusCode: 200, body: JSON.stringify(result) };
};

// After (functions/extract.js)
import { onRequest } from "firebase-functions/v2/https";
export const extract = onRequest(
  { region: "asia-south1", cors: true },
  async (req, res) => {
    const body = req.body || {};
    // ... same logic ...
    res.status(200).json(result);
  }
);
```

Start with the adapter approach — it's one PR with no behavior change. Refactor individual handlers later if needed.

### 4.5 Move `netlify/functions/lib/` into the new `functions/` tree

```bash
cp -r netlify/functions/lib functions/lib
```

You can keep importing them with the relative `../netlify/functions/...` paths (Node ESM resolves them fine in Cloud Functions), or update imports to `./lib/...`. Either works; pick one and stick with it for the diff.

### 4.6 Install Firebase Functions deps

```bash
cd functions
npm init -y
npm pkg set type=module
npm pkg set engines.node="20"
npm install express cors
npm install firebase-functions firebase-admin
cd ..
```

`firebase` and `firebase-admin` stay in `functions/`, **not** in the root `package.json`. The frontend already has `@supabase/supabase-js` and `jspdf` (lazy) — leave them where they are.

---

## 5. `firebase.json` — full file

Replace whatever `firebase init` generated with this:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**", "functions/**"],
    "rewrites": [
      { "source": "/api/**",       "function": "api" },
      { "source": "/admin/**",     "function": "api" },
      { "source": "**",            "destination": "/index.html" }
    ],
    "headers": [
      { "source": "/assets/**",     "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
      { "source": "**/*.@(svg|png|jpg|jpeg|gif|webp|ico)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] },
      { "source": "**",             "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options",        "value": "DENY" },
        { "key": "Referrer-Policy",        "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy",     "value": "geolocation=(), microphone=(), camera=()" }
      ]}
    ],
    "predeploy": ["npm --prefix . run build"],
    "cleanUrls": true,
    "trailingSlash": false
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs20",
      "ignore": ["*.test.js", "*.spec.js", "__tests__/**"]
    }
  ],
  "emulators": {
    "auth":      { "port": 9099 },
    "functions": { "port": 5001 },
    "hosting":   { "port": 5000 },
    "pubsub":    { "port": 8085 },
    "ui":        { "enabled": true, "port": 4000 },
    "singleProjectMode": true
  }
}
```

**The `/admin/**` rewrite** — if `/admin` is purely a SPA route (React handles it client-side), the `**` catch-all at the end is enough and you can drop the `/admin/**` line. Keep it if you want explicit routing.

---

## 6. Secrets — the full mapping

| Netlify env | Firebase equivalent | Sensitive? | Source of truth |
|---|---|---|---|
| `VITE_SUPABASE_URL` | build-time arg to `npm run build` (in `.env.production`) | No | public |
| `VITE_SUPABASE_ANON_KEY` | build-time arg | No | public |
| `VITE_FIRECRAWL_API_KEY` | **drop from client** — never expose scraping keys in browser | n/a | was a leak; move server-side |
| `VITE_AI_API_KEY` | **drop from client** (already server-only since R4) | n/a | already correct |
| `VITE_AI_MODEL` | build-time | No | public |
| `VITE_WEBHOOK_URL` | build-time | No | public |
| `VITE_PAYMENT_PROVIDER` | build-time | No | public |
| `VITE_STRIPE_PUBLISHABLE_KEY` | build-time | No | public |
| `VITE_RAZORPAY_KEY_ID` | build-time (still needed for client SDK) | No | public |
| `VITE_STRIPE_PRICE_*` | build-time | No | public |
| `VITE_RAZORPAY_PLAN_*` | build-time (not currently used, v2.0) | No | public |
| `VITE_LINK_*` | build-time | No | public |
| `SUPABASE_URL` | `firebase functions:secrets:set SUPABASE_URL` | No | server |
| `SUPABASE_SERVICE_KEY` | `firebase functions:secrets:set SUPABASE_SERVICE_KEY` | **YES** | server |
| `AI_API_KEY` | secret | **YES** | server |
| `GEMINI_API_KEY` | secret | **YES** | server |
| `OPENAI_API_KEY` | secret | **YES** | server |
| `AI_PROVIDER_ORDER` | secret | No | server |
| `AI_MODEL` | secret | No | server |
| `OPENAI_MODEL` | secret | No | server |
| `AI_MAX_TOKENS` | secret | No | server |
| `STRIPE_SECRET_KEY` | secret | **YES** | server |
| `STRIPE_WEBHOOK_SECRET` | secret | **YES** | server |
| `RAZORPAY_KEY_ID` | secret | **YES** | server |
| `RAZORPAY_KEY_SECRET` | secret | **YES** | server |
| `RAZORPAY_WEBHOOK_SECRET` | secret | **YES** | server |
| `RESEND_API_KEY` | secret | **YES** | server |
| `ALERT_EMAIL_FROM` | secret | No | server |
| `SCHEDULE_ALERT_WEBHOOK` | secret | No | server |
| `SCRAPE_PROVIDER_ORDER` | secret | No | server |
| `SPIDER_API_KEY` | secret | **YES** | server |
| `JINA_API_KEY` | secret | **YES** | server |
| `ADMIN_PIN_HASH` | secret | **YES** | server |
| `ADMIN_TOKEN_SECRET` | secret | **YES** | server |
| `SITE_URL` | not needed — set in `firebase.json` rewrites | — | — |

### 6.1 Set secrets

```bash
export PROJECT=datiq-prod

firebase functions:secrets:set SUPABASE_URL             --project $PROJECT
firebase functions:secrets:set SUPABASE_SERVICE_KEY     --project $PROJECT
firebase functions:secrets:set GEMINI_API_KEY           --project $PROJECT
firebase functions:secrets:set AI_API_KEY               --project $PROJECT
firebase functions:secrets:set OPENAI_API_KEY           --project $PROJECT
firebase functions:secrets:set STRIPE_SECRET_KEY        --project $PROJECT
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET    --project $PROJECT
firebase functions:secrets:set RAZORPAY_KEY_ID          --project $PROJECT
firebase functions:secrets:set RAZORPAY_KEY_SECRET      --project $PROJECT
firebase functions:secrets:set RAZORPAY_WEBHOOK_SECRET  --project $PROJECT
firebase functions:secrets:set RESEND_API_KEY           --project $PROJECT
firebase functions:secrets:set SCHEDULE_ALERT_WEBHOOK   --project $PROJECT
firebase functions:secrets:set ALERT_EMAIL_FROM         --project $PROJECT
firebase functions:secrets:set SPIDER_API_KEY           --project $PROJECT
firebase functions:secrets:set JINA_API_KEY             --project $PROJECT
firebase functions:secrets:set ADMIN_PIN_HASH           --project $PROJECT
firebase functions:secrets:set ADMIN_TOKEN_SECRET       --project $PROJECT
# Optional / non-secret:
firebase functions:secrets:set AI_PROVIDER_ORDER        --project $PROJECT
firebase functions:secrets:set SCRAPE_PROVIDER_ORDER    --project $PROJECT
```

Each one prompts interactively. For non-interactive:

```bash
firebase functions:secrets:set GEMINI_API_KEY --data-file /tmp/gemini_key.txt --project $PROJECT
```

In CI (GitHub Actions) authenticate with a service account JSON key and use:

```bash
echo -n "$GEMINI_API_KEY" | firebase functions:secrets:set GEMINI_API_KEY --data-file /dev/stdin
```

### 6.2 Build-time env (the `VITE_*` ones)

Keep these in `.env.production` (gitignored) and pass them in your deploy step:

```bash
# .env.production (gitignored, only used at build time)
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJh...
VITE_AI_MODEL=claude-3-5-haiku-20241022
VITE_PAYMENT_PROVIDER=auto
VITE_RAZORPAY_KEY_ID=rzp_live_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_WEBHOOK_URL=https://hooks.n8n.cloud/...
VITE_LINK_CHANGELOG=https://datiq.app/changelog
VITE_LINK_ABOUT=https://datiq.app/about
VITE_LINK_BLOG=https://datiq.app/blog
```

Build with `--mode production`:

```bash
npm run build -- --mode production
```

Vite picks up `.env.production` automatically.

---

## 7. Auth & authorization

### 7.1 Supabase Auth (the only auth you have)

You are **not switching to Firebase Auth**. Supabase Auth stays. After Firebase Hosting is live, in the Supabase dashboard:

- **Authentication → URL Configuration** → add `https://datiq.app/**` and `https://prod.datiq.app/**` to **Redirect URLs**
- Set **Site URL** to `https://datiq.app`
- Re-enable OAuth providers (Google / Microsoft / GitHub) — they accept arbitrary redirect URLs, you just need to whitelist the new one

### 7.2 Admin PIN

`netlify/functions/admin-auth.js` reads `ADMIN_PIN_HASH` from env. On Firebase:

- Store `ADMIN_PIN_HASH` as a secret (see §6.1)
- `verifyAdminToken` uses `process.env.ADMIN_TOKEN_SECRET` — also a secret
- Demo PIN `ADMIN123` is auto-allowed if neither env is set. Make sure **both** are set in prod so the demo path is closed.

### 7.3 Service-to-service auth

The Cloud Function runtime service account (`<project>@appspot.gserviceaccount.com`) calls Supabase over HTTPS with the service key. No extra GCP-side auth needed.

If you ever want **GCP IAM** for Supabase (not currently possible — Supabase is on AWS), you'd switch to signed JWTs. Not in scope.

### 7.4 Internal-only routes

Routes like `/api/admin-*` are already token-gated via `verifyAdminToken`. No change.

### 7.5 Cloud Run IAM (advanced — only if you need VPC access later)

If you later need the function to talk to a private Cloud SQL, put the function behind a Cloud Run service with `--no-allow-unauthenticated` and use ID tokens. Skip for now.

---

## 8. Scheduled functions — Netlify → Cloud Scheduler

The current `netlify/functions/scheduled-runner.js` has `export const config = { schedule: "@hourly" }` (Netlify's cron syntax). Firebase 2nd gen has `onSchedule` which is much cleaner — see `hourlyRunner` in §4.2.

You don't need a separate Cloud Scheduler job or Pub/Sub topic — `onSchedule` creates them under the hood and gives you a single deployable unit.

If you need **more** schedules later (e.g. daily digest, weekly cleanup):

```js
export const dailyDigest = onSchedule(
  { schedule: "0 9 * * *", region: "asia-south1", timeZone: "Asia/Kolkata" },
  async (context) => { /* ... */ }
);
```

Verify it's actually scheduled:

```bash
gcloud scheduler jobs list --project=$PROJECT --location=asia-south1
```

---

## 9. Razorpay webhook — single URL update

In the Razorpay dashboard → Settings → Webhooks:

| Field | Today (Netlify) | Tomorrow (Firebase) |
|---|---|---|
| URL | `https://datiq.app/.netlify/functions/payment-webhook?provider=razorpay` | `https://datiq.app/api/payment-webhook?provider=razorpay` |
| Secret | `RAZORPAY_WEBHOOK_SECRET` (rotated) | `RAZORPAY_WEBHOOK_SECRET` (rotated again) |
| Active events | `payment.captured`, `payment.failed`, `subscription.*` | same |

Rotation sequence: (1) deploy new code with new secret as a secret, (2) update Razorpay dashboard, (3) deploy with old secret removed, (4) verify a test charge end-to-end.

Stripe webhook is the same pattern when you re-enable it (currently deferred per `docs/STRIPE-DEFERRAL.md`).

---

## 10. Custom domain & DNS

### 10.1 Staged cutover — recommended

Deploy Firebase first to a **sub-domain**, validate, then move the apex domain.

```bash
firebase hosting:channel:deploy prod-staging --project $PROJECT
# → returns a URL like https://datiq-prod--prod-staging-xxxx.web.app
```

Map your real sub-domain:

```bash
firebase hosting:channel:deploy prod --project $PROJECT \
  --only hosting:datiq.app
# Then in Firebase Console → Hosting → "Add custom domain" → prod.datiq.app
```

DNS records Firebase will ask for:

| Type | Host | Value |
|---|---|---|
| A | `prod.datiq.app` | `151.101.1.195` (Firebase-provided; check console) |
| A | `prod.datiq.app` | `151.101.65.195` |
| AAAA | `prod.datiq.app` | `2a04:4e42::195` (if using IPv6) |

Test `https://prod.datiq.app` thoroughly (run the §13 smoke script against it).

### 10.2 Apex cutover

When the sub-domain is green for at least 24h:

```bash
firebase hosting:sites:create datiq-app --project $PROJECT   # only if not already
firebase target:apply hosting prod datiq-app
# In Firebase Console → Hosting → "Add custom domain" → datiq.app
# Add the A/AAAA records Firebase gives you
```

DNS propagation is the slow part. Set TTL to 300s on the existing Netlify records 24h before, then update on cutover. Keep Netlify hosting alive for **at least 14 days** as a fallback.

### 10.3 SSL

Firebase Hosting provisions a Let's Encrypt cert automatically. No action needed beyond verifying the DNS resolves to Firebase.

---

## 11. CI/CD pipeline

### 11.1 Strategy

```
PR / non-main branches  →  Netlify auto-deploy (preview URL)   ← unchanged
main branch             →  GitHub Actions:
                            1. Run test suite
                            2. Require manual approval (prod gate)
                            3. Build
                            4. firebase deploy --only hosting
                            5. firebase deploy --only functions
                            6. Run §13 smoke test against the new version
                            7. Mark release in changelog
```

### 11.2 GitHub Actions workflow

`.github/workflows/deploy-prod.yml`:

```yaml
name: Deploy prod
on:
  push:
    branches: [main]
concurrency:
  group: prod-deploy
  cancel-in-progress: false   # never cancel an in-flight prod deploy

jobs:
  test:
    uses: ./.github/workflows/test.yml   # existing test workflow, refactor out
  deploy:
    needs: test
    runs-on: ubuntu-latest
    environment: production              # ← the manual-approval gate
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "npm" }
      - run: npm ci
      - run: npm run build -- --mode production
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_RAZORPAY_KEY_ID: ${{ secrets.VITE_RAZORPAY_KEY_ID }}
          VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
          VITE_AI_MODEL: claude-3-5-haiku-20241022
          VITE_PAYMENT_PROVIDER: auto
          VITE_WEBHOOK_URL: ${{ secrets.VITE_WEBHOOK_URL }}
      - uses: FirebaseExtended/action-hosting-deploy@v3
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
          projectId: datiq-prod
      - run: npm ci && node scripts/smoke-prod.mjs https://datiq.app
        env:
          SMOKE_ADMIN_PIN: ${{ secrets.ADMIN_PIN_HASH }}
```

Secrets to add to GitHub repo settings:

- `FIREBASE_SERVICE_ACCOUNT` — JSON key for a dedicated deployer SA with `roles/firebase.admin`
- `VITE_*` ones listed above
- `SMOKE_ADMIN_PIN` — the plaintext PIN (only used to mint an admin token for the smoke test, then thrown away)

The **environment: production** is what makes the workflow wait for you to click "Approve" in the GitHub UI. That's your gate.

### 11.3 Netlify branch protection (unchanged)

Your current Netlify config will keep auto-deploying non-main branches. Don't disable it.

---

## 12. Pre-prod checklist (do all of these before cutover)

Run through this list with the boxes ticked. Each one is a real failure mode.

- [ ] All `VITE_*` values are in `.env.production` and the build succeeds
- [ ] All server secrets are set via `firebase functions:secrets:set` (verify with `firebase functions:secrets:access SUPABASE_URL`)
- [ ] `firebase deploy --only functions` succeeds and the function shows up in the GCP console (Run → Services)
- [ ] `firebase deploy --only hosting` succeeds and `curl -I https://datiq-app.web.app/` returns 200
- [ ] Supabase Auth redirect URLs include the new domain(s)
- [ ] Razorpay webhook URL updated in dashboard; **secret rotated**; test event received and verified in `firebase functions:log`
- [ ] `datiq.app` A records point to Firebase; HTTPS cert provisioned (check the padlock in the browser)
- [ ] `ADMIN_PIN_HASH` is set as a secret; logging into `/admin` with `ADMIN123` is rejected
- [ ] The hourly scheduler shows up in `gcloud scheduler jobs list`
- [ ] Cold-start is acceptable (call `/api/stats` after 10 minutes of no traffic — should still be < 5s)
- [ ] CORS test: open the prod URL in a private tab, run an extraction, verify no CORS errors in devtools
- [ ] Compare 1st-gen vs 2nd-gen cold start if you care — set `min-instances: 1` for any latency-sensitive endpoint (`create-checkout`, `verify-payment`)
- [ ] The §13 smoke test passes against the staging sub-domain
- [ ] Netlify site is still alive and serving the old version (your fallback)
- [ ] The DNS TTL on the apex domain has been lowered to 300s at least 24h before cutover
- [ ] You've got a tab open to Firebase Console + Supabase Dashboard + Netlify Dashboard for monitoring
- [ ] The team/yourself has been pinged — no other deploys are in flight
- [ ] Billing alert at 50% / 90% is configured

---

## 13. The automated sanity test

This is the file you asked for. Drop it in `scripts/smoke-prod.mjs`. It hits every public surface and exits non-zero if anything is wrong.

```js
// scripts/smoke-prod.mjs
//
// Post-deploy smoke test for DatIQ on Firebase/GCP.
// Usage:
//   node scripts/smoke-prod.mjs https://datiq.app
//   SMOKE_ADMIN_PIN=... node scripts/smoke-prod.mjs https://prod.datiq.app
//
// Exits 0 on full pass, 1 on any failure. Designed to be safe to re-run.

import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.argv[2] || "https://datiq.app";
const PIN = process.env.SMOKE_ADMIN_PIN || "ADMIN123"; // only used for the admin check
const TIMEOUT_MS = 15_000;
const SAMPLE_URL = "https://example.com";

const results = [];
let adminToken = null;

const log = (...a) => console.log(...a);
const ok = (name, extra) => { results.push({ name, status: "PASS", extra }); log(`  ✓ ${name}`); };
const fail = (name, msg) => { results.push({ name, status: "FAIL", extra: msg }); log(`  ✗ ${name} — ${msg}`); };

async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, extra);
  } catch (e) {
    fail(name, e?.message || String(e));
  }
}

async function timedFetch(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function expectStatus(url, init, expected, name) {
  const r = await timedFetch(url, init);
  if (Array.isArray(expected) ? !expected.includes(r.status) : r.status !== expected) {
    throw new Error(`${name}: expected ${expected}, got ${r.status}`);
  }
  return r;
}

log(`\n[smoke] target = ${BASE}\n`);

// ── 1. Static host reachable ─────────────────────────────────────────────
await check("static host returns 200", async () => {
  const r = await timedFetch(BASE);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("text/html")) throw new Error(`content-type ${ct}`);
  return `200, ${ct}`;
});

await check("SPA fallback works for /preview", async () => {
  const r = await timedFetch(`${BASE}/preview`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
});

await check("SPA fallback works for /dashboard", async () => {
  const r = await timedFetch(`${BASE}/dashboard`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
});

await check("static assets have cache header", async () => {
  // The build always produces at least one hashed asset under /assets/
  const idx = await timedFetch(BASE);
  const html = await idx.text();
  const m = html.match(/\/assets\/[A-Za-z0-9_./-]+\.js/);
  if (!m) throw new Error("no /assets/ ref in HTML");
  const r = await timedFetch(`${BASE}${m[0]}`);
  if (r.status !== 200) throw new Error(`asset status ${r.status}`);
  if (!(r.headers.get("cache-control") || "").includes("max-age")) throw new Error("no cache-control");
  return m[0];
});

await check("security headers present", async () => {
  const r = await timedFetch(BASE);
  const h = r.headers;
  const must = ["x-content-type-options", "x-frame-options", "referrer-policy"];
  const missing = must.filter((k) => !h.get(k));
  if (missing.length) throw new Error(`missing ${missing.join(",")}`);
});

// ── 2. Public read endpoints ─────────────────────────────────────────────
await check("/api/stats reachable", async () => {
  const r = await expectStatus(`${BASE}/api/stats`, {}, [200, 503], "stats");
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("no JSON body");
  return `teams=${j.teams ?? "—"} extractions=${j.extractions ?? "—"}`;
});

await check("/api/og-preview parses example.com", async () => {
  const r = await expectStatus(`${BASE}/api/og-preview?url=${encodeURIComponent(SAMPLE_URL)}`, {}, 200, "og-preview");
  const j = await r.json();
  if (!j.url) throw new Error("no url in body");
});

// ── 3. Extraction pipeline ──────────────────────────────────────────────
await check("POST /api/extract returns 200 with body shape", async () => {
  const r = await expectStatus(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: SAMPLE_URL, intent: "summary" }),
  }, [200, 400, 502], "extract"); // 400/502 OK if scraper key missing
  const j = await r.json();
  if (j && j.error) return `upstream error (expected if no scraper key): ${j.error}`;
  if (j && (j.html || j.markdown || j.metadata?.title || j.data)) return "ok";
  throw new Error("unrecognized body shape");
});

// ── 4. AI proxy ──────────────────────────────────────────────────────────
await check("POST /api/ai responds (mock or real)", async () => {
  const r = await timedFetch(`${BASE}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Say 'smoke ok' and nothing else.", max_tokens: 50 }),
  });
  if (![200, 400, 502, 503].includes(r.status)) throw new Error(`status ${r.status}`);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("no JSON body");
  return `status=${r.status}`;
});

// ── 5. Supabase proxy endpoints respond ─────────────────────────────────
await check("GET /api/extractions returns 200", async () => {
  const r = await expectStatus(`${BASE}/api/extractions`, {}, 200, "extractions");
  const j = await r.json();
  if (!Array.isArray(j.items) && !j.error) throw new Error("unexpected body shape");
});

await check("GET /api/schedules returns 200", async () => {
  const r = await expectStatus(`${BASE}/api/schedules`, {}, 200, "schedules");
  const j = await r.json();
  if (!Array.isArray(j.items) && !j.error) throw new Error("unexpected body shape");
});

// ── 6. Admin auth gate ──────────────────────────────────────────────────
await check("POST /api/admin-auth with wrong PIN returns 401", async () => {
  const r = await expectStatus(`${BASE}/api/admin-auth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "definitely-wrong-pin-12345" }),
  }, [401, 400, 403], "admin-auth");
});

await check("POST /api/admin-auth with correct PIN mints token", async () => {
  const r = await timedFetch(`${BASE}/api/admin-auth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: PIN }),
  });
  if (r.status === 401) throw new Error("PIN rejected — set SMOKE_ADMIN_PIN or check ADMIN_PIN_HASH");
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error("no token in response");
  adminToken = j.token;
  return `token ${j.token.slice(0, 6)}…`;
});

await check("admin route accepts the token (admin-revenue 200 or 401)", async () => {
  if (!adminToken) throw new Error("no token from previous check");
  const r = await timedFetch(`${BASE}/api/admin-revenue`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (![200, 401, 503].includes(r.status)) throw new Error(`status ${r.status}`);
  return `status=${r.status}`;
});

// ── 7. Payment endpoints (no actual charge) ──────────────────────────────
await check("POST /api/create-checkout with bad plan returns error JSON", async () => {
  const r = await timedFetch(`${BASE}/api/create-checkout`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId: "not-a-real-plan", billingPeriod: "monthly" }),
  });
  if (![400, 404, 500].includes(r.status)) throw new Error(`status ${r.status}`);
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("no JSON body");
  return `error code: ${j.code || j.error || "—"}`;
});

await check("POST /api/payment-webhook with bad signature is rejected", async () => {
  const r = await timedFetch(`${BASE}/api/payment-webhook?provider=razorpay`, {
    method: "POST", headers: {
      "content-type": "application/json",
      "x-razorpay-signature": "definitely-wrong-signature",
    },
    body: JSON.stringify({ event: "payment.captured", payload: { payment: { entity: {} } } }),
  });
  if (![400, 401, 403, 422].includes(r.status)) throw new Error(`status ${r.status}`);
});

// ── 8. CORS for browser preflight ───────────────────────────────────────
await check("CORS preflight on /api/extract returns Access-Control-Allow-Origin", async () => {
  const r = await timedFetch(`${BASE}/api/extract`, {
    method: "OPTIONS",
    headers: {
      "origin": BASE,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  if (![200, 204].includes(r.status)) throw new Error(`status ${r.status}`);
  const allow = r.headers.get("access-control-allow-origin");
  if (!allow) throw new Error("no ACAO header");
});

// ── 9. Latency check ────────────────────────────────────────────────────
await check("p95 latency on /api/stats under 3s (5 calls)", async () => {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await timedFetch(`${BASE}/api/stats`);
    if (![200, 503].includes(r.status)) throw new Error(`status ${r.status}`);
    samples.push(Date.now() - t0);
    await sleep(100);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples.at(-1);
  if (p95 > 3000) throw new Error(`p95 = ${p95}ms`);
  return `p95=${p95}ms [${samples.join(",")}]`;
});

// ── Summary ─────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
log(`\n[smoke] ${passed}/${results.length} passed, ${failed} failed\n`);

if (failed > 0) {
  for (const r of results.filter((r) => r.status === "FAIL")) {
    log(`   FAIL  ${r.name} — ${r.extra}`);
  }
  process.exit(1);
}
log("[smoke] all green ✓\n");
process.exit(0);
```

Wire it into CI as the post-deploy step (see §11.2), and run it manually after every cutover:

```bash
SMOKE_ADMIN_PIN=your-real-pin node scripts/smoke-prod.mjs https://datiq.app
```

**Caveat:** the script trusts that an `ADMIN_PIN_HASH` secret exists; without it, `/api/admin-auth` accepts `ADMIN123` and your "wrong PIN" check will fail. Always set the secret before running the smoke test against prod.

---

## 14. Post-cutover — first 72 hours

Monitor these signals in order of "if this breaks, it's user-visible":

| Signal | Where to look | Threshold |
|---|---|---|
| 5xx rate on `/api/*` | Cloud Logging → `severity>=ERROR` | > 1% |
| Extraction success rate | `/api/extract` 200 vs 4xx/5xx | < 95% = bad |
| Payment webhook delivery | Razorpay dashboard → Webhooks → Delivery attempts | any failures |
| Scheduled function runs | `gcloud scheduler jobs list` + Cloud Logging | one per hour, no gaps |
| Cold-start latency | Cloud Run metrics | p95 > 3s = add min-instances |
| Cost | Billing report | $0 baseline for 1k extractions/day, $50/mo for 50k |
| Auth | Supabase Auth logs | new signups working, OAuth callback succeeds |
| DNS | `dig datiq.app +short` | resolves to Firebase IPs |

Add an uptime check (synthetic):

```bash
gcloud alpha monitoring uptime create datiq-app-prod \
  --resource-type=uptime-url \
  --host=datiq.app \
  --path=/ \
  --check-interval=60s \
  --period=900s \
  --project=$PROJECT
```

Or use a free external monitor (UptimeRobot, BetterStack) on the `/api/stats` endpoint.

---

## 15. Rollback plan

Firebase Hosting keeps the last ~30 versions automatically. To roll back:

```bash
# List versions
firebase hosting:versions:list --project $PROJECT

# Roll back to a specific version (instant, zero-downtime)
firebase hosting:clone <version-id>:live datiq-app:live --project $PROJECT
```

For functions:

```bash
# Re-deploy the previous function code
git checkout <previous-sha>
firebase deploy --only functions --project $PROJECT
```

For DNS (the nuclear option):

```bash
# Point datiq.app back to Netlify
# (you kept these records ready in §10.2)
```

The "keep Netlify alive for 14 days" rule buys you the time to fix forward without data loss.

---

## 16. Cost estimate (rough)

At DatIQ's current shape (~5k extractions/mo, ~200 batch runs, ~50 payment events):

| Item | Estimate |
|---|---|
| Firebase Hosting | **$0** (well under free tier: 10GB storage, 360MB/day egress) |
| Cloud Functions invocations | **$0** (under 2M/mo free tier) |
| Cloud Functions compute | **$0–$5** (depends on duration) |
| Cloud Scheduler | **$0** (under 3 free jobs) |
| Secret Manager | **$0** (6 active secrets × $0.06/mo = $0.36) |
| Artifact Registry | **$0** (under 0.5GB free) |
| **Firebase total** | **~$1–5/mo** at current scale |
| Supabase (unchanged) | Free tier → Pro $25/mo when you outgrow it |
| Razorpay (unchanged) | 2% per transaction |
| **Total prod** | **~$30–50/mo** at current scale, dominated by Supabase |

You stay cheap until you cross ~500k requests/mo on Cloud Functions or 50GB egress on Hosting. Netlify's pricing is comparable, so this isn't really a cost play — it's a "one fewer vendor" play.

---

## 17. Common pitfalls (read these — they bite)

1. **CORS will burn you if you forget `cors: true` on the function.** The frontend is same-origin, so this is fine for browser traffic — but the Razorpay webhook and the smoke test from external tools need CORS allowed. Set it on every function.
2. **Express body parser vs raw body.** The Razorpay webhook HMAC verification uses the **raw** request body. If `express.json()` parses it first, the signature will be wrong. Either: skip json parsing on that route (`app.use("/api/payment-webhook", (req,res,next)=>{ req.rawBody = Buffer.from(req.body); next(); })`), or use the `rawBody` option on the json parser to preserve it.
3. **`firebase functions:secrets:set` doesn't redeploy.** After setting a new secret, you need to redeploy for the function to see it: `firebase deploy --only functions`.
4. **`onSchedule` is in `firebase-functions/v2/scheduler`, not `v2/https`.** Easy import error.
5. **Don't commit `firebase-service-account.json` to git.** Use GitHub Actions secrets.
6. **The frontend build is `npm run build` (Vite), not `npm run build:firebase`.** Vite outputs to `dist/`, which is what `firebase hosting` publishes. Don't introduce a second build command.
7. **The Cloud Functions cold start is ~1-2s.** If you care about `verify-payment` round-trip time, set `minInstances: 1` on just that function (costs ~$5/mo per always-warm instance).
8. **`/api/schedules` is not the same as `scheduled-runner`.** The first is a user-facing CRUD endpoint (the `/schedules` page calls it). The second is the background hourly job. Both are in the migration.
9. **Static-only files in `public/` (e.g. `public/help/`, `public/vs/`) need to be built and copied to `dist/`.** They are, by Vite. Don't move them.
10. **`functions/` directory cannot have test files** (Netlify had the same rule). The `ignore: ["*.test.js"]` in `firebase.json` catches this. The lesson from your v1.0 release (`5a05f62`) is to keep tests in `netlify/__tests__/` or `functions/__tests__/` — never at the top level.
11. **Region matters for latency.** Pick `asia-south1` (Mumbai) for India users. `us-central1` will add ~250ms RTT. Don't leave it default.
12. **The Supabase service key is the only key that bypasses RLS.** Treat it like a root password. Rotate it quarterly; never expose it to the frontend (you're not — Vite bundle is `datiq.app`-public only).
13. **Vite `VITE_*` variables are baked at build time, not runtime.** If you change a `VITE_*` value, you must rebuild and redeploy. This is a frequent "why didn't the change take effect" trap.
14. **The `predeploy` hook in `firebase.json` runs `npm run build`.** CI must have the `VITE_*` env vars present at deploy time, not at function-runtime.
15. **The `app.all("/api/extract", wrap(extract.handler))` adapter approach is magical.** If something goes wrong and you can't debug it, the per-handler refactor in §4.4 is the fallback. Plan B is fine.

---

## 18. Sequencing — the actual order

If you have one quiet afternoon to start, do this in order. Each step is a separate PR.

| # | PR | Time | Risk |
|---|---|---|---|
| 1 | Add `firebase` CLI + `.firebaserc` + empty `firebase.json` (no functions yet) | 30m | none |
| 2 | Add `functions/` skeleton with the Express adapter + a stubbed `/api/health` route | 1h | none |
| 3 | Wire up **all** secrets via `firebase functions:secrets:set` | 1h | low (just storage) |
| 4 | Move **one** handler end-to-end (suggest `stats.js` — simplest) and deploy to staging channel | 1h | low |
| 5 | Add the rest via the adapter pattern; deploy to staging channel | 2h | medium |
| 6 | Add the `hourlyRunner` schedule; verify it fires | 30m | low |
| 7 | Update Razorpay webhook URL (prod-staging first) | 15m | medium |
| 8 | Update Supabase Auth redirect URLs to include staging sub-domain | 5m | none |
| 9 | Run §13 smoke script against staging sub-domain | 30m | none |
| 10 | Wire up `deploy-prod.yml` GitHub Action with manual gate | 1h | low |
| 11 | Cutover apex domain (DNS swap, monitor for 24h) | 1h active, 24h passive | high |
| 12 | Roll the `VITE_FIRECRAWL_API_KEY` out of the frontend bundle (use a placeholder at build, let the function fall back to defaults) | 30m | low |
| 13 | **Keep Netlify alive for 14 days**, then retire | passive | none |
| 14 | Update `CLAUDE.md` to reflect the new prod target | 15m | none |

Total wall time for steps 1-9: about **two work days**. Step 11 (the actual cutover) is the only one I'd insist on doing when you can babysit it.

---

## 19. After it ships — update `CLAUDE.md`

Once the migration is done, add a section to `CLAUDE.md` (or a new `docs/PROD-INFRA.md` you reference from it) covering:

- Netlify = staging + dev branches (auto-deploy from non-main)
- Firebase = prod (gated deploy from `main`)
- Where each function lives and the mapping table in §1
- How to redeploy, how to roll back, how to add a new function
- The §13 smoke test command
- The §12 pre-prod checklist

---

## 20. TL;DR — if you only do 3 things right now

1. **Create the GCP project, upgrade to Blaze, run `firebase init`** (§3) — 30 min, no code change.
2. **Add the §13 smoke test script and run it against the current Netlify prod.** This becomes your baseline. If it doesn't pass today, it won't pass after migration either.
3. **Set up the GitHub Action with the manual gate** (§11.2) **before you touch any function code.** The gate keeps you safe during the rest of the migration.

When you're ready to start step 1, this doc has every command, file, and check you need.

---

*Document owner: DatIQ engineering. Update this file (not the CLAUDE.md) when the migration plan changes. Once the cutover is complete, archive it to `docs/FIREBASE-MIGRATION-COMPLETED.md` and link from CLAUDE.md.*
