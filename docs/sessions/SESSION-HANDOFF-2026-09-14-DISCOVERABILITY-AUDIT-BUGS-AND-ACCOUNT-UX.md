# Session Handoff — 2026-09-14 — DISCOVERABILITY-AUDIT-BUGS-AND-ACCOUNT-UX

> **Branch:** `fix_discoverability_audit_bugs` → merged into `staging`  
> **Target:** `staging`  
> **Status:** Complete & 100% verified  
> **Verification:** vitest 432 files / 6,919 passed (100% green); db-verify 74 migrations / 833 assertions passed; referral 17 passed; workflows 56 passed; prerender 28 pages verified; build clean (1.38s).

---

## 1. Quick Orientation

| Property | Value |
|---|---|
| **Date** | 2026-09-14 / 2026-09-15 |
| **Branch** | `fix_discoverability_audit_bugs` (merged to `staging`) |
| **Base SHA** | `7545a0f` |
| **Status** | Complete & verified |
| **Test Suites** | 432 / 432 files passed (6,919 / 6,919 tests green) |
| **Database Migrations** | 74 migrations applied (`0074_single_founder_approval.sql`) |
| **Active Focus** | Resolving 504 timeout on mobile crawl audits, competitor limit expansion to 20 with smart input, discoverability navigation stabilization & closed-loop operating ribbon, Account page 2-column overhaul, and platform workflow fixes. |

---

## 2. What Was Accomplished

- **504 Mobile Crawl Timeout**: Capped synthetic PageSpeed Insights (`vitalsSlice`) to 3.5s in `netlify/functions/lib/audit/auditPipeline.js`, ensuring PageSpeed finishes or degrades gracefully so database persistence can complete well within function timeouts. Removed invalid `functions.timeout = 26` from `netlify.toml` which caused Netlify configuration parse error.
- **Competitors Expansion & Smart Intake**:
  - Increased `MAX_COMPETITOR_URLS = 20` in `src/lib/discoverability/intakeModel.js`.
  - Upgraded `src/components/discoverability/AuditComposer.jsx` with smart input supporting CSV paste, commas, semicolons, multiline URLs, and company name conversions (e.g. `Acme Corp` → `https://acmecorp.com`), while reporting invalid URL schemes in `rejected`.
- **Navigation & Tab Stability**:
  - Unified `UNIFIED_DISCOVERABILITY_NAV` across `src/pages/Discoverability.jsx` and `src/pages/DiscoverabilityWorkspace.jsx`, eliminating layout jumping and reordering when switching between Audit, Business Truth, Entity Graph, Schema & Trust, SXO & Outcomes, Subject Scores, Local Directory, and History.
- **Closed-Loop Operating Ribbon**:
  - Built `src/components/discoverability/ClosedLoopRibbon.jsx` rendering the 8-step cycle (`Discover → Score → Diagnose → Recommend → Implement → Validate → Benchmark → Expand`) across all discoverability screens.
- **Audit Context & High-Res Logos**:
  - Integrated Google favicon and schema logo fetching (`FaviconOrLogo`) in `src/components/discoverability/AuditHeader.jsx` and preserved active audit context banners across workspace views.
- **Consolidated Export Dropdown**:
  - Replaced scattered buttons with `AuditExportMenu` dropdown matching Dashboard/Preview format; styled Audit History prominently (`variant="secondary"`); added direct Email action alongside the dropdown.
- **Branded Loader**:
  - Replaced "Re-auditing…" text with `BrandLoader` ("Loading audit report…").
- **SXO & Outcomes**:
  - Handled score variant keys (`scores.seo`, `frameworkScores`, `result.seo_score`) in `src/components/discoverability/SxoDashboard.jsx` to ensure composite master scores render reliably. Added interactive re-evaluation button with busy spinner.
- **Single-Founder Self-Approval**:
  - Added migration `supabase/migrations/0074_single_founder_approval.sql` allowing solo founders to approve proposals with audit-trail recording (`[Single-founder approval]`).

