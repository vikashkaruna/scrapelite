# DatIQ Implementation Prompts — Release 3 · v3.0 "Brand, AI Visibility & Content Engine" (Months 7–9)
Condensed format. Run after DP-R2-RC.

---

## DP-R3-01 · AI Visibility / AEO Monitoring (3.1) — flagship
**Flag:** `ai_visibility` · **v3.0.0-beta** · after R2-RC
**Feature/stories:** Track brand presence in AI answers: scheduled prompt panels ("best {category} tools", "{brand} alternatives", persona questions — default pack + custom prompts) run against ChatGPT, Perplexity, Gemini, Claude, Copilot via official APIs where available; record mention presence, rank/position, citation sources, sentiment of framing; competitor comparison; trend over time; **optimization guidance** (which cited sources to influence, content gaps). Sold as $99/mo add-on (test $149 per R2 check-in); waitlist from R0-04 gets first access. Story: CMO sees brand cited in 2/10 buying-intent prompts vs competitor's 7, with the source pages to fix.
**Impact:** Highest-differentiation feature in the superset; nascent category (vs Profound/HubSpot AEO); premium ARPU + PR magnet. Risks: provider ToS/API variability (official APIs only; per-provider adapters with graceful degradation; ADR documenting compliance stance per provider); answer non-determinism (n=3 sampling per prompt, presence expressed as frequency; methodology page published — transparency is the moat); cost (sampling budgets per tier, weekly default cadence).
**Backend:** `aeo_prompt_sets`, `aeo_runs`, `aeo_results` (provider, prompt, presence, rank, citations[], framing_sentiment, sampled_n); provider adapters; scheduler; citation-source resolver (links to extraction engine — "analyze this source" one-click); guidance generator (templated, citation-grounded).
**Frontend:** `/brand/ai-visibility`: scoreboard (presence % per provider), prompt-set manager, run detail (answer excerpts within fair-use bounds, citations list), competitor overlay, trend chart, guidance panel; add-on purchase flow (Stripe add-on price on File 05 config).
**Testing:** Adapter contract tests (recorded); sampling-math unit tests; methodology-doc assertions (numbers in UI = documented formulas); E2E `@aeo` set→run→scoreboard; billing add-on E2E.
**Deploy:** Waitlist beta (from R0-04 list) 2 weeks → GA v3.0.0. Rollback: flag; add-on refunds playbook.
**Docs:** Feature + methodology page (public, detailed) + help + use case + changelog + **blog: yes** ("Do AIs recommend you?") + /ai-visibility landing page converts from waitlist to live.
**DoD:** `aeo.run_completed{provider}`, `aeo.addon_purchased` + attach-rate baseline + methodology page reviewed by founder.

## DP-R3-02 · Brand Intelligence / Share-of-Voice Engine (3.2)
**Flag:** `brand_intel` · **v3.0.0** · after R2-RC
**Feature:** `/brand` dashboard: SoV matrix vs competitors (volume, reach, net sentiment — donut/bar comparisons), brand health score (composite: sentiment trend, SoV delta, alert frequency, AEO presence when subscribed), reputation timeline, crisis-detection mode (tightened thresholds + incident view grouping related mentions), emerging keyword cluster map (co-occurrence graph from entities_named).
**Impact:** Elevates sentiment into CMO-grade analytics; Business-tier anchor with 3.1. Risk: score credibility (formula published, components drillable — no black boxes).
**Backend:** SoV + health-score computed views; cluster job (co-occurrence on entities/key_phrases); incident grouping model.
**Frontend:** Dashboard (dark-mode-first executive styling per Concept C energy), score card with breakdown drawer, cluster visualization, incident view.
**Testing:** Score-formula golden tests; cluster snapshot on seeded data; E2E `@brand`.
**Deploy:** Beta → GA. **Docs:** Feature + score-methodology page + help + changelog + blog section.
**DoD:** `brand.dashboard_viewed`, `brand.incident_opened`.

## DP-R3-03 · Verified Contact Enrichment (3.3) — trigger-gated
**Flag:** `verified_enrichment` · **v3.0.1** · after R1-07 · **Run only if GTM-dominance trigger fired at R2-RC; else skip to R3-04 and log deferral in tracker.**
**Feature:** Verification waterfall on extracted contacts (syntax→MX→provider verify→optional Apollo/Prospeo lookup via user keys), deliverability score, "verified" badges, filtered exports (verified-only CSV), CRM push respects verification status.
**Impact:** GTM-persona monetizer; reduces bounce complaints. Risks: provider cost (user-key pass-through preferred; metered otherwise), compliance (no scraping private data; verification of publicly listed contacts only, documented).
**Backend:** Waterfall service + provider adapters + cache; verification status on contact records.
**Frontend:** Badges, filters, export toggle, settings (provider keys).
**Testing:** Waterfall unit matrix; cost telemetry; E2E verify→filtered export.
**Deploy:** Beta GTM cohort → GA. **Docs:** Feature + help + compliance note + changelog.
**DoD:** `extract.contact_verified{status}` + bounce-rate feedback loop defined.

