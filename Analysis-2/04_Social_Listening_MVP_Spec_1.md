# DatIQ Social — Social Listening MVP Feature Specification
**Merged council spec: Claude blueprint architecture × DeepSeek schema & alerting intelligence**
Version 1.0 · August 2026

---

## 1. Objective & Positioning

Enable SMB teams to monitor conversations, measure sentiment **and commercial intent**, detect anomalies, and act on brand/market signals inside the same platform where they already extract web data — at 1/10th–1/30th the cost of Brandwatch ($800+/mo) or Sprout Social, with dramatically simpler setup. The MVP must prove users engage with social data inside DatIQ rather than a point tool; the differentiator is **intent tagging** (purchase_intent / churn_risk / support) and one-click **mention → HubSpot lead** push, which no mainstream SMB listening tool offers.

**Success metrics:** ≥50% of new sign-ups create ≥1 keyword in week 1 · median time-to-first-mention <10 min · alert open rate ≥40% · Social users show ≥1.5× D30 retention vs extraction-only users.

---

## 2. Data Sources & Ingestion Architecture

### 2.1 MVP sources (launch)

| Source | Method | Poll cadence | Rate limit | Retention | Cost at scale |
|---|---|---|---|---|---|
| Twitter/X | API v2 Basic (Filtered Stream + Recent Search) | 5 min | 10k tweets/mo (Basic) | 30-day rolling | $100/mo (Basic); Pro-tier gate to control cost |
| Reddit | OAuth via PRAW | 15 min | 100 req/min | 90-day rolling | Free |
| RSS/Atom (news, blogs) | Server-side rss-parser | 30 min | none (HTTP polling) | Unlimited | Infra only |

### 2.2 Phase-next sources (roadmap-mapped)
R2: YouTube comments, news APIs (NewsAPI/GDELT). R3: LinkedIn company pages (partnership-gated — timeboxed spike first), Instagram/Facebook public, Threads. R4+: review platforms, podcasts, GitHub, Product Hunt, Stack Overflow.

### 2.3 Event flow (MVP stack — Supabase + Redis/BullMQ; Kafka/ClickHouse documented as R4 migration path)

```
Collector (per source, scheduled)
  → Normalization layer (unified mention object)
  → Deduplication (Redis content-hash counters)
  → Language detection
  → Enrichment queue (BullMQ): sentiment → intent → NER → reach_score
  → Postgres write (social_mentions) + daily rollup (sentiment_trends / topic_metrics)
  → Alert evaluator → suppression cache → dispatch (in-app / email / webhook / Slack in R2)
```

Unified mention object: `source_platform, source_id, author_handle, author_name, author_followers, content_text, content_html, media_urls, published_at, url, engagement_metrics{}, extracted_keywords[]`. New sources implement one collector interface; downstream logic untouched.

---

## 3. Database Schema (Supabase/Postgres, multi-tenant via workspace_id)

### 3.1 tracked_keywords
`id, workspace_id, keyword, label, is_competitor bool, source_filters JSONB, created_by, is_active` · UNIQUE(workspace_id, keyword) · GIN(source_filters). Limits: Starter 5 · Pro 25 · Business 100 (competitor keywords count toward quota).

### 3.2 social_mentions
`id, workspace_id, keyword_id, source_platform enum(twitter|reddit|rss|…), source_id (unique idx), author_handle, author_name, author_followers int default 0, content_text, content_html, media_urls text[], sentiment enum(positive|neutral|negative), sentiment_score float [-1.0, 1.0], intent_class enum(purchase_intent|churn_risk|support|none) indexed, entities_named JSONB (GIN), key_phrases text[], reach_score float (author_followers × engagement_rate), published_at, url, engagement_data JSONB, ingested_at`
Indexes: (workspace_id, keyword_id, published_at) · sentiment · intent_class · source_platform.
Dual sentiment representation supports categorical filtering and quantitative trending. `entities_named` is the **graph-ready hook** for the R5 Knowledge Graph — entity IDs shared with extraction results from day one.

### 3.3 sentiment_trends (daily rollup)
`id, workspace_id, keyword_id, date, positive_count, negative_count, neutral_count, avg_score, total_mentions, total_reach` · UNIQUE(workspace_id, keyword_id, date). Pre-computed to keep dashboards off the raw table.

### 3.4 topic_metrics (hourly buckets, powers spike detection)
`metric_id, workspace_id, topic_keyword, time_bucket (1-hr), total_mentions, pos_cnt, neg_cnt, total_reach_vol BigInt`.

### 3.5 alert_rules & alert_events
`alert_rules: id, workspace_id, keyword_id, alert_type enum(volume_spike|negative_threshold|high_influence|competitor_co_mention), threshold_value, notification_channel enum(email|in_app|webhook), cooldown_minutes default 30, is_active`
`alert_events: id, alert_rule_id, workspace_id, triggered_at, mention_count, sentiment_value, sample_mention_ids[], notification_status, delivered_at`
Rule quotas: Starter 10 · Pro 50 · Business 200.

---

## 4. UI Specification

