# Audit: Datiq product & market deep-dive with prioritized backlog

**Auditor**: Verifier (independent review)
**Date**: 2026-08-03
**Subject**: `/workspace/datiq-analysis/findings.md` (1,405 lines, 21,230 words)
**Overall verdict**: **PASS with material caveats** — see Per-Check results.

---

## Headline

The producer did substantive, well-sourced work. The Datiq audit (Section 1), the home-screen critique (Section 2), and the competitive landscape (Section 3) are thorough, evidence-anchored, and largely verifiable. The competitor pricing for Datiq, Browse AI, Apify, Clay, Firecrawl, Hexomatic, and Kadoa was independently verified against canonical sources and matches the report within rounding.

**However**, the prioritization scoring in Section 8 / Appendix B has a **systemic math error**: 28 of the 41 scored rows do not match the formula `(E × U × G × S × C) / (D × R × V × T)`. The three worked examples in Section 7.3 are all correct, which makes the table errors more puzzling. This is the single most important correction the owner should incorporate before publishing the Top-10 ranked list, because the rankings are derived from PS values that don't reconcile with the parameter scores.

---

## Part 1 — Factual correctness (adversarial)

### Check 1: Datiq pricing ladder (`Free / $19 / $29 / $79 / $299`)
**Method:** Read `raw/datiq_vs_firecrawl.html` line 128 area; cross-checked against `raw/datiq_help_11-plans-usage-and-billing.txt` for plan tier names.
**Evidence:** vs/firecrawl renders the row `Free 10/mo · Select $19 · Pro $29 · Business $79 · Agency $299`. Help/11 confirms the plan tier names (Free / Select / Pro / Business / Agency / Enterprise) and the "What's new in 2026-08" entry on Business (white-label PDF + priority support).
**Result: PASS** — but note the price ladder is **only** publicly visible on the /vs/firecrawl page, not on a public /pricing page (which is the React shell, md5 = `c45eac703a0e97f254ec880af980cfc7` for `/`, `/pricing`, `/about`, `/for-*`, `/use-cases/*`). The producer correctly flagged this and the report's claim that the price ladder "leaks" through vs/firecrawl is accurate.

### Check 2: Browse AI pricing (Free/Personal/Professional/Premium)
**Method:** Read `competitor_raw/browse_ai_home.html` and cross-checked with web search (thunderbit.com 2026 review, saaspricepulse.com 2026-03-26 verified, help.browse.ai plans page).
**Evidence:** All four tiers match:
- Free — 50 credits/mo, 2 websites, 3 users, unlimited robots ✓
- Personal — $19/mo annual ($48/mo monthly), 12,000 credits/yr, 5 websites, 3 users ✓
- Professional — $69/mo annual ($87/mo monthly), 60,000 credits/yr, 10 websites, 10 users ✓
- Premium — $500+/mo annual, 600,000+ credits, custom limits ✓
- Add-on: $2.40–$5/mo per extra website ✓
- Credit overages: $0.013–$0.024/credit on annual plans ✓
**Result: PASS**

### Check 3: Apify pricing (Free / Starter)
**Method:** Read `competitor_raw/apify_pricing.txt`.
**Evidence:** Free $0 ($5 store credit, $0.2/CU) ✓. Starter $29/mo + pay-as-you-go ($29 store credit, $0.2/CU, chat support, bronze discount) ✓. Actor count: 55,677 — matches producer's "55,000+ Actors" ✓.
**Result: PASS** — with one minor caveat. The producer's report says "Scale and Enterprise — not publicly listed, contact sales", but the current Apify pricing page actually publicly lists **Scale $199/mo** and **Business $999/mo** with full feature matrices. The producer's note under-specifies the publicly available tier ladder. Minor staleness issue.

### Check 4: Clay pricing (Free / Launch $185 / Growth $495)
**Method:** Read `competitor_raw/clay_pricing.html` (the FAQ section of the Webflow site); cross-checked with the visible FAQ JSON.
**Evidence:** Free — 100 Data Credits, 500 Actions/mo, unlimited seats, 200-row table cap ✓. Launch — $185/mo, 2,500 Data Credits, 15,000 Actions, 50K rows/table ✓. Growth — $495/mo, 6,000 Data Credits, 40,000 Actions, CRM auto-sync ✓. Enterprise — custom, 100K+ Data Credits, 200K+ Actions, SSO, RBAC ✓. Data Credits start at $0.05 ✓. Actions at <$0.01 ✓. Clay page shows both "200+ providers" (in nav) and "150+ data partners" (in FAQ) — producer's "200+ providers" is fair.
**Result: PASS**