## DP-R3-04 · Social Posts Writer & Thread Generator (3.4)
**Flag:** `content_writer` · **v3.0.1** · after R2-RC
**Feature:** Turn signals into drafts: from an extraction, change-diff, trending topic, or battlecard → LinkedIn post / X thread drafts in brand voice (workspace voice profile: tone sliders + 3 sample posts); variant generation; hashtag/mention suggestions; export/copy + optional queue (native scheduling deferred — copy-to-Buffer/Hootsuite guidance first). Seat-based add-on candidate (File 05).
**Impact:** ZAi's differentiator — signal-fed content vs generic AI writers; CMO/founder persona. Risks: brand-safety (no-claims-without-source rule; profanity/PII filters; human-approve-always UX), platform ToS (drafting, not auto-posting, at launch).
**Backend:** Voice profile model; draft generator with source-grounding (citations retained in draft metadata); variant endpoint.
**Frontend:** "Write about this" action on results/diffs/mentions/battlecards; editor with variants, voice controls, source panel; drafts library in Projects.
**Testing:** Grounding tests (every claim maps to source); voice-consistency snapshot; E2E signal→draft→export.
**Deploy:** Beta → GA. **Docs:** Feature + help + use case (change-diff → thread in 2 min) + changelog + blog section.
**DoD:** `content.draft_created{source_type}`, `content.draft_exported`.

## DP-R3-05 · Community Moderator (3.5)
**Flag:** `moderator` · **v3.0.2** · after R3-04
**Feature:** Monitor comments on connected brand posts (X initially; LinkedIn when 3.6 lands): flag negative/urgent via existing classifiers, auto-draft replies in brand voice (approve-to-send), escalation routing (Slack channel/email), response-time analytics. $29/seat add-on.
**Impact:** Support-team appeal; seat-license revenue. Risk: reply-automation ToS (approve-to-send only; no autonomous posting), tone failures (voice profile + templates + mandatory approval).
**Backend:** Comment collectors (scoped to owned posts via user OAuth), flag pipeline reuse, reply drafter, escalation dispatcher.
**Frontend:** Moderation inbox (flagged queue, draft-approve-send, escalate), analytics card.
**Testing:** Flag precision on labeled comment set; approval-flow E2E; escalation delivery tests.
**Deploy:** Beta 5 brands → GA. **Docs:** Setup help + policy note + changelog.
**DoD:** `moderator.comment_flagged/reply_sent{approved}`.

## DP-R3-06 · Source Expansion II: LinkedIn/IG/FB Public (3.6) — spike-gated
**Flag:** `sources_v3` · **v3.0.2** · after R2-08 · **Begin with a 5-day timeboxed spike per council OH flag; proceed only with documented compliant access paths (official APIs/partnerships); publish spike ADR either way.**
**Feature:** LinkedIn company-page posts (Marketing API partnership path), Instagram/Facebook public business content (Graph API), Threads where available — as collectors with per-source tier gating; influencer reach mapping (3.7) ships free-riding on reach_score once sources land.
**Impact:** CMO-persona breadth; unlocks 3.5 on LinkedIn. Risk: partnership timelines (parallel-track applications; roadmap honesty on marketing pages — "subject to platform approval").
**Backend/Frontend/Testing/Deploy/Docs:** collector pattern as prior; source toggles; fixture suites; GA behind gates; source-status public docs page.
**DoD:** ADR + whichever sources cleared compliance live with `social.mention_ingested{platform}`.

## DP-R3-07 · Campaign Tracking + Template/Recipe Gallery Community (3.8 + 3.9)
**Flag:** `campaigns_gallery` · **v3.0.3** · after R3-02, R2-05
**Feature:** Campaign tags on keywords/mentions/content-drafts with per-campaign dashboards (volume, sentiment, SoV delta, drafts shipped); community template submission (moderated queue, attribution, quality gate reuse) turning the gallery into a UGC pSEO flywheel.
**Impact:** CMO depth + acquisition flywheel. Risk: submission spam (rate limits, review queue, reputation minimums).
**Backend:** `campaigns` tagging model + rollups; submission workflow + moderation queue.
**Frontend:** Campaign selector + dashboards; submit-template flow; moderation admin.
**Testing:** Rollup correctness; moderation-flow E2E; template health on submissions.
**Deploy:** GA. **Docs:** Helps + contributor guide + changelog.
**DoD:** `brand.campaign_created`, `templates.submitted/approved`.

---

## DP-R3-RC · Release Cut v3.0 → prep R4
Release notes + v3.0 blog ("The brand pillar is live") + PR push on AI Visibility (category-creation angle) · pricing config: add-ons live-verified, attach-rate reporting · regression + goldens · tag v3.0.3 · council check-in vs R3 exits (free→paid ≥5%, add-on attach ≥15%) · enterprise-pipeline review → confirms/defers R4-02 SOC 2 certification spend · open R4 milestone.
