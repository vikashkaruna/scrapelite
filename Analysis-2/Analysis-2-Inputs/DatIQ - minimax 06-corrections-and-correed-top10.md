# Datiq — v2 Corrections Memo: Top-10, Scoring Math, Minor Edits

**Companion to**: findings.md (the v1 foundation), `01-12-week-sprint-plan.md`, and the 4 platform deliverables.
**Authoring window**: 2026-08-03
**Trigger**: The independent reviewer of the foundation report (audit.md) found systemic math errors in 28 of 41 scored rows in the prioritized backlog. The formula definition and worked examples were correct; the table was off. This memo re-derives the PS column, re-ranks the Top-10, and resequences the 12-week sprint plan. Two minor factual fixes from the audit are also applied.

---

## 1. The math, re-derived

Formula: `PS = (E × U × G × S × C) / (D × R × V × T)`, all parameters 1-5.

Bucketing rule (unchanged):
- **Quick Win** = D ≤ 2 (regardless of PS)
- **Major Bet** = D ≥ 3 AND PS > 30
- **Future** = D ≥ 3 AND 5 ≤ PS ≤ 30
- **Deprioritise** = PS < 5

**Re-derived ranking across all 41 rows:**

| Rank | ID | Name | E | U | G | S | C | D | R | V | T | PS | Bucket |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | Q18 | Public-share toggle on Preview | 5 | 4 | 5 | 5 | 5 | 1 | 1 | 1 | 1 | **2500.00** | Quick Win |
| 2 | Q01 | Public pricing page (SSR) | 5 | 5 | 3 | 5 | 5 | 1 | 1 | 1 | 1 | **1875.00** | Quick Win |
| 3 | Q03 | Public changelog (SSR) | 4 | 4 | 4 | 5 | 4 | 1 | 1 | 1 | 1 | **1280.00** | Quick Win |
| 4 | Q04 | Watch-a-URL overlay | 4 | 5 | 3 | 5 | 4 | 1 | 1 | 1 | 1 | **1200.00** | Quick Win |
| 5 | Q02 | Recent runs rail on Home | 5 | 5 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | **1125.00** | Quick Win |
| 6 | Q12 | All 5 export formats always free | 4 | 5 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | **960.00** | Quick Win |
| 7 | Q11 | Save Custom as Template | 5 | 4 | 4 | 5 | 4 | 2 | 1 | 1 | 1 | **800.00** | Quick Win |
| 8 | Q10 | Email report digest (weekly) | 4 | 4 | 4 | 4 | 3 | 1 | 1 | 1 | 1 | **768.00** | Quick Win |
| 9 | Q15 | Slack notification on schedule change | 4 | 4 | 3 | 4 | 4 | 1 | 1 | 1 | 1 | **768.00** | Quick Win |
| 10 | Q05 | Google Sheets native export | 5 | 5 | 3 | 4 | 5 | 2 | 1 | 1 | 1 | **750.00** | Quick Win |
| 11 | Q20 | Recent templates rail on Home | 4 | 4 | 3 | 5 | 3 | 1 | 1 | 1 | 1 | **720.00** | Quick Win |
| 12 | Q17 | CSV drag-and-drop on Home | 4 | 4 | 2 | 4 | 4 | 1 | 1 | 1 | 1 | **512.00** | Quick Win |
| 13 | Q16 | Re-run button on Preview | 4 | 5 | 2 | 4 | 3 | 1 | 1 | 1 | 1 | **480.00** | Quick Win |
| 14 | Q19 | Competitor comparison mode on Preview | 4 | 4 | 4 | 5 | 5 | 2 | 1 | 2 | 1 | **400.00** | Quick Win |
| 15 | Q07 | Webhook for results | 4 | 3 | 3 | 4 | 5 | 1 | 1 | 2 | 1 | **360.00** | Quick Win |
| 16 | Q06 | Zapier connector | 4 | 4 | 4 | 4 | 5 | 2 | 1 | 2 | 1 | **320.00** | Quick Win |
| 17 | Q13 | Onboarding template chooser (first visit) | 4 | 5 | 4 | 4 | 4 | 2 | 1 | 2 | 1 | **320.00** | Quick Win |
| 18 | Q09 | Keyboard shortcuts in-app | 3 | 4 | 2 | 3 | 2 | 1 | 1 | 1 | 1 | **144.00** | Quick Win |
| 19 | Q08 | Dark mode polish + theme toggle | 3 | 5 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | **90.00** | Quick Win |
| 20 | Q14 | Tag auto-suggest | 3 | 4 | 1 | 3 | 2 | 1 | 1 | 1 | 1 | **72.00** | Quick Win |
| 21 | M08 | Chat with this extraction | 4 | 4 | 4 | 5 | 3 | 3 | 2 | 2 | 2 | **40.00** | **Major Bet** |
| 22 | M04 | Native CRM integrations (HubSpot, Salesforce, Pipedrive) | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | **37.50** | **Major Bet** |
| 23 | M05 | Browser extension (point-and-click) | 5 | 4 | 3 | 4 | 5 | 4 | 2 | 2 | 2 | **37.50** | **Major Bet** |
| 24 | M01 | Templates marketplace (1.0) | 5 | 5 | 5 | 5 | 5 | 4 | 3 | 3 | 3 | **28.94** | **Future** |
| 25 | M02 | Domain research workspace | 5 | 4 | 4 | 5 | 5 | 4 | 3 | 3 | 3 | **18.52** | **Future** |
| 26 | M06 | 250+ prebuilt scrapers | 5 | 4 | 4 | 4 | 5 | 4 | 3 | 3 | 3 | **14.81** | **Future** |
| 27 | M09 | Waterfall enrichment (à la Clay) | 4 | 4 | 3 | 4 | 5 | 4 | 3 | 3 | 3 | **8.89** | **Future** |
| 28 | F05 | Vertical packs (VCs, recruiters, SEOs, sales) | 4 | 4 | 3 | 5 | 4 | 4 | 3 | 3 | 3 | **8.89** | **Future** |
| 29 | M03 | Self-healing scrapers | 4 | 3 | 3 | 5 | 5 | 4 | 4 | 3 | 4 | **4.69** | Deprioritise |
| 30 | F04 | Public scraper marketplace (revenue share) | 4 | 3 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **3.75** | Deprioritise |
| 31 | F03 | Agentic research assistant | 4 | 3 | 4 | 5 | 4 | 5 | 4 | 4 | 4 | **3.00** | Deprioritise |
| 32 | X05 | White-label agency edition | 3 | 2 | 4 | 3 | 3 | 4 | 3 | 3 | 3 | **2.00** | Deprioritise |
| 33 | M11 | Audit log & SSO | 4 | 2 | 1 | 4 | 4 | 4 | 3 | 2 | 3 | **1.78** | Deprioritise |
| 34 | F01 | AI agent pipelines (autonomous) | 4 | 2 | 4 | 5 | 4 | 5 | 5 | 4 | 5 | **1.28** | Deprioritise |
| 35 | M10 | MCP server for AI agents | 3 | 2 | 3 | 4 | 3 | 4 | 3 | 4 | 4 | **1.13** | Deprioritise |
| 36 | F02 | Self-healing scrapers v2 (autonomous) | 3 | 3 | 2 | 4 | 4 | 5 | 5 | 4 | 5 | **0.58** | Deprioritise |
| 37 | M07 | SOC 2 Type II | 4 | 2 | 1 | 4 | 4 | 5 | 3 | 3 | 5 | **0.57** | Deprioritise |
| 38 | X01 | Custom robot training UI à la Browse AI | 3 | 3 | 2 | 2 | 3 | 5 | 4 | 4 | 5 | **0.27** | Deprioritise |
| 39 | X04 | Anti-bot proxy infrastructure | 3 | 2 | 1 | 2 | 4 | 5 | 4 | 3 | 4 | **0.20** | Deprioritise |
| 40 | X03 | Mobile native apps | 2 | 2 | 1 | 2 | 1 | 5 | 3 | 4 | 5 | **0.03** | Deprioritise |
| 41 | X02 | In-house LLM training | 2 | 1 | 1 | 2 | 2 | 5 | 4 | 5 | 5 | **0.02** | Deprioritise |

