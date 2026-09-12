# DatIQ — Pricing & Packaging Model, Revenue Projections & Unit Economics
**Council verdict D4: Gemini-shaped 4-tier ladder + DeepSeek modular add-ons; Claude conversion mechanics**
Version 1.0 · August 2026

---

## 1. Pricing Principles

1. **Ungated magic moment stays free** — the URL box converts; never wall it (ChartMogul 2026: ungated freemium converts best; 7–9% is "good").
2. **Land at $29, expand to $399+** — DeepSeek's $99 entry is wrong for a zero-review product today, but right as the *Pro* anchor; the ladder carries users up as pillars ship.
3. **Modules monetize as add-ons** — AI Visibility, Social Topic Packs, Executive Intelligence attach to any paid tier; this is how ARPU scales toward enterprise without repricing the base.
4. **Pass-through where possible** — Apollo runs on the user's key (COGS ≈ 0); X gated to Pro.
5. **Price evolves with proof** — Year-2 review targets +20–30% list increases once reviews, SOC 2, and case studies exist (grandfather existing).

---

## 2. Tier Structure & Feature Matrix

| Feature / Limit | **Free** | **Starter $29/mo** | **Pro $99/mo** | **Business $399/mo** | **Enterprise custom (≈$1,499+)** |
|---|---|---|---|---|---|
| Monthly extractions | 10 | 200 | 1,000 | 5,000 | Unlimited |
| Batch runs /mo | 5 | 50 | 200 | 1,000 | Unlimited |
| Schedules + change-detection alerts | 1 | 10 | 50 | 200 | Unlimited |
| Result permalinks, export (JSON/CSV/MD) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Social mentions /mo | — | 2,000 | 10,000 | 50,000 | Custom |
| Tracked keywords (incl. competitors) | — | 5 | 25 | 100 | Unlimited |
| Sentiment + intent tagging | — | Basic | Advanced + trends | Advanced + API | Custom models |
| Social sources | — | Reddit + RSS | + Twitter/X | + YouTube/news | Custom |
| CRM connectors | — | 1 (HubSpot **or** Apollo) | All (incl. Calendly briefs, R2) | All + Salesforce (R4) | Custom integrations |
| Company Intelligence (R2) | — | 5 profiles/mo | 50/mo | 250/mo | Unlimited |
| Competitive Intelligence / battlecards (R2) | — | — | ✓ | ✓ + win/loss | ✓ |
| REST API calls /mo | — | 1,000 | 10,000 | 50,000 | Unlimited + webhooks |
| MCP server access (R2) | — | — | ✓ | ✓ | ✓ |
| Seats | 1 | 3 | 10 | 25 | Unlimited + SSO/SAML |
| Data retention | 30 d | 90 d | 1 yr | 2 yr | Unlimited + residency |
| AI training on customer data | Never | Never | Never | Never | Never |
| Support | Community | Email 48h | Priority 4h | Priority + onboarding | Dedicated CSM + Slack |

**Add-ons (any paid tier):** AI Visibility Intelligence (R3) $99/mo · Social Topic Pack (+5 keywords, +5k mentions) $49/mo · Executive Intelligence briefs (R4) $199/mo · Extra extraction credits $0.75/1,000 ops · Dedicated proxy pool $250/mo · Premium data connectors $99/mo each · Community Moderator seats (R3) $29/seat.
**Annual = 2 months free.** Starter is the "Most Popular" badge tier at launch; badge moves to Pro at R2 when Calendly briefs + Company Intelligence land.

**Upgrade-path logic:** Free proves extraction → Starter adds social + one connector ($29 impulse threshold) → Pro unlocks X source, all connectors, competitive intel, API/MCP ($99 team decision) → Business adds scale + battlecards + seats → Enterprise adds trust (SSO, SOC 2, residency).

---

## 3. Revenue Projections (24-month, bottom-up)

Assumptions: R0 SEO/permalink engine compounds acquisition; paid tiers live Month 3 (Wk 10); conversion improves 1–2% → 4–5% as multi-module value lands (multi-product platforms convert 2–3× single-product); churn declines with connector switching costs; add-ons attach from Month 8 (R3).

