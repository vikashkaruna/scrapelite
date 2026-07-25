---
name: production-readiness
description: >-
  Release-readiness gate for the DatIQ web app — audits and fixes everything a
  version needs before it ships to staging and production, then merges and
  commits it. Use this skill whenever the user asks to "review for production
  readiness", "prepare a release", "ship to staging/main", "run the readiness
  gate", "get this release-ready", or mentions updating docs + help + blogs +
  changelog + pricing + comparison + screenshots + public gallery together as a
  release chore. Also trigger it before any merge to `staging` or `main`, and
  whenever the user wants the release collateral (external docs, help center,
  release blog, changelog, use cases, comparison pages, pricing, public gallery)
  brought into sync with the code — while keeping admin/internal-only material
  out of every customer-facing surface. Model-agnostic: it leans on a
  deterministic audit script so any model runs it the same way.
---

# DatIQ Release Readiness Gate

Bringing a DatIQ release to production is not one task — it is a dozen surfaces
that must all agree: the code, the tests, the internal record, the public help
center, the developer reference, the marketing pages, pricing, the changelog,
the release blog, and the public gallery. When they drift, customers see stale
prices, a help page that describes a feature that no longer exists, or — worst —
internal/admin details leaking onto a public page.

This skill is the gate that keeps them in sync. It exists to guarantee three
things about a release: **inclusion** (every shipped change is reflected on every
surface that should mention it), **completion** (no half-updated page, no
missing screenshot, no empty changelog), and **correctness** (what each surface
says is true, and confidential material never crosses into a public one).

## The golden rule: two audiences, one wall between them

Every artifact in this repo belongs to exactly one of two audiences:

- **External / public** — anything a customer or search engine can reach:
  `src/pages/*` marketing & legal pages, `public/help/*`, `public/*.html`,
  the blog, changelog, use-cases, comparison pages, `public/llms.txt`,
  `public/sitemap.xml`, and the public gallery.
- **Internal / confidential** — `docs/internal/*`, `CLAUDE.md`, `AGENTS.md`,
  anything under `.claude/`, session handoffs, and **the entire admin console**
  (`/admin*`, `src/pages/admin/*`, admin Netlify functions, PIN/HMAC/token
  mechanics, Supabase schema, env vars, provider keys, internal pricing math).

The wall is one-directional: internal facts must **never** appear on an external
surface. The most common leak is the **admin console** — do not describe admin
features, admin routes, admin auth, or operator tooling in help pages, the
changelog, feature listings, blogs, comparison pages, or `llms.txt`. Admin
belongs only in `docs/internal/`. `references/external-vs-internal.md` is the
authority on what is confidential; read it before editing any external surface.

## Always start with the deterministic audit

Before touching anything, run the bundled audit — it is the same on every model
and turns "review everything" into a concrete, ranked worklist:

```bash
node .claude/skills/production-readiness/scripts/audit.mjs
```

It checks, and prints PASS/WARN/FAIL for, each of these:

1. **Admin leakage** — admin terms on any external surface (hard FAIL).
2. **Email routing** — every customer-facing contact address is one of the two
   live inboxes: `hello@datiq.app` (product, bugs, features, billing, general)
   or `admin@datiq.app` (enterprise/agency, legal & terms, privacy & DPDP). The
   retired `support@`/`legal@`/`privacy@` aliases fail the check; `--fix-emails`
   rewrites each to the inbox that now owns it. Test files are exempt — they
   name the retired addresses in order to assert they are gone.
3. **Help build drift** — `public/help/*.html` is regenerated from the markdown
   sources (someone hand-edited HTML, or forgot to rebuild).
4. **Screenshot integrity** — every `assets/screenshots/*` referenced by help
   or docs resolves to a real file, and the newest screenshot is not older than
   the newest shipped UI change.
5. **Version coherence** — the changelog version, the release blog, and the docs
   all reference the same current version.
6. **Pricing coherence** — plan names/prices in the public pricing surfaces match
   `src/lib/pricingConfig.js` (the source of truth) and each other.
7. **Gallery / persona coverage** — the public gallery has at least one curated
   sample per persona and per headline feature.

Add `--json` for machine output, `--fix-emails` to auto-apply the email
consolidation. Every FAIL is a blocker for production; every WARN is a judgement
call you resolve or explicitly note in the release doc.

## The workflow

Work top-to-bottom. Each step maps to a reference file with the detail; keep this
page as the map. Check items off as you go and record what you changed — the
release doc you write at the end is what the next person reads.

### 1. Audit and triage
Run `scripts/audit.mjs`. Turn every FAIL/WARN into a task. Read
`references/checklist.md` for the full item-by-item gate (it enumerates every
surface below with its acceptance criteria).

### 2. Code & tests
The release must be green before any collateral work matters. Run the full gate:
`npm run test:all` (unit + contract + integration + system + build + e2e smoke +
security). New/changed features need new/updated tests and coverage — a feature
with no test is not release-ready. See `references/checklist.md` § Tests.

