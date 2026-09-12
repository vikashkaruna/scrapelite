# DatIQ Implementation Prompts — Release 1 · v2.0 "Platform Launch" (Weeks 5–12)
Run in order after DP-R0-RC. Prepend GLOBAL SYSTEM CONTEXT (File 07 §2). Specs referenced: File 04 (Social), File 05 (Pricing).

---

## DP-R1-01 · Social Ingestion Pipeline (foundation of 1.1)
**Flag:** `social_pipeline` (internal) · **Version:** v2.0.0-alpha · **Run after:** DP-R0-RC

**Description & stories.** Build the collector→normalize→dedupe→enrich→store pipeline per File 04 §2.3 for Twitter/X (5-min), Reddit/PRAW (15-min), RSS (30-min). As an ops owner I can see per-collector health, lag, and error rates; as the pipeline I never store a duplicate mention.

**Impact.** Foundation for the entire Social pillar; no direct UI. Risks: X API cost/limits (collector-level quota enforcement per workspace — File 04 §7 guardrail; Reddit+RSS degrade gracefully if X disabled); source ToS compliance (public data only, author-erasure job). Blast radius: worker infra only.

**Backend.** Tables per File 04 §3 (`tracked_keywords`, `social_mentions`, `sentiment_trends`, `topic_metrics`, `alert_rules`, `alert_events`) with RLS + graph-ready `entities_named`; collector interface (`collect(sourceConfig) → RawMention[]`) with the three implementations; normalization to the unified mention object; Redis content-hash dedupe; BullMQ enrichment queue (stages stubbed until DP-R1-02); language detection; collector health endpoint + Grafana-style status page (internal); author-erasure worker (delete-by-handle).

**Frontend.** Internal admin: pipeline status card (per-source lag, last run, error count).

**Testing.** Collector unit tests with recorded fixtures (no live API in CI); dedupe property tests; normalization golden fixtures per source; erasure integration test. Acceptance: staging pipeline fills mentions for 3 test keywords within 10/20/30-min SLAs.

**Deployment.** Workers deployed flag-gated; run 72h on staging keywords before DP-R1-02. Rollback: pause queues (data retained). Runbook mandatory (restart, backfill, quota-exhaustion procedures).

**Docs.** Runbook + internal architecture doc + ADR (Supabase/BullMQ now, Kafka/ClickHouse migration criteria per File 03 P1-33).

**DoD.** Framework + `social.mention_ingested{platform}` events + 72h stability report.

---

## DP-R1-02 · Sentiment + Intent Classification (1.1 enrichment)
**Flag:** `social_pipeline` · **Version:** v2.0.0-alpha · **Run after:** DP-R1-01

**Description.** Enrichment stages: sentiment (label + score −1..1), **intent_class** (purchase_intent | churn_risk | support | none), NER into `entities_named`, `reach_score` = followers × engagement_rate. Implementation per P0-23 decision gate: hosted-LLM classifier first (small-model-first routing), fine-tuned baseline evaluated in parallel; pluggable `Classifier` interface so the backend can swap without pipeline change.

**Impact.** Intent tagging is the pillar's differentiator (council D5); accuracy is brand-critical. Risks: misclassification harm (confidence field stored; UI shows "AI-classified" affordance + correct-label feedback control feeding eval set); cost (batching, small-model-first; per-1k-ops budget from File 05 §4). Gate: ≥80% sentiment agreement and ≥70% intent agreement on the 500-sample golden set (incl. hi/en code-mix) before flag advances.

**Backend.** Classifier service + provider adapters; batch inference worker; feedback endpoint writing to `/tests/golden/mentions.json` growth set; nightly `sentiment_trends` + hourly `topic_metrics` rollups.

**Frontend.** (Deferred to DP-R1-03; only feedback control spec here.)

**Testing.** Golden-set eval harness in CI (report, non-blocking initially; blocking at gate); rollup correctness SQL tests; cost-per-1k telemetry assertion.

**Deployment.** Shadow-classify staging stream 48h → gate review → enable enrichment writes. Rollback: mentions stored unenriched, re-enrich job available.

**Docs.** Internal model card (provider, eval scores, known weaknesses, escalation) + runbook update.

**DoD.** Gate met + `social.mention_enriched{sentiment,intent}` + cost/1k within budget.

---

