# SESSION-HANDOFF-2026-07-25-CONTACT-RESEND.md

> **Session date:** 2026-07-25
> **Branches at end of session:** `main` = `dc71fe5`, `staging` = `4ea6883` — both in sync with `origin`, working trees clean
> **Status at handoff:** shipped to production (datiq.app auto-deploys from `main`)
> **Next session entry point:** read `AGENTS.md` → `CLAUDE.md` → `git log --oneline -10` → `git status`

---

## TL;DR

The `/contact` form went from a browser `mailto:` hand-off to real server-side
email delivery, and DatIQ's customer-facing addresses were consolidated into two
inboxes. The session took a detour through Web3Forms before landing on Resend —
that detour is worth reading, because it was driven by a real constraint rather
than a preference.

| # | Commit | What |
|---|---|---|
| 1 | `031b16d` | **feat(contact):** Web3Forms delivery + `hello@`/`admin@` two-inbox routing |
| 2 | `bb38b85` | merge `Integrate-web3forms-contactdatiq` → `staging` |
| 3 | `df3fa19` | **chore(help):** rebuild `public/help` from markdown sources |
| 4 | `47249ba` | **feat(contact):** replace Web3Forms with server-side Resend delivery |
| 5 | `c7b2442` | **fix(email):** sender identity follows direction — `hello@` out, `noreply@` in |
| 6 | `4ea6883` | **refactor(email):** one env var per sender — `hello@` / `alerts@` / `noreply@` |
| 7 | `dc71fe5` | merge `staging` → `main` (production) |

Final gate: **1529 tests green** (960 unit / 382 contract / 180 integration / 7
system), build clean, readiness audit **5 pass · 2 warn · 0 fail**.

---

## Where things ended up

### Two customer inboxes

`src/lib/contactRouting.js` is the **single source of truth**. It exports the
enquiry-type table, the inbox map, and `buildSubject()`.

| Inbox | Owns |
|---|---|
| `hello@datiq.app` | Product support, bug reports, feature requests, billing, general |
| `admin@datiq.app` | Enterprise & agency, legal & terms, privacy & DPDP (incl. DPDP grievance officer, DMCA agent) |

`support@` / `legal@` / `privacy@` are retired. The readiness audit (Check 2)
fails the build if they reappear, and `--fix-emails` rewrites each to the inbox
that now owns it. Test files are exempt — they name the retired addresses
precisely in order to assert they are gone.

Eight enquiry types (`support`, `bug`, `billing`, `feature`, `enterprise`,
`legal`, `privacy`, `other`). The form shows the destination live as the user
picks: *"Goes to admin@datiq.app"*.

### Delivery

```
/contact → apiClient.sendContactEmail → POST /api/contact-email → Resend
                                        (netlify/functions/contact-email.js)
```

**Routing is server-authoritative.** The browser sends an enquiry *type* and
never names a recipient. The function imports `contactRouting.js` (rather than
mirroring it) and resolves the destination itself. Consequences:

- Exactly ONE inbox receives each message — no duplicate delivery.
- The endpoint cannot be used as an open relay. A client that posts
  `to` / `routeTo` / `route_to` is ignored; there is a contract test for it.
- `RESEND_API_KEY` never reaches the browser bundle.

Also in the function: honeypot (`botcheck` → 200 and drop, so bots don't
retry), field size caps, email-shape validation, HTML escaping on every
user-supplied value, and Resend `tags` (`stream` / `inbox` / `enquiry_type`).
Returns 503 when `RESEND_API_KEY` is absent, which the UI renders as a
pre-filled `mailto:` fallback so a message is never silently lost.

### Mail senders — one env var each, no fallback chains

| Variable | Default | Used by | Direction |
|---|---|---|---|
| `CONTACT_EMAIL_FROM` | `DatIQ <hello@datiq.app>` | `welcome-email.js`, `reengagement.js` | outbound, human |
| `ALERT_EMAIL_FROM` | `DatIQ Alerts <alerts@datiq.app>` | `scheduled-runner.js` | outbound, machine |
| `FORM_EMAIL_FROM` | `DatIQ Contact <noreply@datiq.app>` | `contact-email.js` | inbound |

Each function reads exactly one variable and never falls back to another. The
specific accident being designed out: setting an outbound sender to `hello@`
must never make the inbound form mail `hello@` from `hello@`. Regression tests
assert the isolation in **both** directions.

Defaults are correct with nothing set, so production works without any Netlify
change. Per-context values are documented in `NETLIFY-ENVIRONMENTS.md` §5.2.

### The parallel side-channels (unchanged)

`contactService.js` starts the CRM webhook and the subscriber capture *before*
awaiting the email, so a slow webhook costs no wall-clock time, and wraps both
in a no-op catch so neither can fail a submission. `contactWebhook.js` is still
**scaffolding**: it posts to `VITE_CONTACT_WEBHOOK_URL` → falls back to
`VITE_WEBHOOK_URL` → no-ops. Its `contact.submitted` envelope is the stable
contract for whatever consumes it later.

---

## Why the Web3Forms detour happened, and why it ended

Worth reading before anyone reintroduces a client-side form service.

1. Built on Web3Forms first (commit `031b16d`) using the key the user supplied.
   Flagged up front that a Web3Forms access key delivers to the single address
   registered against it — the API has no free "send to arbitrary address"
   field. The user chose to proceed with one key plus `route_to` metadata and a
   `[HELLO]`/`[ADMIN]` subject tag for mailbox-side filtering.
2. Mail then appeared to go missing. It had not: it was landing at the address
   registered on the key, visible in Resend's inbound dashboard (the domain's MX
   pointed at Resend). **My earlier diagnosis was wrong** — delivery was working.
