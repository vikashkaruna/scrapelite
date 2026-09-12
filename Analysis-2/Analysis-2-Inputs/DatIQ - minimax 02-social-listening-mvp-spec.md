# Datiq Social Listening — MVP Feature Spec

**Status**: Lock target W11 (Phase 1). Build starts W12 (Phase 2 sprint-0).
**Authoring window**: 2026-08-03
**MVP scope**: 2 personas, 4 data sources, 5 surfaces, 4 alert types, 1 export, 0 social-publishing features (publishing is Phase 3).
**Out of scope for MVP**: visual listening (image/video), sentiment at comment level (per-comment), AI theme clustering beyond simple keyword grouping, cross-platform identity resolution.

---

## 1. Why this, why now

The Datiq audit (findings.md §1.1) positions Datiq as "intelligence from every URL." The home page has 6 outcome tiles. The most differentiated — **"Build a lead list"**, **"Competitor intel"**, **"Scrape pricing"** — all depend on knowing what people and companies are *saying* on the open web, not just what's on their own page. Today, Datiq answers "what is on this page?" — not "what is the market saying about this company?" That second question is where the competitors (Brand24 $149–$499/mo, Sprout Social Listening $249–$499+/user, Brandwatch $1K–$10K+/mo) make their money and where the highest-LTV customers live.

The MVP is built to (a) close the "what is the market saying?" gap without buying enterprise infrastructure, (b) feed the lead-list and competitor-intel tiles, and (c) open a path to the brand-positioning engine (Phase 3).

## 2. Personas served

| Persona | Job-to-be-done | Frequency | WTP signal |
|---|---|---|---|
| **Sara** — Head of Sales / RevOps, B2B SaaS | "What is the market saying about us and our 3 main competitors? Who is saying it?" | Weekly | Will pay $79–$299/mo for a working brand tracker. |
| **Mike** — Product Marketing / CI | "What is changing in the category? What features are people asking for? Where are the gaps in competitor positioning?" | Weekly | Will pay $99–$499/mo for category tracking. |
| **Reggie** — Recruiter | "Where is the talent signalling interest? What are people saying about working at company X?" | Daily for active searches | Will pay $49–$149/mo for a 'signal' tier. |

The MVP optimizes for Sara + Mike. Reggie is a Phase 2 vertical.

## 3. Data sources — MVP scope = 4, with 4 more in Phase 2

### 3.1 Sources shipped in MVP (4)

| Source | Why | Access model | Cost per call | Free/paid | Limits to design around |
|---|---|---|---|---|---|
| **X (Twitter) Search API** | Largest public-conversation surface; competitive intelligence gold. | API v2 search; paid tier only (Basic $100/mo, Pro $5K/mo). | $0.006/req | Basic 10K tweets/mo; Pro 1M/mo | 1 query per "search" object; rate-limit 60 req/15 min on Pro. |
| **Reddit** | Long-form, threaded, niche communities, durable posts. | Pushshift / Arctic Shift for backfill (free); official API for new posts. | $0.003/req (Reddit), free via Pushshift | Free backfill; 60 req/min official | Pushshift has data-quality issues — restrict to ≥2022 for sentiment. |
| **YouTube** | Product reviews, tutorials, category commentary. | YouTube Data API v3. | $0.005/req | Free 10K units/day (1 search = 100 units) | Caption-based extraction only; no transcript without 3rd-party. |
| **News & blogs (via RSS + Bing/Google News)** | Press releases, news mentions, blog posts. | Bing News Search API ($7/1K); Google News RSS (free). | $0.008/req (news) | Bing 1K/mo free; RSS unlimited | Dedup on URL; respect robots.txt. |

### 3.2 Sources deferred to Phase 2 (4)

| Source | Why deferred | Plan |
|---|---|---|
| **LinkedIn** | No public search API at scale; egress is restricted. | Integrate Phyllo or API Direct (~$0.002–$0.006/req). |
| **TikTok** | Display APIs are gated; trending research via 3rd-party. | Add in Phase 2 once brand-positioning engine lands. |
| **Instagram public** | Display API heavily restricted since 2018. | Use Meta Graph API for business accounts only. |
| **Threads (Meta)** | Limited API; mostly post-mirror. | Add when Meta expands access. |

### 3.3 Source-aggregator strategy

We will not build a unified social-listening ingestion layer from scratch. Two viable 3rd-party aggregators were evaluated for MVP:

