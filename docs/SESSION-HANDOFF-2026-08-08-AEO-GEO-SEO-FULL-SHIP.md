# DatIQ — AEO/GEO/SEO hardening: full P0 ship (all 5 items)

**Date:** 2026-08-08 → 2026-08-09 (IST)
**Branch on entry:** `Fix-address-AEO-GEO-SEO-gaps` (off `staging`)
**Branch on exit:** `staging` at `3f3271d` (merge of `feat/aeo-geo-seo-hardening`)
**Status:** P0 (5 items) shipped and merged to staging. Production deploy pending — Netlify will auto-deploy from `staging` once the build runs, or you can promote `staging` to `main` per the project pattern.

---

## 1. What this session shipped

The full AEO/GEO/SEO hardening plan, executed end to end. Five P0 items, all green.

| P# | Item | Status | Files |
|---|---|---|---|
| P0.1 | Flip `Google-Extended` + `Bytespider` to `Allow: /` in robots.txt | ✅ | `public/robots.txt` |
| P0.2 | `useSeo` hook + wire into 12 React app routes | ✅ | `src/hooks/useSeo.js`, `src/hooks/useSeo.test.js`, 12 page files |
| P0.3 | `/what-is-datiq` static HTML page with FAQPage + Article JSON-LD | ✅ | `public/what-is-datiq/index.html` |
| P0.4 | 19 static HTML pages replacing SPA fallback for crawlers | ✅ | 19 `public/<route>/index.html` files (full list below) |
| P0.5 | `/faq` static HTML page with 12-Q&A FAQPage JSON-LD | ✅ | `public/faq/index.html` |

### Test gate (before merge to staging)

| Gate | Result |
|---|---|
| `npm run test:unit` | **1631/1631** passed (102 files, 5.8s) — 10 new from `useSeo.test.js`, no regressions |
| `npm run build` | clean (672ms) — only pre-existing chunk-size warnings, no errors |
| `test:contract` / `test:integration` / `test:system` / `test:db` / `test:e2e:smoke` / `test:security` | not re-run in this session; the changes are isolated to `src/hooks/useSeo.js`, 12 page components (import + one useSeo call), and 19 new static HTML files. The static pages don't touch the React app or the test suite. |

### The 19 static pages

| Page | Size | Headline content |
|---|---|---|
| `/what-is-datiq` | 18 KB | 8-Q&A FAQPage + Article JSON-LD · brand-collision disambiguation · 5 plans card |
| `/faq` | 19 KB | 12-Q&A FAQPage JSON-LD · 5 sections with deep-link anchors |
| `/about` | 14 KB | AboutPage JSON-LD · 5 Pillar cards · 4-step How it works · 4 values |
| `/pricing` | 21 KB | Product + 7 Offer JSON-LD · 8 plan cards · feature comparison table |
| `/blog` | 29 KB | Blog + 9 BlogPosting JSON-LD · 1 featured + 8 posts as expandable sections |
| `/use-cases` | 9 KB | 4-card grid linking to the 4 use-case detail pages |
| `/contact` | 10 KB | 6 direct channels (general, sales, support, billing, security, press) · mailto form |
| `/integrations` | 9 KB | 12-card grid (6 available, 6 coming soon) |
| `/changelog` | 11 KB | V1.0+ AEO/GEO release + V1.0 base · 6 capability groups |
| `/gallery` | 8 KB | Explains the interactive gallery model; links to the app |
| `/vs/browse-ai` | 11 KB | 8-row comparison table + "Choose X if you…" two-column |
| `/vs/clay` | 11 KB | Same template · 9-row comparison table |
| `/vs/firecrawl` | 14 KB | Same template · mirrors the existing `public/vs/firecrawl.html` (now also serves at `/vs/firecrawl/`) |
| `/for-sales` | 7 KB | Persona page · 4 bullets + 5 keyword pills |
| `/for-seo` | 7 KB | Persona page · 4 bullets + 5 keyword pills |
| `/for-ci` | 7 KB | Persona page · 4 bullets + 4 keyword pills |
| `/extract-pricing` | 7 KB | Intent page · 4 bullets + 5 keyword pills |
| `/extract-contacts` | 7 KB | Intent page · 4 bullets + 5 keyword pills |
| `/extract-headings` | 7 KB | Intent page · 4 bullets + 5 keyword pills |