3. Both inboxes turned out to be registered against the *same* key, so **every**
   submission was delivered to **both** — a privacy enquiry landed in the support
   inbox and vice versa. Routing existed only as a subject tag.
4. The user proposed using Resend (already in the stack) or the Zoho API
   instead. Resend won: one vendor, one dashboard, key already configured, and
   moving delivery server-side made routing authoritative rather than advisory.

**The lesson:** a client-side form service binds delivery to the key, so routing
can only ever be advisory metadata. Moving the send server-side is what made
one-recipient-per-enquiry actually enforceable.

---

## Files

**Added**
- `netlify/functions/contact-email.js` — the Resend endpoint
- `netlify/__tests__/contact-email.test.js` — 38 contract tests
- `src/lib/contactRouting.js` + test — routing table, source of truth
- `src/lib/contactService.js` + test — orchestration
- `src/lib/contactWebhook.js` + test — CRM scaffolding

**Removed**
- `src/lib/web3forms.js` + test — the whole transport
- The hardcoded Web3Forms access key that was baked into `config.js`

**Changed**
- `src/pages/Contact.jsx` — 8 enquiry types, live destination hint, both inboxes
  in the sidebar, error state with `mailto:` fallback
- `src/lib/apiClient.js` — `sendContactEmail`
- `src/lib/config.js` — Web3Forms config removed; `CONTACT_WEBHOOK_URL` kept
- `src/pages/Privacy.jsx`, `Terms.jsx`, `public/dmca.html`, `Pricing.jsx`
  (enterprise CTA), `Integrations.jsx` (agency link) → `admin@`
- `index.html` (JSON-LD `contactPoint`) and `docs/DatIQ-Developer-API.md` →
  `hello@`. Both were still on `support@` because they sit outside the audit's
  scan roots; the audit now covers them via `emailFixFiles`.
- `netlify/functions/welcome-email.js`, `reengagement.js` → `CONTACT_EMAIL_FROM`
- `.claude/skills/production-readiness/scripts/audit.mjs` — two-inbox policy,
  per-alias mapping, test-file exemption, wider scan
- `.claude/skills/production-readiness/references/external-vs-internal.md` —
  rewritten; it still claimed "exactly one customer contact address"
- `NETLIFY-ENVIRONMENTS.md` — Supabase auth From `noreply@` → `hello@`
  (outbound to users); three senders per context in §5.2
- `src/styles/screens.css` — `.contact-route-hint`, `.contact-error a`

---

## Open items for the next session

### Needs the operator, not code

- [ ] **Send one real test submission** through `/contact` on datiq.app. This is
      the only way to confirm `noreply@datiq.app` is deliverable from the
      verified domain — it could not be verified from the repo. Use an
      enterprise or legal type to exercise `admin@` routing in the same shot.
- [ ] **Confirm `RESEND_API_KEY` is set in the production context.** Almost
      certainly yes (welcome + alerts depend on it), but the contact form now
      does too. Without it: 503 → `mailto:` fallback, nothing lost.
- [ ] **Zoho MX.** The user planned to point `datiq.app` MX at Zoho directly
      rather than have Resend inbound receive and forward (mail was collecting
      in Resend's receiving section and not reaching Zoho, because inbound
      forwarding rules were never configured). Independent of this code — it
      governs whether mail reaches the inbox after Resend hands it off.
- [ ] Optional: set the three `*_EMAIL_FROM` vars explicitly per context. Not
      required — defaults are correct.

### Code

- [ ] **The CRM webhook has no endpoint yet.** `contactWebhook.js` currently
      posts to the general n8n webhook. When the real pipeline exists, set
      `VITE_CONTACT_WEBHOOK_URL` and consume the `contact.submitted` envelope.
      No refactor needed.
- [ ] **Resend delivery webhooks** are the natural next step for automation. The
      Resend `tags` are already emitted for exactly this.
- [ ] The Web3Forms account can be closed — nothing references it.
- [ ] Branch `Integrate-web3forms-contactdatiq` is merged and pushed; safe to
      delete locally and on origin.

### Pre-existing, untouched

- [ ] Readiness audit's 2 remaining WARNs: screenshots need regenerating after
      UI changes (`node docs/capture-screenshots.mjs`), and gallery/persona
      coverage can't be proven from source.
- [ ] Everything under "Pre-cutover: Production isolation" in `CLAUDE.md`.

---

## Notes for whoever picks this up

- **`main` is checked out in the primary worktree** (`/Users/vikash/Extracta`),
  so it cannot be checked out in a secondary worktree. Run merges into `main`
  with `git -C /Users/vikash/Extracta merge …`.
- The primary worktree had **uncommitted user work** at handoff — a modified
  `public/favicon.png` and an untracked `ai-powered-growth-stack-playbook.md`.
  Both are unrelated to this session and were deliberately left alone. Verified
  they did not overlap the merge before it ran, and survived it unchanged.
- **`vitest` run from the primary worktree inflates test counts** (~3652 instead
  of ~960) because it also walks the nested `.claude/worktrees/*` copies. Not a
  regression. For clean per-suite numbers, run from a secondary worktree.
- **Do not add env values to `netlify.toml`.** Values in
  `[context.*.environment]` override the Netlify UI, and committed placeholders
  previously caused a production login outage — the file's own header says so.
  Config lives in the UI; the repo holds documented values and safe defaults.
- Browser verification in this session **stubbed the mail call but not the
  webhook**, so a few real payloads reached the user's n8n test endpoint.
  Stub both if that matters.