| Provider | Coverage | Cost | Lock-in |
|---|---|---|---|
| **API Direct** (apidirect.io) | 12 platforms, 50 endpoints, pay-per-request $0.002–$0.01, free 50 req/endpoint/mo | $0 | None — pass-through pricing |
| **Phyllo** | Creator-economy focus, good LinkedIn/IG/TikTok/YT, customized pricing | Custom | Higher — Phyllo SDK integration |

**Decision for MVP: dual-track.** Use **API Direct for X, Reddit, YouTube, News** in the MVP (cheapest path, no contract, scales linearly). Re-evaluate Phyllo at Phase 2 when LinkedIn is added and creator-economy personas are prioritized. This keeps MVP cost-of-goods low and avoids one-vendor lock-in for the most volatile data sources.

## 4. Data model

### 4.1 Top-level entities

```
Brand
  - id (uuid)
  - name (string)
  - aliases (string[])         // e.g. ["DatIQ", "Dat IQ", "dat-iq"]
  - domain (string, nullable)  // primary domain
  - industry (string)
  - created_at, updated_at

Mention
  - id (uuid)
  - brand_id (uuid → Brand)
  - source (enum: x, reddit, youtube, news, blog, forum)
  - external_id (string)       // native ID in source (tweet id, reddit id, etc.)
  - url (string)
  - author_handle (string)
  - author_name (string)
  - author_followers (int, nullable)
  - content_text (text)
  - content_lang (string)      // ISO-639-1
  - posted_at (timestamp)
  - ingested_at (timestamp)
  - reach_score (int, nullable) // computed: followers + shares + comments
  - engagement_count (int, default 0)
  - sentiment_label (enum: positive, neutral, negative, mixed)
  - sentiment_score (float, -1.0 to +1.0)
  - emotion_vector (jsonb, nullable) // optional: Plutchik 8-axis from API Direct add-on
  - entities (jsonb)            // extracted: {people:[], companies:[], products:[]}
  - topics (string[])          // clustered keywords

Alert
  - id (uuid)
  - brand_id (uuid)
  - user_id (uuid)
  - type (enum: spike, sentiment_drop, new_source, keyword_match, competitor_mention)
  - threshold (jsonb)          // e.g. {"mentions_per_hour": 50, "delta": 3.0}
  - channels (enum[]: email, slack, webhook, in_app)
  - enabled (bool)
  - last_fired_at (timestamp, nullable)
  - created_at, updated_at

Snapshot
  - id (uuid)
  - brand_id (uuid)
  - window (enum: hour, day, week)
  - bucket_ts (timestamp)       // start of window
  - mention_count (int)
  - positive_count (int)
  - negative_count (int)
  - neutral_count (int)
  - reach_total (bigint)
  - top_sources (jsonb)         // {x: 120, reddit: 30, ...}
  - top_keywords (jsonb)        // [{term, count}, ...]
```

### 4.2 Indexes

- `mentions (brand_id, posted_at desc)` — primary browse path
- `mentions (brand_id, source, posted_at desc)` — per-source views
- `mentions USING gin (to_tsvector('english', content_text))` — full-text search
- `mentions (sentiment_label, brand_id, posted_at desc)` — sentiment drill-down
- `mentions (author_handle, brand_id)` — author tracking
- `alerts (user_id, enabled, brand_id)` — alert evaluation

### 4.3 Retention

- Hot (Postgres): 90 days for full-text search and drill-down.
- Cold (S3 + Parquet): after 90 days, snapshots only (mention counts, sentiment labels, top keywords). Useful for trend-over-time.

## 5. Sentiment model

The MVP ships with a **two-tier sentiment** approach to control cost and latency:

1. **Fast tier (default)**: lexicon + heuristics — `VADER`-style scoring. Free, sub-millisecond, on every ingest.
2. **Accurate tier (on-demand, for top 5% by reach)**: hosted LLM with structured output. Charged at the cost of one extra extraction per qualifying mention.

Future option: integrate API Direct's **Emotion Analysis add-on** (+$0.001/req, Plutchik 8-axis) for paying customers who want emotion breakdown.

## 6. UI — five surfaces, four wireframe-level mockups

### 6.1 Surface map

| Surface | URL | Purpose | Key actions |
|---|---|---|---|
| **Brand Tracker** | `/listening` | Brand list + add brand | Add, edit, pause, archive |
| **Brand detail (Overview)** | `/listening/:brandId` | Daily snapshot of one brand | Change window, drill to mentions |
| **Mentions feed** | `/listening/:brandId/mentions` | Stream of all mentions | Filter, save search, export |
| **Alerts** | `/listening/:brandId/alerts` | Configure alert rules | Add rule, edit, test-fire, history |
| **Compare** | `/listening/compare?brands=a,b,c` | Side-by-side brand comparison | Pick brands, pick window, export |