### 3. Internal documentation
Update `docs/internal/DatIQ-Product-Documentation-Internal.md` (and `CLAUDE.md`
if architecture/state changed) with the full technical truth — this is where
admin, schema, env, and internals live. Everything else in this list is derived
from, and must not exceed, what is safe to publish.

### 4. External documentation & Help Center
Edit the **markdown sources** (`docs/DatIQ-User-Guide.md`,
`docs/DatIQ-Developer-API.md`), never the generated HTML. Then rebuild:
`node docs/build-help.mjs`. Keep developer-focused (`developers.html`) and
non-developer (user guide) content separate and each complete. Add/curate help
pages for new features. See `references/checklist.md` § Help Center.

### 5. Screenshots
Regenerate for any screen that changed UI: start the dev server, then
`node docs/capture-screenshots.mjs` (uses system Chrome via Playwright). Place the
newest shots where help, docs, and blogs reference them. Stale screenshots are a
correctness bug — the audit flags them.

### 6. Persona-aware surfaces
DatIQ ships 7 personas (see `src/lib/personaConfig.js`). For each shipped feature,
make sure the persona it serves is reflected wherever persona-targeted content
lives: use-cases pages, help intros, the gallery, and the release blog's angle.
See `references/content-playbooks.md` § Personas.

### 7. Features, competition & comparison
Keep the public feature listing (changelog `FEATURE_GROUPS`, `About`, `llms.txt`)
current with what shipped — and admin-free. Update the comparison pages
(`public/vs/*.html`, `src/pages/Vs*.jsx`) against current competitor capabilities
so the matrix is honest and current. See `references/content-playbooks.md`
§ Comparison.

### 8. Plans & pricing
`src/lib/pricingConfig.js` is the source of truth. Ensure `/pricing`, the pricing
matrix, `PricingMatrix.jsx`, help § billing, and any blog/comparison price
mentions all agree with it, with correct feature inclusion/exclusion per tier and
at least one worked example. See `references/content-playbooks.md` § Pricing.

### 9. Public gallery
Curate the public gallery so it showcases the release: at least one sample per
persona and per headline feature, each with a real, non-sensitive extraction.
See `references/content-playbooks.md` § Gallery.

### 10. Release blog + changelog + use-cases
Write a professional release/version blog (subject, title, hook, punchy
subheads, persona focus, body, a screenshot near the top and inline where it
helps, references, a clear CTA, and a conclusion). Add a changelog entry for the
release. Add or refresh any use-cases the release enables. Templates and the full
quality bar live in `references/content-playbooks.md` § Blog / § Changelog /
§ Use-cases.

### 11. Re-audit, then ship
Re-run `scripts/audit.mjs` — it must be all PASS (no FAIL). Re-run `npm run
test:all`. Then follow `references/merge-and-deploy.md` to commit, merge to
`staging` (verify), and — only if staging is green — merge to `main` (production).

## Auto mode

"Auto mode" means the deterministic parts run without a human and the risky parts
stay gated:

- **CI enforcement (always on):** `npm run readiness` runs `scripts/audit.mjs` and
  is a required check in `.github/workflows/phase-gate.yml` and
  `staging-gate.yml`. A release that leaks admin content, splits support emails,
  ships stale help/screenshots, or has an empty changelog **cannot** be promoted.
  This is model-independent — it protects the release even if no agent runs the
  skill.
- **Agent auto-run (defaults):** invoke `/production-readiness` (or this skill).
  With no arguments it runs the whole workflow with sensible defaults —
  audit → fix every FAIL → update collateral → test → merge to `staging` → and,
  if `staging` is green, merge to `main`. It applies `--fix-emails`, removes admin
  leakage, rebuilds help, and writes the release doc automatically. It **stops and
  asks** only for the genuinely irreversible or ambiguous: a failing production
  smoke test, a pricing change with no source-of-truth backing, or a competitor
  claim it cannot verify.

`references/merge-and-deploy.md` has the exact commands, the green-gate
definition, and rollback.

## Reusing this skill on another project

The *process* is general; only the config is DatIQ-specific. The config lives at
the top of `scripts/audit.mjs` (paths, the canonical support email, the admin/
confidential term list, personas, competitors) and in
`references/external-vs-internal.md`. To reuse: copy the skill, edit that config
block and that one reference file, and the workflow, gate, and auto-mode carry
over unchanged.

## Reference files

- `references/checklist.md` — the full gated checklist, surface by surface, with
  acceptance criteria. Read this to know exactly what "done" means for each item.
- `references/external-vs-internal.md` — the confidentiality boundary: what is
  admin/internal, the email policy, and the rules for never leaking either.
- `references/content-playbooks.md` — how to write the blog, changelog, use-cases,
  gallery curation, pricing sync, comparison updates, and persona coverage, with
  templates.
- `references/merge-and-deploy.md` — commit, the staging→production gate, the
  green-gate definition, auto-mode behavior, and rollback.