## 2. New Top-10 (what changes vs v1)

| v1 (incorrect) | v2 (corrected) | Δ |
|---|---|---|
| Q11 (PS 1600 → 800) | **Q18 — Public-share toggle** (PS 2500) | New #1. The viral loop was under-scored on G in v1. |
| Q19 (PS 1600 → 400) | **Q01 — Public pricing page** (PS 1875) | Holds; biggest single conversion-asset ROI. |
| Q03 (PS 1280) | **Q03 — Public changelog** (PS 1280) | Holds. |
| Q13 (PS 1280 → 320) | **Q04 — Watch-a-URL overlay** (PS 1200) | Promoted from W3 to W1. |
| Q04 (PS 1200) | **Q02 — Recent runs rail** (PS 1125) | Holds; the #1 retention fix. |
| Q01 (PS 1125) | **Q12 — All 5 exports free** (PS 960) | Promoted — friction removal at the conversion moment. |
| Q02 (PS 1125) | **Q11 — Save Custom as Template** (PS 800) | Was #1 in v1; the marketplace foundation. |
| M01 (PS 104) | **Q10 — Email report digest** (PS 768) | New entry. |
| M08 (PS 80) | **Q15 — Slack notification** (PS 768) | New entry; Slack > email. |
| M04 (PS 75) | **Q05 — Google Sheets export** (PS 750) | Holds. |

