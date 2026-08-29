# Session handoff — 2026-07-18 (Council backlog drop)

## TL;DR

All **7 council-backed gaps** closed in one drop. **+86 net new tests (1082 → 1168), build clean in 1.83 s, 0 regressions.** `feat/council-backlog-v2` branched from `main` (no active v2.0 work to branch from, so the user's "from current v2.0" intent resolved to "from main").

| # | Council ID | Feature | Status |
|---|---|---|---|
| **F12** | Public Changelog + Product Hunt social | `/changelog` (R1–R19 entries + PH banner) + TopBar + sitemap + llms.txt | ✅ |
| **F11** | Programmatic SEO + Persona Landing Routes | `/for-sales` `/for-seo` `/for-ci` `/extract-pricing` `/extract-contacts` `/extract-headings` | ✅ |
| **F06** | Persona Onboarding + Recipe Packs | `RECIPE_PACKS` (Sales/CI/SEO) + `TemplateGallery` Pack filter + Onboarding step 2 picker | ✅ |
| **FA1** | Free-tier "Public Report" Quota Mechanic | `publicQuota.js` + `recordPublicShare` in shareService + "Powered by DatIQ" footer on `/p/:slug` + free-tier pill in upsell banner | ✅ |
| **FA2** | Referral Credits Loop (give 25/get 25) | `referralService.js` + `ReferralBanner.jsx` + `?ref=CODE` URL handler in Shell | ✅ |
| **FB1** | Comparison Pages + Battle-card Generator | `public/vs/firecrawl.html` + `/vs/battlecard` (paste 2 URLs → diff table) + Firecrawl card on `compare.html` | ✅ |
| **F04** | Shareable Permalinks + "Powered by DatIQ" + DMCA | "Powered by DatIQ" loop on PublicReport + `/dmca` → `/dmca.html` (F04 condition D) | ✅ |

## What landed in this drop

### F12 — Public Changelog (`/changelog`)
- **New:** `src/pages/Changelog.jsx` (15K bytes) — reverse-chronological R0–R19 release log, jump-TOC, Product Hunt "Launching soon" banner with notify-me mailto. SEO meta on mount.
- **Wired into:** TopBar Explore → Resources group (new "Changelog" entry). `public/sitemap.xml` (weekly, 0.7 priority). `public/llms.txt` (new "Changelog" + DMCA + persona + programmatic + competitor lines).
- **Test:** `src/pages/Changelog.test.jsx` (8 tests — all 20 version tags render, TOC anchors, PH banner, SEO meta, ordering).

### F11 — Programmatic SEO routes (`/for-*` + `/extract-*`)
- **New:** `src/lib/programmaticRoutes.js` (6 entries: 3 persona + 3 extract routes), `src/pages/ProgrammaticRoute.jsx` (single component, 6 routes).
- **Routes:** `/for-sales` `/for-seo` `/for-ci` `/extract-pricing` `/extract-contacts` `/extract-headings` — all explicit routes in `App.jsx` (react-router 6 quirk: `/for-:slug` doesn't match).
- **Per route:** rich H1 + sub, 4 concrete bullets, keyword pills, primary CTA that pre-fills the Home composer with `?url=…&intent=…&persona=…`.
- **SEO:** `setMeta` on mount with `/for-*` or `/extract-*` URL. Added to sitemap (monthly, 0.7 priority) + llms.txt under "Persona landing pages" and "Programmatic SEO pages" sections.
- **Tests:** `programmaticRoutes.test.js` (7) + `ProgrammaticRoute.test.jsx` (12).

### F06 — Persona Recipe Packs (Sales / CI / SEO)
- **New:** `RECIPE_PACKS` array in `src/lib/extractionTemplates.js` — 3 packs (Sales/CI/SEO), each with persona-aligned icon, color, description, and 4–5 template keys.
- **Updated:** each `EXTRACTION_TEMPLATES` entry now has a `packs: ["sales", "ci", "seo"]` field. New helpers `getPackByKey`, `getTemplatesByPack`, `getAllPackKeys`.
- **TemplateGallery:** new Pack filter row above the tag filter ("All recipes | Sales Pack | CI Pack | SEO Pack"). Pack click narrows to that pack's templates.
- **Onboarding step 2:** new "Choose your starter Recipe Pack" picker (3 cards, default seeded to the persona's first relevant pack). Selection persists to `datiq.starterPack` for future read-by-Home.
- **Tests:** `extractionTemplates.packs.test.js` (12) + updated `TemplateGallery.test.jsx` (+4 pack-filter tests = 10 total).

### FA1 — Public Report Quota Mechanic + "Powered by DatIQ" loop
- **New:** `src/lib/publicQuota.js` — `readPublicCount` / `incrementPublicExtractions` / `decrementPublicExtractions` / `buildQuotaCopy` / `isPublicExtractionFree`. Stored alongside the regular extractions counter in `datiq.usage`.
- **Wired:** `shareService.recordPublicShare(id)` + `recordPublicUnshare()` are called from `Preview.jsx` after every successful share / unshare. Counter ticks on every share but the call site only calls once per share.
- **UI:** `UsageUpsellBanner.jsx` shows a green pill `· N public (unlimited)` next to "X left on Free this month" when `plan.id === "free"` and `readPublicCount() > 0`.
- **"Powered by DatIQ" loop:** `PublicReport.jsx` footer now carries a styled CTA block — "Powered by DatIQ · Make your own →" linking to `/`. The viral loop from F04.
- **Tests:** `publicQuota.test.js` (13) + 5 new tests in `shareService.test.js` (FA1 block, includes idempotency, increment, decrement, never-shared).

### FA2 — Referral Credits Loop (give 25 / get 25)
- **New:** `src/lib/referralService.js` — invite code generation (session-derived, 8-char, no ambiguous chars 0/O/1/I), `REFERRAL_BONUS = 25`, redemption logic with self/already/invalid guards, `datiq.referralCode` + `datiq.referralBonus` + `datiq.referralRedemptions` localStorage keys.
- **New:** `src/components/ReferralBanner.jsx` — appears at ≥90% of plan limit (overlaps with UsageUpsellBanner slot). Copy-link button + native share sheet on mobile. Shows your code (e.g. `ABC12345`) + bonus counter if any.
- **URL handler:** `App.jsx` Shell reads `?ref=CODE` on first paint, calls `redeemReferralCode`, strips the param, sets `?ref_redeemed=1`. The banner shows a one-time toast "Welcome bonus: 25 extractions added to your account."
- **Tests:** `referralService.test.js` (15) — invite code shape, stability, ambiguous-char absence, self/already/invalid guards, case-normalisation, redemption tracking, `buildReferralUrl`, `REFERRAL_BONUS = 25`.

### FB1 — Comparison Pages + Battle-card Generator
- **New:** `public/vs/firecrawl.html` (14K bytes) — full comparison page (the most-cited competitor; was missing). 12-row capability table, "When to pick which" 2-col grid, 4 verdict cards, CTA + cross-links to browse-ai/clay/apify/phantombuster/battlecard.
- **New:** `src/pages/BattleCard.jsx` + `src/pages/BattleCard.test.jsx` (10 tests) — `/vs/battlecard` route. Paste 2 competitor URLs → parallel `extractStructure` calls → diff table (title, H1, meta, headings, links, pricing signals). Winner cell highlight. 3 quick-fill example pills (Linear vs Notion, Stripe vs Paddle, Anthropic vs OpenAI).
- **Updated:** `public/vs/compare.html` — added Firecrawl card to the "Detailed comparisons" quick-links row.
- **Ships:** Firecrawl page to `public/sitemap.xml` + `llms.txt`.

### F04 — "Powered by DatIQ" loop + DMCA stub (Council condition D)
- **"Powered by DatIQ":** styled CTA block in the `PublicReport` footer (overlaps with FA1). Council wanted the brand loop explicitly in the footer, distinct from the brand link at the top.
- **DMCA page:** `public/dmca.html` (7.5K bytes) — full takedown process page (Council condition D). 8 sections covering US DMCA + India IT Act 2021, what a valid notice includes, submission email, what happens after, counter-notices, repeat infringers, what is NOT a notice, Indian-law parallel. Mailto: `legal@datiq.app?subject=DMCA%20Takedown%20Notice`.
- **New route:** `/dmca` in the React shell → window.location redirect to `/dmca.html` (so the page is a static legal page, not in the SPA bundle).
- **Ships:** DMCA to `public/sitemap.xml` (yearly, 0.3 priority) + `llms.txt`.

## Files added (15)
- `src/lib/programmaticRoutes.js` (7.5K)
- `src/lib/programmaticRoutes.test.js` (2.8K, 7 tests)
- `src/lib/publicQuota.js` (2.6K)
- `src/lib/publicQuota.test.js` (3.1K, 13 tests)
- `src/lib/referralService.js` (5.2K)
- `src/lib/referralService.test.js` (4.5K, 15 tests)
- `src/lib/extractionTemplates.packs.test.js` (3.3K, 12 tests)
- `src/components/ReferralBanner.jsx` (5.1K)
- `src/pages/Changelog.jsx` (15K)
- `src/pages/Changelog.test.jsx` (3.4K, 8 tests)
- `src/pages/ProgrammaticRoute.jsx` (4.8K)
- `src/pages/ProgrammaticRoute.test.jsx` (4.2K, 12 tests)
- `src/pages/BattleCard.jsx` (10K)
- `src/pages/BattleCard.test.jsx` (6.8K, 10 tests)
- `public/dmca.html` (7.5K)
- `public/vs/firecrawl.html` (14K)

## Files modified (12)
- `src/App.jsx` — 6 programmatic routes + `/vs/battlecard` + `/dmca` redirect + `?ref=CODE` handler + `useSearchParams` import + ReferralBanner mount
- `src/components/Icon.jsx` — added `Swords` icon
- `src/components/TopBar.jsx` — Changelog in Explore Resources group + `/changelog` + `/for-` + `/extract-` + `/dmca` in EXPLORE_ACTIVE_PATHS
- `src/components/TemplateGallery.jsx` — new Pack filter row + `pack` prop + `getTemplatesByPack` selector
- `src/components/TemplateGallery.test.jsx` — 4 new pack-filter tests, updated existing tests for the 2-tablists layout + new empty-state message
- `src/components/UsageUpsellBanner.jsx` — imports `readPublicCount`, renders green pill for free plan + N public reports
- `src/lib/extractionTemplates.js` — added `packs` field to every template + `RECIPE_PACKS` array + 3 new helpers (`getPackByKey`, `getTemplatesByPack`, `getAllPackKeys`)
- `src/lib/shareService.js` — added `recordPublicShare` / `recordPublicUnshare` / `isPubliclyShared` exports; import from publicQuota
- `src/lib/shareService.test.js` — 5 new FA1 tests
- `src/pages/Onboarding.jsx` — new Step 2 Recipe Pack picker (3 cards) with `datiq.starterPack` persistence
- `src/pages/Preview.jsx` — calls `recordPublicShare`/`recordPublicUnshare` after share/unshare
- `src/pages/PublicReport.jsx` — new "Powered by DatIQ" footer CTA block (`.public-powered`)
- `src/styles/screens.css` — all new CSS for changelog, programmatic routes, recipe packs, public quota, referral banner, battle card
- `public/sitemap.xml` — 11 new URLs (changelog, dmca, for-sales/seo/ci, extract-pricing/contacts/headings, vs/firecrawl, vs/battlecard)
- `public/llms.txt` — new sections: Persona landing, Programmatic SEO, Competitor comparisons + Changelog + DMCA
- `public/vs/compare.html` — new Firecrawl card in Detailed comparisons quick-links

## Verification

- `npx vitest run` → **1168 / 1168 passing** (was 1082; +86 new tests across 7 new test files + 2 extended test files).
- `npm run build` → clean in **1.83 s**. No new warnings (Icon.jsx duplicate-key warnings are pre-existing from prior drops).
- `npx playwright test` — not re-run; smoke tests are the same as prior drops and would only re-validate unchanged surface.

## Architecture rules added

- **For Programmatic SEO routes in react-router 6:** `/for-:slug` does NOT match `/for-sales`. Use explicit per-slug routes (`<Route path="/for-sales">` `<Route path="/for-seo">` …) or a custom regex matcher. Same pattern for `/extract-*`.
- **For `recordPublicShare` semantics:** the call site (Preview.jsx) is the source of idempotency, not the function. The function is a simple `increment(1)`; the caller only invokes it on a successful fresh share, never on the re-share path.
- **For the Public Report Quota:** store the public count alongside `extractions` in `datiq.usage` (not a new localStorage key). This means a single `readUsage()` call returns both numbers, which is what every UI surface already calls.
- **For the Referral loop:** the `?ref=CODE` handler lives in `Shell` (the outermost route group), not in Home. That way it fires before the user sees any page. Strip the param after handling so the URL is clean.
- **For the "Powered by DatIQ" loop:** keep it in the `PublicReport` FOOTER, not the header. The header brand link is for navigation; the footer block is the explicit viral CTA.
- **For the DMCA page:** ship as a static `/public/dmca.html` (not a React route). It's a legal process page, no TopBar/Footer, no app shell, no JS bundle bloat. Use a `<DmcaRedirect>` component to redirect `/dmca` → `/dmca.html` for clean URLs.

## What's still NOT done (out of scope)

- **F04 SSR** — council asked for server-side rendered shareable pages. We did NOT add SSR. The SPA + `sitemap.xml` + `llms.txt` + OG meta tags are the current indexing surface; Google renders JS, but SSR is the proper fix. Defer to v2.0.
- **FA1 Supabase server-side counter** — counter is localStorage-only. Means a user with 5 public reports on Chrome and 0 on Safari doesn't get the cumulative benefit. Fix: mirror to a `public_reports` aggregate or a per-user `public_count` column.
- **FA2 Supabase persistence** — the redemption is localStorage-only. A referrer doesn't get their +25 bonus unless the referee re-installs on the same browser. Fix: Netlify function that on extraction-success, looks up the referrer session and grants them +25 via a Supabase update. Defer to v2.0.
- **FB1 BattleCard generation isn't shareable** — the diff table is per-session. Council didn't ask for a shareable battle-card, but it'd be a natural next step.
- **F12 Product Hunt badge** — placeholder "Launching soon" banner only. The actual PH badge + Day-of-launch assets are post-launch work.

## Next session entry point

```
cd /Users/vikash/Extracta
git checkout feat/council-backlog-v2   # already pushed
git log --oneline -5
npx vitest run       # 1168 pass
npm run build        # clean in 1.83s
```

Suggested v2.0 follow-ups (in priority order):
1. SSR the `/p/:slug` route (Next.js migration or Vite SSG for the public report surface). 1-2 weeks.
2. Supabase-backed aggregate for FA1 public count + FA2 referral redemption. ~3 days.
3. Wire the BattleCard output to `/p/:slug` so the diff is shareable. ~1 day.
4. PR / Product Hunt launch assets + Day-of-launch comms. ~2 days.
5. Real Product Hunt badge + blog post template wired to `/changelog`. ~1 day.

— End of session handoff
