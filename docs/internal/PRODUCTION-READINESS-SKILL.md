# Production-Readiness Skill — internal reference

> Internal only. Not published to the help center or any external surface.
> Created 2026-07-22 on branch `claude/production-readiness-skill-cfe3d8`.

This documents the **`production-readiness`** skill: what it is, what it
automates, how it runs in auto mode, what this first pass changed, and how to
evolve it. It is the reference the next person reads before running a release.

## 1. What the skill is

A model-agnostic **release-readiness gate** for DatIQ. It guarantees three things
about any release before it reaches production: **inclusion** (every shipped
change is reflected on every surface that should mention it), **completion** (no
half-updated page, missing screenshot, or empty changelog), and **correctness**
(what each surface says is true — and internal/admin material never leaks onto a
customer-facing one).

It exists because a DatIQ release touches a dozen surfaces that drift
independently: code, tests, internal docs, the help center, the developer
reference, marketing pages, pricing, changelog, release blog, use-cases, the
comparison pages, and the public gallery. The skill turns "review everything for
production" into a deterministic worklist and a gated merge.

## 2. Files (all under version control)

```
.claude/skills/production-readiness/
├── SKILL.md                              # the workflow + the golden rule + auto mode
├── scripts/
│   └── audit.mjs                         # deterministic PASS/WARN/FAIL audit (Node built-ins only)
└── references/
    ├── checklist.md                      # the full gated checklist, surface by surface
    ├── external-vs-internal.md           # the confidentiality boundary + email policy
    ├── content-playbooks.md              # blog / changelog / use-cases / gallery / pricing / comparison / personas
    └── merge-and-deploy.md               # staging→prod gate, green-gate definition, auto mode, rollback

.claude/commands/production-readiness.md  # slash command: /production-readiness [auto|audit|staging-only]
```

Enforcement wiring:
- `package.json` → `npm run readiness` runs the audit; it is now the **first step
  of `npm run test:all`** (fails fast on a leak).
- `.github/workflows/staging-gate.yml` and `phase-gate.yml` → a **"Release-
  readiness audit"** step runs `npm run readiness` in the test-suites job of both
  gates. A leak, an email split, a broken screenshot reference, or an empty
  changelog blocks promotion in CI regardless of which model (or human) ran the
  release.

## 3. The deterministic audit (`scripts/audit.mjs`)

The heart of "runs the same from any model." Seven checks:

| # | Check | Severity | Auto-fix |
|---|-------|----------|----------|
| 1 | Admin/confidential leakage on external surfaces | FAIL | — (remove manually) |
| 2 | Customer email routing → `hello@datiq.app` + `admin@datiq.app` | FAIL | `--fix-emails` |
| 3 | Help build freshness (markdown vs generated HTML) | WARN | run `docs/build-help.mjs` |
| 4 | Screenshot integrity (broken ref) / staleness | FAIL / WARN | regenerate screenshots |
| 5 | No public version numbers (changelog + docs, D22a) | WARN | remove the string |
| 6 | Pricing coherence (plan names vs `pricingConfig.js`) | WARN | — |
| 7 | Gallery / persona coverage (advisory reminder) | WARN | curate gallery |

Usage: `node .claude/skills/production-readiness/scripts/audit.mjs [--json] [--fix-emails]`.
Exit code is non-zero when any FAIL exists, so it gates CI directly. All
project-specific config (paths, the canonical support email, the confidential
term list, personas, competitors) lives in the `CONFIG` block at the top of the
script — **the only place to edit to reuse the skill elsewhere.**

## 4. Auto mode

- **CI (always on):** `npm run readiness` is a required step in both gate
  workflows and the first step of `test:all`. Deterministic protections hold even
  when no agent runs the skill.
- **Agent (defaults):** `/production-readiness` (or invoking the skill) runs the
  whole workflow with sensible defaults — audit → fix every FAIL → sync collateral
  → test → merge to `staging` → and, if staging is green, merge to `main`. It
  applies `--fix-emails`, removes admin leakage, rebuilds help, and writes the
  release doc automatically. It stops and asks a human only for a failing smoke
  test, an unverifiable pricing/competitor claim, or a FAIL it cannot auto-resolve.
  Modes: `audit` (report only), `staging-only` (stop after staging), `auto`.