| Metric | M3 | M6 | M12 | M18 | M24 |
|---|---|---|---|---|---|
| Registered users | 1,500 | 5,000 | 16,000 | 42,000 | 85,000 |
| MAU | 600 | 2,000 | 8,000 | 21,000 | 42,500 |
| Starter subs ($29) | 15 | 80 | 330 | 850 | 1,700 |
| Pro subs ($99) | 3 | 22 | 110 | 380 | 800 |
| Business subs ($399) | 0 | 3 | 18 | 60 | 140 |
| Enterprise accounts (avg $1,499) | 0 | 0 | 4 | 12 | 28 |
| Add-on MRR | — | — | $4,900 | $18,200 | $41,500 |
| **MRR** | $732 | $5,695 | $39,027 | $122,375 | $260,272 |
| **ARR run-rate** | $8.8K | $68K | **$468K** | **$1.47M** | **$3.12M** |
| Free→paid conversion | 3.0% | 3.5% | 4.0% | 4.6% | 5.0% |
| Monthly churn | 5.0% | 4.5% | 4.0% | 3.3% | 2.8% |
| CAC (blended) | $45 | $38 | $30 | $24 | $20 |
| LTV (blended) | $95 | $210 | $470 | $780 | $1,050 |
| LTV:CAC | 2.1× | 5.5× | 15.7× | 32× | 52× |
| NRR | — | — | 104% | 112% | 118% |

Scenario band at M24: conservative $1.9M ARR (conversion stalls at 3.5%, no add-on attach) · base $3.12M · aggressive $5.4M (AI Visibility attach ≥25% + enterprise pull-forward). Sits between Claude's $1.6M (base-tier-only model) and Gemini's $6M (Year-3 figure) — the add-on layer is the delta driver.
**Reconciliation note:** DeepSeek's Year-1 $1.16M assumed $99/$499/$1,999 pricing from day one; council rejected the entry price (D4) but its Year-2/3 ARPU trajectory is recovered here through tier-up migration + add-ons.

---

## 4. Unit Economics

### 4.1 Cost per customer per month (fully loaded)

| Component | Free | Starter $29 | Pro $99 | Business $399 | Ent. ~$1,499 |
|---|---|---|---|---|---|
| Infra (Supabase, Redis, hosting) | $0.50 | $0.80 | $1.60 | $6.00 | $18 |
| Social APIs (X amortized, Reddit, RSS) | — | $1.80 | $9.50 | $32 | $85 |
| LLM inference (sentiment/intent/summaries) | $0.05 | $1.20 | $4.80 | $18 | $55 |
| Connector API + webhook egress | — | $1.00 | $4.00 | $12 | $30 |
| Support (allocated) | $0 | $2.00 | $5.00 | $18 | $150 (CSM) |
| **Total cost** | **$0.55** | **$6.80** | **$24.90** | **$86** | **$338** |
| **Gross margin** | n/a | **77%** | **75%** | **78%** | **77%** |

Blended paid GM ≈ **76%** at M12 → **80%+** by M24 as DeepSeek optimizations land: datacenter-first proxy routing, browser-context reuse, small-model-first inference (fine-tuned 8B for standard parsing, frontier LLM fallback only), Redis entity-lookup caching, Apollo pass-through. Per-1,000-operations COGS target: **$0.60** (proxy $0.18 · headless compute $0.22 · LLM/NLP $0.12 · third-party API $0.08).

### 4.2 Guardrails
Free-user cost capped at $0.55/mo (10 extractions, no social) → sustainable at 80k registered · X API is the COGS wildcard → Pro-gated with per-workspace collector-level quotas · CAC payback target <6 months by M12 (achieved M9 in base case) · investor thresholds: GM >60% ✓, NRR >110% by M18 ✓, LTV:CAC >4× from M6 ✓.

### 4.3 Pricing experiments backlog
A/B Starter $29 vs $39 (M6) · annual-toggle default-on test · AI Visibility $99 vs $149 at launch (category is price-elastic upward) · usage-based API overage vs hard caps for developer persona · INR/regional pricing for India GTM (M12, DPDPA-positioned).
