# Session Handoff — 2026-09-29 — Razorpay Payment Gateway Invocation Fix

> **Branch:** `docker-desktop-build`  
> **Target:** `docker-desktop-build` (GCP Docker migration & Local Docker Desktop)  
> **Status:** Complete & verified (Local Docker Desktop + Staging Firebase Hosting verified green)  

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `docker-desktop-build` |
| **Status** | Complete & verified |
| **Pre-Push Gates** | Parameterisation gate green, 539 Vitest unit files (9,380 tests) passed, 311 contract test files (5,556 tests) passed, 17/17 local smoke tests passed |
| **Active Focus** | Fix Razorpay checkout modal failure: "Payment failed / Network error. Please check your internet connection and try again" |

---

## 2. What Was Accomplished

1. **Fixed Razorpay Key Mismatch in `deployment/env/.env.local`**:
   - Synchronized `VITE_RAZORPAY_KEY_ID=rzp_test_TLPTaWASakiuJK` to match `RAZORPAY_KEY_ID=rzp_test_TLPTaWASakiuJK`. Previously, `VITE_RAZORPAY_KEY_ID` was set to an invalid/expired key (`rzp_test_1g0k6q3Q7X8Z2A`), causing Razorpay's API to reject preference requests with HTTP 401 Unauthorized.
2. **Added Runtime Config Resolution for `RAZORPAY_KEY_ID`**:
   - Updated `src/lib/paymentConfig.js` to inspect `window.__DATIQ_RUNTIME__?.razorpayKeyId` before falling back to `import.meta.env.VITE_RAZORPAY_KEY_ID`.
   - Updated `deployment/scripts/gen-local-config.mjs` to export `razorpayKeyId` in the generated `runtime-config.js` served dynamically by the trackers container.
   - Declared `razorpayKeyId: ""` in `public/runtime-config.js`.
3. **Enhanced Diagnostics in `fetchSafe`**:
   - Added `console.warn` diagnostic logging in `src/lib/paymentService.js` on fetch failures to log the endpoint, attempt number, and error details to the browser console.
4. **Environment Contract & Documentation Parity**:
   - Documented and added `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `deployment/env/.env.staging.example` and `deployment/env/.env.prod.example` adhering to Rule 2 of deployment standards (`[purpose] · [how to obtain] · DO / DON'T` comments above value lines).
   - Populated `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in `deployment/env/.env.staging`.
   - Fixed missing leading `e` in `SUPABASE_ANON_KEY` in `deployment/env/.env.staging`.
   - Populated matching test credentials in repo-root `.env`.
5. **Rebuilt & Redeployed**:
   - Rebuilt and restarted the local Docker Desktop stack (`./deployment/scripts/up.sh`) — all 17 smoke tests green.
   - Deployed updated web payload and runtime configuration to staging Firebase Hosting (`./deployment/scripts/gcp/deploy-hosting.sh staging`).

---

## 3. Root Cause Analysis

### Symptom
When clicking "Get Pro" → "Proceed to payment" on `/pricing`:
```
Payment failed
Network error. Please check your internet connection and try again.
```

### Technical Root Causes
1. **Key Mismatch in Local Docker Stack**:
   - The backend container created an order with merchant ID `rzp_test_TLPTaWASakiuJK` via `/api/create-checkout`.
   - The frontend bundle was baked with `VITE_RAZORPAY_KEY_ID=rzp_test_1g0k6q3Q7X8Z2A`.
   - When the Razorpay SDK opened, Razorpay's API (`https://api.razorpay.com/v1/standard_checkout/preferences`) returned `401 Unauthorized` because the key did not match the merchant who generated the order.
2. **Missing Runtime Config Override in `paymentConfig.js`**:
   - `src/lib/paymentConfig.js` only checked `import.meta.env.VITE_RAZORPAY_KEY_ID`. Unlike `src/lib/config.js`, it did not read `window.__DATIQ_RUNTIME__`, so dynamic per-deployment keys could not be overridden without a full image rebuild.
3. **Missing Backend Variables in Staging Env & Examples**:
   - `deployment/env/.env.staging` had `VITE_RAZORPAY_KEY_ID` but was missing `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
   - `.example` files lacked the documented keys, violating deployment standards.
4. **Vite Dev Proxy Default Target**:
   - In `vite.config.js`, the dev proxy forwarded `/api` to port 9999 (Netlify functions dev) by default. When developers ran `npm run dev` against the local Docker gateway on port 8080 without setting `FUNCTIONS_DEV_PORT=8080`, `/api` was unreachable, triggering `fetchSafe`'s network error fallback.

---

## 4. Verification Evidence

1. **Parameterisation Gate**:
   - `bash deployment/scripts/check-parameterisation.sh`:
     ```
     ✓ parameterisation gate: no forbidden literals in deployment/ deployables
     ```
2. **Unit Tests**:
   - `npm run test:unit`:
     ```
     Test Files  539 passed (539)
     Tests       9380 passed (9380)
     ```
3. **Contract Tests**:
   - `npm run test:contract`:
     ```
     Test Files  311 passed (311)
     Tests       5556 passed (5556)
     ```
4. **Local Docker Stack (`http://localhost:8080`)**:
   - `./deployment/scripts/up.sh`: 17/17 smoke checks passed.
   - Playwright headless browser test clicked "Get Pro" → "Proceed to payment" on `http://localhost:8080/pricing`:
     - Gateway `/api/create-checkout` returned HTTP 200 with new `order_id`.
     - Razorpay SDK loaded and launched iframe.
     - `iframe.razorpay-checkout-frame` present: `true`.
     - Zero 401 errors on `api.razorpay.com`.
5. **Staging Firebase Hosting (`https://datiq-vsp-fhs-stg.web.app`)**:
   - `./deployment/scripts/gcp/deploy-hosting.sh staging` completed cleanly.
   - Playwright headless browser test on `https://datiq-vsp-fhs-stg.web.app/pricing`:
     - Order created and Razorpay checkout initialized.
     - `iframe.razorpay-checkout-frame` present: `true`.
     - Payment portal cleanly opened in test mode with UPI/Cards/Netbanking options.

---

## 5. Files Modified

| File | Change Description |
|---|---|
| `src/lib/paymentConfig.js` | Read `window.__DATIQ_RUNTIME__?.razorpayKeyId` with fallback to `VITE_RAZORPAY_KEY_ID`. |
| `src/lib/paymentService.js` | Add `console.warn` diagnostic logging in `fetchSafe` catch block. |
| `public/runtime-config.js` | Declare `razorpayKeyId: ""` contract property. |
| `deployment/scripts/gen-local-config.mjs` | Export `razorpayKeyId` in rendered `runtime-config.js`. |
| `deployment/env/.env.local` | Set `VITE_RAZORPAY_KEY_ID=rzp_test_TLPTaWASakiuJK` matching `RAZORPAY_KEY_ID`. |
| `deployment/env/.env.staging` | Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; fix `SUPABASE_ANON_KEY` typo. |
| `deployment/env/.env.staging.example` | Document server-side Razorpay keys per Rule 2. |
| `deployment/env/.env.prod.example` | Document server-side LIVE Razorpay keys per Rule 2. |
| `.env` | Synchronize test Razorpay keys in repo root. |
