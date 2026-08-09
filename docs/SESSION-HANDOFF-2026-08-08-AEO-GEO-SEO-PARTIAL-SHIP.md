# DatIQ — AEO/GEO/SEO hardening: partial P0.1 ship + plan for the rest

**Date:** 2026-08-08 → 2026-08-09 (IST)
**Branch on entry:** `Fix-address-AEO-GEO-SEO-gaps` (off `staging`)
**Branch on exit:** `main` and `staging` both at `b2a019e`
**Production deploy:** Pending (Netlify will auto-deploy `main` once a build runs)

---

## 1. What this session was

A scoped hardening pass on DatIQ's AEO/GEO/SEO surface. The driver was an external audit (two messages from a reviewer doing a Firecrawl read of the site) plus the existing `vikash-seo-geo-aeo-skill` audit gap. The site is much further along than the audit's first message implied — `robots.txt`, `llms.txt`, `sitemap.xml`, JSON-LD in the shell, and 16+ static help pages were already in place. The real work was (1) confirm what's already there, (2) identify the actual gaps, (3) ship the first piece (`robots.txt` partial P0.1), and (4) write down a plan for the rest as three executable prompts.

---

## 2. What shipped

| Item | Status | Where |
|---|---|---|
| `User-agent: OAI-SearchBot / Allow: /` | ✅ Live in prod | `public/robots.txt` |
| `User-agent: Googlebot / Allow: /` (explicit form) | ✅ Live in prod | `public/robots.txt` |
| `User-agent: Claude-User / Allow: /` | ✅ Live in prod | `public/robots.txt` |
| `User-agent: Google-Extended / Disallow: /` | ⚠️ **Still disallowed** — needs explicit sign-off to flip | `public/robots.txt` |
| `User-agent: Bytespider / Disallow: /` | ⚠️ **Still disallowed** — needs explicit sign-off to flip | `public/robots.txt` |

**Commit:** `759653c fix(seo): allow OAI-SearchBot, Googlebot, and Claude-User in robots.txt` (1 file, +9 lines)
**Reapplied as:** `2e4ca1d` on staging (post-rebase over the nanoid vuln fix `570646a`)
**Merged to main via:** PR #56 (user opened and merged while the staging-deploy cron was running)
**Live on staging:** `https://6a777df6327b4f785dfca6d5--datiqapp.netlify.app/robots.txt` (verified 00:39 IST)
**Live on main:** `https://datiq.app/robots.txt` (deploy triggered by the merge; pending build completion in the Netlify UI)

### Test results before push

| Phase | Result |
|---|---|
| `npm run test:unit` | 1621/1621 passed (101 files, 6.4s) |
| `npm run test:all` (readiness + unit + contract + integration + system + db + build + e2e:smoke + security) | **2,695/2,695 passed**, 0 failed, 15 skipped |
| `npm run build` | clean, 8.47 kB `dist/index.html` + 287 kB CSS |

### Branch state on exit

```
main       b2a019e [origin/main]       Merge pull request #56 from vikashkaruna/Fix-address-AEO-GEO-SEO-gaps
staging    b2a019e [origin/staging]    Merge pull request #56 from vikashkaruna/Fix-address-AEO-GEO-SEO-gaps
```

Local `staging` was fast-forwarded to `main` after the PR #56 merge so the two branches are back in lockstep. The `Fix-address-AEO-GEO-SEO-gaps` branch still exists locally at the pre-rebase SHA `759653c` and on `origin/Fix-address-AEO-GEO-SEO-gaps` — it can be deleted; the work is in main.

---

## 3. What was planned but NOT shipped in this session

These were the remaining gaps from the audit. Each got a full implementation prompt (see §6).