### Diff summary vs. main

```
36 files changed, 4620 insertions(+), 4 deletions(-)
```

Breakdown:
- `public/robots.txt` — 2 lines changed (P0.1 policy flips)
- `src/hooks/useSeo.js` + `src/hooks/useSeo.test.js` — 1 new file + 1 test file (P0.2)
- 12 × `src/pages/*.jsx` — 2 lines each (import + useSeo call) for the React app routes
- 19 × `public/<route>/index.html` — new static pages
- `public/sitemap.xml` — 2 new URLs (what-is-datiq, faq)

---

## 2. Branch state on exit

```
main       b2a019e [origin/main]       Merge pull request #56 from vikashkaruna/Fix-address-AEO-GEO-SEO-gaps
staging    3f3271d [origin/staging]    merge: AEO/GEO/SEO P0 hardening (feat/aeo-geo-seo-hardening) into staging
feat       dc5149b [origin/feat/...]   feat(seo): add static /for-*, /extract-*, /changelog, /gallery pages (P0.4 batch 4 — final)
```

The feature branch is preserved on origin at `dc5149b`. staging is now 1 merge commit ahead of the previous staging tip `de0582a`, and contains the full P0 work.

---

## 3. Why Prompt 3 (static HTML) over Prompt 1 (SSG)

This session chose the static-HTML approach (Prompt 3) over the SSG approach (Prompt 1) for the P0.4 step. The decision was made before any code was written and recorded in the prior session's handoff doc at `docs/SESSION-HANDOFF-2026-08-08-AEO-GEO-SEO-PARTIAL-SHIP.md`.

The summary: the codebase already has 20+ static HTML files for marketing pages (`/help/01..16-*.html`, `/vs/apify.html`, `/vs/firecrawl.html`, `/vs/phantombuster.html`, `/vs/compare.html`, `/use-cases/usecase.html`, `/dmca.html`). Adding 17 more static files is the natural extension of that pattern, with zero new build dependencies, zero test-suite interaction, and the lowest possible risk surface. The SSG approach is the right call for a long-term refactor to a single source of truth, but Prompt 3 ships faster and safer for a v1.0+ hardening pass.

A follow-up SSG PR is the natural next step (tracked in §6 below).

---

## 4. Decisions and open questions

### 4.1 The `Google-Extended` policy reversal (closed)

`Google-Extended` controls whether Google can use your content for Gemini training and grounding. It is **independent** of `Googlebot` (which controls Google Search indexing). The decision was to **flip to `Allow: /`** for both `Google-Extended` and `Bytespider`. The robots.txt file now has a comment block above each explaining the policy and how to revert. The flips are live in the commit at `203ba9d`.

If a regulatory or licensing concern surfaces later, the comment block points at exactly which lines to flip back.

### 4.2 The Prompt 1 vs Prompt 3 decision (closed)

Closed in favor of Prompt 3 (static HTML). See §3 above.

### 4.3 The skill update (still pending)

The `vikash-seo-geo-aeo-skill` was not updated in this session. The skill has 9 documented gaps that allowed the DatIQ situation to slip through (SPA detection, per-page schema enforcement, brand-collision disambiguation, etc.). The Prompt 2 for updating the skill was drafted but not executed.

A future session should run that prompt. The skill lives at `~/.claude/skills/vikash-seo-geo-aeo-skill/SKILL.md` and the prompt is reproduced in §5 below.

### 4.4 The `og-card.png` (still pending)

The `<meta property="og:image">` and `<meta name="twitter:image">` in `index.html` still point at `/favicon.svg` — a tiny pixel. A 1200×630 social card is on P1.

### 4.5 The dead React routes (still pending — cleanup)

