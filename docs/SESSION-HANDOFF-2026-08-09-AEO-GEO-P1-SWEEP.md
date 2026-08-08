# DatIQ — AEO/GEO/SEO P1 sweep (post P0 ship)
**Date:** 2026-08-09
**Branch:** `feat/aeo-geo-seo-p1-sweep` (off `staging` at `cdd1a07` after the contact email consolidation)
**Status:** Code + content complete; awaiting user push to deploy

---

## 1. What was shipped in this session

Eight items from the PR #60 follow-up + the staging AEO/GEO/SEO full ship handoff. Each one is a real change in the local branch.

| # | Item | Status | Files |
|---|---|---|---|
| 0 | Gallery / persona coverage | ✅ 7 curated persona samples added | `public/gallery/index.html` (updated) |
| 1 | 4 use-case detail pages | ✅ All 4 built | `public/use-cases/{lead-generation,competitor-research,seo-audit,market-research}/index.html` |
| 2 | llms-full.txt fix | ✅ 384-line comprehensive version (was: missing) | `public/llms-full.txt` (new) |
| 3a | og-card | ✅ Generated + 19 files updated | `public/og-card.jpg` (new) + 19 meta-tag updates |
| 3b | Brand-collision in llms.txt | ✅ Added DAT iQ freight disambiguation | `public/llms.txt` (updated) |
| 3c | BreadcrumbList JSON-LD | ✅ 11 nested pages | All `public/use-cases/*/index.html` + `public/vs/*` |
| 3d | Search Console submission | ⏳ Operator action — flagged below | — |
| 4 | P2 (Product Hunt, G2, Capterra) | ⏳ Operator action — checklist below | — |
| 5 | Production verify curls | ✅ Run; results below | `docs/SESSION-HANDOFF-2026-08-09-AEO-GEO-P1-SWEEP.md` |
| 6 | AEO/GEO smoke test recipe | ✅ Written below | This doc |
| 7 | Test suite | ✅ 2,807 tests passing | `npm run test:unit && npm run test:contract && ...` |