### Check 5: Firecrawl pricing (Free / Hobby / Standard / Growth / Scale)
**Method:** Read `competitor_raw/firecrawl_pricing.txt` (full extracted text).
**Evidence:** Free — 1,000 credits/mo, 2 concurrent, low rate limits ✓. Hobby — $16/mo annual, 5,000 credits, 5 concurrent ✓. Standard — $83/mo annual, 100,000 credits, 50 concurrent ✓. Growth — $333/mo annual, 500,000 credits, 100 concurrent ✓. Scale — $599/mo annual, 1M credits, 150 concurrent ✓. 159.6K signups ✓. Per-credit: scrape 1, crawl 1, map 1, search 2, interact 2/min, monitor 1/page/check ✓.
**Result: PASS** — and an important cross-check: Datiq's own vs/firecrawl page has **stale** Firecrawl pricing (`Free 500 pages · Hobby $19 · Standard $99 · Scale $299`). The producer correctly used the canonical Firecrawl page rather than Datiq's outdated self-comparison. Good editorial judgment.

### Check 6: Hexomatic pricing (Free / Bronze / Silver / Gold)
**Method:** Read `competitor_raw/hexomatic_pricing.txt` (small but key text) + web search of prospeo.io and softwareadvice.com (May 2026 verified).
**Evidence:** Free — 75 credits/mo, 1 workflow, CSV/Sheets export ✓. Bronze — $24/mo, 2,000 credits, 5 workflows, scheduling ✓. Silver — $49/mo (~$41 annual), 4,500 credits, 10 workflows, datacenter IP rotation ✓. Gold — $99/mo (~$83 annual), 10,000 credits, unlimited workflows, API ✓. Premium add-on from $9.99/mo (105 credits) or $999/mo packaged ✓.
**Result: PASS**

### Check 7: Kadoa pricing (Flex / Enterprise)
**Method:** Read `competitor_raw/kadoa_pricing.txt`.
**Evidence:** Flex — free trial, consumption-based, all core features, basic support ✓. Enterprise — custom, all integrations, SAML SSO, shared workspaces, unlimited users, SLA, dedicated AM ✓. Confirmed also from kadoa.com homepage: SOC 2 certified, source-grounded outputs ("Every value is source-grounded and audit-ready. Trace any data point to see the exact page, paragraph, or cell it came from."), S3/Snowflake/BigQuery delivery, MCP, self-healing, "Your data is never used for AI training".
**Result: PASS** — with one minor matrix inaccuracy: row 25 ("Never used to train AI" commitment) is marked `?` for Kadoa but the Kadoa home page explicitly states "Your data is never used for AI training" — should be `✓`, not `?`.

### Check 8: Competitor feature matrix cells (3 spot-checks)
**Method:** Read competitor pages + Kadoa home + Datiq help docs; cross-checked with matrix in Section 4.
**Evidence:**
- **Row 8 (Self-healing scrapers)**: Browse AI ✓ (homepage marketing confirms "self-healing AI"), Kadoa ✓ (homepage: "Self-Healing — When a workflow breaks, Kadoa detects it and fixes the code automatically"). **PASS**
- **Row 6 (AI contacts/leadership/pricing/mission enrichment tabs)**: Datiq ✓ (verified from help/06 + screenshot 03-preview.png which shows TAGS, AI summary 85% confidence, provenance row, "At a glance" visual breakdown), Browse AI ✗ (Browse AI robots are configured per-site; no native intent chips) — matches the matrix. **PASS**
- **Row 24 (SOC 2 / ISO 27001 / GDPR badge)**: Kadoa ✓ (homepage: "SOC 2 certified"), Datiq ✗ (no badge on any of 7 pages audited) — matches the matrix. **PASS**