### 6.2 Wireframe — Brand detail (Overview)

```
+--------------------------------------------------------------+
|  DatIQ                                       [All sources v] |
|  Industry: Data & Analytics      [+ Add alert] [Settings]    |
+--------------------------------------------------------------+
|  [Day] [Week] [Month] [Custom]                  ← window tab  |
+--------------------------------------------------------------+
|  Mentions over time (line chart, last 7 days)                |
|       ___                                                     |
|      /   \___      ___                                        |
|  ___/        \____/   \___                                    |
|  M  T  W  T  F  S  S                                         |
+--------------------------------------------------------------+
|  Sentiment split       |  Top sources                       |
|  [====positive 62%]    |  x.com        43%                   |
|  [====neutral  24%]    |  reddit.com   22%                   |
|  [==negative  14%]    |  youtube.com  18%                   |
|                        |  news         17%                   |
+--------------------------------------------------------------+
|  Top 5 mentions (reach-sorted)                               |
|  • @vc_analyst  82K followers  "Just tried DatIQ — ..." [+] |
|  • r/automation  1.2K upvotes  "DatIQ vs Browse AI ..."     |
|  • TechCrunch  "DatIQ launches v2.0"          [+]            |
+--------------------------------------------------------------+
|  New keywords (trending up)         |  Reach delta           |
|  • "alternative to clay"            |  +18% this week        |
|  • "scraping for recruiters"        |                        |
+--------------------------------------------------------------+
```

### 6.3 Wireframe — Mentions feed

```
+--------------------------------------------------------------+
|  DatIQ · Mentions                       [Last 7 days v]     |
|  Filter: [All sources v] [All sentiment v] [Search...  /]    |
|  Saved:  • "negative + reddit"  • "competitor mentions"     |
+--------------------------------------------------------------+
|  Mar 12 · X · @vc_analyst · 82K followers       reach 82,000 |
|  "Just tried DatIQ — the URL-to-summary UX is wild. ..."    |
|  Sentiment: positive 0.82        [+ Track author]  [Share]  |
+--------------------------------------------------------------+
|  Mar 12 · Reddit · r/automation · 124 upvotes    reach 3,200 |
|  "DatIQ vs Browse AI — I tested both on YC pricing pages..."|
|  Sentiment: neutral 0.10         [View thread]   [Export]   |
+--------------------------------------------------------------+
|  Mar 11 · YouTube · "Alex Reviews AI" · 12K views reach 12K  |
|  "DatIQ in 5 minutes — actually useful?"                    |
|  Sentiment: positive 0.61        [Watch on YT]   [Share]    |
+--------------------------------------------------------------+
|  [Load more]                                                 |
+--------------------------------------------------------------+
```

### 6.4 Wireframe — Alert rule editor

```
+--------------------------------------------------------------+
|  New alert rule for DatIQ                                    |
+--------------------------------------------------------------+
|  What triggers?                                              |
|   ( ) Mention spike            when mentions/hour > [ 50 ]   |
|   ( ) Sentiment drop           when negative % > [ 25 %]     |
|   ( ) New source               when first mention on [ x ]   |
|   (●) Keyword match            when content matches         |
|                                    [ competitor:clay ]       |
|   ( ) Competitor mention       when [ "browse ai" ] appears |
+--------------------------------------------------------------+
|  Where to send?                                              |
|   [✓] Email  [✓] Slack (#brand-tracker)                      |
|   [ ] Webhook  [ ] In-app only                               |
+--------------------------------------------------------------+
|  Quiet hours:   [ 22:00 ] to [ 08:00 ]   America/New_York    |
+--------------------------------------------------------------+
|  [Test fire]   [Save rule]                                   |
+--------------------------------------------------------------+
```

### 6.5 Wireframe — Compare brands

```
+--------------------------------------------------------------+
|  Compare brands:  DatIQ [x]  Browse AI [x]  Clay [x]   [+ ]  |
+--------------------------------------------------------------+
|  [Week] [Month] [Quarter]                                    |
+--------------------------------------------------------------+
|  Mentions trend (stacked area)                               |
|  Brand         | Mon | Tue | Wed | Thu | Fri | Sat | Sun   |
|  DatIQ         |  12 |  18 |  22 |  15 |  30 |  20 |  16   |
|  Browse AI     |  28 |  24 |  22 |  26 |  25 |  18 |  14   |
|  Clay          |  44 |  41 |  39 |  45 |  48 |  30 |  28   |
+--------------------------------------------------------------+
|  Sentiment heatmap    |  Top shared keywords                 |
|  DatIQ    pos 62%     |  "alternative to clay"               |
|  Browse   pos 58%     |  "no-code scraper"                   |
|  Clay     pos 71%     |  "lead list builder"                 |
+--------------------------------------------------------------+
|  [Export CSV] [Save view] [Schedule weekly email]            |
+--------------------------------------------------------------+
```

