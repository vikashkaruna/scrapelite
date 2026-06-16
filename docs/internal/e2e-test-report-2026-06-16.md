# DatIQ E2E Test Report — 2026-06-16

**Branch:** `claude/firecrawl-fallback-analysis-qyksr4`  
**Test run:** 2026-06-16  
**Tool:** Playwright (Chromium)  
**Server:** `npm run dev` → http://localhost:5173  
**Result: 89 passed, 0 failed**

---

## Test coverage

### Home page (/)
- H1 headline renders
- URL input and Extract button present
- FAB "Bulk import" button present and correctly labelled
- 5 intent chips visible: AI summary / Find contacts / Scrape pricing / Map site / Custom
- First chip (AI summary) active by default
- 8 capability cards rendered
- No inline multi-URL textarea on Home (removed in R15)
- TopBar nav links: Extract / Batch / Dashboard (correct order)
- TopBar brand name "DatIQ" and tagline "Intelligence from every URL"
- Footer slim single-row present

### FAB → /batch navigation
- FAB click navigates directly to /batch page (not BulkUploadModal)

### OG preview card
- Debounce logic fires on URL input (API unavailable in dev mode without Netlify Functions — expected)

### Intent chip interaction
- Custom chip reveals custom extraction textarea
- Map site chip shows domain mapping notice
- Switching chips updates active state correctly

### Home validation
- Invalid URL shows validation error inline

### Batch page (/batch)
- Heading renders
- 4 intent chips visible (AI summary / Find contacts / Scrape pricing / Custom)
- URL textarea present
- URL count badge updates correctly (`.batch-url-count`)
- Import CSV tab accessible via `.batch-tab` button

### Batch draft persistence
- Entering URLs and navigating away then back → textarea retains content (via `datiq.batchDraft` localStorage)
- Verified: `https://example.com\nhttps://test.com` survived round-trip navigation

### Dashboard page (/dashboard)
- Heading "Your extractions" renders
- Table/card layout toggle present
- Export dropdown: only shown when items exist — correct empty state behaviour
- Batch runs dropdown button present
- Batch runs dropdown menu opens **left-aligned** (`left: 0`), bounding box x=596.8125 (on-screen)
- Batch runs menu left edge aligns with button within 10px tolerance
- Refresh button present
- New extraction button present
- Empty state (`.empty-state`) shown when no data
- Search box hidden in empty state (correct — only shown when items exist)

### Pricing page (/pricing)
- 7 plan cards: Free / Select / Pro / Business / Agency / Developer / Enterprise
- Annual/monthly billing toggle present
- Enterprise card (dashed border) present
- Developer "Coming soon" card present
- Plan card hover state captured in screenshot

### Account page (/account)
- Heading "Your plan & usage" renders
- "Batch executions" counter row visible
- "Content generations" counter row visible

### Contact page (/contact)
- 7 enquiry type buttons present
- `/contact?type=bug` pre-fills subject field with "Bug report: " via `#contact-subject`

### About page (/about)
- Founder block: "Vikash Karuna" visible
- Hero text does NOT say "powered by DatIQ" (copy bug fixed)

### Blog page (/blog)
- Blog post cards visible
- Clicking `.blog-card-clickable` opens `.blog-modal-overlay` (PostModal)

### Privacy page (/privacy)
- DPDP Act 2023 content present in page HTML
- References `datiq.app` (not `scrapelite.netlify.app`)

### Terms page (/terms)
- References "Arbitration and Conciliation Act"
- References "Bengaluru" as seat

### Use cases page (/use-cases)
- 4 `.uc-hub-card` cards present
- `/use-cases/lead-generation` subpage renders

### VS comparison pages
- `/vs/browse-ai` renders with correct heading
- `/vs/clay` contains "$19/month" CTA text

### Integrations page (/integrations)
- Cards visible

### Onboarding page (/onboarding)
- Rendered inside Shell (TopBar `.topbar-inner` visible)

### Payment cancel page
- "No charge was made" message present

### TopBar Explore dropdown
- Opens on click
- Contains: "About DatIQ" (Company section), "Contact Us", "Compare Tools"

### Auth modals
- "Sign in" button opens AuthModal in sign-in mode

### Mobile nav (<600px)
- Hamburger button visible at 375px width
- Nav panel slides down on hamburger click

### Theme toggle
- Button present
- Toggles between light/dark (persists to `data-theme` attribute)

### Footer
- Slim single-row `.site-footer-slim` present
- Privacy and Terms links present as `.footer-nav-link` buttons

### Route redirects
- `/help/index.html` returns HTTP 200
- `/compare` redirects to `/vs/browse-ai`

### Admin page (/admin)
- PIN input present
- ADMIN123 dev fallback logs in (server function unavailable in `npm run dev` — correct degraded behaviour)
- Admin sidebar (`.admin-layout`) visible after login
- `/admin/pricing`, `/admin/coupons`, `/admin/users` all load correctly

