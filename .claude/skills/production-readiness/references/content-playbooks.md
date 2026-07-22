# Content playbooks — blog, changelog, use-cases, gallery, pricing, comparison, personas

How to produce each customer-facing artifact to the DatIQ quality bar. Keep
everything admin-free (see `external-vs-internal.md`). Prices always trace to
`src/lib/pricingConfig.js`.

## § Blog — release / version posts

Posts live in `src/pages/Blog.jsx` as objects in the `POSTS` array:
`{ slug, image?, title, excerpt, date, category?, fullContent }`. `fullContent`
is a template string with light markdown (`##`, `**bold**`, `` `code` ``,
links, and `![alt](/help/assets/screenshots/NN-name.png)` images).

A release blog is marketing, not a changelog dump. Required anatomy:

1. **Subject / category** — e.g. "Product", "Release", "How-to". Sets reader
   expectation.
2. **Title** — specific and benefit-led. Not "v1.1 released" but
   "Every DatIQ support question now lands in one inbox — and 4 more release
   wins".
3. **Hook** (first paragraph / `excerpt`) — the reader's problem in their words,
   and the promise of the post. Earns the scroll.
4. **A screenshot near the top** — the money shot of the headline feature.
   Reference an existing file under `/help/assets/screenshots/`.
5. **Punchy subheads** — one benefit per `##` section. Lead with the outcome,
   then the mechanism.
6. **Persona focus** — write to a specific persona (Sales, SEO, Founder, …);
   name their workflow. Generic posts convert nobody.
7. **Body with inline screenshots** where a visual clarifies a step.
8. **References** — link to the relevant help page, use-case, or comparison.
9. **A clear CTA** — one primary action ("Start extracting free →" / "See plans").
10. **Conclusion** — restate the win and where the product is going.

Keep it honest: only shipped capability, and never mention admin/operator
tooling. After adding a post, if it references a new screenshot, make sure the
file exists (the audit will FAIL on a broken image reference).

## § Changelog

`src/pages/Changelog.jsx` — `VERSION`, `SHIPPED`, and `FEATURE_GROUPS` (capability
areas, each with user-facing `items`). This is the public "what's in the box".
Rules:
- Add each shipped, customer-usable feature to the right group.
- **Never** add an admin/operator group or item — the audit fails the build on
  admin terms here (this is exactly where a leak crept in before).
- Bump `VERSION`/`SHIPPED` when the release version changes; keep it consistent
  with the docs (audit: version coherence).

## § Use-cases

`src/pages/UseCases.jsx` (hub) + `UseCaseLead/Competitor/SEO/Research.jsx`
(details). Add or refresh a use-case when a release enables a new end-to-end
workflow. Each detail page: the persona, the job-to-be-done, the concrete DatIQ
steps, and a CTA. Tie it to the matching help section and gallery sample.

## § Gallery

The public gallery (`/gallery`, `src/pages/Gallery.jsx`, backed by Supabase
`public_reports` via `shareService.js`) showcases real, shareable extractions.
Because it's runtime-populated, the audit can't prove coverage — you confirm it:
- Publish ≥1 sample per persona and per headline feature (a pricing extraction
  for the CI persona, a contacts extraction for Sales, an SEO audit sample, …).
- Every sample must be a **real, non-sensitive** extraction — no PII, no
  credentials, no private customer data. Prefer well-known public sites.
- Give each a clear title and the intent it demonstrates so it doubles as a demo.

## § Pricing

`src/lib/pricingConfig.js` is the source of truth (`price_usd`,
`price_usd_annual`, `price_inr_annual`, `limits`, `comingSoon`, feature lists).
Everything else must agree with it:
- `/pricing` (`Pricing.jsx`) and the tier×feature matrix (`PricingMatrix.jsx`).
- Help § billing (`public/help/11-plans-usage-and-billing.html`, via the user-
  guide markdown).
- Any price named in a blog or comparison page.
Requirements: correct feature inclusion/exclusion per tier; annual figures shown
as "$X/mo, billed annually"; at least one worked example. The audit's pricing
check confirms plan **names** line up; you confirm the **numbers** trace to the
source. Coming-soon plans (e.g. Developer) need not appear on the billing page.

## § Comparison

`public/vs/*.html` (browse-ai, clay, apify, phantombuster + `compare.html`) and
`src/pages/VsBrowseAI.jsx`, `VsClay.jsx`. Keep the matrices honest and current:
verify competitor pricing/capability claims before publishing (if you can't
verify a competitor claim, soften it or drop it — do not ship an unverifiable
comparison). Cross-link all comparison pages. Never compare on admin/operator
features.

## § Personas

7 personas in `src/lib/personaConfig.js` (Sales, Competitive-intel, SEO,
Research, Recruiter, Founder, VC). For each shipped feature, ensure the persona
it serves is represented where persona-targeted content lives — the matching
use-case, the help intro chips, a gallery sample, and the release blog's chosen
angle. The goal is that every persona can find themselves in the release.
