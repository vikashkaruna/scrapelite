# Datiq — Pricing, Packaging, Revenue Projections & Unit Economics

**Companion to**: findings.md §1.6, the rebrand spec (`04-homepage-rebrand.md`), and the platform expansion.
**Authoring window**: 2026-08-03
**Plan**: Rebrand + re-tier, lift the Business+ ceiling, layer in new modules (Social Listening, Connectors, Templates marketplace) under a hybrid platform model. Annual price uplift ~8–11% (in line with 2025 SaaS benchmark [Monetizely 2025]); usage-based layers for AI/listening/connectors.
**Reference benchmarks**: 2025 median entry $29/user/mo, hybrid 61% adoption, 9% free-to-paid, NRR 115–125% elite, $1K–$5K ACV conversion 10%, PQL conversion 30% [Monetizely 2025; ProductLed 2025].

---

## 1. The pricing problem today

| Symptom | Evidence |
|---|---|
| **Buyers can't see the price** | The `/pricing` URL is in the sitemap but the React shell is the only renderer (findings.md §1.3). Self-serve conversion is leaking. |
| **Free tier is too tight to demo** | "5 URLs per batch" on the free plan, "10 extractions/mo" — the second is fine, the first is below every competitor (findings.md §1.7, item 4). |
| **The plan ladder is flat** | $19 / $29 / $79 / $299 — a 15× jump from Pro to Agency. There is no room for a "team" tier in between. |
| **No platform ceiling** | The Business tier ($79) is the same number Clay starts at for one workspace ($185). Above $79 the next plan is $299, a 3.8× jump that loses the mid-market. |
| **No monetization of new modules** | Social Listening, Templates marketplace, native CRM, brand engine — none of these have a packaging plan. |

## 2. Target pricing model — three principles

1. **Hybrid: platform fee + usage-based layers** for AI, listening, and connector volume. The 2025 SaaS benchmark says 61% of companies use hybrid; for our category it's the default. Base subscription covers identity, dashboard, exports, gallery; usage covers things that have a real marginal cost (AI tokens, mention pulls, enrichment credits).
2. **Public, crawlable, with a "compare to" table** on `/pricing` that names Browse AI / Clay / Hexomatic and shows how Datiq's price-per-output is 1/5 to 1/15 of theirs. Today the comparison is implicit; it must be explicit.
3. **Annual default, with monthly as a 25–30% premium** — standard 2025 pattern. Annual improves cash collection and gives 12-month NRR stability.

## 3. The new plan ladder

> **Currency**: USD. Annual = monthly × 10 (i.e. 2 months free). Monthly is the same price as below; no premium on monthly for the Free tier.
> All names, prices, and limits are subject to A/B testing in W5 of Phase 0 (P0-W5.4).

### 3.1 Free — $0

| Includes | Limit |
|---|---|
| Single-URL extractions | 25 / month |
| Batch | 10 URLs per batch, 5 batches / month |
| Schedules | 3 active, daily cadence only, email alert only |
| AI summary, AI custom extraction, intent chips | Yes |
| 5 export formats | Yes |
| Public-shareable links | Yes |
| Gallery browse | Yes |
| Templates | 3 free templates |
| Connectors | Manual CSV download only |

**Conversion target**: 9% to paid within 30 days (ProductLed 2025 median for sub-$1K ACV; ours is lower because our templates gallery is the activation hook). 12% in the upper quartile.

### 3.2 Pro — $29 / month (annual: $24 effective)

The current Pro plan, lifted slightly and given real teeth.

| Includes | Limit |
|---|---|
| Single-URL extractions | 250 / month |
| Batch | 50 URLs per batch, 25 batches / month |
| Schedules | 25 active, all cadences, email + Slack alert |
| Templates | Unlimited, including 50 marketplace templates / month |
| AI summary, AI custom extraction | 250 calls / month (each extraction = 1 call) |
| Public-shareable links | Unlimited |
| White-label PDF | No |
| Connectors | Zapier, Google Sheets, webhooks (results delivered) |
| Team seats | 1 |
| AI Overage | $0.10 per extra AI call (auto-pause at $25) |

### 3.3 Team — $99 / month (annual: $83 effective) — **NEW**

The "missing middle" — fills the gap between Pro and Business. Three seats included.