---

## Known limitations / environment notes

| Limitation | Reason | Impact |
|---|---|---|
| OG preview card not shown | `/api/og-preview` Netlify Function unavailable in `npm run dev` | No user impact in production |
| Admin uses dev fallback PIN | `/.netlify/functions/admin-auth` unavailable without `netlify dev` | Production uses server-verified PIN; ADMIN123 rejected unless no ADMIN_PIN_HASH set |
| Real batch extraction not tested | Requires Firecrawl/Spider/Jina API keys | Extraction chain tested separately via provider unit tests |
| Batch Export dropdown not verified | Only shown after results; can't run real batch in CI | UI structure verified via code inspection |
| Social proof section not shown | Supabase not configured in dev; stats return null | Correct behaviour — section hidden when data unavailable |

---

## Screenshots

All 37 screenshots captured in `e2e-screenshots/` (not committed — generated on-demand).

| File | Screen |
|---|---|
| 01-home.png | Home page |
| 02-home-fab-to-batch.png | After FAB click → /batch |
| 03-home-og-preview.png | OG preview area |
| 04-home-custom-chip.png | Custom intent chip active |
| 05-batch-page.png | Batch page |
| 06-batch-draft-persisted.png | Batch textarea with restored draft |
| 07-batch-csv-tab.png | Batch CSV import tab |
| 08-dashboard.png | Dashboard empty state |
| 09-dashboard-empty.png | Dashboard export area (empty) |
| 10-dashboard-batch-runs-dropdown.png | Batch runs dropdown left-aligned |
| 11-pricing.png | Pricing page (7 plans) |
| 12-pricing-plan-hover.png | Plan card hover state |
| 13-account.png | Account & usage page |
| 14-contact.png | Contact form |
| 15-contact-bug.png | Contact pre-filled for bug report |
| 16-about.png | About page with founder block |
| 17-blog.png | Blog listing |
| 18-blog-post-modal.png | Blog post modal overlay |
| 19-privacy.png | Privacy page |
| 20-terms.png | Terms page |
| 21-use-cases.png | Use cases hub |
| 22-uc-lead-gen.png | Lead gen use case page |
| 23-vs-browse-ai.png | DatIQ vs Browse.ai |
| 24-integrations.png | Integrations catalog |
| 25-onboarding.png | Onboarding (inside Shell) |
| 26-payment-cancel.png | Payment cancelled page |
| 27-topbar-explore-dropdown.png | TopBar Explore dropdown |
| 28-auth-modal-signin.png | Sign-in auth modal |
| 29-mobile-home.png | Home at 375px viewport |
| 30-mobile-nav-open.png | Mobile nav panel open |
| 31-theme-toggled.png | Dark mode active |
| 32-footer.png | Footer slim single-row |
| 33-admin-login.png | Admin PIN gate |
| 34-admin-dashboard.png | Admin revenue dashboard |
| 35-admin-pricing.png | Admin pricing editor |
| 36-admin-coupons.png | Admin coupon manager |
| 37-admin-users.png | Admin user table |

---

## Bugs found and fixed this session

| Bug | Fix | File |
|---|---|---|
| `waitUntil: "networkidle"` hanging with Vite HMR | Changed to `domcontentloaded` + 600ms wait | `e2e-test.mjs` |
| URL count badge selector wrong | Changed to `.batch-url-count` | `e2e-test.mjs` |
| CSV tab text "Upload CSV" vs "Import CSV" | Fixed to match `button.batch-tab` text | `e2e-test.mjs` |
| Dashboard export dropdown timeout | Only shown when `hasItems` — wrapped in visibility check | `e2e-test.mjs` |
| Dashboard empty state class `.dash-empty` | Changed to `.empty-state` | `e2e-test.mjs` |
| Contact bug subject selector | Fixed to `#contact-subject` | `e2e-test.mjs` |
| Blog PostModal selector | Fixed to `.blog-modal-overlay` | `e2e-test.mjs` |
| Privacy DPDP locator | Changed to HTML content check | `e2e-test.mjs` |
| Use cases card class `.uc-card` | Changed to `.uc-hub-card` | `e2e-test.mjs` |
| Mobile viewport API | Changed from `ctx.setViewportSize` to `page.setViewportSize` | `e2e-test.mjs` |
| Footer Privacy/Terms links | Links are `<button>` not `<a>` — fixed selector to `.footer-nav-link` | `e2e-test.mjs` |
| Admin sidebar class | Changed from `.admin-sidebar` to `.admin-layout` | `e2e-test.mjs` |

---

## How to re-run

```bash
cd /home/user/scrapelite
npm run dev &          # must be running on port 5173
node e2e-test.mjs
```

Report JSON: `e2e-screenshots/report.json`