### 4.1 Layout
New top-nav item **Social** (`/social`). Three-panel layout (Sprout-inspired, SMB-simplified): left sidebar (keywords + filters), center mention feed, right analytics/detail panel. Built on the new brand tokens; shares card/table components with Extract. Mobile: panels stack; analytics in bottom-sheet.

### 4.2 Dashboard zones (wireframe)

```
┌─────────────────────────────────────────────────────────────────┐
│ SUMMARY BAR  7-day mentions · avg sentiment (color pill) · Δ%   │
│              net-intent count (🔥 purchase / ⚠ churn signals)   │
├──────────┬──────────────────────────────┬───────────────────────┤
│ KEYWORDS │ VOLUME SPARKLINE (30d,       │ SENTIMENT DONUT       │
│ + tags   │ pos/neg/neu color segments)  │ pos/neg/neu %         │
│ + filters├──────────────────────────────┤───────────────────────┤
│ sentiment│ MENTION FEED (infinite       │ TOP KEYWORDS table    │
│ platform │ scroll, 20/batch)            │ (click = filter feed) │
│ date     │ [icon] @author · 2h ago      ├───────────────────────┤
│ intent   │  content preview (3 lines)   │ DETAIL VIEW on click: │
│ engage.  │  [sentiment][intent][reach]  │ full text, author,    │
│ min.     │  ♥ 41  ↻ 12  💬 7            │ score breakdown,      │
│          │  [Save to Collection]        │ [→ Push to HubSpot]   │
└──────────┴──────────────────────────────┴───────────────────────┘
```

### 4.3 Feed & filtering
Filters (AND logic): keywords (multi) · sentiment · **intent class** · platform · date (24h/7d/30d/custom) · min engagement. Sorts: newest (default), most engaging, highest reach. Card click → detail: full content, author profile, source link, sentiment word-contribution breakdown, related mentions, **Save to Collection**, **Push to HubSpot as lead** (high-intent CTA — the signature action). Infinite scroll, batch 20, "Load More" after 100 to cap DOM.

### 4.4 Onboarding wizard (guards activation)
3 steps: (1) add first keyword + suggested competitor keyword; (2) pick sources; (3) default alert pre-configured (spike 200%) with one-toggle confirm → land on feed with 30-day backfill streaming in (Sprint 1.3 makes backfill instant value).

### 4.5 Alert configuration (gear icon → settings panel)
Rule builder: keyword → type → threshold → channel → cooldown. Defaults per §5. Active/inactive toggles, last-triggered timestamps, test-fire button.

---

## 5. Alerting Engine

**Trigger rules (DeepSeek thresholds adopted):**
1. **Volume spike:** mention volume >300% of rolling 1-hour baseline (user-tunable 150–500%; onboarding default 200% vs 7-day average for low-volume brands).
2. **Negative sentiment threshold:** negative >40% of topic volume within a 30-minute window (default UI: 30%).
3. **High-influence mention:** author >100,000 followers or verified/executive handle mentions a tracked term.
4. **Competitor co-mention:** tracked competitor keyword appears in the same thread/conversation as the brand keyword.

**Evaluation & dispatch:** enrichment-time evaluation against active rules → Redis-backed **30-minute suppression window per keyword cluster** (prevents viral-event alert fatigue; analytics logging continues) → payload formatted → in-app (bell + badge), email (SendGrid template with 3 sample mentions + trend micro-chart), webhook (HMAC-signed JSON). R2 adds Slack/Teams; R4 adds PagerDuty for enterprise. All events logged to `alert_events` for audit and digest assembly.

**Email digests (P1-24):** daily/weekly rollup — new mentions, sentiment shift, intent signals, site-change deltas from the diff engine — the retention workhorse and the seed of the R4 Executive Intelligence module.

---

## 6. Tier Gating & Cost Control

| Capability | Free | Starter | Pro | Business |
|---|---|---|---|---|
| Social pillar | — | ✓ | ✓ | ✓ |
| Mentions/mo | — | 2,000 | 10,000 | 50,000 |
| Keywords | — | 5 | 25 | 100 |
| Sources | — | Reddit + RSS | + Twitter/X | + YouTube/news (R2) |
| Intent tagging | — | Basic | Full + trends | Full + API |
| Alert rules | — | 10 | 50 | 200 |
| Backfill | — | 7 days | 30 days | 90 days |

Twitter/X gated to Pro to contain the $100/mo Basic-tier API cost until volume justifies Academic/higher tiers (BA unit-economics note, File 05 §4).

---

## 7. Non-Functional Requirements & Risks

Ingestion-to-feed latency ≤10 min (X), ≤20 min (Reddit) · feed p95 render <800 ms via rollup tables · classifier accuracy gate: ≥80% sentiment agreement on 500-sample eval before launch (P0-23) · GDPR/DPDPA: public data only, author-erasure honoring, no PII enrichment beyond public profile fields · cost guardrail: per-workspace mention quotas enforced at collector level, not just billing level. **Top risks:** X API pricing volatility (mitigate: Reddit+RSS-first value, X as Pro upsell) · classifier quality on Indian-English/multilingual mentions (eval set includes hi/en code-mix) · alert fatigue (suppression + digest defaults).