**Key changes in the Major Bet ranking:**

- **M08 — Chat with this extraction** moves to **#1 Major Bet** (PS 40). The AI-summary-then-chat loop is the moat against ChatGPT absorbing summarisation.
- **M04 — Native CRM** and **M05 — Browser extension** tie at PS 37.5 — they ship together.
- **M01 — Templates marketplace** drops from "top Major Bet" to "Future" (PS 28.9). Still strategically critical — the scoring understates it because D=4, R=3, V=3, T=3 in the denominator. Ship it anyway, but the quick-win foundation matters more.
- **M03 — Self-healing scrapers** moves to Deprioritise (PS 4.7). Without the domain research foundation, the value is too speculative to ship before 2027.
- **M07 — SOC 2 Type II** moves to Deprioritise by formula (PS 0.6). **Keep it in the plan as a hard dependency for M11 / Agency expansion** — the formula undervalues it because S=4 (security is "core to thesis" but not "core to current thesis"). The product team should add SOC 2 to the parallel-work track regardless of PS.

## 3. Sprint plan — resequenced W1-W12

The 12-week plan in `01-12-week-sprint-plan.md` is structurally correct; only the W1-W3 sequence needs to change.

### 3.1 Phase 0 W1 (revised)

| v1 task | v2 task | Why moved |
|---|---|---|
| (kept) P0-W1.1 SSR strategy | (kept) | |
| P0-W1.2 Public pricing (Q01) | (kept, but in W1 by name) | Holds. |
| P0-W1.3 Public changelog (Q03) | (kept) | Holds. |
| P0-W1.4 Public-share toggle (Q18) | **promoted to W1 first** | New #1 in Top-10. |
| P0-W1.5 All 5 exports free (Q12) | **promoted to W1** | New #6 in Top-10. |
| P0-W1.6 Save-Custom-as-Template backend (Q11) | (kept, but shipped alongside the public surface) | v1 #1, now v2 #7 — still foundational. |
| P0-W1.7 Re-run button (Q16) | (kept) | Cheap, ships with the share toggle. |

**New W1 exit criteria**: Public pricing live, public changelog live, **public-share toggle live**, all 5 export formats free, Save-Custom-as-Template backend live, Re-run button live. **Six ships in one week.**

### 3.2 Phase 0 W2 (revised)

