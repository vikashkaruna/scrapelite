# Datiq — 12-Week Sprint Plan: Phase 0 + Phase 1 (v2)

**v2 changes from v1**:
1. **W1 sequence corrected** to put the corrected Top-3 first (Q18 Public-share toggle → Q01 Public pricing → Q03 Public changelog). W2 promoted to ship Q04 (Watch-a-URL) and Q15 (Slack) — the new #4 and #9 in the corrected Top-10.
2. **Phase 1 Major Bet order re-sequenced** to put **M08 — Chat with this extraction** as the #1 Major Bet (corrected PS 40), ahead of M01 — Templates marketplace (now Future, corrected PS 28.9).
3. **W11/W12 add the Social Listening spec lock + sprint-0** so the platform expansion is build-ready by the end of Phase 1.
4. **All PS values re-derived** from the formula `(E × U × G × S × C) / (D × R × V × T)`. See `06-corrections-and-correed-top10.md` for the full re-derived table.

**Authoring window**: 2026-08-03
**Engineering team shape assumed**: 1 Eng Manager, 2 Senior Front-End (FE), 2 Senior Back-End (BE), 1 Full-Stack (FS), 1 Designer (DES), 1 DevRel/GTM (DR), 1 PM. **12 engineers × 1 week = 12 eng-weeks per week.** Use 1 FE-week ≈ 1 BE-week.

**Definitions**
- **Phase 0 = weeks 1–6**: Quick-Win foundation (SSR pages, exports, retention rails, no-code UX fixes, first CRM/Sheets connector).
- **Phase 1 = weeks 7–12**: First Major Bets (Chat with extraction alpha, browser extension, native CRM rollout, templates marketplace beta, foundation of Social Listening MVP).

**Effort convention** in the tables below: T-shirt size in **eng-weeks**. Total = 6-week effort summed across all roles.

**Bucketing convention (re-derived, v2)**:
- Quick Win = D ≤ 2 (20 items)
- Major Bet = D ≥ 3 AND PS > 30 (3 items: M08, M04, M05)
- Future = D ≥ 3 AND 5 ≤ PS ≤ 30 (5 items: M01, M02, M06, M09, F05)
- Deprioritise = PS < 5 (13 items, including M03, M07, M10, M11, F01-F04, X01-X05)

---

## Phase 0 (weeks 1–6) — Quick-Win Foundation (v2 sequence)

### P0-W1 — Six ships: the corrected Top-6

The corrected Top-10 starts with Q18 (PS 2500), Q01 (PS 1875), Q03 (PS 1280), Q04 (PS 1200), Q02 (PS 1125), Q12 (PS 960). W1 ships the top of the Top-10 plus two foundational items.

| Task | Owner | Eng-weeks | Corrected PS | Notes |
|---|---|---|---|---|
| P0-W1.1 Audit React-only renderer; design SSR/SSG strategy (Vite + Netlify/Cloudflare or Next.js refactor) | EM + 1 FS | 1.5 | n/a | Blocker for everything that follows (Q01, Q03, Q18). |
| P0-W1.2 **Public-share toggle on Preview — Q18 (PS 2500)** | 1 FE | 0.5 | 2500 | New #1 in v2. The `/p/:slug` viral loop. **Make public-by-default for new extractions** — not a buried toggle. |
| P0-W1.3 **Public pricing page (SSR) — Q01 (PS 1875)** | 1 FE + 1 DES | 0.5 | 1875 | 5-tier ladder. Highest-ROI conversion asset. |
| P0-W1.4 **Public changelog (SSR) — Q03 (PS 1280)** | 1 FE | 0.5 | 1280 | Monthly entries; indexable. |
| P0-W1.5 **All 5 export formats always free — Q12 (PS 960)** | 1 BE | 0.5 | 960 | Friction removal at the conversion moment. |
| P0-W1.6 Save-Custom-as-Template backend + DB schema — Q11 (PS 800) | 1 BE | 1.0 | 800 | Foundation for the marketplace (M01). **Critical path.** |
| P0-W1.7 Re-run button on Preview — Q16 (PS 480) | 1 FE | 0.3 | 480 | 5-second repeat. |
| P0-W1.8 Watch-a-URL overlay (start) — Q04 (PS 1200) | 1 FE + 0.3 DES | 0.5 | 1200 | Promoted from W3 in v1. Promoted because PS moved up in v2 ranking. |