## DP-R1-03 · Social Listening Dashboard & Mention Feed (1.1 UI)
**Flag:** `social_mvp` · **Version:** v2.0.0-beta · **Run after:** DP-R1-02

**Description & stories.** Ship `/social` per File 04 §4: summary bar (7-day mentions, avg sentiment pill, Δ%, net-intent count), 30-day volume sparkline (pos/neg/neu segments), keyword sidebar with filters (keyword, sentiment, **intent**, platform, date, min-engagement; AND logic), infinite-scroll feed (20/batch, Load More at 100), mention detail (full content, author, reach, sentiment word-contribution, related, **Save to Collection**, feedback control), sorts (newest/engaging/reach). Responsive stack + bottom-sheet analytics on mobile.

**Impact.** The pillar's face; engagement metric owner (feed DAU, mentions viewed). Risk: feed performance — rollup-table-only dashboard queries, virtualized list; p95 render <800ms acceptance.

**Backend.** Feed query endpoints (cursor pagination, filter combinators), detail endpoint, related-mentions (same author/entities), collection-save reusing polymorphic items from R0-06.

**Frontend.** Three-pane layout on brand tokens; loading skeletons, empty states (teach keyword add), error states; a11y (feed as list semantics, keyboard nav); donut + top-keywords right panel (click = filter).

**Testing.** Component tests per zone; E2E `@social` journey (add keyword→see backfilled feed→filter by intent→save to collection); perf test with 50k seeded mentions; visual snapshots light+dark.

**Deployment.** Flag ON internal workspace → 20 beta workspaces 1 week → hold GA until DP-R1-05 (alerts) so first impression includes the aha. Rollback: flag.

**Docs.** Feature doc + 3 help articles (keywords, filtering, feed) + use case (founder tracks launch-day chatter) + changelog (published at GA).

**DoD.** Framework + `social.feed_viewed`, `social.mention_opened`, `social.mention_saved` + perf acceptance evidence.

---

## DP-R1-04 · Keyword Tracking & Onboarding Wizard (1.1 + 1.13)
**Flag:** `social_mvp` · **Version:** v2.0.0-beta · **Run after:** DP-R1-03

**Description.** Keyword CRUD with `is_competitor`, per-source filters, tier quotas (5/25/100); 3-step onboarding wizard (first keyword + suggested competitor → sources → pre-configured spike alert) landing on a feed that fills via 7-day instant mini-backfill (full 30-day backfill in DP-R1-08). Guards the ≥30% activation target.

**Impact.** Activation owner for the pillar. Risk: keyword ambiguity frustration — live match-preview in wizard ("~120 mentions/week for this term") with refinement tips.

**Backend.** Keyword endpoints + quota enforcement; match-preview endpoint (sampled search); wizard-state persistence.

**Frontend.** Wizard modal flow (skippable, resumable); keyword management panel (tags, labels, active toggles, competitor badge).

**Testing.** Quota unit tests per tier; wizard E2E incl. resume; preview accuracy fixture test.

**Deployment.** With `social_mvp` cohort. **Docs.** Help (getting started with Social) + wizard microcopy reviewed by founder.

**DoD.** Framework + `social.keyword_created{is_competitor}`, `social.wizard_completed` + wizard completion ≥70% in beta.

---

## DP-R1-05 · Alert Engine & Notifications (1.1 alerts)
**Flag:** `social_alerts` · **Version:** v2.0.0-beta · **Run after:** DP-R1-02

**Description.** Rules per File 04 §5: volume spike (>300%/1-hr baseline; onboarding default 200% vs 7-day avg), negative >40%/30-min, high-influence (>100k followers/verified), competitor co-mention; 30-min Redis suppression per keyword cluster; channels: in-app (bell+badge), email (SendGrid template: 3 sample mentions + trend micro-chart), webhook (extends R0-08 with `mention.alert`). Rule quotas 10/50/200. Rule builder UI + test-fire.

**Impact.** Retention lever #1; the pull-back-into-product mechanism. Risk: alert fatigue (suppression + sane defaults + digest fallback), false spikes on low-volume brands (minimum-volume floor before spike math applies).

**Backend.** Evaluator in enrichment stage; `alert_events` writes; dispatch worker with per-channel adapters; digest-compatible event log.

**Frontend.** Alert settings panel (builder, toggles, last-triggered, cooldown), in-app notification center.

**Testing.** Trigger-rule property tests (synthetic streams: spike, crisis, influencer, co-mention); suppression window tests; email snapshot; E2E rule-create→synthetic-trigger→bell+email.