The React components in `src/pages/` for the now-static pages (`About.jsx`, `Pricing.jsx`, `Blog.jsx`, `UseCases.jsx`, `VsBrowseAI.jsx`, `VsClay.jsx`, `Contact.jsx`, `Integrations.jsx`, `Changelog.jsx`, `Gallery.jsx`, `ProgrammaticRoute.jsx`, `UseCaseLead.jsx`, `UseCaseCompetitor.jsx`, `UseCaseSEO.jsx`, `UseCaseResearch.jsx`) are NOT removed. They become dead code. Clean them up in a follow-up PR after we have signal that the static pages are working in production.

---

## 5. The prompts (preserved for future sessions)

Three prompts were drafted in the prior session. The one that was executed was Prompt 3. Prompt 1 (SSG) is the natural follow-up. Prompt 2 (skill update) is still pending.

### Prompt 1 — SSG approach (NOT executed; deferred to a future session)

```
You are working on DatIQ (https://datiq.app), a zero-code web intelligence platform
rebranded from ScrapeLite. The site is a Vite 5 + React 18 + React Router 6 SPA
deployed on Netlify (project `datiqapp`). The codebase is at
/Users/vikash/Extracta. The locked stack is documented in AGENTS.md and CLAUDE.md —
read them first. Do not change the tech stack, do not introduce Tailwind rewrites
of the design tokens, do not break the existing 1133-test suite.

## Goal
Implement the AEO/GEO/SEO hardening plan below, on a fresh branch
`feat/aeo-geo-seo-hardening` off `main`. Ship P0 items in order.

(Full prompt at the prior handoff doc:
docs/SESSION-HANDOFF-2026-08-08-AEO-GEO-SEO-PARTIAL-SHIP.md §6)
```

### Prompt 2 — skill update (NOT executed; skill lives at `~/.claude/skills/vikash-seo-geo-aeo-skill/`)

The skill has 9 gaps that need to be closed:
- **Gap A** — Add SPA / client-side rendering detection to Phase 2 audit
- **Gap B** — Enforce "never block AI crawlers" with explicit per-user-agent checks
- **Gap C** — Add per-page (not just site-wide) JSON-LD requirement
- **Gap D** — Add brand-collision disambiguation playbook
- **Gap E** — Differentiate `llms.txt` vs `llms-full.txt`
- **Gap F** — Add og-image / social card requirement
- **Gap G** — Add `/what-is-<brand>` canonical answer page requirement
- **Gap H** — Add external citation surfaces checklist
- **Gap I** — Add Search Console / Bing Webmaster submission step

Full prompt at the prior handoff doc §6.

### Prompt 3 — Static HTML approach (EXECUTED in this session)

The full prompt was executed end-to-end across 9 commits on `feat/aeo-geo-seo-hardening`, merged to staging at `3f3271d`. The work matches the prompt exactly.

---

## 6. What's still pending

### P1 (P1 of the original plan)
- `og-card.png` 1200×630 — replace favicon in `og:image` and `twitter:image`
- Brand-collision disambiguation in `llms.txt` and home page (mention DAT iQ freight explicitly)
- Differentiate `llms-full.txt` from `llms.txt` (build is currently producing a copy)
- BreadcrumbList JSON-LD on nested pages
- Article JSON-LD on `/blog/<slug>` posts (currently only on the blog index)

### P2 (operator actions)
- Submit sitemap to Google Search Console
- Submit sitemap to Bing Webmaster Tools
- Confirm/claim `@datiq_app` on X and `linkedin.com/company/datiq` (referenced in JSON-LD; verify they exist)
- Launch on Product Hunt
- Create profiles on G2, Capterra, GetApp, Wellfound
- Cross-post on IndieHackers, dev.to, Hashnode, Hacker News
- Update GitHub repo description to match the JSON-LD

### Follow-up engineering
- 4 use-case detail pages (`/use-cases/lead-generation`, `/use-cases/competitor-research`, `/use-cases/seo-audit`, `/use-cases/market-research`) — these are not in the original P0.4 list. The static `/use-cases` hub links to them but they are still React routes. If you want them crawlable, do a follow-up static pass.
- Cleanup of the now-dead React routes (`About.jsx`, `Pricing.jsx`, `Blog.jsx`, `UseCases.jsx`, `VsBrowseAI.jsx`, `VsClay.jsx`, `Contact.jsx`, `Integrations.jsx`, `Changelog.jsx`, `Gallery.jsx`, `ProgrammaticRoute.jsx`, the 4 use-case detail components) — remove in a follow-up PR.
- Skill update (Prompt 2) — see §5.
- The `vite-react-ssg` approach (Prompt 1) as a follow-up if you want a single source of truth for the marketing pages.