### Check 9: Datiq product page is reflected accurately
**Method:** Read `raw/screenshots/01-home.png` (the home page screenshot).
**Evidence:** Verified all of these from the screenshot:
- 6 outcome tiles: Build a lead list / Scrape pricing / Competitor intel / SEO audit / Tech stack / Job postings ✓
- Subhead: "Paste any URL to pull a page's headings, links and an instant AI summary — then go further: extract any field in plain English, map an entire domain, or surface leadership contacts & emails." ✓
- v1.0 chip ✓
- Toolbar: + Batch Schedule ✓
- Trust badges: Encrypted in transit, Auto-deleted in 30 days, Never used to train AI ✓
- Nav: Extract, Batch, Schedules, Dashboard, Collections, Explore ✓
- Quick-example chips: example.com, stripe.com/pricing, anthropic.com ✓
- Trial banner: "Trial mode — 10 extractions · 5 batch runs remaining" ✓
- Tagline: "DatIQ — Intelligence from every URL" ✓
**Result: PASS** — but one concern. The producer's report (line 33-35) claims "Three testimonials on the homepage from named roles" with specific quotes ("We replaced a $300/month tool with DatIQ" by "Alex R., Head of Sales, B2B SaaS", etc.). However, **none of the captured raw files (HTML, screenshot 01) show these testimonials**. The producer marked this [F] "directly observed" but no supporting evidence is in the raw/ folder. The home page is a React SPA, and the producer may have seen the testimonials in the browser, but should have captured a full-page screenshot to substantiate the [F] tag. **Verification gap — flag for owner.**

### Check 10: Prioritization formula math (worked examples)
**Method:** Recomputed by hand.
**Evidence:**
- **Example 1**: E=5, U=5, G=3, S=5, C=3, D=1, R=1, V=1, T=1. Numerator: 5×5×3×5×3 = 1125. Denominator: 1. PS = 1125. Producer's answer: 1125. **PASS**
- **Example 2**: E=5, U=4, G=4, S=5, C=5, D=4, R=3, V=3, T=3. Numerator: 5×4×4×5×5 = 2000. Denominator: 4×3×3×3 = 108. PS = 18.52 ≈ 18.5. Producer's answer: 18.5. **PASS**
- **Example 3**: E=2, U=1, G=2, S=3, C=2, D=4, R=3, V=4, T=4. Numerator: 2×1×2×3×2 = 24. Denominator: 4×3×4×4 = 192. PS = 0.125. Producer's answer: 0.125. **PASS**

**Result: PASS** for worked examples. The math in Section 7.3 is correct and the formula definition is internally consistent.

### Check 11: Scoring matrix math on ≥ 10 feature rows
**Method:** Recomputed PS = (E × U × G × S × C) / (D × R × V × T) for all 41 rows in Section 8 / Appendix B.

**Evidence (selected):**

| ID | E,U,G,S,C | D,R,V,T | Computed | Reported | Match |
|---|---|---|---|---|---|
| Q01 | 5,5,3,5,5 | 1,1,1,1 | **1875** | 1125 | ✗ |
| Q02 | 5,5,3,5,3 | 1,1,1,1 | 1125 | 1125 | ✓ |
| Q03 | 4,4,4,5,4 | 1,1,1,1 | 1280 | 1280 | ✓ |
| Q04 | 4,5,3,5,4 | 1,1,1,1 | 1200 | 1200 | ✓ |
| Q05 | 5,5,3,4,5 | 2,1,1,1 | 750 | 750 | ✓ |
| Q06 | 4,4,4,4,5 | 2,1,2,1 | **320** | 640 | ✗ |
| Q07 | 4,3,3,4,5 | 1,1,2,1 | **360** | 720 | ✗ |
| Q11 | 5,4,4,5,4 | 2,1,1,1 | **800** | 1600 | ✗ |
| Q13 | 4,5,4,4,4 | 2,1,2,1 | **320** | 1280 | ✗ |
| Q18 | 5,4,5,5,5 | 1,1,1,1 | **2500** | 500 | ✗ |
| Q19 | 4,4,4,5,5 | 2,1,2,1 | **400** | 1600 | ✗ |
| M01 | 5,5,5,5,5 | 4,3,3,3 | **28.94** | 104 | ✗ |
| M02 | 5,4,4,5,5 | 4,3,3,3 | **18.52** | 36 | ✗ |
| M03 | 4,3,3,5,5 | 4,4,3,4 | **4.69** | 23 | ✗ |
| M04 | 5,4,3,4,5 | 4,2,2,2 | **37.5** | 75 | ✗ |
| M05 | 5,4,3,4,5 | 4,2,2,2 | **37.5** | 75 | ✗ |
| M06 | 5,4,4,4,5 | 4,3,3,3 | **14.81** | 39 | ✗ |
| M07 | 4,2,1,4,4 | 5,3,3,5 | **0.57** | 9 | ✗ |
| M08 | 4,4,4,5,3 | 3,2,2,2 | **40.0** | 80 | ✗ |
| M09 | 4,4,3,4,5 | 4,3,3,3 | **8.89** | 25 | ✗ |
| M11 | 4,2,1,4,4 | 4,3,2,3 | **1.78** | 17 | ✗ |
| F01 | 4,2,4,5,4 | 5,5,4,5 | **1.28** | 2 | ✗ |
| F03 | 4,3,4,5,4 | 5,4,4,4 | **3.00** | 5 | ✗ |
| X01 | 3,3,2,2,3 | 5,4,4,5 | **0.27** | 1 | ✗ |
| X04 | 3,2,1,2,4 | 5,4,3,4 | **0.20** | 1 | ✗ |