**Deployment.** Beta cohort → **GA of `social_mvp` + `social_alerts` together = v2.0.0-beta public**. Canary watch: alert send error rate <0.5%.

**Docs.** Help (alerts), runbook (dispatch failures, suppression tuning), changelog, **blog: yes** ("DatIQ Social: hear the web — and its intent"), use case (crisis catch story).

**DoD.** Framework + `social.alert_triggered{type}`, `social.alert_opened` + open-rate baseline recorded.

---

## DP-R1-06 · Stripe Billing, Tiers & Gates (1.2)
**Flag:** `billing` · **Version:** v2.0.0 · **Run after:** DP-R0-RC (parallel-safe with R1-01..05)

**Description & stories.** Monetization live per File 05: Stripe Checkout + Customer Portal for Free/Starter $29/Pro $99/Business $399 (+annual, coupons, trials); webhook lifecycle (`subscription.created/updated/deleted`, `invoice.payment_succeeded/failed` → provision/downgrade/reset/dunning); usage metering (extractions, mentions, API calls, connector calls) with idempotent meter events; tier gates in router + API from the single `/config/pricing.ts` source; self-serve upgrade/downgrade; grandfathering of existing free users (comms per P1-26).

**Impact.** Enables all revenue; conversion-critical UX (every extra click loses upgrades). Risks: gate bugs locking paying users out (gate unit-matrix tests across tier×feature; support override tool in admin); webhook replay (idempotency keys); tax (Stripe Tax enabled; India GST registration flagged to founder as ops task).

**Backend.** Stripe integration module; `billing_events` audit; metering service with Redis counters → nightly reconcile; gate middleware `requireTier/requireQuota`; dunning email flow.

**Frontend.** Pricing page checkout activation (replaces R0 stubs); upgrade modals at gate-touch points (contextual: "Add Social with Starter — $29"); billing settings (plan, invoices, payment method via Portal); quota-exceeded states everywhere metered.

**Testing.** Stripe-mock integration suite (full lifecycle incl. failed payment); gate matrix tests (4 tiers × 12 gated capabilities); E2E `@billing` upgrade→use gated feature→downgrade; webhook replay tests.

**Deployment.** Sandbox staging full pass → live mode with internal test card → GA = **v2.0.0 tagged, paid tiers public**. Rollback: flag returns to stub pricing (subscriptions honored, gates fail-open for paid — fail-open decision recorded in ADR).

**Docs.** Pricing/FAQ page copy, billing help set (upgrade, invoices, cancel), changelog, runbook (dunning, refunds, disputes), internal support playbook.

**DoD.** Framework + `billing.checkout_started/completed`, `billing.gate_hit{feature,tier}` + first live transaction verified.

---

## DP-R1-07 · Connector Framework + HubSpot + Apollo (1.3, 1.4, 1.6)
**Flag:** `connectors` · **Version:** v2.0.1 · **Run after:** DP-R1-06 (gating), DP-R1-02 (intent scores available)

**Description & stories.** Connector abstraction (authorize/test_connection/sync/map_fields/disconnect; registry, Vault-encrypted tokens, BullMQ sync engine, per-connector token-bucket) + first two connectors. **HubSpot:** OAuth 2.0 (scopes contacts/companies/deals r+w), bi-directional sync (extracted contacts/companies → HubSpot create-or-update matched by email/domain; HubSpot lifecycle/deal context → DatIQ), social→engagement notes (daily batch), manual "Create deal", `datiq_intent_score` custom property; webhook receiver. **Apollo:** user-provided key, people/match + organizations/enrich + email verification, bulk queue at 50% rate limit, enrichment applied to extraction results, optional sequence push. Field-mapping engine with default maps (blueprint matrices) + per-workspace overrides. Connector mgmt UI: auth status, sync history log, mapping config, disconnect. Sync schedules (event-driven outbound; 6-hr inbound; user-configurable hourly/daily/weekly). Tier gates: Starter 1 connector, Pro all.

**Impact.** The Extract→Enrich→Sync killer pipeline; Starter conversion driver (HubSpot) + Pro justification (Apollo). Risks: HubSpot Marketplace approval timing (private-app fallback for beta — applied Wk 0); data-quality writes into customer CRMs (dry-run preview mode default-on for first sync; per-field sync toggles; full sync log with undo-window for creates); rate limits (framework limiter + Apollo 50% rule).