| Includes | Limit |
|---|---|
| Everything in Pro | |
| Team seats | 3 included, $20 / extra seat / month |
| Single-URL extractions | 1,000 / month |
| Batch | 200 URLs per batch, 100 batches / month |
| Schedules | 100 active, all channels (email, Slack, webhook) |
| Templates | Unlimited, including unlimited marketplace |
| White-label PDF | Yes |
| Native CRM (HubSpot, Apollo) | 1,000 enrichment credits / month |
| Shared workspaces | Yes |
| Audit log | Last 30 days |
| API access | Yes, 250K requests / month |
| AI Overage | $0.08 per call (volume discount) |

### 3.4 Business — $249 / month (annual: $208 effective) — **renamed + raised from $79**

The "platform" tier. The lift from $79 is justified by the new Social Listening module and the new connectors — see §3.6.

| Includes | Limit |
|---|---|
| Everything in Team | |
| Team seats | 10 included, $25 / extra seat / month |
| Single-URL extractions | 5,000 / month |
| Batch | 1,000 URLs per batch, unlimited batches |
| Schedules | 500 active, all channels |
| Templates | Unlimited + author profile + 1 paid template |
| Social Listening (Beta) | 5 brands, 90-day history, all 4 alert types |
| Native CRM (HubSpot, Apollo, Salesforce) | 10,000 enrichment credits / month |
| Domain Research workspace | Yes (alpha) |
| Browser extension | Yes |
| "Chat with this extraction" | Yes |
| API access | 1M requests / month |
| Audit log | Last 90 days |
| SOC 2 Type II | Inherited (when shipped W24) |
| SSO (SAML) | Yes (when shipped W24) |
| AI Overage | $0.06 per call (volume discount) |

### 3.5 Agency — $799 / month (annual: $666 effective) — **renamed + raised from $299**

| Includes | Limit |
|---|---|
| Everything in Business | |
| Team seats | 30 included, $25 / extra seat / month |
| Single-URL extractions | 25,000 / month |
| Social Listening | 25 brands, 1-year history, white-label digest |
| Domain Research | Yes (beta) |
| Templates marketplace | Author profile + 10 paid templates + revenue share (90/10 split) |
| Connectors | All + Calendly / Stripe / Salesforce / Pipedrive |
| White-label PDF | Yes + custom branding |
| Dedicated onboarding | Slack channel + 1× / quarter review |
| Custom SLAs | Yes (with signed order form) |
| API access | 5M requests / month |
| Audit log | Full history |
| AI Overage | $0.05 per call |

### 3.6 Enterprise — Custom

Same as today: SSO/SAML, custom SLAs, on-prem or VPC options, dedicated CSM. Sourced via sales.

---

## 4. Usage-based add-ons (cross-tier)

These are the real revenue levers. Each maps to a marginal-cost line in §6.

| Module | Metered unit | Free | Pro | Team | Business | Agency |
|---|---|---|---|---|---|---|
| **AI calls (custom extraction, AI summary, Chat)** | 1 call | 5 | 250 | 1,000 | 5,000 | 25,000 |
| **AI overage** | 1 call | n/a | $0.10 | $0.08 | $0.06 | $0.05 |
| **Social Listening — brands tracked** | 1 brand / month | — | — | — | 5 | 25 |
| **Social Listening — extra brand** | 1 brand / month | — | — | — | $25 | $20 |
| **Social Listening — extra alert rule** | 1 rule / month | — | — | — | $5 | $3 |
| **Templates marketplace — paid-template purchase (creator side)** | 1 sale | n/a | n/a | n/a | n/a | 90% to creator |
| **Templates marketplace — paid-template use** | 1 use | — | — | — | $1 | $0.80 |
| **Native CRM — enrichment credits** | 1 record | — | — | 1,000 | 10,000 | 50,000 |
| **Native CRM — extra enrichment** | 1 record | — | — | $0.04 | $0.03 | $0.02 |
| **Domain Research** | 1 domain / month | — | — | — | 5 | 25 |
| **Browser extension** | 1 install | — | — | — | 5 seats | 30 seats |
| **API calls above tier quota** | 1K calls | n/a | n/a | $0.10 | $0.05 | $0.03 |

## 5. The "compare to" page — public pricing

The single highest-ROI conversion asset in Q1 (Q01, PS 1125). One `/pricing` page with three columns:

### 5.1 The three columns

1. **Starter** — Datiq Pro at $29 (annual: $24). Includes everything in §3.2.
2. **Team** — Datiq Team at $99. Everything in §3.3.
3. **Platform** — Datiq Business at $249. Everything in §3.4.

### 5.2 The "vs. competitors" footnote