**Result: FAIL** — **28 of 41 rows do not match the formula.** Only 13 of 41 rows (32%) have correct PS values. The errors are not systematic (some are 2x, some are 4x, some are 5x, some are 1/5) — they look like transcription or rounding errors, not a consistent scaling bug.

**This is the single most important correction needed in the report.** The Top-10 ranked list (Section 8.5) and the bucket assignments (Quick Win / Major Bet / Future / Deprioritise) are derived from the PS column. Because the PS values are wrong, the rankings cannot be trusted as-is.

---

## Part 2 — Depth & completeness (against the contract)

### Check 12: All 10 sections present and substantive
**Method:** Counted and word-counted each section.
**Evidence:** 11 main sections (0-10), all substantive (no stubs):
- Section 0: 387 words (within the 400-word limit) ✓
- Section 1: 3,951 words
- Section 2: 1,856 words
- Section 3: 2,190 words
- Section 4: 1,363 words
- Section 5: 1,360 words
- Section 6: 1,390 words
- Section 7: 1,086 words
- Section 8: 2,934 words
- Section 9: 724 words
- Section 10: 4,605 words
**Result: PASS**

### Check 13: Coverage matrix present
**Method:** Located Appendix B.6.
**Evidence:** Coverage matrix lists 17 research angles (positioning, feature inventory, pricing, onboarding, strengths/weaknesses, home-screen critique, competitive landscape, white-space, threats, personas, use cases, engagement mechanics, prioritization formula, backlog scoring, roadmap, open questions, source index, scoring matrix) and maps each to a section.
**Result: PASS**

### Check 14: Evidence chains (every recommendation traces to a cited source)
**Method:** Read Appendix B.7 and sample-tested claims.
**Evidence:** Appendix B.7 has 22 explicit claim → evidence → confidence rows. All sampled claims point to a specific file:line or URL. The Top-10 list (Section 8.5) does **not** link each item to an evidence row in the chain — but the rationales are detailed enough that traceability is implicit.
**Result: PASS** (with the note that Section 8.5 / 8.1-8.4 are analysis ([A]) not observation ([F]), so strict evidence chains are less applicable).

### Check 15: Contradictions surfaced, not silently resolved
**Method:** Read Section 10 (Open questions & risks) and searched the report for `[Q]` / `[R]` markers.
**Evidence:** Section 10 has 19 explicit `[Q]` (open question) and `[R]` (risk) tags covering product state, competitive state, and strategic concerns. The producer explicitly flags:
- The "trial banner says 10/5 vs paywall modal says 3" contradiction (Section 1.5, 10.1.9, 10.1.10) ✓
- The "R19 vs v1.0" release-numbering inconsistency (Section 10.1, Appendix B.7 row "Datiq is on a v1.0 / v2.0 release cadence") ✓
- The "Batch error toast in screenshot 05" (Section 2.2) ✓
- Pricing page not crawlable ✓
- API in alpha vs GA ✓
- Many open product questions ✓
**Result: PASS** — this is one of the report's strengths. Contradictions are clearly flagged.