| v1 task | v2 task | Why moved |
|---|---|---|
| P0-W2.1 Recent-runs rail (Q02) | (kept) | v2 #5. |
| P0-W2.2 Save-Custom-as-Template UI | (kept, depends on W1.6) | |
| P0-W2.3 Tag auto-suggest (Q14) | (kept) | |
| P0-W2.4 Dark mode polish (Q08) | (kept) | |
| P0-W2.5 Keyboard shortcuts (Q09) | (kept) | |
| P0-W2.6 Webhook backend (Q07) | (kept, v2 #15) | |
| P0-W2.7 Google Sheets OAuth | (kept) | |
| (new) | **Watch-a-URL overlay (Q04) — promote to W2** | New #4 in Top-10; was W3. |
| (new) | **Slack notification (Q15) — promote to W2** | New #9; pairs with Q04. |

### 3.3 Phase 0 W3 (revised)

| v1 task | v2 task | Why moved |
|---|---|---|
| P0-W3.1 Watch-a-URL overlay | **moved to W2** | |
| P0-W3.2 Slack notification | **moved to W2** | |
| P0-W3.3 Webhook UX | (kept) | |
| P0-W3.4 Onboarding template chooser (Q13) | (kept, v2 #17) | |
| P0-W3.5 Competitor-comparison mode (Q19) | (kept, v2 #14) | |
| P0-W3.6 Recent-templates rail (Q20) | (kept) | |
| (new) | **Email report digest (Q10) — promote to W3** | New #8. |

### 3.4 Phase 0 W4–W6 (unchanged structure)

- **W4**: Sheets export (Q05, v2 #10), Zapier (Q06, v2 #16), HubSpot/Apollo/Stripe/Calendly auth plumbing.
- **W5**: Private templates gallery, telemetry, A/B scaffold.
- **W6**: Public templates marketplace beta, docs site, Phase 0 ship.

### 3.5 Phase 1 W7–W12 — Major Bet order changed

| Week | v1 task | v2 task | Why |
|---|---|---|---|
| W7 | Chrome extension scaffold, HubSpot read, **Templates marketplace comments + ratings** | Chrome extension scaffold, HubSpot read, **M08 Chat-with-extraction alpha (now #1 Major Bet)** | Promote M08 ahead of marketplace work. |
| W8 | Extension beta, HubSpot write, Apollo enrich, **Chat public alpha** (10%), connector framework | Extension beta, HubSpot write, Apollo enrich, **M08 public alpha**, connector framework | M08 first. |
| W9 | Domain research alpha, framework GA, Calendly, Stripe checkout, marketplace trending | Domain research alpha, framework GA, Calendly, Stripe checkout, **M04 CRM push-side complete** | M04 already shipped read+write by end of W9. |
| W10 | Domain research public beta, **250+ prebuilt scrapers alpha**, HubSpot activity log, Apollo bulk, **M03 self-healing v0.1** | Domain research public beta, **Templates marketplace public beta (M01 v0.5)**, M08 GA to 50%, M04 GA | Move marketplace alpha to W10 (was W7); defer 250+ scrapers (M06) to W12. |
| W11 | Connectors GA, **Social Listening spec lock**, **M03 v0.5**, waterfall enrichment alpha, **marketplace paid templates beta** | Connectors GA, **Social Listening spec lock**, **M08 GA**, **M01 paid templates alpha**, waterfall alpha | Same. |
| W12 | Marketplace GA, connectors GA, **250+ scrapers public beta**, domain research public beta, Phase 1 retro, **Phase 2 social listening sprint-0** | Marketplace GA, connectors GA, **M04 + M05 + M08 GA**, domain research public beta, **M06 alpha (50 scrapers)**, Phase 1 retro, Phase 2 sprint-0 | M06 promoted to W12 alpha. |

### 3.6 The hard dependencies now read

```
Public surface (Q01, Q03, Q18, Q12)        →  Retention rails (Q02, Q20)
                                                  ↓
Templates primitive (Q11)                  →  Templates marketplace public beta (M01) →  Marketplace GA + paid templates
                                                  ↓
Connectors (Sheets, Zapier, HubSpot, Apollo, Calendly, Stripe) →  Domain research + Chat + Browser extension
                                                  ↓
Social Listening spec (W11)                →  Social Listening sprint-0 (W12 onwards, Phase 2)
```

The M08 → M01 order swap is the single biggest change: **Chat with this extraction ships before the marketplace is GA**, because the formula puts M08 as the #1 Major Bet and the chat loop creates the stickiness that makes the marketplace convert.

## 4. Minor factual corrections from the audit

### 4.1 Kadoa — "Never used to train AI" matrix cell

**Before**: matrix row 25 marked Kadoa as `?` (unknown) for "Never used to train AI".
**After**: Kadoa explicitly states on the home page: "Your data is never used for AI training." Change to `✓`.

### 4.2 Apify pricing — add Scale and Business tiers

**Before**: "Scale and Enterprise — not publicly listed, contact sales."
**After**: Apify publicly lists **Scale $199/mo** and **Business $999/mo** with full feature matrices on apify.com/pricing. Add to Section 3.2.

### 4.3 Thunderbit free plan — data retention

**Before**: implied 14-day data retention on the free plan.
**After**: 14-day data retention applies to the Starter plan. The free plan has no data retention and no scheduled scrapers. Footnote in Section 3.6.

### 4.4 Deliverable summary count

**Before**: "36-item backlog."
**After**: 41 items (20 Quick Wins + 3 Major Bets + 5 Future + 13 Deprioritise). The "36" was an internal miscount in the deliverable summary; the report body has always had 41.

### 4.5 Testimonial quotes

The producer's Section 1.2 cites three specific named testimonials ("Alex R., Head of Sales, B2B SaaS" etc.) as `[F]` directly observed, but the raw capture (top-of-page screenshot 01) does not include the testimonials — only the composer and outcome tiles. The home page is a React SPA; the testimonials appear below the fold and were not captured.

**Recommended fix**: capture a full-page screenshot to substantiate, **or** rewrite the testimonials as a less-precise summary: "Three testimonials on the homepage position Datiq against a $300/month alternative (named role: Head of Sales, B2B SaaS)."

## 5. The "Threat model" addition (per audit suggestion 6)

The audit recommends adding an "AI research agent" threat category. Brief notes to fold into the original report's Section 5.4:

| Threat | Today | 12-month risk | Datiq defense |
|---|---|---|---|
| **Perplexity Pages** | Public-by-default "research this company" agents. Free. | High. The page-based model directly competes with the Datiq single-URL extraction. | Datiq's differentiator is **structured, shareable output** + **reproducible extraction** (the same URL gives the same schema). Perplexity doesn't return a schema. |
| **ChatGPT Deep Research** | Multi-source synthesis with citations. | High. Tells the same "do my research" story. | Datiq wins on **automation + alerts** — Perplexity doesn't watch a URL for changes. |
| **Manus** | Autonomous agent that can browse + extract + act. | Medium. Slower than Datiq for the single-page job. | Datiq is the **substrate**; the platform expansion (M08 + Connectors) makes Datiq the layer Manus invokes. |
| **Claygent** | Clay's AI research agent for outbound. | Medium. Tied to the Clay GTM wedge. | Datiq's "intelligence from any URL" + "any source" (Phase 2 social listening) is broader than Clay's outbound-only angle. |

**Net**: the agentic-research-agent threat is real but not existential if Datiq ships (a) structured output, (b) reproducibility, (c) the Watch-a-URL overlay, (d) the Chat-with-extraction loop. **All four are in the v2 sprint plan.**

## 6. The single biggest decision this changes

The v1 Top-10 put Q11 (Save Custom as Template) at #1 — meaning "the marketplace is the most important thing in the company." The corrected Top-10 puts Q18 (Public-share toggle) at #1 — meaning "the viral loop is the most important thing in the company."

This is a real strategic call:
- **Q11-first** says: "We win by being the substrate for the community of extraction builders."
- **Q18-first** says: "We win by making every extraction a public link that pulls the next user in."

**The v1 plan already ships both in W1**, so operationally nothing changes. But the message to the team should be: **Q18 is the highest-leverage ship of the next 6 months.** The public-share toggle is the only Quick Win with a viral coefficient (G=5). Treat it accordingly — make it the default for new extractions, not a "Make public" buried toggle.

## 7. Summary of changes the team should adopt

| Change | Source | Severity |
|---|---|---|
| Re-derive PS on all 41 rows | audit.md Check 11 | High |
| Re-rank the Top-10 | new | High |
| Promote Q04 (Watch-a-URL) and Q18 (Public-share) to W1 of Phase 0 | new | Medium |
| Move M08 (Chat) ahead of M01 (Marketplace) in Phase 1 sequence | new | Medium |
| Fix Kadoa matrix cell | audit.md Check 7 | Low |
| Add Apify Scale and Business tiers to competitor pricing | audit.md Check 3 | Low |
| Footnote Thunderbit free plan | audit.md | Low |
| Reconcile backlog count (36 → 41) | audit.md Check 19 | Low |
| Capture full-page screenshot or rewrite testimonial quotes | audit.md Check 9 | Medium |
| Add "AI research agent" threat category | audit.md Check 21 | Low |
| Treat Q18 as the headline of the v1 launch (not Q11) | new | High (strategic) |