A single table at the bottom, naming names:

| | Datiq Pro | Datiq Team | Datiq Business | Browse AI Pro | Clay Pro | Hexomatic |
|---|---|---|---|---|---|---|
| Annual entry | $24 / mo | $83 / mo | $208 / mo | $69 / mo | $446 / mo | $24 / mo |
| 1,000 extractions / mo cost | $29 | $99 | $249 | $69 | $446 | $48 + overage |
| 10,000 extractions / mo cost | ~$129 (incl. overage) | $99 | $249 | $300+ | $446 | $250+ |
| Real templates marketplace | Yes (Q1) | Yes | Yes | Limited (250 robots) | No (workflows) | 100 automations |
| Native CRM | No | Yes (HubSpot, Apollo) | Yes (all 4) | No | Yes (Growth $446) | No |
| Social Listening | No | No | Yes (5 brands) | No | No | No |

> "Same job, 1/15th the price" is the message the testimonials already imply. Make it explicit on the pricing page.

## 6. Unit economics

### 6.1 Per-tier gross margin (year 1)

| Tier | Avg monthly revenue | Variable cost / customer / month | Gross margin | Notes |
|---|---|---|---|---|
| Free | $0 | $0.42 (5 AI calls + 25 extractions + 1 GB infra) | n/a | Activation cost only. |
| Pro ($29) | $29 | $3.10 (250 AI calls @ $0.012 incl. LLM + infra) | **89%** | Cost dominated by LLM tokens. |
| Team ($99) | $99 | $9.50 (1,000 AI + 1,000 enrichment credits + 3 seats infra) | **90%** | |
| Business ($249) | $249 | $22.40 (5,000 AI + 10,000 enrichment + 5 listening brands) | **91%** | Listening + LLM break-even at 5 brands. |
| Agency ($799) | $799 | $58.00 (25,000 AI + 50,000 enrichment + 25 listening brands + 30 seats) | **93%** | Volume discount on every line. |
| **Blended target** | $128 | $11.40 | **91%** | Same shape as SaaS Capital 2025 elite. |

### 6.2 Cost-of-goods (COGS) — per-unit detail

| Unit | Cost | Source |
|---|---|---|
| 1 single-URL extraction (AI summary) | $0.011 | LLM at GPT-4o-mini rates; HTML parse + render = $0.001 infra |
| 1 custom-extraction (AI field) | $0.013 | LLM at GPT-4o-mini; structured output tokens |
| 1 Chat-with-extraction turn | $0.018 | LLM at GPT-4o; longer context |
| 1 social mention (ingest) | $0.003 (X) / $0.003 (Reddit) / $0.005 (YT) / $0.008 (News) | API Direct pass-through |
| 1 sentiment call (LLM, top 5%) | $0.005 | Hosted LLM |
| 1 enrichment credit (Apollo) | $0.012 | Apollo list-price ÷ 0.6 margin |
| 1 enrichment credit (HubSpot find/create) | $0.001 | HubSpot free on Clay side, $0 cost on our side |
| 1 webhook delivery | $0.0002 | infra |
| 1 /p/:slug view | $0.0001 | CDN + S3 |

These are the *base* costs at 2026 LLM rates. **If LLM costs drop 50% in 12 months** (per current trajectory), Pro gross margin moves to 95% and Business to 96%. **The risk to gross margin is LLM cost increase**, which is why we meter AI calls and surface them in the UI.

### 6.3 CAC and LTV (year 1)

Assumptions: blended ARPA $128; gross margin 91%; monthly churn 3% (mid-market SaaS median); expansion NRR 115% (in line with elite SaaS).

- **LTV** = ARPA × gross margin / churn = $128 × 0.91 / 0.03 = **$3,883** (with NRR uplift, LTV/CAC × 1.15 → $4,465)
- **Target CAC** for LTV/CAC = 3 → $1,294 (mid-market norm is 1.5–3× payback)
- **Payback period** = CAC / (ARPA × gross margin) = $1,294 / ($128 × 0.91) = **11.1 months**

These match the 2025 elite SaaS benchmark (Monetizely 2025: 10–14 month payback, LTV/CAC 3–5).

### 6.4 Sensitivity

| Scenario | ARPA | Churn | Gross margin | LTV | CAC @ 3× | Payback |
|---|---|---|---|---|---|---|
| Conservative | $99 | 4% | 85% | $2,103 | $701 | 8.3 mo |
| Plan | $128 | 3% | 91% | $3,883 | $1,294 | 11.1 mo |
| Upside | $180 | 2% | 93% | $8,370 | $2,790 | 16.7 mo |