**P0-W1 total ≈ 5.3 eng-weeks.** Six of the corrected Top-6 ship in W1. Marketing can start linking real pages.

### P0-W2 — Retention rails + watch overlay + Slack

| Task | Owner | Eng-weeks | Corrected PS | Notes |
|---|---|---|---|---|
| P0-W2.1 Recent-runs rail on Home (signed-in) — Q02 (PS 1125) | 1 FE | 0.8 | 1125 | The #1 retention fix. |
| P0-W2.2 Save-Custom-as-Template UI on Preview — Q11 | 1 FE | 0.5 | 800 | Pairs with W1.6. |
| P0-W2.3 Tag auto-suggest — Q14 | 1 FE | 0.2 | 72 | Half-day. |
| P0-W2.4 Dark mode polish + system-preference default — Q08 | 1 FE | 0.3 | 90 | Already shipped in code. |
| P0-W2.5 Keyboard shortcuts in-app — Q09 | 1 FE | 0.5 | 144 | 10 documented shortcuts + `?` overlay. |
| P0-W2.6 Webhook for results backend + HMAC signing — Q07 | 1 BE | 1.0 | 360 | Required for Zapier. |
| P0-W2.7 Google Sheets OAuth app registration + consent flow | 1 BE | 0.5 | n/a | Hard blocker for Q05. |
| P0-W2.8 **Watch-a-URL overlay — Q04 (PS 1200, ship in W2)** | 1 FE + 0.3 DES | 0.5 | 1200 | Completes the W1 start. |
| P0-W2.9 **Slack notification on schedule change — Q15 (PS 768, promoted from W3)** | 1 BE | 0.5 | 768 | Per-schedule Slack webhook config. |

**P0-W2 total ≈ 4.8 eng-weeks.** Home page now has a returning-user surface; templates primitive exists; watch flow + Slack notifications live.

### P0-W3 — Templates UX + email digest + competitor comparison

| Task | Owner | Eng-weeks | Corrected PS | Notes |
|---|---|---|---|---|
| P0-W3.1 Webhook UX in Account — surface URLs + delivery log | 1 FE | 0.5 | n/a | |
| P0-W3.2 **Email report digest (weekly) — Q10 (PS 768, promoted from W4 in v1)** | 1 BE + 0.3 DR | 1.0 | 768 | Standard retention loop. |
| P0-W3.3 Onboarding template chooser (first-visit) — Q13 (PS 320) | 1 FE + 1 DES | 1.5 | 320 | 2-step "what's your job?" → 3 templates. |
| P0-W3.4 Competitor-comparison mode on Preview — Q19 (PS 400) | 1 FE + 1 BE | 1.5 | 400 | Side-by-side 2–5 URLs. |
| P0-W3.5 Recent-templates rail on Home — Q20 (PS 720) | 1 FE | 0.3 | 720 | Depends on W1.6, W2.1. |
| P0-W3.6 CSV drag-and-drop on Home — Q17 (PS 512) | 1 FE | 0.3 | 512 | |

**P0-W3 total ≈ 5.1 eng-weeks.** The "what's your job?" first-visit flow is live; competitor comparison is real.

### P0-W4 — Sheets + Zapier + connector plumbing

| Task | Owner | Eng-weeks | Corrected PS | Notes |
|---|---|---|---|---|
| P0-W4.1 Google Sheets native export — Q05 (PS 750) | 1 FE + 1 BE | 1.5 | 750 | "Send to Sheet" on Preview + Dashboard. |
| P0-W4.2 Zapier integration (publish + Zap listing) — Q06 (PS 320) | 1 BE + 0.5 DR | 1.5 | 320 | 1 trigger (new extraction) + 5 actions. |
| P0-W4.3 HubSpot OAuth app registration + sandbox testing | 1 BE | 1.0 | n/a | Long lead-time; start now for P1-W7. |
| P0-W4.4 Apollo.io API key + sandbox testing | 1 BE | 0.5 | n/a | Quick — Apollo uses API keys, not OAuth. |
| P0-W4.5 Stripe webhook receiver for billing events | 1 BE | 0.5 | n/a | Needed for plan-downgrade UX. |
| P0-W4.6 Calendly webhook receiver scaffolding | 1 BE | 0.5 | n/a | Wired to "Push extracted contact to a Calendly invite" in Phase 1. |