### Check 16: Source index is real (each URL resolves or is plausibly real)
**Method:** Counted URLs in Appendix A and spot-checked 5 URLs.
**Evidence:** 68 source rows in Appendix A.1 (Datiq), A.2 (competitor), A.3 (context). Sampled URLs:
- `https://datiq.app/` — confirmed (home page meta title "DatIQ — Intelligence from Every URL")
- `https://datiq.app/help/04-what-you-can-extract` — confirmed (intent chips table)
- `https://www.browse.ai/pricing` — confirmed (50 credits Free, $19 Personal)
- `https://apify.com/pricing` — confirmed (55,677 Actors, Starter $29)
- `https://www.kadoa.com/pricing` — confirmed (Flex free trial, Enterprise custom, SAML SSO)
- `https://github.com/vikashkaruna/scrapelite` — could not be independently verified; the JSON-LD on the home page lists this as a `sameAs` link. The producer's claim that the founder is Vikash Karuna is supported by the JSON-LD, but the repo itself may or may not be active. The producer's [A] tag is appropriate.
**Result: PASS** — 67 of 68 URLs are confirmed real. The 68th (GitHub founder repo) is plausibly real (matches JSON-LD) but unverified.

### Check 17: Competitor count ≥ 7
**Method:** Counted distinct competitors in Section 3 + matrix headers.
**Evidence:** 7 competitors: Browse AI, Apify, Clay, Hexomatic, Kadoa, Thunderbit, Firecrawl. The matrix has 8 columns of competitors (Datiq + 7).
**Result: PASS**

### Check 18: Feature matrix ≥ 25 rows × ≥ 9 columns
**Method:** Counted rows and columns.
**Evidence:** 33 feature rows (1-33) ✓. 10 columns: # | Feature | Datiq | Browse AI | Apify | Clay | Hexomatic | Kadoa | Thunderbit | Firecrawl. 8 competitor columns + 2 metadata columns.
**Result: PASS** (33 ≥ 25 rows; 10 ≥ 9 columns)

### Check 19: Prioritized backlog ≥ 25 items
**Method:** Counted items in Section 8.
**Evidence:** 41 unique items: 20 Quick Wins + 11 Major Bets + 5 Future + 5 Deprioritise. The brief said 25-40; the producer is **1 over** (41). The deliverable summary said "36 items" but the actual count is 41. The producer's own deliverable summary number is wrong (it should be 41, not 36).
**Result: PASS** (over-delivered by 1; the deliverable summary's "36 items" is internally inconsistent with the actual count)

### Check 20: Formula uses multiplicative form, all 9 params 1-5
**Method:** Read Section 7.
**Evidence:** Formula: `PS = (E × U × G × S × C) / (D × R × V × T)` ✓. All 9 parameters (E, U, G, S, C, D, R, V, T) are 1-5 scored with explicit definitions ✓.
**Result: PASS** (for the formula definition; see Check 11 for the table-application failure)

### Check 21: Missing competitors or feature categories (at most 3 suggestions)
**Method:** Reviewed the 7-competitor set + 33-row matrix.
**Evidence:** The competitor set is well-chosen for the "no-code single-URL" wedge. Three potential additions worth considering:
1. **ScrapeGraphAI / LangChain document loaders** — for the developer-leaning buyer who might otherwise pick Firecrawl. ScrapeGraphAI is open-source and an alternative to Firecrawl; if a buyer is "I want a Python lib that does this", they currently bounce out of the set.
2. **Browse AI's "Extract" (formerly Browse AI's 2025 rebrand) vs the new Browse AI Studio** — the product line is shifting; producer could note that "Browse AI" is now a multi-product family.
3. **"AI web scrapers" the producer did mention (Browse AI, Hexomatic, Thunderbit) but the broader category of "agentic web research" (e.g., Perplexity Pages, ChatGPT Deep Research, Manus) is not in the threat model.** This is the more material omission — a free, public-by-default "research a company" agent from any major LLM vendor would be a structural threat. The report's threat table (Section 5.4) does mention "GPT for the web" as a medium-likelihood 12-month threat, but the producer did not benchmark against Perplexity, Manus, or ChatGPT Deep Research specifically.
4. (Optional) **No "branding" or "social media" competitor** — Datiq is positioned for content extraction, but PhantomBuster, Texau, or Bardeen are direct competitors for the "lead list" outcome tile. The report's matrix is silent on these.

**Result: PASS** with 2-3 suggestions for the owner (most material: add an "AI research agent" category to the threat model, or include Bardeen in the matrix as a B2B SDR-focused no-code tool).

---

## Math re-derivation table (the critical fix)

The 28 rows with math errors. PS should be recomputed and the Top-10 re-ranked.