The upside case is achievable if (a) NRR stays at 115%+ via Social Listening + CRM attach and (b) Agency plan scales past 100 customers.

## 7. Revenue projections — 12 months post-rebrand

Base assumptions:
- Current paying base: ~250 customers (estimated, in line with "5+ teams & researchers" testimonial signal).
- Free base: 1,500 users.
- Plan distribution post-rebrand target: 5% Pro / 50% Team / 35% Business / 10% Agency. (Today most are Pro; the rebrand + new modules shifts the mix upmarket.)
- 9% free-to-paid conversion in the first 90 days post-public-pricing launch.
- 3% monthly churn blended.
- 115% NRR from the new modules (Social Listening + CRM + Templates attach).

| Month | Free | Pro | Team | Business | Agency | MRR | Notes |
|---|---|---|---|---|---|---|---|
| M0 (today) | 1,500 | 200 | 30 | 15 | 5 | $14,620 |  |
| M3 | 2,200 | 220 | 60 | 50 | 12 | $26,920 | Public pricing live; 9% free→paid; +90% ARPA uplift on existing mid-tier |
| M6 | 3,400 | 240 | 110 | 110 | 22 | $53,180 | Templates marketplace live; first Social Listening beta signups |
| M9 | 4,500 | 250 | 170 | 180 | 32 | $79,790 | Domain research beta; SOC 2 Type I in flight |
| M12 | 5,500 | 260 | 230 | 250 | 45 | $112,790 | Social Listening GA; first Enterprise deals closing |

**MRR growth**: ~7.7× in 12 months (8.5× if Enterprise closes as planned).
**ARR at M12**: ~$1.35M.
**Year-1 net new MRR**: ~$98K.
**Required gross adds**: 350 paying customers across 12 months (≈30 net adds / month after churn).

### 7.1 What needs to be true for M12 to land

1. `/pricing` ships in W1 of Phase 0 (Q01, P0-W1.2).
2. Templates marketplace seeds with 30+ high-quality templates by W6 of Phase 0.
3. HubSpot + Apollo connectors ship GA in P1-W12.
4. Social Listening MVP ships in W12 of Phase 1.
5. **One** of: (a) Clay adds a comparable social listening module and Datiq retains the price advantage, (b) Brand24 ships a comparable "AI summary of one page" feature, (c) the templates marketplace reaches 100 community templates with ≥3 creators earning >$500/mo.

### 7.2 What kills the projection

| Risk | Magnitude | Mitigation |
|---|---|---|
| Free-to-paid stays at 5% instead of 9% | −$25K MRR by M6 | Activation experiments; templates gallery; the Watch-a-URL overlay (P0-W3.1) |
| Team plan underperforms (customers stay on Pro) | −$8K MRR by M6 | 3 seats is the wedge; 4th seat is a hard upsell trigger |
| Social Listening MVP ships late | −$10K MRR by M9 | Defer to Phase 2 explicitly; don't sell what doesn't exist |
| Browse AI ships a "Custom" intent chip | −5% conversion | Templates marketplace is the category moat; ship the gallery first |
| LLM cost doubles | −3pp gross margin | Metered AI calls; surface cost in UI; model-switching for tier-1 (VADER) |

## 8. Rollout sequence

| Week | Task | Owner |
|---|---|---|
| P0-W1 | Public pricing page (`/pricing`) ships — Q01 | 1 FE + 1 DES |
| P0-W3 | Plan-change in-app banner for existing customers ("New plans coming in 30 days") | 1 FE + 0.3 DR |
| P0-W5 | Pricing A/B test scaffold live | 1 FE + 0.3 DR |
| P0-W6 | Existing customers grandfathered for 6 months at current prices | 0.3 DR |
| P1-W7 | Social Listening beta available to Business+ | 1 BE + 1 FE |
| P1-W11 | First paid-template purchase in marketplace | 1 FE + 0.3 DR |
| P1-W12 | All new plans GA | All |

Grandfather clause: existing Pro $29 customers stay at $29 for 6 months; existing Business $79 customers move to Team $99 for 6 months then to Business $249 unless they downgrade; existing Agency $299 customers move to Agency $799 for 6 months then renew at $799.

The grandfathering cost is a 6-month revenue dip of ~$15K (offset by the conversion uplift in M3+). Worth it for trust and reduced churn.