**P0-W4 total ≈ 5.5 eng-weeks.** All four target connectors have at least auth + test plumbing. Sheets + Zapier are public.

### P0-W5 — Polish + telemetry + templates gallery preview

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P0-W5.1 Templates gallery (private, user-only) — preview of M01 | 1 FE + 1 BE + 1 DES | 2.0 | "My templates" page; one-click "Use template". |
| P0-W5.2 Telemetry: extraction funnels, share rate, Sheets-export rate, schedule fire rate, template-apply rate | 1 BE | 1.0 | Required before Phase 1 to measure the marketplace flywheel. **Add `share_link_viewed` and `share_link_published` events specifically — Q18 is the highest-ROI ship, instrument it.** |
| P0-W5.3 Pricing-page A/B test scaffold (3 heroes + 2 CTAs) | 1 FE + 0.3 DR | 0.5 | |
| P0-W5.4 Public-share analytics on `/p/:slug` (views, click-throughs) | 1 BE | 0.5 | "X views" badge to motivate more shares. |
| P0-W5.5 Onboarding-tour replay polish — `g t` keyboard | 1 FE | 0.2 | |

**P0-W5 total ≈ 4.2 eng-weeks.** Telemetry is now live — every Phase 1 ship has a measurement plan, with the Q18 viral loop specifically instrumented.

### P0-W6 — Phase 0 ship + public templates marketplace beta

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P0-W6.1 Templates marketplace (public) — M01 v0.5 (beta) | 1 FE + 1 BE + 1 DR | 3.0 | Public gallery of Datiq-authored + 10 hand-curated community templates. |
| P0-W6.2 "Promote to template" button on successful custom extraction | 1 FE | 0.5 | |
| P0-W6.3 Docs site (Docusaurus or Mintlify) for the developer API + connectors | 1 FS + 0.3 DR | 1.5 | Required for the public Zapier + Phase 1 CRM rollouts. |
| P0-W6.4 Pricing-page launch (public SSR) | 0.5 FE + 0.5 DR | 1.0 | Sales/GTM comms + outreach. |
| P0-W6.5 Phase 0 retro, Phase 1 kick-off | EM + PM | 0.5 | |

**P0-W6 total ≈ 6.5 eng-weeks.** **Phase 0 exit criteria met** (see below).

### Phase 0 exit criteria (the tests for "ship")