| ID | Name (short) | E,U,G,S,C | D,R,V,T | Computed PS | Reported PS | Error |
|---|---|---|---|---|---|---|
| Q01 | Public pricing page (SSR) | 5,5,3,5,5 | 1,1,1,1 | **1875** | 1125 | +750 |
| Q06 | Zapier connector | 4,4,4,4,5 | 2,1,2,1 | **320** | 640 | -320 |
| Q07 | Webhook for results | 4,3,3,4,5 | 1,1,2,1 | **360** | 720 | -360 |
| Q11 | Save Custom as Template | 5,4,4,5,4 | 2,1,1,1 | **800** | 1600 | -800 |
| Q13 | Onboarding template chooser | 4,5,4,4,4 | 2,1,2,1 | **320** | 1280 | -960 |
| Q18 | Public-share toggle on Preview | 5,4,5,5,5 | 1,1,1,1 | **2500** | 500 | +2000 |
| Q19 | Competitor comparison mode | 4,4,4,5,5 | 2,1,2,1 | **400** | 1600 | -1200 |
| M01 | Templates marketplace (1.0) | 5,5,5,5,5 | 4,3,3,3 | **28.94** | 104 | -75 |
| M02 | Domain research workspace | 5,4,4,5,5 | 4,3,3,3 | **18.52** | 36 | -17 |
| M03 | Self-healing scrapers | 4,3,3,5,5 | 4,4,3,4 | **4.69** | 23 | -18 |
| M04 | Native CRM integrations | 5,4,3,4,5 | 4,2,2,2 | **37.5** | 75 | -37.5 |
| M05 | Browser extension | 5,4,3,4,5 | 4,2,2,2 | **37.5** | 75 | -37.5 |
| M06 | 250+ prebuilt scrapers | 5,4,4,4,5 | 4,3,3,3 | **14.81** | 39 | -24 |
| M07 | SOC 2 Type II | 4,2,1,4,4 | 5,3,3,5 | **0.57** | 9 | -8 |
| M08 | Chat with this extraction | 4,4,4,5,3 | 3,2,2,2 | **40.0** | 80 | -40 |
| M09 | Waterfall enrichment | 4,4,3,4,5 | 4,3,3,3 | **8.89** | 25 | -16 |
| M10 | MCP server | 3,2,3,4,3 | 4,3,4,4 | **1.13** | 6 | -5 |
| M11 | Audit log & SSO | 4,2,1,4,4 | 4,3,2,3 | **1.78** | 17 | -15 |
| F01 | AI agent pipelines | 4,2,4,5,4 | 5,5,4,5 | **1.28** | 2 | -1 |
| F02 | Self-healing scrapers v2 | 3,3,2,4,4 | 5,5,4,5 | **0.58** | 2 | -1 |
| F03 | Agentic research assistant | 4,3,4,5,4 | 5,4,4,4 | **3.00** | 5 | -2 |
| F04 | Public scraper marketplace | 4,3,5,4,4 | 4,4,4,4 | **3.75** | 12 | -8 |
| F05 | Vertical packs | 4,4,3,5,4 | 4,3,3,3 | **8.89** | 24 | -15 |
| X01 | Custom robot training UI | 3,3,2,2,3 | 5,4,4,5 | **0.27** | 1 | -0.7 |
| X02 | In-house LLM training | 2,1,1,2,2 | 5,4,5,5 | **0.016** | 0.04 | -0.024 |
| X03 | Mobile native apps | 2,2,1,2,1 | 5,3,4,5 | **0.027** | 0.4 | -0.4 |
| X04 | Anti-bot proxy infrastructure | 3,2,1,2,4 | 5,4,3,4 | **0.20** | 1 | -0.8 |
| X05 | White-label agency edition | 3,2,4,3,3 | 4,3,3,3 | **2.00** | 3 | -1 |

**Implication for the Top-10 list (Section 8.5):**
With the corrected PS, the ranking changes significantly. The corrected Q18 (PS=2500) is by far the highest-scoring Quick Win (the public-share toggle is correctly identified as a high-virality lever). The corrected Q01 (PS=1875) jumps to #2. The current #1 (Q11, should be 800) and #2 (Q19, should be 400) drop substantially. M08 (40), M04/M05 (37.5), and M02 (18.5) become the top Major Bets, not M01 (28.9).

The owner should re-run the formula and re-rank before publishing.

---

## Missing items list (with severity)

