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

There are exactly **two** customer contact addresses:

| Inbox | Owns |
|---|---|
| `hello@datiq.app` | Product support, bug reports, feature requests, billing, and anything general. |
| `admin@datiq.app` | Enterprise & agency, legal & terms, privacy & DPDP — including the DPDP grievance officer and the DMCA agent. |

Two is the whole list. Do not reintroduce further role-split inboxes
(`support@`, `legal@`, `privacy@`, `billing@`, …) on any customer surface — the
audit (Check 2) fails the build if a deprecated address reappears, and
`--fix-emails` rewrites each to the inbox that now owns it. The split is drawn
where the *reader* differs, not where the topic does: general enquiries go to
whoever is on support, while legal, privacy, and enterprise threads want a
named accountable owner.

`src/lib/contactRouting.js` is the single source of truth. The contact form
labels itself from it, and `netlify/functions/contact-email.js` imports it to
choose the actual recipient, so the address a customer is shown and the address
that receives the mail cannot drift apart.

### Sender identity follows direction

Which address DatIQ sends *from* depends on which way the mail is travelling —
this is a rule, not a preference, so don't "consolidate" it:

- **Outbound** (DatIQ → a user: welcome, re-engagement, auth, alerts) sends from
  **`hello@datiq.app`**. A human received it, so a human must be able to reply.
- **Inbound** (a visitor's form submission → our own inbox) sends from
  **`noreply@datiq.app`**. The submitter's address is unverified, so sending as
  them would forge an identity we haven't checked; sending as `hello@` would
  make `hello@` mail itself. `reply_to` carries the real person.

`alerts@datiq.app` (scheduled-change alerts) and `noreply@datiq.app` are system
senders, **not** customer contact points. They are in the audit's `ignoreEmails`
list and should be left alone.

To re-consolidate at any time: `node scripts/audit.mjs --fix-emails`.

## When you're unsure

Ask: "Could a customer or competitor read this, and does it reveal how we run
the business rather than what the product does for them?" If yes, it is
internal. When still unsure, keep it in `docs/internal/` and out of the public
surface — omission is cheap; a leak is not.