1. `/pricing` and `/changelog` return SSR HTML that Google indexes within 7 days.
2. **A returning user lands on Home and sees their last 8 extractions + last 5 templates.**
3. A first-visit user lands on Home and gets a 2-step "what's your job?" flow.
4. **A paying user can share an extraction publicly (one click, public-by-default), send it to Sheets, post a Slack alert, and re-run it in one click.**
5. The Zapier public integration is published.
6. Telemetry is live: extraction-funnel, share, Sheets-export, schedule-fire, template-apply, public-link-view events all streaming to one dashboard. **Plus Q18-specific share-link-viewed + share-link-published events.**
7. HubSpot and Apollo OAuth/sandbox are working; Calendly webhook receiver is wired.
8. Templates marketplace is open to 10 hand-curated community templates in a closed beta.
9. **Q18 viral loop is instrumented and measurable** (the corrected #1 Quick Win is the headline ship of Phase 0).

---

## Phase 1 (weeks 7–12) — First Major Bets (v2 sequence: M08 before M01)

The v2 ordering puts **M08 — Chat with this extraction** first because it is the corrected #1 Major Bet (PS 40). M01 — Templates marketplace is a Future item per the corrected formula (PS 28.9) but ships as a major strategic initiative at P1-W10 (public beta) → W12 (GA). The chat loop creates the stickiness that makes the marketplace convert.

### P1-W7 — M08 alpha + browser extension scaffold + CRM design lock

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W7.1 **M08 — Chat with this extraction (alpha)** | 1 BE + 1 FS | 2.0 | Server-side streaming; OpenAI-compatible. New v2 #1 Major Bet. |
| P1-W7.2 Chrome extension scaffold (Manifest V3) | 1 FE | 1.5 | Right-click "Extract with Datiq" + side-panel composer. |
| P1-W7.3 Native HubSpot integration: read-side (find/create contact by email, find/create company by domain) | 1 BE | 1.5 | Foundation for "Send to CRM" action. |
| P1-W7.4 Templates marketplace: comments + ratings | 1 FE + 0.3 DR | 1.0 | |
| P1-W7.5 Stripe billing — usage-based metering foundation | 1 BE | 1.0 | Metered billing blocks for the Phase 2 platform plan. |

**P1-W7 total ≈ 7.0 eng-weeks.**

### P1-W8 — M08 public alpha + extension beta + CRM push-side + Apollo

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W8.1 **M08 — Chat with this extraction (public alpha to 10% of Pro users)** | 1 BE + 1 FS + 0.3 DR | 1.5 | Gated feature flag. |
| P1-W8.2 Chrome extension: published beta on Chrome Web Store (5 internal users) | 1 FE | 1.0 | |
| P1-W8.3 HubSpot write-side: "Send this contact / company to HubSpot" + writeback of enrichment | 1 BE | 1.5 | Match by HubSpot Object ID, not email. |
| P1-W8.4 Apollo.io enrichment integration — "Enrich with Apollo" on the Find-contacts tab | 1 BE | 1.0 | Per-record credit consumption surfaced in UI. |
| P1-W8.5 Connector framework — abstract "Connector" interface for any new OAuth/API source | 1 BE | 1.0 | Prevents future rewrites for Salesforce, Pipedrive, Notion, etc. |

**P1-W8 total ≈ 6.0 eng-weeks.** All four target connectors (HubSpot, Stripe, Calendly, Apollo) are wired at the framework level. M08 is live to 10% of Pro.

### P1-W9 — M04 push complete + domain research alpha + connector framework GA

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W9.1 **M04 — Native CRM push-side complete** (HubSpot, Apollo write paths) | 1 BE | 1.0 | |
| P1-W9.2 Domain-research workspace alpha — M02 v0.3 (internal) | 1 FS + 1 BE | 3.0 | "Paste a domain" → sitemap crawl + classifier. |
| P1-W9.3 Connector framework v1 GA | 1 BE | 1.0 | |
| P1-W9.4 Calendly "push extracted contact to a Calendly invite" — P1 connector | 1 BE | 1.0 | |
| P1-W9.5 Stripe checkout for usage top-ups | 1 BE | 0.5 | |
| P1-W9.6 Public templates marketplace: featured + trending rails | 1 FE + 0.3 DR | 1.0 | |

**P1-W9 total ≈ 7.5 eng-weeks.** CRM push complete; domain research in alpha; Calendly + Stripe fully wired.

### P1-W10 — M01 templates marketplace public beta + M08 GA 50% + M04 GA

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W10.1 **M01 — Templates marketplace public beta** | 1 FE + 1 BE + 0.3 DR | 2.0 | Now Future per the v2 formula (PS 28.9) but still strategically critical. |
| P1-W10.2 **M08 — Chat with this extraction GA to 50% of Pro+** | 1 BE + 0.3 DR | 1.0 | |
| P1-W10.3 **M04 — Native CRM GA** (HubSpot, Apollo) | 1 BE + 0.3 DR | 1.0 | |
| P1-W10.4 Domain research workspace public beta — M02 v0.5 | 1 FS + 1 BE | 2.0 | Beta to 5% of Pro+; gated by invite. |
| P1-W10.5 HubSpot writeback — add contact/company activity log entry per extraction | 1 BE | 0.5 | |

**P1-W10 total ≈ 6.8 eng-weeks.** M08, M04, M01 all GA-ing on a rolling basis; domain research in public beta.

### P1-W11 — Connectors GA + M08 GA + social listening spec lock

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W11.1 **HubSpot, Apollo, Stripe, Calendly connectors to public beta** | 1 BE + 0.3 DR | 2.0 | Per-connector docs + 1 demo video. |
| P1-W11.2 **Social Listening MVP — spec lock, data-source contracts, infra** | 1 BE + 1 FS + 1 DES | 2.0 | See `02-social-listening-mvp-spec.md`. |
| P1-W11.3 **M08 — Chat with this extraction GA** | 1 BE + 0.3 DR | 1.0 | 100% rollout after 2 weeks at 50%. |
| P1-W11.4 M05 — Browser extension public beta (Chrome Web Store) | 1 FE | 1.0 | |
| P1-W11.5 Waterfall enrichment alpha (Apollo → Hunter → Clearbit fallback) — M09 | 1 BE | 1.0 | |
| P1-W11.6 Templates marketplace — author profile + paid templates (private beta) | 1 FE + 0.3 DR | 1.0 | |

**P1-W11 total ≈ 7.3 eng-weeks.** **Spec for Social Listening MVP locked. Phase 2 (Q3) build-ready.** M08 GA. M05 public beta.

### P1-W12 — Phase 1 ship + Phase 2 kickoff

| Task | Owner | Eng-weeks | Notes |
|---|---|---|---|
| P1-W12.1 **M01 — Templates marketplace GA — 1.0** | 1 FE + 1 BE + 0.5 DR | 2.0 | Open to all; featured rails; paid templates. |
| P1-W12.2 **HubSpot / Apollo / Calendly / Stripe connectors to GA** | 1 BE | 1.5 | |
| P1-W12.3 **M05 — Browser extension GA** | 1 FE | 1.0 | |
| P1-W12.4 M02 — Domain research workspace public beta | 1 FS | 1.0 | |
| P1-W12.5 M06 — 250+ prebuilt scrapers alpha (50 live, 150 in queue) | 1 FS + 0.3 DR | 2.0 | |
| P1-W12.6 Phase 1 retro, Phase 2 (platform) kick-off | EM + PM | 0.5 | |
| P1-W12.7 **Phase 2 social listening sprint-0** | 1 FS + 1 BE | 2.0 | Infra, OAuth, first data source live. |

**P1-W12 total ≈ 9.0 eng-weeks.** **Phase 1 exit criteria met** (see below). Social Listening build is underway.

### Phase 1 exit criteria

1. A user can publish a template; ≥100 other users apply it within 30 days.
2. A user can install the Chrome extension and extract a page with two clicks.
3. **A user can "Chat with this extraction" (GA) and get cited follow-up answers.**
4. A user can paste a domain and see a classified map (pricing / careers / leadership / blog / legal / product).
5. HubSpot, Apollo, Calendly, Stripe connectors are GA.
6. 50+ prebuilt scrapers are live in the marketplace.
7. **Social Listening MVP spec is signed off; infra is provisioned; first data source (X/Twitter API) is in sprint-0.**
8. **M08 is GA — the chat loop is the new conversion surface for templates + connectors.**
9. NRR is trending up (early signal: ≥10% of paying users on Pro+ use ≥3 of the 4 connectors, ≥5% use M08).

---

## Cross-phase work that never stops

| Stream | Owner | Weekly cost |
|---|---|---|
| Public-site SEO + content (using the SSR pages shipped in W1) | 1 DR | 0.5 |
| **Q18 viral loop monitoring** — share-link-published + share-link-viewed → click-through → sign-up funnel | 0.3 DR | 0.3 |
| Templates marketplace curation + featured rotation | 0.3 DR | 0.3 |
| Customer interviews (8/week, 2 personas/week) | PM + DR | 0.5 |
| Quarterly SOC 2 prep (vendor selection, Type I in W12, Type II start W24) | EM + 0.3 legal | 0.5 |

**Note on SOC 2**: M07 (SOC 2 Type II) is Deprioritise per the v2 formula (PS 0.6), but the parallel-work track keeps it moving. The formula undervalues it because S=4 (security is "core to thesis" but not "core to current thesis") is the same as any platform bet. SOC 2 is a hard dependency for M11 (Audit log & SSO) and for the Agency expansion. The product team should treat it as ongoing background work, not as a candidate for the sprint plan.

---

## Risk register and mitigations (12-week window)

| Risk | Severity | Mitigation |
|---|---|---|
| **SSR refactor blows up** in W1 (the React shell is the only renderer) | High | **Pre-empt**: spike in week 0 (1 FS × 1 day) to choose between Netlify/SSR adapter vs. Next.js refactor. Pick the lighter one. |
| **Google dev-app review for Sheets/HubSpot OAuth slips** beyond the 2-week SLA | Medium | Start registration in W2 and W4 respectively. Have a "user pastes their own OAuth client" fallback for the Sheets connector. |
| **Q18 default-public toggle creates noise** (users accidentally publish private data) | High | **Pre-empt**: ship with a confirmation modal for first 30 days, then make the default public. Add a "private by default" org-level override for enterprise plans. **Measure publish-rate → view-rate → sign-up conversion; the loop is the entire reason Q18 is #1.** |
| **M08 Chat — LLM cost surprise** | High | Tier-1 VADER-style for sentiment; only the top 5% of mentions go to LLM. Per-workspace soft cap on Chat usage. Surface cost in UI. |
| **Templates marketplace fails to seed** (closed beta has <10 templates, low quality) | High | **Pre-empt**: PM authors 30 high-quality templates before the marketplace goes public. Recruit 5 power users to seed the community. |
| **Apollo credit costs** exceed the per-record cost budget | Medium | Surface Apollo cost in UI before action; rate-limit per workspace; soft-cap at $50/workspace/month. |
| **Stripe webhooks get out of sync** with the metered-billing model | Low | Use Stripe's CLI for testing; deploy the webhook receiver with idempotency keys. |
| **HubSpot writeback** corrupts customer data | High | Match by HubSpot Object ID; never overwrite fields owned by the customer; log every write; require 2-click confirmation. |

---

## Headcount dependency

The 12-week plan above assumes:
- 1 Eng Manager (oversight + reviews)
- 2 Senior Front-End
- 2 Senior Back-End
- 1 Full-Stack
- 1 Designer
- 1 DevRel/GTM
- 1 PM

**If you can only hire 1 FE and 1 BE**, drop Phase 1's parallel work to: connector framework + HubSpot + Apollo + Sheets polish, defer browser extension and domain research to Phase 2. The phase 0 critical path (pricing/changelog/Q18 share toggle/recent runs/templates primitive) fits in 4 eng-weeks per role.

**If you can add one more designer** by W6, they can own the Social Listening MVP UI mocks in W11–W12 and pre-empt the bottleneck.

---

## Diff from v1 (for reviewers)

| What changed | From | To | Why |
|---|---|---|---|
| W1 sequence | Q01, Q03, Q18, Q12, Q11, Q16 | **Q18 first, then Q01, Q03, Q12, Q11, Q16, Q04 start** | Q18 (PS 2500) is the corrected #1. Q04 (PS 1200) is the corrected #4. |
| W2 additions | — | Q04 ship + Q15 (Slack) | Both promoted from W3 in v1 per the v2 Top-10. |
| W3 swap | Q04 + Q15 (which were here) | Q10 (Email digest) + Q13 + Q19 + Q20 + Q17 | Q04 and Q15 already shipped in W2. Q10 promoted from W4. |
| Phase 1 W7 | Templates marketplace comments | **M08 Chat alpha** + extension scaffold + HubSpot read | M08 is the corrected #1 Major Bet. M01 demoted per v2 formula. |
| Phase 1 W8 | Marketplace trending | **M08 public alpha** + extension beta + HubSpot write | M08 ships to 10% of Pro. |
| Phase 1 W10 | M03 self-healing v0.1 (Deprioritise) | **M01 public beta** + M08 GA 50% + M04 GA | M03 was Deprioritise per v2; M01 v0.5 promoted here. |
| Phase 1 W12 | — | **Phase 2 social listening sprint-0** | New: social listening build starts W12. |
| Telemetry | extraction funnels, share rate | **+ share-link-viewed + share-link-published events specifically for Q18** | Q18 is the headline ship; instrument it. |
| Risk register | — | **Q18 default-public noise risk added** | Default-public is a strategic call; needs a guardrail. |
| Cross-phase work | DR + EM bench | **+ Q18 viral loop monitoring** | Dedicated stream for the #1 Quick Win. |