### Pre-existing warns (unchanged, unrelated to this sweep)
- Screenshot integrity (UI source changed — regenerate via `node docs/capture-screenshots.mjs`)
- Gallery / persona coverage (the audit reads runtime data; static samples are now there but the audit doesn't count them — fix in a follow-up audit pass)

---

## 2. Production verify curls (item 5)

Run from a clean shell against `https://datiq.app` (the live production site, last deployed from `staging` after the AEO/GEO/SEO P0 ship). Items marked **[post-deploy]** are in the local branch and will pass once the branch is pushed to staging.

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | `robots.txt` allows Google-Extended | ✅ `Allow: /` | Gemini grounding enabled per P0.1 policy reversal |
| 2 | Homepage brand count | ✅ 31 | DatIQ mentioned 31× in the SPA shell |
| 3 | `/about/` has h1 | ✅ 1 | Static page shipped in P0.4 |
| 4 | `/what-is-datiq/` has FAQPage JSON-LD | ✅ 1 | Static page shipped in P0.3 |
| 5 | `/faq/` has FAQPage JSON-LD | ✅ 1 | Static page shipped in P0.5 |
| 6 | `/use-cases/lead-generation/` renders | **[post-deploy]** | Currently SPA — will be 8.5KB static page after deploy |
| 7 | `/llms.txt` has DatIQ header | ✅ `# DatIQ: The Unified Web Intelligence Platform` | Live |
| 8 | `/llms-full.txt` returns comprehensive content | **[post-deploy]** | Currently 404s to SPA — will return 17.8KB after deploy |
| 9 | `/og-card.jpg` returns JPEG | **[post-deploy]** | Currently returns HTML shell — will return 372KB JPEG after deploy |
| 10 | `/sitemap.xml` returns valid XML | ✅ 3,291 bytes | Live |

The 4 `[post-deploy]` items are exactly what this branch delivers. After merging to staging + Netlify auto-deploy, the full set will pass.

---

## 3. AEO/GEO smoke test recipe (item 6)

After this branch deploys, verify the actual AI surfaces that matter. Run these prompts on each of ChatGPT (with Browse), Perplexity, Claude (with web search), and Gemini. The expected citation is the canonical DatIQ page.

### Identity prompts (must cite datiq.app)
| Prompt | Expected citation | Brand-collision check |
|---|---|---|
| "What is DatIQ?" | `datiq.app/what-is-datiq` | MUST NOT cite freight DAT iQ (IntelliTrans) |
| "What is DatIQ.app?" | `datiq.app/` or `datiq.app/what-is-datiq` | Same |
| "DatIQ pricing" | `datiq.app/pricing` | OK |
| "DatIQ vs Browse.ai" | `datiq.app/vs/browse-ai` | OK |
| "DatIQ vs Clay" | `datiq.app/vs/clay` | OK |
| "DatIQ vs Firecrawl" | `datiq.app/vs/firecrawl` | OK |
| "DatIQ for sales teams" | `datiq.app/for-sales` | OK |
| "DatIQ for SEO" | `datiq.app/for-seo` | OK |
| "DatIQ for competitive intelligence" | `datiq.app/for-ci` | OK |
| "DatIQ API" | `datiq.app/help/index.html` (Developer API section) | OK |
| "DatIQ changelog" | `datiq.app/changelog` | OK |
| "DatIQ gallery" | `datiq.app/gallery` | OK |

### Use-case prompts (must cite the new detail pages)
| Prompt | Expected citation |
|---|---|
| "How to extract contacts from a company website" | `datiq.app/extract-contacts` OR `datiq.app/use-cases/lead-generation` |
| "How to monitor competitor pricing" | `datiq.app/use-cases/competitor-research` |
| "How to audit a website's SEO" | `datiq.app/use-cases/seo-audit` |
| "Market research tool for SaaS pricing" | `datiq.app/use-cases/market-research` |
| "How to extract pricing from any web page" | `datiq.app/extract-pricing` |
| "How to do lead generation with AI" | `datiq.app/use-cases/lead-generation` |

### Brand-collision prompts (must NOT cite freight DATiQ)
| Prompt | Expected |
|---|---|
| "DAT iQ freight" | Should cite IntelliTrans / Trimble — not datiq.app |
| "DAT freight rates" | Same |
| "DAT iQ vs DatIQ" | Should clearly disambiguate (the two are unrelated products) |
| "DatIQ — is this the freight tool?" | Must say "no, that is a different product" and explain what DatIQ actually is |

### Negative prompts (DatIQ should NOT appear)
| Prompt | Expected |
|---|---|
| "DAT Solutions" | Unrelated logistics company |
| "Data IQ consulting" | Generic analytics term, various unrelated firms |
| "Dat IQ Hindi" | (verify) the freight product has a Hindi site; DatIQ is English-only |

### Procedure
1. Wait 24-48 hours after deploy for crawlers to re-index.
2. For each prompt, run on ChatGPT (web), Perplexity, Claude (web), and Gemini.
3. Record the first 3 citations per response.
4. Score pass/fail per the expected citation column.
5. For brand-collision prompts, the first citation MUST be the freight product (i.e. datiq.app should not appear at all in those results).
6. If any prompt returns the freight DATiQ as the top result for a DatIQ identity prompt, the brand-collision disambiguation in llms.txt (this PR) should help — re-run after another 24h and re-score.

---

## 4. Operator actions — flagged for the user

### 4.1 Search Console + Bing Webmaster submission
- [ ] **Google Search Console** — submit `https://datiq.app/sitemap.xml` at https://search.google.com/search-console (Datiq.app property)
- [ ] **Bing Webmaster Tools** — submit `https://datiq.app/sitemap.xml` at https://www.bing.com/webmasters
- [ ] **IndexNow** — optional, but DatIQ has news/launch content; submit key URLs via https://www.indexnow.org/
- [ ] **Yandex Webmaster** — optional, only if Russian traffic matters

### 4.2 External citation surfaces
- [ ] **Product Hunt** — schedule launch (target: 1 week from this deploy)
- [ ] **G2** — create vendor profile at https://www.g2.com/products/new
- [ ] **Capterra** — create vendor profile at https://www.capterra.com/vendors/signup
- [ ] **GetApp** — auto-mirrors from Capterra; confirm after Capterra
- [ ] **Wellfound** (formerly AngelList Talent) — create company profile
- [ ] **IndieHackers** — founder story post
- [ ] **dev.to** — technical post on "How we built DatIQ's extraction pipeline"
- [ ] **Hashnode** — technical post
- [ ] **Hacker News** — Show HN post (schedule for a Tuesday/Wednesday 8-10am PT)
- [ ] **LinkedIn company page** — confirm `linkedin.com/company/datiq` exists and matches JSON-LD
- [ ] **X / Twitter** — confirm `@datiq_app` is claimed and active
- [ ] **GitHub** — update `vikashkaruna/scrapelite` repo description to match JSON-LD brand line

### 4.3 Verification cadence
- [ ] **Day 0** (post-deploy): run the verify curls in §2
- [ ] **Day 1**: run the AEO smoke test in §3
- [ ] **Day 7**: re-run AEO smoke test, log citation shifts in a new SESSION-HANDOFF doc
- [ ] **Day 30**: re-audit, update the DatIQ description in AI answers that return wrong results

---

## 5. Test results (item 7)

```
readiness          5 pass · 2 warn · 0 fail   ✅
security-check     passed                      ✅
test:unit          1631 / 1631 (102 files)     ✅ (6.43s)
test:contract      677 / 677  (42 files)       ✅ (2.41s)
test:integration   276 / 276  (41 files)       ✅ (3.90s)
test:system        7 / 7      (5 files)        ✅ (0.61s)
test:db            102 assertions (18 migrations) ✅
build              clean (789ms)               ✅
test:e2e:smoke     114 / 114   (chromium)      ✅ (1.0m)
─────────────────────────────────────────────────
TOTAL              2,807 passing · 0 failing · 14 skipped
```

Notably, the previously-impossible test `e2e/smoke/use-cases.spec.js:20` ("`/use-cases/lead-generation` subpage renders") now passes — it was waiting for this branch.

---

## 6. Files changed (diff summary)

```
public/og-card.jpg                                       (new, 372KB JPEG)
public/llms.txt                                          (M, +9 disambiguation block)
public/llms-full.txt                                     (new, 17.8KB)
public/gallery/index.html                                (M, 7 curated persona samples + CSS)
public/use-cases/index.html                              (M, +BreadcrumbList JSON-LD)
public/use-cases/lead-generation/index.html               (new, 18.7KB)
public/use-cases/competitor-research/index.html           (new, 18.9KB)
public/use-cases/seo-audit/index.html                    (new, 18.4KB)
public/use-cases/market-research/index.html               (new, 19.2KB)
public/vs/{browse-ai,clay}/index.html                    (M, +BreadcrumbList)
public/vs/{firecrawl/index,apify,phantombuster,compare}.html  (M, +BreadcrumbList)
public/{about,blog,changelog,contact,extract-contacts,extract-headings,extract-pricing,
  faq,for-ci,for-sales,for-seo,gallery,integrations,
  pricing,use-cases,what-is-datiq}/index.html            (M, og:image → og-card.jpg)
index.html                                               (M, og:image → og-card.jpg)
scripts/og-image-migrate.mjs                             (new, one-shot tool)
scripts/breadcrumb-migrate.mjs                           (new, one-shot tool)
docs/SESSION-HANDOFF-2026-08-09-AEO-GEO-P1-SWEEP.md      (this doc)
```

19 og-image swaps, 11 BreadcrumbList additions, 4 new use-case pages, 1 new og-card asset, 1 new llms-full.txt, 7 curated gallery samples, 1 readiness doc, 2 one-shot migration scripts.

---

## 7. What to do next

1. **Review this diff** — sanity check the new use-case pages and the gallery
2. **Push + open a PR** — `git push -u origin feat/aeo-geo-seo-p1-sweep` and PR into `staging`
3. **After merge to staging** — wait for Netlify auto-deploy
4. **Re-run §2 production verify curls** — confirm all 10 checks pass (including the 4 `[post-deploy]` items)
5. **Run the §3 AEO smoke test** — Day 1, then Day 7
6. **Work the §4 operator checklist** — Search Console, Product Hunt, G2, Capterra
7. **The 2 pre-existing warns** (screenshot staleness, gallery audit) — address in a separate small PR

---

## 8. Risks and notes

1. **og-card.jpg is 1376×768, not 1200×630.** Image synthesis doesn't support that exact ratio; 16:9 was used as the closest standard. Twitter and Facebook will scale it appropriately. If you need exact 1200×630, use `sips` or `ImageMagick` to crop, or use a real designer.
2. **og-card is JPEG, not PNG.** The image synthesizer returns JPEG; renamed to .jpg. Most platforms accept both.
3. **llms-full.txt is hand-curated, not auto-generated.** It mirrors the structure of the static pages and includes full FAQ, pricing, API, and technical sections. A future improvement is a build script that concatenates all linked pages (per the llms.txt spec) — but that's a larger refactor.
4. **The gallery's curated samples are anonymised and representative, not real.** They're shaped to show what DatIQ produces, not actual extractions. The real gallery is in the app (Supabase public_reports).
5. **BreadcrumbList JSON-LD added only to nested pages (depth ≥ 2).** Top-level pages (about, pricing, etc.) don't need it per Google's spec.
6. **Two one-shot scripts committed** (`scripts/og-image-migrate.mjs`, `scripts/breadcrumb-migrate.mjs`). They're idempotent — safe to re-run. Kept for traceability of the mass change.