## 7. Alerts — four types in MVP

| Type | Default trigger | Configurable | Default channel |
|---|---|---|---|
| **Mention spike** | When mentions in 1 hour ≥ 3× trailing 7-day hourly average | threshold (1.5× to 10×), window (1h, 4h, 24h) | Email + in-app |
| **Sentiment drop** | When negative % in window > 25% AND negative count > 10 | threshold (10–50%), min volume (5–100) | Email + in-app |
| **New source** | When a brand gets its first mention on a new source | source list (default: any) | In-app |
| **Keyword match** | When content matches a saved query (e.g. "competitor:clay", "pricing complaint") | full query DSL (boolean + source filter + sentiment filter) | Slack + email |

Quiet hours per user, per brand, per rule. Webhook destination optional for Pro+ customers (using the same webhook framework from P0-W2.6).

## 8. API surface (new)

The Datiq public API gains 3 new resource families:

```
# Brands
POST   /v1/listening/brands
GET    /v1/listening/brands
GET    /v1/listening/brands/{id}
PATCH  /v1/listening/brands/{id}
DELETE /v1/listening/brands/{id}

# Mentions
GET    /v1/listening/brands/{id}/mentions
        ?source=&sentiment=&from=&to=&limit=&cursor=
GET    /v1/listening/mentions/{id}

# Alerts
POST   /v1/listening/brands/{id}/alerts
GET    /v1/listening/brands/{id}/alerts
PATCH  /v1/listening/alerts/{id}
DELETE /v1/listening/alerts/{id}
POST   /v1/listening/alerts/{id}/test      # force-fire for setup verification
```

Rate limits: aligned with the existing per-tier limits (100 req/10s Free, 190 Pro, 250 Business+). Heavy aggregate calls (compare, snapshot) have their own quota.

## 9. Pricing impact (handed to `03-pricing-packaging.md`)

- **Free**: 1 brand, 7-day history, mention spike + sentiment drop alerts only, no exports.
- **Pro ($29 → ??)**: 5 brands, 90-day history, all 4 alert types, 1 saved search, CSV export.
- **Business ($79 → ??)**: 25 brands, 1-year history, all alert types, 10 saved searches, webhook delivery, API access.
- **Agency ($299 → ??)**: 100 brands, 2-year history, white-label PDF digest, multi-tenant alerts, dedicated Slack channel for onboarding.

## 10. Build & launch plan (4-week post-spec)

| Week | Task | Owner |
|---|---|---|
| B+0 | Data-source contracts locked, OAuth + first 1K pulls from each source | 1 BE + 1 FS |
| B+1 | Sentiment tier-1 (VADER-style), ingest pipeline, mentions table + indexes | 1 BE |
| B+1 | Brand Tracker + Brand detail Overview (section 6.2) | 1 FE + 1 DES |
| B+2 | Mentions feed (6.3) + Compare (6.5) | 1 FE |
| B+2 | Alerts engine + rule editor (6.4) | 1 BE + 1 FE |
| B+3 | Public API endpoints (8.) + rate limiting | 1 BE |
| B+3 | Closed beta with 20 paying customers (Sara + Mike) | PM + DR |
| B+4 | Bug bash + GTM collateral + GA | All |

## 11. Open questions to validate before W12

1. **X API cost**: at $0.006/req with 1K brand-trackers, can we keep cost-of-goods at < $0.50/brand/month? **Action**: spike in W11 to model.
2. **Sentiment accuracy on Reddit/YouTube**: VADER is tuned for short text. **Action**: back-test on 500 labeled Reddit posts; if accuracy < 75%, swap to a hosted LLM for tier-1.
3. **Author identity resolution**: how do we dedupe `@vc_analyst` on X vs the same person on Reddit vs the same person on YouTube? **Action**: defer to Phase 2 unless Sara personas raise it as a blocker in beta.
4. **Legal**: are we OK showing Reddit post bodies? Pushshift/Arctic Shift terms are grey. **Action**: legal review in W11; default to "title + permalink + first 280 chars" if pushback.
5. **Compute cost for the Compare view at scale**: side-by-side 10 brands × 90 days = 1.5M mentions. **Action**: pre-compute daily snapshots; the compare view reads from snapshots, not raw mentions.
