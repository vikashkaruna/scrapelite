# DatIQ Implementation Prompts — Release 4 · v3.5 "Enterprise, Trust & Reliability" (Months 10–12) & Release 5 · v4.0 "Autonomous Intelligence" (Year 2)
Condensed format. R4 runs after DP-R3-RC; R5 after DP-R4-RC and only with R4 retention/NRR evidence.

---

# RELEASE 4 · v3.5

## DP-R4-01 · Team Workspaces, RBAC & Audit Logs (4.1)
**Flag:** `teams_rbac` · **v3.5.0-beta** · after R3-RC
**Feature:** Multi-member workspaces with roles (Owner/Admin/Editor/Viewer + per-pillar grants), invitations, seat enforcement per tier, comprehensive audit log (auth, data access, exports, connector actions, admin overrides) with retention + export. Story: agency runs 5 client projects with scoped analyst access.
**Impact:** Enterprise gate-opener; agency segment unlock. Risks: RLS complexity explosion (policy test matrix mandatory — role × pillar × action); migration of solo workspaces (auto-Owner, zero-disruption script rehearsed on staging snapshot).
**Backend:** `workspace_members`, `roles`, granular policy layer over existing RLS; invitation flow (email tokens); audit writer middleware covering all mutating endpoints; seat metering into billing.
**Frontend:** Members settings (invite, role change, remove), role-aware UI hiding (server-enforced, client-reflected), audit viewer (filter/export, Business+).
**Testing:** Policy matrix suite (highest-value tests of the release); invitation E2E; audit completeness assertions (every mutating route logs).
**Deploy:** Beta agencies → GA v3.5.0. **Docs:** Admin guide + roles reference + changelog + blog section.
**DoD:** `team.member_invited/role_changed`, `audit.event_written` coverage report ≥95% of mutating routes.

## DP-R4-02 · SSO/SAML + SOC 2 Certification + Privacy Posture (4.2) — trigger-confirmed at R3-RC
**Flag:** `enterprise_auth` · **v3.5.0** · after R4-01
**Feature:** SAML/OIDC SSO (Okta/Azure AD/Google), SCIM basics (provision/deprovision), enforced-SSO workspace mode; SOC 2 Type II audit execution on the R2-08 evidence base; GDPR/DPDPA posture completion (DPA template, subprocessor list, data-map, residency statement); public Trust Center page.
**Impact:** Unblocks enterprise procurement; pricing power (+ File 05 Year-2 list review). Risks: audit timeline (external dependency — engineering freeze windows planned); SSO lockout bugs (break-glass owner path, tested).
**Backend:** SSO provider integration (WorkOS-class or native), SCIM endpoints, session policy engine.
**Frontend:** SSO config UI (Enterprise), Trust Center (public), enforced-SSO login flows.
**Testing:** IdP matrix tests (3 providers), lockout/break-glass E2E, SCIM conformance.
**Deploy:** Design-partner enterprise pilot → GA. **Docs:** SSO setup per IdP + security whitepaper + DPA + changelog + **blog: yes** ("Enterprise-ready").
**DoD:** SOC 2 report issued (or auditor-confirmed date) + first enforced-SSO workspace live + `auth.sso_login{idp}`.

## DP-R4-03 · Self-Healing Extraction & Validation Layer (4.3)
**Flag:** `self_healing` · **v3.5.1** · after R1-11
**Feature:** Full reliability layer: drift detection on scheduled/monitored targets (structure fingerprints), auto-repair via semantic re-derivation of field mappings with human-review queue for low-confidence repairs, output validation rules (type/range/required-field anomaly QA), per-target reliability score surfaced to users. Kadoa-parity.
**Impact:** Enterprise trust + support-load reduction; monitors become dependable infrastructure. Risk: silent wrong-data (validation blocks publish on anomaly; user notified with diff of suspected drift).
**Backend:** Fingerprint store, drift detector job, repair engine on R1-11 semantic layer, validation rule engine, review queue.
**Frontend:** Reliability badge + history per monitored URL; review-queue admin surface; anomaly notices in diffs/alerts.
**Testing:** Drift simulation suite (mutated golden pages), repair-accuracy benchmark (≥85% auto-repair on fixture drift), validation rule units.
**Deploy:** Shadow (log-only) 2 weeks → enforce. **Docs:** Reliability methodology page + runbook + changelog.
**DoD:** `extract.drift_detected/auto_repaired{confidence}` + auto-repair rate reported weekly.