## 5. What this first pass changed (release collateral)

| Surface | Change |
|---------|--------|
| **Customer email** | Consolidated all customer contact points to a single inbox `hello@datiq.app` — replaced `support@` / `legal@` / `privacy@` across `src`, `public`, and `netlify` (customer-facing error strings). System senders (`alerts@`) untouched. |
| **Contact page** | Collapsed the three role-split contact cards into one "one inbox for everything" card. |
| **Admin leak (Changelog)** | Removed the public **"Admin console"** feature group from `src/pages/Changelog.jsx` — admin belongs only in internal docs. External help/docs were already admin-clean. |
| **Changelog** | Added a "one support inbox — hello@datiq.app" item to the Docs & help group. |
| **Blog** | Added minimal `![alt](src)` image support to the blog renderer + `.blog-post-img` CSS; added a persona-focused release post, *"Set It and Know: Monitor Any Web Page for Changes with DatIQ Schedules,"* with a real screenshot at the top and a `hello@datiq.app` CTA. |
| **Tests** | Updated `Changelog.test.jsx` (12→11 groups, dropped `feature-admin`, email regex) and `Pricing.integration.test.jsx` (email regex) to match the intentional changes. |
| **Audit result** | 5 PASS / 2 WARN / 0 FAIL. WARNs: screenshot staleness (needs a live dev server to regenerate) and gallery/persona coverage (runtime-populated — confirm manually). |

## 6. Outstanding (consciously deferred WARNs)

- **Screenshots** — the audit flags UI changed after the newest screenshot. Regenerating requires a running dev server + system Chrome (`npm run dev` then `node docs/capture-screenshots.mjs`), which isn't available in a headless agent run. Follow-up: regenerate on a workstation and re-run help build.
- **Public gallery coverage** — the gallery is populated at runtime (Supabase `public_reports`); confirm ≥1 curated sample per persona and per headline feature. Persona-based auto-seeding is a candidate feature (see §7).

## 7. Suggested skill improvements (roadmap)

Ordered by leverage. Each makes the skill more reusable, flexible, or state of the art.

1. **Externalize CONFIG to `readiness.config.json`.** Move the `CONFIG` block out
   of `audit.mjs` into a JSON file the script reads. Reuse on another project then
   means dropping in one config file — no code edit. (Highest reusability win.)
2. **Auto-regenerate screenshots in CI.** A workflow job that boots the dev
   server, runs `capture-screenshots.mjs` headless, and fails/commits on visual
   drift — turns the screenshot WARN into an enforced, automated step.
3. **Gallery persona-seeder.** A script that ensures the public gallery has ≥1
   curated, non-sensitive sample per persona/feature (seed from a fixtures list),
   so check 7 becomes deterministic instead of advisory.
4. **Pricing number cross-check.** Extend check 6 from plan *names* to plan
   *numbers* — parse `pricingConfig.js` amounts and flag any conflicting price
   string in help/comparison/blog. Closes the most likely correctness gap.
5. **Competitor-claim verifier.** Given the comparison pages, fetch each
   competitor's current pricing/features (web) and flag stale claims for review —
   keeps `/vs/*` honest over time.
6. **Release-notes generator.** Diff `main..HEAD`, group by area, and draft the
   changelog entry + blog outline for the human to refine — less blank-page work.
7. **Skill eval harness.** Use skill-creator's eval loop (test prompts + the audit
   as an objective grader) to benchmark the skill and optimize its description for
   triggering. Makes quality measurable across models.
8. **Generalize the audience wall.** Parameterize "external vs internal" so the
   same skill guards any product's confidentiality boundary, not just DatIQ's
   admin console.

## 8. How to run it next time

```bash
# Report only
npm run readiness
# or the whole gate on-demand
/production-readiness auto
```

Then follow `references/merge-and-deploy.md`. Record the release outcome here (or
in a dated `docs/internal/` handoff) so the trail stays complete.