### Area 2: Your Plan & Usage (`Account.jsx`) 2-Column Overhaul
Reorganized `src/pages/Account.jsx` into the clean 2-column structure requested:
- **Left Column**: Account Details (Full name, email, phone, member since) → Brand Kit → Advanced PDF Background → Integrations → Invoices & Receipts → Danger Zone.
- **Right Column**: Explore Plans CTA → Current Plan → Offers → Coupons → Usage This Month → Agency Plan Features → Usage Alerts → Discoverability Stats → Usage by Role → Quick Stats → Workflow Runs.

### Area 3: Workflow Templates & Runs
- **Domain Normalization**: In `src/pages/Templates.jsx`, stripped protocols and paths so URLs like `https://datiq.app` resolve cleanly without failure.
- **Progress Dock Auto-Dismiss**: `src/components/ExtractionProgressDock.jsx` auto-dismisses completed extraction jobs after 4 seconds.
- **Run History**: Added `localStorage` caching (`datiq.workflowRuns`) for instant zero-flash load, auth state resolution listener, ExportMenu in header, and fixed table column widths in `src/components/WorkflowRunHistory.jsx`.
- **Sticky Actions Alignment**: Wrapped `.wrp-sticky-bar` in `.container.wrp-bar-inner` in `src/pages/WorkflowRunPreview.jsx`.

### Area 4: Account Intelligence Lists (`Lists.jsx`) & Bulk Enrichment
- **100% Failure Rate Fixed**: In `netlify/functions/lib/bulkEnrich.js`, fixed response parsing (`scraped?.html || scraped?.data?.html`), restoring list bulk enrichment.
- **UI Improvements**: Expanded list textarea dialog to 100% width (`.dli textarea`) and wired progress events (`datiq:listenrichment`) to `ExtractionProgressDock`.

### Area 5: Competitor Watchlists (`Watchlists.jsx`)
- Rendered rich baseline competitive landscape analysis on first scan when targets are monitored rather than "no material change detected".

### Area 6: Signal Rules & Integrations
- **Signal Rules Caching**: Added optimistic local state caching on create and delete in `src/pages/SignalRules.jsx`.
- **Integrations Catalog**: Marked Slack, Airtable, Notion, and HubSpot as Available; sorted catalog: Available → Beta (Zapier) → Roadmap (Salesforce, Extension).

---

## 3. Root Cause Analysis

1. **504 Mobile Crawl Timeout**:
   - **Symptom**: `Discoverability POST /audits failed (504)` on `https://datiq.app` when device profile was set to "mobile crawl".
   - **Root Cause**: Mobile Lighthouse PageSpeed Insights queries can take 8–15s on synthetic emulators. When CrUX field cache missed, PSI exceeded Netlify's 10-second default function execution timeout before DB persistence could finish.
   - **Resolution**: Clamped `vitalsSlice` to 3,500ms in `auditPipeline.js` (CrUX field data answers in ~1.5s; slow synthetic lab runs degrade to `unmeasured` rather than timing out the function). Removed invalid `functions.timeout = 26` from `netlify.toml` which caused Netlify TOML parse error.

2. **Bulk Enrichment 100% Failure**:
   - **Symptom**: Bulk enriching lists of domains failed 100% of the time.
   - **Root Cause**: `bulkEnrich.js` expected `scraped.html` directly, but Firecrawl returns `{ data: { html } }` or `{ html }`.
   - **Resolution**: Updated parser to `scraped?.html || scraped?.data?.html` and robustly extracted title and text.

---

## 4. Verification Evidence

- `npm test`: **432 / 432 test files passed**, **6,919 / 6,919 tests green** (100%).
- `npm run test:db`: **74 migrations applied**, **833 assertions passed** (0 failed).
- `npm run verify:referral`: **17 assertions passed**.
- `npm run verify:workflows`: **56 assertions passed**.
- `npm run prerender`: **28 pages rendered and written cleanly**.
- `npm run build`: **Built with Vite in 1.38s with 0 errors**.

---

## 5. Operator Deployment Tasks & Next Steps

- [ ] Apply migration `supabase/migrations/0074_single_founder_approval.sql` on staging/production Supabase.
- [ ] Netlify deployment will automatically build from `staging`.
- [ ] Verify Discoverability mobile crawl audit against `https://datiq.app` on staging environment.
