# DatIQ — Master Implementation Prompt Framework
**The global contract inherited by every release prompt (Files 08–12). Load this file into the coding agent's context before running any prompt.**
Version 1.0 · August 2026

---

## 1. How This System Works

Each feature in the roadmap (File 02) has an executable implementation prompt with a stable ID: **DP-{Release}-{Seq}** (e.g., DP-R0-01). Prompts are ordered; each declares its predecessors. You run them one at a time against the codebase (Claude Code / agent of choice), and each one leaves the system **deployable, tested, documented, and tracked** before the next begins. The Excel tracker (DatIQ_Feature_Release_Tracker.xlsx) is the single source of traceability: Feature ↔ Prompt ↔ Release ↔ Source report ↔ Status.

**Execution loop per prompt:**
1. Paste `GLOBAL SYSTEM CONTEXT` (§2) + the prompt block.
2. Agent implements → runs tests → updates docs set → prepares deploy artifacts.
3. You review the PR + preview deploy → flip the feature flag on staging → smoke test → canary → GA.
4. Update tracker row (Status, Test, Deploy, Docs columns) and the changelog entry ships with the release.

---

## 2. GLOBAL SYSTEM CONTEXT (prepend verbatim to every prompt)

```
You are the lead engineer implementing DatIQ (datiq.app), a Next.js 14 (App Router) +
Supabase (Postgres, Auth, Vault) + Redis/BullMQ + Stripe SaaS being expanded from a
web-extraction tool into a unified web+social+data intelligence platform.

ASSUMED STACK (confirm against repo; if reality differs, adapt and record the delta in
/docs/architecture/decisions/ as an ADR before writing code):
- Frontend: Next.js App Router, TypeScript, Tailwind, shared component library at
  /components/ui built on the 2026 rebrand tokens (Inter UI / display serif marketing).
- Backend: Next.js API routes + /workers (BullMQ) for pipelines; Supabase Postgres with
  RLS multi-tenancy on workspace_id; Redis for cache/queues/rate-limits.
- Live already (never rebuild, only extend): single/batch/scheduled URL extraction,
  AI enrichment/summary, heading/link/contact/pricing extractors, freemium auth.

NON-NEGOTIABLE CONVENTIONS
1. Feature flags: every user-facing change ships behind a flag in /lib/flags.ts
   (default OFF in prod). Name given per prompt.
2. Migrations: additive-only within a release; destructive changes need a 2-release
   deprecation window. Every migration has a tested down().
3. Multi-tenancy: every new table carries workspace_id + RLS policy + created_at/updated_at.
4. Telemetry: every feature emits its named PostHog events (given per prompt). No
   silent features — untracked features cannot be re-scored.
5. Testing gates (CI-enforced, in order): typecheck → lint → unit (Vitest) →
   integration (API + pipeline against Supabase test db) → E2E (Playwright, tagged
   per feature) → visual snapshot on changed routes. A prompt is not done with
   failing or skipped gates.
6. Security: secrets in Supabase Vault; webhooks HMAC-verified; API keys hashed at
   rest; rate limits token-bucket in Redis.
7. Accessibility: WCAG 2.1 AA on all new UI (keyboard, contrast, ARIA, focus order).

DOCUMENTATION CONTRACT — every prompt updates ALL that apply, in the same PR:
  /docs/features/{slug}.md        user-facing feature doc (what/why/how, screenshots slots)
  /docs/api/openapi.yaml          + regenerated /docs/api reference if endpoints changed
  /docs/help/{slug}.md            step-by-step help-center article (task-oriented)
  /docs/use-cases/{slug}.md       1 persona-anchored use case (problem → steps → outcome)
  /content/changelog/{date}-{slug}.md   changelog entry: Added/Changed/Fixed + flag + tier
  /content/blog/drafts/{slug}.md  launch blog draft (only when prompt says "blog: yes")
  /docs/internal/runbooks/{slug}.md     ops runbook when a worker/queue/webhook is added
  README + .env.example           when setup/env changes
  In-app: tooltip/empty-state copy + "What's new" modal entry keyed to the flag.
Docs are code: they merge in the feature PR or the PR does not merge.

DEPLOYMENT CONTRACT (incremental, reversible):
  a. Migrate DB (additive) → deploy code with flag OFF → verify health.
  b. Enable flag on staging → run tagged E2E + manual smoke script (provided per prompt).
  c. Canary: enable for internal workspace + 5% of users, watch error rate & p95 for 24h.
  d. GA: flag 100%, changelog entry published, "What's new" modal live, tracker updated.
  e. Rollback = flag OFF (code stays); DB rollback only via tested down() migration.
  Versioning: semver. Flag GA batches map to versions (v1.1.x during R0, v2.0.0 at R1
  launch, etc.). Tag releases in git; release notes assembled from /content/changelog.

OUTPUT REQUIRED FROM YOU (the agent) at the end of every prompt run:
  1. Summary of changes (files, migrations, endpoints, components).
  2. Test evidence (suite results, new coverage).
  3. The filled smoke-test script results.
  4. List of docs/content files created/updated.
  5. The tracker row values to record (Status=Built, Test/Docs/Deploy sub-statuses).
  6. Any deviations from this contract, as an explicit "DEVIATIONS" section.
```