**Backend.** As above; conflict resolution: CRM wins on user-edited fields, DatIQ wins on datiq_* custom props (documented).

**Frontend.** `/connect` hub (cards per connector, states: available/connected/error/syncing); mapping table UI; sync-history with per-record outcome + error drill-in; dry-run preview diff screen.

**Testing.** Contract tests against HubSpot/Apollo sandboxes (recorded); mapping-engine unit suite; conflict-resolution scenario tests; E2E `@connectors` connect→dry-run→sync→verify in sandbox CRM; disconnect revocation test.

**Deployment.** Design-partner beta (5 workspaces, dry-run enforced) 1 week → GA v2.0.1. Rollback: flag pauses syncs (auth retained), per-connector kill switch.

**Docs.** 2 feature docs + setup helps (with sandbox screenshots) + mapping reference + use case (conference prospect list → enriched → CRM in 10 min) + changelog + **blog: yes** ("Your CRM, always current") + runbooks (token refresh failures, sync backlog) + HubSpot Marketplace listing copy.

**DoD.** Framework + `connect.authorized{provider}`, `connect.sync_completed{provider,records}`, `connect.mention_pushed` + zero unresolved sync errors in beta week.

---

## DP-R1-08 · Historical Backfill + Competitive Tracking + Trend Charts (1.8, 1.10)
**Flag:** `social_compete` · **Version:** v2.0.1 · **Run after:** DP-R1-05

**Description.** 30-day backfill on keyword creation (X recent-search + Reddit, quota-aware, progress UI); competitor keywords get separate analytics lane; side-by-side sentiment/volume trend comparison charts (own vs competitors, configurable ranges); "Share of conversation" mini-metric (mention-volume share — full SoV engine lands R3).

**Impact.** Instant time-to-value + the Klue/Crayon-at-1/20th-price wedge; Pro upsell surface. Risk: backfill quota burn — per-tier backfill windows (7/30/90 per File 04 §6), queued off-peak.

**Backend.** Backfill worker with resumable cursors; comparison query endpoints on rollups; share-of-conversation calc.

**Frontend.** Backfill progress in wizard/keyword panel; Compare tab with multi-series charts (recharts on brand palette); competitor badge styling throughout feed.

**Testing.** Backfill resume/idempotency tests; chart data-contract tests; E2E compare journey.

**Deployment.** With cohort → GA. **Docs.** Help (competitive tracking) + use case (pricing-war watch) + changelog.

**DoD.** Framework + `social.backfill_completed`, `social.compare_viewed`.

---

## DP-R1-09 · Change-Detection Alerts on Scheduled Runs (1.5)
**Flag:** `change_alerts` · **Version:** v2.0.1 · **Run after:** DP-R0-08, DP-R1-05 (shared notification infra)

**Description.** The diff engine (built P0-18) gets its user surface: per-schedule "Alert me on changes" with scope (any change / pricing fields / selected fields), field-level diff view (before/after, added/removed), notifications via the alert channels, and diff history per monitored URL. Fulfills the "competitor pricing tracker" promise.

**Impact.** Converts live scheduling into the retention habit; feeds R2 Competitive module. Risk: noisy diffs (normalization: whitespace/dynamic-token stripping, per-field sensitivity thresholds, "ignore this element" control).

**Backend.** Diff storage (`extraction_diffs`), scope evaluator, notification hookup, diff-history endpoints.

**Frontend.** Schedule settings extension; diff viewer (side-by-side, changed-field highlighting); history timeline; alert cards deep-linking to diff.

**Testing.** Diff-normalization fixture suite (10 real-world page pairs); scope evaluator units; E2E schedule→synthetic change→alert→diff view.

**Deployment.** Staging synthetic targets → GA. **Docs.** Feature + help (monitoring a pricing page) + use case + changelog + blog paragraph in R1 launch post.

**DoD.** Framework + `extract.change_detected{scope}`, `extract.diff_viewed`.

---

## DP-R1-10 · Usage Dashboard + Email Digests (1.7, 1.9)
**Flag:** `usage_digests` · **Version:** v2.0.2 · **Run after:** DP-R1-06, DP-R1-09

**Description.** Settings → Usage: visual consumption vs quota (extractions, mentions, API, connector calls) with cycle projections + upgrade CTA at 80%. Daily/weekly email digest: new mentions, sentiment shift, intent signals, site-change deltas, top shared results — per-user preferences, one-click unsubscribe granularity.

