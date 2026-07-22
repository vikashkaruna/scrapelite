# External vs internal — the confidentiality boundary

The single most important rule of a DatIQ release: **internal facts never cross
onto a customer-facing surface.** This file is the authority on which is which.
Read it before you edit any external page, and re-run the audit
(`scripts/audit.mjs`) after — Check 1 enforces it automatically.

## What is INTERNAL (confidential — never publish)

These live only in `docs/internal/*`, `CLAUDE.md`, `AGENTS.md`, `.claude/*`, and
session handoffs. They must not appear in help pages, blogs, the changelog,
feature listings, comparison pages, `llms.txt`, or any `src/pages/*` marketing
page:

- **The admin console in its entirety.** Routes (`/admin*`), pages
  (`src/pages/admin/*`), admin Netlify functions, the PIN, HMAC-signed session
  tokens, lockout mechanics, the operator sidebar — none of it. Customers do not
  have an admin console; describing one is both a leak and a lie.
- **Infrastructure & secrets.** Supabase project details, the service key, RLS
  policies, table/column names (`pricing_config`, `app_config`,
  `coupon_redemptions`, …), env var names, provider API keys, Netlify function
  internals.
- **Server-authoritative pricing math & anti-abuse.** How discounts resolve,
  coupon `maxUses` enforcement, the redeem RPC, guest bypass-prevention
  internals. The *customer-visible* price and plan features are public; the
  *mechanism* is not.
- **Unshipped / deferred internals.** Stripe deferral, recurring-billing
  deferral rationale, roadmap sequencing, migration plans — internal only.

The audit's `confidentialTerms` list encodes the highest-signal leak markers
(`admin console`, `/admin`, `ADMIN_PIN`, `HMAC`, `SUPABASE_SERVICE`,
`service_role`, `pricing_config`, `app_config`, `RLS policy`, `PIN-gated`, …).
It is deliberately specific to avoid false positives — the word "administrator"
in a privacy policy is fine; "admin console" is not. If you add an internal
concept, add its marker to that list.

## What is EXTERNAL (public — keep current, keep truthful)

- `public/help/*` (generated), `public/*.html`, `public/vs/*.html`
- `public/llms.txt`, `public/sitemap.xml`, `public/robots.txt`
- The public React pages: Home, Blog, Changelog, About, Pricing, Contact,
  Privacy, Terms, Integrations, UseCases*, Vs*, Gallery, PublicReport, and the
  public components (PricingMatrix, TrustStrip)
- `docs/DatIQ-User-Guide.md`, `docs/DatIQ-Developer-API.md` (the public sources
  that generate the help center)

Everything external must describe only shipped, customer-usable capability, and
must never reference the internal items above.

## The email policy

There is exactly **one** customer contact address: **`hello@datiq.app`**.

Do not reintroduce role-split inboxes (`support@`, `legal@`, `privacy@`,
`billing@`, …) on any customer surface — one inbox is simpler for the customer
and for us, and the audit (Check 2) fails the build if a deprecated address
reappears. Legal surfaces (Terms, Privacy/DPDP grievance officer, the DMCA
agent) also use `hello@datiq.app`; the local-part is not legally required to be
role-specific, and a single monitored inbox is more reliable than three that
might go unwatched.

System senders are different and are **not** customer contact points — leave
them alone: `alerts@datiq.app` (scheduled-change alert emails), `noreply@…`.
They are in the audit's `ignoreEmails` list.

To re-consolidate at any time: `node scripts/audit.mjs --fix-emails`.

## When you're unsure

Ask: "Could a customer or competitor read this, and does it reveal how we run
the business rather than what the product does for them?" If yes, it is
internal. When still unsure, keep it in `docs/internal/` and out of the public
surface — omission is cheap; a leak is not.