---

## 3. Standard Prompt Anatomy (what each block in Files 08–12 contains)

| Section | Purpose |
|---|---|
| **Header** | Prompt ID · Feature ID (File 02) · Flag name · Target version · Run-after dependencies |
| **Feature description & user stories** | What ships, for whom, with 2–4 testable stories |
| **Impact analysis** | Conversion/engagement/revenue effect · systems touched · risk & blast radius · affected tiers/personas · metrics that must move |
| **Backend changes** | Schema/migrations, endpoints, workers, third-party integration specifics |
| **Frontend changes** | Routes, components, states (loading/empty/error), responsive + a11y notes |
| **Testing & acceptance** | Unit/integration/E2E specs + acceptance criteria + smoke script |
| **Incremental deployment** | Flag rollout plan, canary criteria, rollback triggers |
| **Docs & content updates** | The exact doc-contract files for this feature (incl. blog yes/no, SEO pages) |
| **Definition of Done** | Checklist incl. tracker + changelog + telemetry verification |

Condensed prompts (R2–R5) compress these into fewer lines but keep every section; expand any of them into the full format by asking the planning agent: *"Expand DP-Rx-yy to full anatomy per the Master Framework."*

---

## 4. Runbook — Execution Order

Run strictly in this order (dependencies encoded in each header):

**R0 / v1.1 (Weeks 1–4):** DP-R0-00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → **R0-RC** (release-cut prompt)
**R1 / v2.0 (Weeks 5–12):** DP-R1-01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → **R1-RC**
**R2 / v2.5:** DP-R2-01…08 → R2-RC · **R3 / v3.0:** DP-R3-01…07 → R3-RC · **R4 / v3.5:** DP-R4-01…07 → R4-RC · **R5 / v4.0:** DP-R5-01…06 → R5-RC

Every release ends with a **Release-Cut prompt (Rx-RC)**, which: assembles release notes from changelog entries · publishes the launch blog · updates the homepage/pricing copy where tier gates changed · regenerates the docs nav + sitemap · runs the full regression suite · tags the version · produces the "council check-in" report (metrics vs File 02 exit criteria + re-scoring trigger evaluation).

---

## 5. Standing Improvement Mechanisms (built into the system)

1. **DP-R0-00 Bootstrap** creates the flag system, docs-as-code pipeline, changelog automation, golden test datasets, and telemetry taxonomy — so every later prompt's contract is executable, not aspirational.
2. **Golden datasets:** frozen URL corpus (50 pages) for extraction regression; 500-sample labeled mention set (incl. hi/en code-mix) for sentiment/intent gates. Any pipeline prompt must keep golden accuracy ≥ baseline.
3. **Weekly council check-in prompt** (template in File 08 appendix): feeds live PostHog metrics against File 02 triggers; outputs re-scoring recommendations.
4. **Content flywheel:** every feature's use-case doc doubles as a programmatic-SEO seed; the blog draft ships within the release, not "later."
5. **Traceability:** tracker column "Source Report §" ties every feature to the originating model analysis, so future council debates re-open with full provenance.
