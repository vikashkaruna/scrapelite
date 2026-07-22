# The gated checklist — surface by surface

This is the authoritative "what does done mean" list. Each item names the
surface, the acceptance criteria, and how it's verified (`audit` = the audit
script proves it; `manual` = human/agent judgement). Work the audit's FAILs
first, then walk this list. Nothing marked a blocker may reach production
unresolved.

## Tests & coverage  (blocker)
- [ ] `npm run test:all` is green (unit + contract + integration + system + build
      + e2e smoke + security). *(verify: run it)*
- [ ] Every new or changed feature has new/updated tests. A feature with no test
      is not release-ready — add unit tests for logic in `src/lib`, contract
      tests for Netlify functions, and a smoke path for new routes. *(manual)*
- [ ] `npm run test:coverage` shows no regression in coverage for touched files.
      *(manual)*
- [ ] No test is skipped without a documented reason (grep `it.skip`/`describe.skip`).

## Internal documentation  (blocker for correctness)
- [ ] `docs/internal/DatIQ-Product-Documentation-Internal.md` reflects the shipped
      change (this is the full technical truth — admin, schema, env all live
      here). *(manual)*
- [ ] `CLAUDE.md` updated if architecture, routes, localStorage keys, env, or
      state changed. *(manual)*

## External documentation & Help Center  (blocker)
- [ ] Edited the **markdown sources** (`docs/DatIQ-User-Guide.md`,
      `docs/DatIQ-Developer-API.md`), not the generated HTML. *(manual)*
- [ ] Ran `node docs/build-help.mjs` so `public/help/*` is regenerated.
      *(audit: help build freshness)*
- [ ] New features have a help section; changed features have updated copy.
      *(manual)*
- [ ] Developer-focused reference (`developers.html`) and non-developer user
      guide are each complete and correct for their audience. *(manual)*
- [ ] No internal/admin content anywhere in help. *(audit: leakage)*

## Screenshots  (blocker if referenced image is missing)
- [ ] Every screen with changed UI has a fresh screenshot (dev server up →
      `node docs/capture-screenshots.mjs`). *(audit: staleness = WARN)*
- [ ] Every screenshot referenced by help/docs/blog resolves to a real file.
      *(audit: integrity = FAIL if broken)*
- [ ] Screenshots placed where help, docs, and the release blog reference them.

## Personas  (blocker for correctness)
- [ ] For each shipped feature, the persona it serves is reflected in the
      relevant persona-targeted surface (use-cases, help intro, gallery sample,
      blog angle). 7 personas: Sales, Competitive-intel, SEO, Research,
      Recruiter, Founder, VC — see `src/lib/personaConfig.js`. *(manual)*

## Features, competition & comparison  (blocker)
- [ ] Public feature listing current: changelog `FEATURE_GROUPS`, `About`,
      `llms.txt`. *(manual + audit: leakage)*
- [ ] Comparison pages (`public/vs/*.html`, `src/pages/VsBrowseAI.jsx`,
      `VsClay.jsx`) reflect current competitor capabilities and are honest
      (parity where true, differentiation where real). *(manual)*
- [ ] Feature coverage is admin-free everywhere it's listed. *(audit: leakage)*

## Plans & pricing  (blocker)
- [ ] `src/lib/pricingConfig.js` is the only source of truth. *(manual)*
- [ ] `/pricing`, `PricingMatrix.jsx`, help § billing, and any price mention in
      blogs/comparison all agree with it. *(audit: pricing coherence)*
- [ ] Feature inclusion/exclusion per tier is correct; at least one worked
      pricing example exists (e.g. "Pro at $23/mo billed annually"). *(manual)*

## Public gallery  (blocker for coverage)
- [ ] ≥1 curated public sample per persona and per headline feature, each a real,
      non-sensitive extraction. *(audit: WARN reminder — confirm manually)*
- [ ] No sample exposes PII, credentials, or a customer's private data.

## Release blog, changelog & use-cases  (blocker)
- [ ] A professional release/version blog exists for this release (see
      `content-playbooks.md` § Blog for the required structure & quality bar).
- [ ] Changelog has an entry/feature-group for what shipped. *(audit: version
      coherence)*
- [ ] Use-cases added/refreshed for any newly enabled workflow. *(manual)*

## Workflow integration  (report)
- [ ] Netlify functions, scheduled-runner, webhooks touched by the release are
      accounted for and their status noted in the release doc (coverage,
      env needed, TODOs). *(manual)*

## Final gate  (blocker)
- [ ] `scripts/audit.mjs` is all PASS (0 FAIL); every WARN resolved or annotated
      in the release doc. *(audit)*
- [ ] `npm run test:all` green. *(verify)*
- [ ] Release doc written to `docs/internal/` recording what changed on each
      surface. *(manual)*
- [ ] Merge/deploy per `merge-and-deploy.md`: staging first, production only if
      staging is green.