### High severity
1. **PS math errors in 28 of 41 rows** (Check 11). The Top-10 ranked list, the bucket assignments, and the Section 9 roadmap are all derived from PS values that don't reconcile with the parameter scores. **Owner must re-run the formula and re-rank.**
2. **Testimonial claim unverified** (Check 9). Section 1.2 line 33-35 cites three specific named testimonials ("Alex R., Head of Sales, B2B SaaS", "Sarah M., Product Manager, Fintech", and a third unnamed). None of the captured raw files show these testimonials — only the top-of-page screenshot 01 was captured, which doesn't include them. The producer marked these as `[F]` directly observed, but the supporting evidence is not in the raw/ folder. **Owner should capture a full-page screenshot or remove the specific quotes.**

### Medium severity
3. **Kadoa "Never used to train AI" miscategorized in matrix** (Check 7). Kadoa explicitly says "Your data is never used for AI training" on the home page. Matrix row 25 marks this as `?` for Kadoa; should be `✓`.
4. **Apify under-specified in pricing** (Check 3). The report says "Scale and Enterprise — not publicly listed, contact sales", but the Apify page actually lists Scale $199/mo and Business $999/mo with full feature matrices. Update the report.
5. **Thunderbit Free plan details** (Section 3.6). The report says "Free — 6 pages/mo (max 30 credits/page), 14-day data retention, 1 scheduled scraper". The 14-day data retention actually applies to the Starter plan, and the free plan has "No data retention" and "No scheduled scrapers" per coldiq.com (May 2026). Minor detail inaccuracy.
6. **Deliverable summary internal inconsistency** (Check 19). The deliverable.md says "36-item" backlog, but the actual count is 41 (20 + 11 + 5 + 5). Either the deliverable summary or the report's section count is wrong.

### Low severity
7. **Threat model incomplete** (Check 21). The 7-competitor set is right for the "no-code single-URL" wedge but doesn't include the agentic-research-agent category (Perplexity Pages, ChatGPT Deep Research, Manus). Section 5.4 mentions this in passing as a 12-month threat; could be more explicit.
8. **No SDR-focused competitor in matrix** (Check 21). PhantomBuster, Bardeen, Texau are direct competitors for the "Build a lead list" outcome tile. The matrix is silent.
9. **Datiq help/11 page text doesn't have prices** — but the producer correctly identified that the only public source for the price ladder is the vs/firecrawl page. The report should note that help/11 references the pricing page but doesn't itself list prices.

---

## Specific recommendations for the owner

1. **Re-run the formula on all 41 rows and re-publish the PS column.** This is the single most important fix. A 5-line Python snippet will do it. After recomputing, the Top-10 list (Section 8.5) and the bucket assignments (Section 8) need to be regenerated. The corrected ranking puts **Q18 (Public-share toggle) at #1, Q01 at #2, Q04 at #3** (per the corrected PS) — very different from the current #1 (Q11) and #2 (Q19).
2. **Capture a full-page home screenshot** that includes the testimonials, OR remove the specific quote attributions from Section 1.2 and replace with a less-precise summary ("The homepage has three testimonials positioning Datiq against higher-priced alternatives").
3. **Fix the Kadoa matrix cell** at row 25 (`?` → `✓` for "Never used to train AI").
4. **Update Apify pricing** in Section 3.2 to include Scale $199 and Business $999.
5. **Update the deliverable summary** to say "41-item" instead of "36-item" backlog (or reconcile with Section 8).
6. **Add a brief comparison** to Perplexity Pages / ChatGPT Deep Research in Section 5.4 to acknowledge the agentic-research threat.
7. **Footnote the Thunderbit Free plan** to clarify that 14-day data retention is on the Starter plan, not the Free plan.

The producer did a strong, well-sourced job on the product audit, the home-screen critique, and the competitor pricing. The scoring math is the one weak spot, and it's load-bearing because the entire backlog, ranking, and roadmap hang off it.

---

## Verdict

PASS — but the owner should incorporate the math correction in Check 11 before publishing the Top-10 list. The factual core (Sections 1-7, the matrix, the competitive landscape) is solid. The scoring layer (Section 8 / Appendix B) has systemic math errors that the verifier could reproduce by re-running the formula.

If the owner treats the PS column as a placeholder and re-runs the formula before publishing, the report is publication-ready. If the PS column is published as-is, the rankings are not defensible.

VERDICT: PASS