## DP-R4-04 · Salesforce + Pipedrive (+Dynamics scoped) Connectors (4.4)
**Flag:** `crm_wave2` · **v3.5.1** · after R1-07 (AppExchange application filed during R3)
**Feature:** Salesforce (OAuth, Contacts/Accounts/Opportunities bi-directional, datiq_* custom fields, AppExchange listing) and Pipedrive (simpler REST) on the connector framework; Dynamics spec'd, built if enterprise pipeline demands.
**Impact:** Enterprise + EMEA market expansion. Risks: AppExchange security review (long lead — filed early; private-connected-app fallback), Salesforce data-model variance (mapping presets per common org shapes + dry-run default).
**Backend/Frontend/Testing:** Framework pattern as R1-07 incl. dry-run, sandbox contract tests, mapping UI reuse.
**Deploy:** Pilot orgs → GA. **Docs:** Setup helps + mapping references + changelog + listing copy.
**DoD:** `connect.sync_completed{provider=salesforce|pipedrive}` + listing status tracked.

## DP-R4-05 · Executive Intelligence Module (4.5)
**Flag:** `exec_intel` · **v3.5.2** · after R2-01, R2-04, R3-02
**Feature:** One-click executive briefs assembled from all pillars: Morning Brief (mentions, changes, AEO shifts, pipeline-relevant signals), Competitor Summary, Industry Summary, Board Brief (period narrative + charts, exportable via existing docx/pdf paths); schedule to email/Slack; $199/mo add-on (File 05). Gemini's module, matured on the R1 digest engine.
**Impact:** C-suite persona (the founder's own persona — dogfood daily); premium ARPU; retention at the top. Risk: narrative accuracy (citation-grounded assembler, no-fabrication rule, review-before-send option).
**Backend:** Brief assembler (pillar query federation + templated narrative w/ citations), schedule engine on digest infra, export renderer.
**Frontend:** Brief gallery, config (audience, sections, cadence), preview/edit, share via permalink.
**Testing:** Assembler golden briefs (3 seeded workspaces), citation coverage assertions, export snapshot.
**Deploy:** Founder dogfood 2 weeks → beta → GA. **Docs:** Feature + use case (the Monday board update) + changelog + **blog: yes**.
**DoD:** `exec.brief_generated{type}/scheduled` + founder uses it weekly (the honest DoD).

## DP-R4-06 · Ops Hardening: Anomaly Service, PagerDuty, Proxy Pools & Residency (4.6 + 4.7)
**Flag:** `ops_enterprise` · **v3.5.2** · after R3-RC
**Feature:** Anomaly-detection service hardening (volume/sentiment model upgrades, SLO dashboards), PagerDuty channel for Enterprise alerts, dedicated proxy pool add-on ($250/mo) with isolation, data-residency options (EU + India region evaluation — DPDPA positioning), status page public.
**Impact:** Enterprise SLA credibility; India GTM enabler. Risk: multi-region complexity (scoped: residency for stored artifacts first, compute later — ADR).
**Backend:** Region-aware storage routing, pool provisioning automation, SLO instrumentation, status-page feed.
**Frontend:** Enterprise settings (residency, pool), status page.
**Testing:** Region-routing tests, failover drills documented.
**Deploy:** Enterprise pilot. **Docs:** SLA doc + residency statement + runbooks + changelog.
**DoD:** SLO dashboard live + first residency-pinned workspace verified.

## DP-R4-07 · Customer Intelligence v1 (4.9) + Admin Console v2 (4.8)
**Flag:** `customer_intel` · **v3.5.3** · after R3-02
**Feature:** Ingest reviews (G2/Capterra/Play/AppStore exports + paste), support-ticket CSV, NPS exports → themes, sentiment, churn-risk surfacing (reusing intent_class=churn_risk pipeline); links to company/contact records. Admin v2: subscription ops, feature-flag targeting UI, support-impersonation with consent+audit.
**Impact:** Product/CS persona wedge; completes the signal loop (market→brand→customer). Risk: PII in tickets (ingestion redaction pass, retention controls).
**Backend:** Ingestion adapters + redaction, theme clustering (reuse cluster job), churn-risk view; admin v2 endpoints.
**Frontend:** `/customers` dashboard (themes, risk list, verbatims with source), upload flows; admin v2 screens.
**Testing:** Redaction unit suite, clustering snapshots, impersonation audit tests.
**Deploy:** Beta → GA. **Docs:** Feature + privacy notes + changelog.
**DoD:** `customer.source_ingested{type}`, `customer.risk_flagged`.

## DP-R4-RC · Release Cut v3.5 → gate R5
Release notes + enterprise launch blog + sales one-pager refresh · tag v3.5.3 · council check-in vs R4 exits (first 5 enterprise logos, NRR ≥110%) · **R5 go/no-go:** proceed only with retention evidence (WAU/MAU ≥45%, churn ≤3%) — else insert a consolidation release (R4.5: debt, perf, depth) and re-gate · Year-2 pricing review executed (File 05 §1.5) · open R5 milestone if green.

---

# RELEASE 5 · v4.0 (Year 2 — sequenced quarterly, re-scored at each RC)

## DP-R5-01 · Knowledge Graph Foundation (5.2 — built first; agents consume it)
**Flag:** `knowledge_graph` · **v4.0.0-alpha**
**Feature:** Promote entities_named + company/contact/battlecard/mention linkages (graph-ready since R1) into a first-class graph: entity resolution (dedupe/merge across pillars), relationship edges (company↔people↔products↔brands↔mentions↔changes), graph query API, entity pages ("everything DatIQ knows about {entity}"), graph visualization in Research Workspace.
**Impact:** The long-term moat; multiplies every pillar. Risks: resolution errors (confidence + human merge/split tools), scale (evaluate the deferred ClickHouse/graph-store migration here — the R1 ADR's criteria finally bite).
**Key tests:** resolution precision/recall on labeled set; cross-pillar linkage integrity.
**Docs/blog:** methodology + "The DatIQ Graph" post. **DoD:** `graph.entity_resolved/merged` + entity pages live.

## DP-R5-02 · Autonomous AI Agents (5.1)
**Flag:** `agents` · **v4.0.0**
**Feature:** Agent framework on MCP tools + graph: Research, Competitive, Brand, Sales, Executive, Compliance agents — goal-configured, scheduled or triggered, producing artifacts (reports, battlecard updates, brief sections, CRM actions) with **approval gates on all external writes**, full action logs, spend budgets. Story: Competitive Agent notices a pricing diff, updates the battlecard draft, and files a brief section for approval.
**Impact:** Gemini's "Exceptional/Exceptional"; category leadership. Risks: autonomy safety (approval-gated writes, budget caps, kill switch, action audit), reliability expectations (agent SLA honesty in docs).
**Key tests:** scenario harness per agent (seeded worlds → expected artifacts), gate-enforcement tests, budget-cap tests.
**Docs/blog:** agent handbook + launch post. **DoD:** `agent.run_completed{type}`, `agent.action_approved/rejected` + human-approval rate tracked.

## DP-R5-03 · Multi-Modal Ingestion (5.4)
**Flag:** `multimodal` · **v4.0.1**
**Feature:** PDF, DOCX, CSV, images (OCR), audio/video (transcription), email-forwarding ingestion → same enrichment + graph; "Intelligence from Everywhere." Per-format quotas; tier-gated heavy media.
**Risks:** processing cost (budget + async UX), format edge cases (fixture corpus per format).
**DoD:** `ingest.file_processed{format}` + format coverage report.

## DP-R5-04 · Market Intelligence Module (5.5)
**Flag:** `market_intel` · **v4.0.1**
**Feature:** Market maps (graph-derived competitor/adjacency clusters), TAM/SAM/SOM estimator (sourced, assumption-editable), trend & emerging-player detection (cluster velocity), analyst-grade exports.
**Risks:** estimate credibility (every number sourced/assumption-flagged — no oracle claims).
**DoD:** `market.map_generated` + methodology page.

## DP-R5-05 · Risk Intelligence (5.6)
**Flag:** `risk_intel` · **v4.0.2**
**Feature:** Vendor/cyber/compliance/ESG monitoring: watchlists over companies (news/sanctions/cert-expiry/breach signals via monitors + sources), risk scores with drill-down, alerting, audit-friendly reports. BFSI/public-sector wedge (India resonance).
**Risks:** false-positive reputational harm (evidence-linked flags only, review states).
**DoD:** `risk.flag_raised{category}` + pilot with 2 design partners.

## DP-R5-06 · Sub-Product Packaging + Marketplace (5.7 + 5.8, + 5.3 virality prediction as marketplace-era analytics add-on)
**Flag:** `platform_economy` · **v4.0.3**
**Feature:** Standalone-sellable DatIQ Brand/Social/Sales/Executive/Research SKUs on shared platform (pricing config refactor to product-line model); partner marketplace (connectors, templates, agent recipes — revenue share, review pipeline); virality/trend forecasting shipped as analytics add-on on topic_metrics time series.
**Risks:** SKU complexity vs File 05 simplicity principle (council review mandatory before launch), marketplace trust (security review pipeline for partner connectors).
**DoD:** first external partner listing live + SKU checkout E2E + council sign-off recorded.

## DP-R5-RC · Release Cut v4.0
Annual report assembly · full council re-convening (new market scan — competitors will have moved; re-run the File 01 method) · v5 horizon planning.