**Impact.** Churn-reducing transparency + the retention workhorse; digest is the Executive Intelligence seed (R4). Risk: digest spam perception — default weekly, daily opt-in.

**Backend.** Usage aggregation endpoints; digest assembler worker (queries rollups + diffs + alert_events), SendGrid templates, preference model.

**Frontend.** Usage screen (bars, projections, history); notification preferences panel.

**Testing.** Quota math golden tests vs metering; digest snapshot tests (empty/light/heavy data states); unsubscribe E2E.

**Deployment.** GA. **Docs.** Help (usage, notifications) + changelog.

**DoD.** Framework + `billing.usage_viewed`, `digest.sent/opened` + digest open-rate baseline.

---

## DP-R1-11 · LLM Semantic-Fallback Parsing (1.11)
**Flag:** `semantic_fallback` · **Version:** v2.0.2 · **Run after:** DP-R0-RC (independent)

**Description.** When structural extraction confidence drops (selector miss, layout shift), route the DOM through semantic LLM parsing; results flagged `extraction_method=semantic` with confidence; golden-corpus regression guard.

**Impact.** Reliability = trust; cheap insurance pre-R4 self-healing. Risk: cost (only-on-failure routing, small-model-first, per-workspace daily semantic budget); silent quality drift (golden gate: structural parity ≥ baseline, semantic-path accuracy ≥85% on failure fixtures).

**Backend.** Confidence scorer, fallback router, budget limiter, method+confidence persisted.

**Frontend.** Subtle method badge + tooltip on results; nothing else.

**Testing.** Failure-fixture suite (20 broken-layout pages); golden regression in CI; cost telemetry assertion.

**Deployment.** Shadow mode 1 week (log-only) → enforce. **Docs.** Internal doc + changelog line.

**DoD.** Framework + `extract.semantic_fallback{confidence}` + failure-recovery rate reported.

---

## DP-R1-12 · Product Analytics Deep-Dive & Admin Console v1 (1.12 + P1-31)
**Flag:** `admin_v1` (internal) · **Version:** v2.0.2 · **Run after:** DP-R1-06

**Description.** Retention cohorts, feature-adoption dashboards, funnel drop-off views wired for the council check-in; internal admin console: user/workspace lookup, subscription state + support overrides (gate bypass with audit log), pipeline health, quota adjustments.

**Impact.** Decision infrastructure + support-cost control. Risk: admin abuse — role-restricted, every action audit-logged.

**Backend.** Admin API (separate auth realm), audit_logs writes, cohort SQL views.

**Frontend.** `/admin` (internal-only routing + IP allowlist), lookup/detail screens, health board.

**Testing.** Authz tests (non-admin denial), audit-log assertions, cohort view correctness.

**Deployment.** Internal GA. **Docs.** Internal admin guide + runbook.

**DoD.** Framework + first cohort report generated for check-in.

---

## DP-R1-13 · Polish Pass: Performance, A11y, Mobile (P1-28/29/30)
**Flag:** rolls into existing flags · **Version:** v2.0.3 · **Run after:** all R1

**Description.** Virtualized feeds, lazy loading, cache tuning (p95 targets: feed <800ms, dashboard <1.2s); WCAG 2.1 AA audit + remediation on Social/Connect/Pricing; mobile/tablet passes on the same. Bug-bash burn-down from beta feedback.

**Testing.** Lighthouse budgets in CI (perf ≥85, a11y ≥95 on core routes); axe automated scans; device-matrix E2E smoke.

**Deployment.** Continuous. **Docs.** Changelog "quality" section.

**DoD.** Budgets green + open-bug count below threshold agreed with founder.

---

## DP-R1-RC · Release Cut v2.0 → prep R2
Release notes + **v2.0 launch blog + PH "Ship" update** · homepage/pricing copy sync (badge on Starter) · full regression + golden suites · tag v2.0.3 · council check-in vs R1 exit criteria (free→paid ≥3%, WAU/MAU→40%, 50 paying workspaces, churn <5%) · trigger evaluation (developer vs CMO vs GTM dominance → File 02 §9 re-sequencing decision for R2) · user-research synthesis (P1-34) attached · open R2 milestone; Phase-2 architecture memo (P1-33) reviewed and ADR'd.