---

## 7. How to ship and verify

### Deploy

The standard DatIQ flow per AGENTS.md:
1. The `feat/aeo-geo-seo-hardening` branch is now merged into `staging` at `3f3271d`. Netlify should auto-deploy the staging environment.
2. Verify on the staging URL: `https://staging--datiqapp.netlify.app/` (Edge-Access gated — check the Netlify UI).
3. When happy, sync `staging` to `main` (or open a PR from `staging` → `main`) and merge. Netlify auto-deploys to `https://datiq.app`.
4. Spot-check the production URLs (the verify curls from the original prompt work for the static pages):
   ```bash
   curl -s https://datiq.app/robots.txt | grep -A1 "Google-Extended"   # should show Allow: /
   curl -s https://datiq.app/ | grep -c 'DatIQ\|datiq.app'            # should be many
   curl -s https://datiq.app/about | grep -c '<h1'                      # should be 1+
   curl -s https://datiq.app/pricing | grep -c 'application/ld+json'   # should be 1+
   curl -s https://datiq.app/what-is-datiq | grep -c 'FAQPage'         # should be 1
   curl -s https://datiq.app/faq | grep -c 'FAQPage'                    # should be 1
   curl -s https://datiq.app/blog | grep -c 'BlogPosting'               # should be 9
   ```

### AEO/GEO smoke test (3rd-party AI)

After deploy, verify with the actual AI surfaces that matter:
- Ask ChatGPT, Perplexity, Claude, and Gemini "What is DatIQ?" — all four should now cite `datiq.app/what-is-datiq`.
- Ask "DatIQ vs Browse.ai" — should cite `datiq.app/vs/browse-ai`.
- Ask "How to extract pricing from a web page" — should cite `datiq.app/extract-pricing` and `datiq.app/vs/firecrawl`.

If any AI still returns the freight DATiQ (IntelliTrans) as the top result, the brand-collision disambiguation in `llms.txt` (P1) is the next lever.

---

## 8. Reference docs

- `AGENTS.md` — top-level project context
- `CLAUDE.md` — current source of truth (updated with every release)
- `docs/SESSION-HANDOFF-2026-08-08-STAGING-REBUILD-RETEST.md` — session immediately before this one
- `docs/SESSION-HANDOFF-2026-08-08-AEO-GEO-SEO-PARTIAL-SHIP.md` — the prior session's handoff (drafted the plan and the 3 prompts; shipped P0.1 partial)
- `docs/SESSION-HANDOFF-2026-08-08-AEO-GEO-SEO-FULL-SHIP.md` — this document
- The AEO/GEO/SEO skill at `~/.claude/skills/vikash-seo-geo-aeo-skill/SKILL.md` — still NOT updated; see Prompt 2 in §5.

## 9. Risks and notes for the next session

1. **The dead React routes** — see §4.5. They don't break anything (the static file takes precedence over the SPA fallback) but they are confusing and grow the bundle. Clean up in a follow-up PR.
2. **The 4 use-case detail pages** — see §6. They are not crawlable as static HTML. If you want them to be, do a follow-up pass.
3. **The `llms-full.txt` issue** — the build is producing a copy of `llms.txt` for `llms-full.txt`. Fix the build script in a follow-up.
4. **The `og-card.png`** — favicon is still used for social previews. Add a 1200×630 PNG.
5. **The skill update** — Prompt 2 is still pending. The skill has 9 documented gaps that the next AEO audit will repeat unless the skill is updated.
6. **Test gate scope** — only `test:unit` + `build` was re-run in this session. The full `test:all` chain was last green at the partial P0.1 ship, but did not re-run after the P0.2–P0.5 work landed. Run the full chain before promoting `staging` to `main` for production deploy.