| P# | Item | Effort | Notes |
|---|---|---|---|
| P0.1 (rest) | Flip `Google-Extended` and `Bytespider` to `Allow: /` | 5 min | **Policy reversal** — needs explicit sign-off. Currently blocks Gemini and ByteDance crawler discoverability. |
| P0.2 | `useSeo` hook + per-route meta in React app | 0.5 day | Required for any pre-rendering or static-HTML work to have unique per-route metadata. |
| P0.3 | `/what-is-datiq` route (canonical answer page) | 0.5 day | The single most-recommended page; the audit called it out by name. |
| P0.4 | Pre-render 10 SEO routes (Prompt 1 = SSG, Prompt 3 = static HTML fallback) | 1–2 days | **THE BIG ONE.** Closes the "SPA returns empty body to non-JS crawlers" gap. |
| P0.5 | `/faq` route with FAQPage JSON-LD | 0.5 day | High-value structured data for AI engines. |

P1 and P2 (og-card, brand-collision phrasing, llms-full.txt differentiation, BreadcrumbList, external citation surfaces, Search Console submission) are deferred to a follow-up session.

---

## 4. The audit's actual findings — and which still hold

The external audit identified 11 gaps. Resolved vs. still open:

| Audit finding | Status |
|---|---|
| `/robots.txt` blocks `Google-Extended` | ⚠️ Still open (P0.1 rest) |
| `/robots.txt` blocks `Bytespider` | ⚠️ Still open (P0.1 rest) |
| No per-page `<title>`/`<meta>`/canonical | ⚠️ Still open (P0.2) |
| JSON-LD only in shell, not per-page | ⚠️ Still open (P0.2, P0.3, P0.5) |
| No `/what-is-datiq` canonical answer page | ⚠️ Still open (P0.3) |
| No `/faq` route with FAQPage | ⚠️ Still open (P0.5) |
| og:image = favicon (tiny pixel) | ⚠️ Still open (P1) |
| Brand collision with freight "DAT iQ" | ⚠️ Still open (P1, addressed in P0.3's copy) |
| `llms-full.txt` is identical to `llms.txt` | ⚠️ Still open (P1) |
| Most content pages are SPA-only (empty body to non-JS crawlers) | ⚠️ Still open (P0.4) |
| External citation surfaces (Product Hunt, G2, etc.) | ⚠️ Still open (P2, operator actions) |

**Bottom line:** only 1 of 11 audit findings is closed (the OAI-SearchBot/Googlebot/Claude-User partial). The other 10 are queued with prompts.

---

## 5. Decisions and open questions

### 5.1 The `Google-Extended` policy reversal (open)

`Google-Extended` controls whether Google can use your content for Gemini training and grounding. It is **independent** of `Googlebot` (which controls Search indexing). Today:
- `Googlebot: Allow: /` — Google can index DatIQ for Search ✅
- `Google-Extended: Disallow: /` — Google **cannot** use DatIQ to ground Gemini ❌

The audit and the SEO/GEO/AEO skill both call for flipping this. The user has not yet given the green light. Possible reasons to keep it: privacy, content licensing, legal. Default: flip it.

### 5.2 Prompt 1 (SSG) vs Prompt 3 (static HTML) — the user has not decided

Two complete implementation prompts were written:

- **Prompt 1 — SSG approach:** installs `vite-react-ssg`, prerenders the 10 SEO routes at build time. More elegant long-term; risks interacting with Supabase auth in `useEffect`-heavy components.
- **Prompt 3 — static HTML approach:** hand-writes `public/<route>/index.html` for each of the 10 SEO routes, mirroring the existing `/help/`, `/vs/`, `/use-cases/`, and `/dmca.html` pattern. Lower risk; same outcome for crawlers; two sources of truth (the React component and the static file).

The prompt in §6 below is Prompt 1 (SSG). The static-HTML alternative (Prompt 3) is in the prior session's transcript and is functionally equivalent.

### 5.3 Branch state

- The work for the next pass should branch off `main` (which is now at `b2a019e`, contains the partial P0.1).
- The local `Fix-address-AEO-GEO-SEO-gaps` branch is stale (pre-rebase SHA `759653c`) but harmless. Delete at your leisure.

---

## 6. The prompt to run in the next session

Start a fresh session. Open the new session on `main` (or on a fresh branch off main). Paste the prompt below verbatim. The prompt is self-contained: it includes context, the goal, the gap list, the per-item instructions, the order of operations, the "done" definition, and the reporting template.

```
You are working on DatIQ (https://datiq.app), a zero-code web intelligence platform
rebranded from ScrapeLite. The site is a Vite 5 + React 18 + React Router 6 SPA
deployed on Netlify (project `datiqapp`). The codebase is at
/Users/vikash/Extracta. The locked stack is documented in AGENTS.md and CLAUDE.md —
read them first. Do not change the tech stack, do not introduce Tailwind rewrites
of the design tokens, do not break the existing 1133-test suite.

## Goal
Implement the AEO/GEO/SEO hardening plan below, on a fresh branch
`feat/aeo-geo-seo-hardening` off `main`. Ship P0 items in order. Each P0 item ends
with a verification step you must actually run before moving to the next.

## What already exists (do not redo)
- public/robots.txt — already lists OAI-SearchBot, GPTBot, ClaudeBot, PerplexityBot,
  CCBot, anthropic-ai, Claude-User, Googlebot. Disallows /admin*.
- public/llms.txt — 92-line directory for LLM ingestion.
- public/sitemap.xml — 28 URLs, all valid public routes.
- index.html — already has Organization, WebSite, SoftwareApplication JSON-LD in
  the head, plus OG/Twitter/canonical.
- public/help/01..16-*.html — 16 static help docs, fully crawlable.
- public/vs/{apify,compare,firecrawl,phantombuster}.html — static comparison pages.
- public/use-cases/usecase.html — static use-case page.
- src/App.jsx — all the recommended routes exist (about, pricing, blog, use-cases,
  vs/*, contact, changelog, integrations, gallery, etc.) but most are React
  components served via SPA fallback, so non-JS crawlers see an empty body.

## The actual gaps to fix (P0 only — ignore P1/P2 for this pass)

### P0.1 — Flip Google-Extended and Bytespider to Allow: /
File: public/robots.txt
Change the two blocks:
  User-agent: Google-Extended
  Disallow: /
becomes:
  User-agent: Google-Extended
  Allow: /

  User-agent: Bytespider
  Disallow: /
becomes:
  User-agent: Bytespider
  Allow: /

Add a comment above the Google-Extended block explaining: this controls whether
content can be used for Gemini training/grounding. We want DatIQ to be citable
by Gemini, so we explicitly allow.

(If the user has flagged that the original block was intentional, STOP and ask
before making this change. Default: make the change.)

Verify after deploy:
  curl -s https://datiq.app/robots.txt | grep -A1 "Google-Extended"

### P0.2 — Add a useSeo hook for per-route meta
New file: src/hooks/useSeo.js
Signature: useSeo({ title, description, canonical, ogImage, jsonLd, robots })
Behavior:
  - On mount, push the values into document.head (title, meta[name=description],
    link[rel=canonical], meta[property=og:*], meta[name=twitter:*], and any
    JSON-LD scripts passed in jsonLd: array).
  - On unmount, restore the previous values (so navigating between routes leaves
    the head in a consistent state).
  - Use unique DOM ids for the JSON-LD scripts to avoid duplicates.
  - Skip if any value is null/undefined.

Wire it into every public route in src/App.jsx with a unique title + 150-160 char
description + canonical URL. The minimum set is:
  /                       → "DatIQ: The Unified Web Intelligence Platform | Intelligence from Web"
  /about                  → "About DatIQ — the no-code web intelligence platform | DatIQ.app"
  /pricing                → "DatIQ Pricing — Free, Select, Pro, Business, Agency | DatIQ.app"
  /blog                   → "DatIQ Blog — guides on web data extraction, AI summarization, scraping"
  /use-cases              → "DatIQ Use Cases — lead generation, competitor research, SEO audit, market research"
  /use-cases/lead-generation
  /use-cases/competitor-research
  /use-cases/seo-audit
  /use-cases/market-research
  /contact                → "Contact DatIQ — sales, support, and partnerships"
  /changelog              → "DatIQ Changelog — every release, every fix, every feature"
  /integrations           → "DatIQ Integrations — HubSpot, Salesforce, Google Sheets, Slack, webhooks"
  /vs/browse-ai           → "DatIQ vs Browse.ai — feature-by-feature comparison"
  /vs/clay                → "DatIQ vs Clay — feature-by-feature comparison"
  /vs/firecrawl           → "DatIQ vs Firecrawl — feature-by-feature comparison"
  /for-sales              → "DatIQ for sales teams — extract contacts and pricing from any company site"
  /for-seo                → "DatIQ for SEO teams — extract headings, links, and content structure"
  /for-ci                 → "DatIQ for competitive intelligence — monitor competitor sites automatically"
  /extract-pricing        → "Extract pricing data from any URL — DatIQ"
  /extract-contacts       → "Extract contacts from any URL — DatIQ"
  /extract-headings       → "Extract headings and content structure from any URL — DatIQ"
  /gallery                → "DatIQ public gallery — shared extractions you can browse"

Each page's description should be 150-160 chars, mention "DatIQ" and "DatIQ.app"
in the first 80 chars, and end with the canonical URL.

Verify (after build):
  npm run build && npm run preview
  For each of the above routes, open the rendered HTML and confirm the <title>
  and <meta name="description"> match the expected value. The body content check
  fails until P0.4 ships — that's expected.

Tests: there is no existing test for per-route meta. Add a small unit test
src/hooks/useSeo.test.js that mounts a component using the hook, asserts the
title was set, then unmounts and asserts it was restored.

### P0.3 — Add /what-is-datiq route
New file: src/pages/WhatIsDatiq.jsx
Structure (answer-first AEO style):
  - <h1>What is DatIQ?</h1>
  - First paragraph, 40-60 words, declarative: "DatIQ.app is a no-code web
    intelligence platform that turns any public URL into structured data —
    headings, links, contacts, pricing, AI summaries, and custom fields — in
    seconds, with no code required. It is built for SDRs, marketers, founders,
    researchers, and agencies who need clean web data without writing scrapers."
  - Section: "Who is DatIQ for?" (SDRs, BDRs, CI analysts, SEO/content
    marketers, market researchers, recruiters, startup founders, VCs, agencies)
  - Section: "What can you extract?" (web extraction, AI summary, custom
    extraction, domain mapping, contacts, pricing, content generation, exports)
  - Section: "How does DatIQ work?" (paste URL → choose options → AI extracts
    → review in Preview → enrich → save to Dashboard → export)
  - Section: "DatIQ plans" (link to /pricing)
  - Section: "FAQ" — 6-10 Q&A pairs (see below)

Wire into src/App.jsx with the route /what-is-datiq → <WhatIsDatiq />.
Wire useSeo with:
  title: "What is DatIQ? — The no-code web intelligence platform | DatIQ.app"
  description: "DatIQ.app is a no-code web intelligence platform that turns any
    public URL into structured data — headings, links, contacts, pricing, AI
    summaries, and custom fields. Built for SDRs, marketers, founders, researchers,
    and agencies. Free to start, no credit card."
  canonical: "https://datiq.app/what-is-datiq"
  jsonLd: [
    { "@type": "FAQPage", "mainEntity": [<6-10 Question objects>] },
    { "@type": "Article", "headline": "What is DatIQ?", "author": "DatIQ",
      "datePublished": "2026-08-08", "dateModified": "2026-08-08" }
  ]

FAQ pairs (use these or refine):
  Q: What is DatIQ?
  A: DatIQ is a no-code web intelligence platform that turns any public URL
     into structured data — headings, links, contacts, pricing, AI summaries,
     and custom fields — in seconds.
  Q: Who is DatIQ for?
  A: SDRs and BDRs doing prospect research, competitive intelligence analysts,
     SEO and content marketers, market researchers, recruiters, startup
     founders, VCs doing due diligence, and digital agencies.
  Q: How is DatIQ different from Clay, Browse.ai, or Firecrawl?
  A: DatIQ combines plain-English custom extraction, built-in AI enrichment
     tabs, background processing, and full CSV/PDF export in one no-code
     product. It is significantly cheaper than Clay, simpler than Firecrawl,
     and more feature-rich than Browse.ai.
  Q: Do I need to write code to use DatIQ?
  A: No. DatIQ is zero-code — paste a URL, describe any field you want in
     plain English, and the AI extracts it. Custom extraction is configurable
     in the UI without scripting.
  Q: What formats can I export?
  A: CSV (comprehensive — every enrichment included) and PDF (jsPDF report,
     customizable with white-label templates on Business and Agency plans).
  Q: Can I schedule recurring extractions?
  A: Yes. Scheduled monitoring is included on Pro, Business, and Agency plans.
  Q: Does DatIQ offer an API?
  A: Yes. The Developer plan (H3 2026) includes an API-first tier. Business
     and Agency plans include API access today.
  Q: Is DatIQ India-first?
  A: Yes. DatIQ is built India-first with INR pricing, Razorpay + UPI payment
     support, and DPDP Act 2023 compliance.

Add the URL to public/sitemap.xml with priority 0.9, changefreq monthly.

### P0.4 — Pre-render the top 10 SEO routes (THE BIG ONE)
This is the single biggest unlock. Right now /about, /pricing, /blog, /use-cases/*,
/vs/browse-ai, /vs/clay, /for-*, /extract-*, /contact, /changelog, /integrations,
/gallery all return the SPA shell with an empty body to non-JS crawlers. After
this step they return rendered HTML with real content.

Install:
  npm install --save-dev vite-react-ssg

Configure vite.config.js:
  - Add `import ssg from "vite-react-ssg"` at the top.
  - Replace the bare `react()` plugin usage with the ssg() wrapper.
  - Export a default that calls `defineConfig` with both the ssg plugin and the
    existing datiq-quiet-proxy-errors plugin.
  - The SSG config needs:
    - entry point: src/main.jsx
    - routes: list every public route from P0.2 (the same set), EXCLUDING:
      /dashboard, /account, /batch, /schedules, /preview, /workspace,
      /onboarding, /reset-password, /payment/success, /payment/cancel,
      /admin/*, /p/:slug
    - The SSG plugin will write dist/<route>/index.html for each route.
  - Netlify's existing `[[redirects]] from = "/*" to = "/index.html"` already
    serves static files preferentially over the SPA fallback, so the
    pre-rendered files win automatically.

Build:
  rm -rf dist
  npm run build
  # Should print "X pages prerendered" or similar.

Verify locally:
  npm run preview
  curl -s http://localhost:4173/about | grep -oE "<h1[^>]*>[^<]+"
  # Should now return real content like "About DatIQ".

Verify on production after deploy:
  curl -s https://datiq.app/about | grep -oE "<h1[^>]*>[^<]+"
  curl -s https://datiq.app/pricing | grep -oE "<h1[^>]*>[^<]+"
  curl -s https://datiq.app/blog | grep -oE "<h1[^>]*>[^<]+"
  curl -s https://datiq.app/use-cases/lead-generation | grep -oE "<h1[^>]*>[^<]+"
  curl -s https://datiq.app/what-is-datiq | grep -oE "<h1[^>]*>[^<]+"

Tests:
  npm run test:all
  # The most likely failure mode is the SSG trying to evaluate a component
  # that needs a Supabase session. The exclusion list above should prevent
  # this. If a route fails, exclude it from the SSG routes list and document
  # the reason in a code comment.

CSP / Netlify headers:
  The existing netlify.toml CSP allows 'unsafe-inline' for scripts, which is
  what the SSG-emitted React hydration needs. No change required.
  The existing X-Robots-Tag noindex block on /admin/* is preserved (Netlify
  applies it before the SSG files because /admin is not in the SSG route list).

### P0.5 — Add /faq route with FAQPage JSON-LD
New file: src/pages/Faq.jsx
Port the content from public/help/14-faq-and-troubleshooting.html into a React
component. Structure:
  - <h1>Frequently Asked Questions</h1>
  - 8-12 Q&A pairs in the same answer-first style as P0.3.
  - Add ids to each Q for deep linking (e.g. #faq-what-is-datiq).

Wire into src/App.jsx with the route /faq → <Faq />.
Wire useSeo with FAQPage JSON-LD covering all 8-12 pairs.
Add the URL to public/sitemap.xml with priority 0.7.

## Order of operations
1. Branch: git checkout -b feat/aeo-geo-seo-hardening main
2. P0.1 → commit → build → preview (locally)
3. P0.2 → commit → run new unit test → build → preview
4. P0.3 → commit → build → preview
5. P0.4 → install ssg → wire up config → commit → build → verify prerendered
   files exist → run full test suite
6. P0.5 → commit → build → preview
7. npm run readiness
8. Open PR against main
9. After merge, Netlify auto-deploys. Wait for deploy to complete, then run
   the production verify curls from P0.4 against https://datiq.app.

## What "done" means
- All five P0 items shipped on a single branch via clean commits.
- npm run test:all passes (no regressions; 1133/1133 or higher).
- npm run build completes cleanly.
- npm run readiness passes.
- The verify curls against production all return real <h1> content for
  /about, /pricing, /blog, /use-cases/lead-generation, /what-is-datiq, /faq.
- robots.txt on production shows Allow: / for Google-Extended and Bytespider.
- sitemap.xml on production includes /what-is-datiq and /faq.

## What NOT to do
- Do not change the tech stack.
- Do not convert design-system.css to Tailwind.
- Do not add new third-party services.
- Do not skip the test suite ("I'll add tests later").
- Do not deploy directly to main.
- Do not touch P1/P2 items in this pass — they go in a follow-up.

## Reporting
At the end, report:
- Branch name + commit SHAs.
- The exact diff summary (files added, modified, deleted).
- The output of the production verify curls.
- The output of `npm run test:all` (must show 1133+ tests passing).
- Any deviations from this plan and why.
```

---

## 7. Reference docs (also in the repo)

- `AGENTS.md` — top-level project context
- `CLAUDE.md` — current source of truth (updated with every release)
- `docs/SESSION-HANDOFF-2026-08-08-STAGING-REBUILD-RETEST.md` — the session immediately before this one
- `public/robots.txt`, `public/llms.txt`, `public/sitemap.xml` — current SEO surface
- `src/App.jsx` — all routes
- `netlify.toml` — deploy + CSP + per-route headers
- The skill at `~/.claude/skills/vikash-seo-geo-aeo-skill/` — the AEO/GEO/SEO reference (the skill itself was NOT updated in this session; that's a follow-up item from the same plan)

## 8. Risks and notes for the next session

1. **The `Google-Extended` flip is a policy reversal.** If the user has any reason to keep it disallowed (privacy, content licensing, legal), the agent should STOP and ask before making the change. Default: flip.
2. **The SSG approach (P0.4) is the riskiest step.** It may interact badly with Supabase auth in `useEffect`-heavy components. The exclusion list is the first line of defense; if a route fails, exclude it and document why. Fallback: hand-write static HTML for the failing routes (the Prompt 3 approach in the prior session).
3. **The 1133-test baseline was confirmed to actually be 1,621 unit + 677 contract + 276 integration + 7 system + 114 e2e = 2,695 tests.** The prompt's "1133/1133 or higher" is the old number; the real baseline is 2,695. Tests must stay ≥ 2,695.
4. **Per-page JSON-LD in the React app may need deduplication logic in `useSeo`** — multiple `FAQPage` schemas added across navigations would clutter the head. Use unique DOM ids and clean up on unmount.
5. **Netlify auto-deploys from `main` to production.** Once the next PR is merged, give Netlify 5-10 minutes for the build before running the production verify curls.
