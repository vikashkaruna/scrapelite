# Session handoff — 2026-08-29 — Integrations/Browser-extension on pricing, real Push+export gating, Resend export-email rebuild

**Branch:** `claude/dashboard-plan-features-fdcef9`, cut from `main` @ `3c977e8`.
**Merged to `staging`** by fast-forward: `bdae135` → `b01795c` → `3572efa` → `d0983f9` (a real merge commit against a concurrent staging session — see "Merge conflicts" below).
**`main` untouched.**

## What was asked, in order

1. A large multi-part request (Collections hidden bug, universal export/email/clipboard for paid plans, scheduled-monitoring tiers, Integrations + a browser extension on paid plans, remove plan-tier labels from menus, unit-of-measurement/gap-analysis). Four genuinely ambiguous sub-decisions were raised via `AskUserQuestion` and answered later in the session (see "Decisions" below) rather than guessed.
2. A narrower follow-up: **"Update the plans tiles and Compare every plan in details. Integrations are missing in plans and comparison."**
3. A final instruction: **"Yes, do the Resend email rebuild next."**

All three were delivered in this session.

## Decisions (answered via `AskUserQuestion`, not guessed)

| Question | Answer |
|---|---|
| Browser extension — build the real thing, or an entitlement flag? | **Entitlement flag only.** No shipping extension exists anywhere in this codebase (marketing copy actually brags DatIQ needs none) — building one is a separate, multi-week project. |
| Scheduled monitoring for Free/Developer (only Select/Pro/Business/Agency/Go were specified) | **Free = 0, Developer = 10** (matches Pro). |
| Email export delivery mechanism | **Replace** the old client-side webhook/mailto flow entirely with a server-side Resend endpoint that attaches the real file. |
| Plan-tier hint labels on Export/Copy menus | **Remove entirely** — no replacement label. |

## What shipped

### 1. Pricing tiles + comparison matrix
- `Integrations (HubSpot, Notion, Airtable, Slack)` and `Browser extension` added as real feature lines on every `/pricing` card **and** as new rows in the comparison matrix (`PricingMatrix.jsx`), gated Select-and-up, excluded on Free/Go.
- Scheduled monitoring re-tiered: Select=5, Pro=10, Business=25, Agency=Infinity, Developer=10, Free/Go=0 (was Select=0, Pro=1, Business=5).
- Go and Select now carry JSON export, so every paid plan has the full CSV/PDF/Markdown/JSON set.
- Removed the stale `"All plans" / "Select+" / "Pro+"` hint spans from every Export/Copy dropdown item on Dashboard/Preview/Batch. Upgrade toasts that said "requires the Select/Pro plan" were wrong (those formats moved to Go) — corrected to "Go plan or higher" everywhere.

### 2. Real enforcement, not just labels
- `entitlementModel.js`'s `"integrations"` capability was **unconditionally `ok()`** before this session — i.e. every plan, including Free, could already push to HubSpot/Notion/Airtable/Slack with zero gating. Now gated on `L.integrations` (Select and up). Added `"browser_extension"` as a new entitlement-flag-only capability.
- `PushIntegrationMenu.jsx` locks the four real providers behind the new gate client-side (shows a "Select plan+" badge, refuses with an upsell toast); Google Sheets is deliberately exempt — it's a client-side CSV download with no server connection, already free on every plan.
- **Server-side gap closed**: none of the four push endpoints (`integrations-hubspot.js`, `-notion.js`, `-airtable.js`, `-slack.js`) had ANY entitlement check before this — a client that skipped the UI and POSTed directly could push regardless of plan. Added a matching check to all four, scoped to the manual push action only (Slack's automated `handleNotify` is untouched — different feature).
- New `requireCapabilityForUser(userId, capability)` in `requireEntitlement.js`, alongside the existing `requireCapability(event, capability)` — avoids a second `authenticateBearer()` round trip in handlers that already resolved the caller. **Trap hit and fixed**: the first version reused `requireCapability(event, ...)` inside handlers whose top-level dispatcher had already authenticated once; the second internal auth call consumed a slot from each contract test's `globalThis.fetch` mock queue (meant for the provider's own API calls), silently shifting every mocked response by one and corrupting unrelated assertions. Root-caused by reverting via `git stash` and confirming the failure was new, not pre-existing.

### 3. Collections dropdown bug (Dashboard)
Root cause: the Collection picker's dropdown menu is a normal in-flow child of `.card.rise.table-wrap`, which sets `overflow: hidden` to clip the table to its own rounded corners — a real fix, not a preference, since the menu was genuinely invisible, not just badly positioned. `CollectionPicker.jsx` now renders its menu via a `createPortal` to `document.body`, `position: fixed`, computed from the trigger's own `getBoundingClientRect()`, repositioned on scroll/resize. Verified live in a browser (screenshot in the session).

### 4. Resend export-email rebuild
- New `netlify/functions/export-email.js` — sends CSV/PDF/Markdown/JSON as a real Resend attachment, branded like the invoice emails (`invoiceEmail.js`'s house style: 560px, brand header, bordered body). **Signed-in only, unconditionally** — the one deliberate exception to this codebase's usual "guests fail open" rule, because this endpoint relays mail to an arbitrary, client-supplied recipient list; failing open would make it a free spam relay. Re-checks `export.email` **and** `export.<format>` server-side — emailing a format is never more permissive than downloading it.
- `pdfExport.js` refactored the same way `invoicePdf.js` already was: one layout builder (`buildExtractionsPdf`), a browser `.save()` wrapper (`extractionsToPdf`, signature unchanged for existing call sites), and a new Node-safe `extractionsPdfBuffer()` for the email attachment.
- `EmailModal.jsx` gained a "Send as" format `<select>`, scoped to whatever the caller's plan actually allows (passed in as a `formats` prop, never re-derived inside the modal). Wired into **Dashboard** (replacing the old handler) and added **fresh** to **Preview** and **Batch**, which never had an email option before this session.
- New env var `EXPORT_EMAIL_FROM` (default `DatIQ <hello@datiq.app>`), reply-to `hello@datiq.app`, per the one-var-per-sender rule.
- **Deleted** `src/lib/emailService.js` (the old webhook/mailto flow — no attachment, no branding, no plan enforcement) and its test file. Confirmed nothing else imported it before deleting.
- 24 new contract tests in `netlify/__tests__/export-email.test.js`.

### 5. Account.jsx
Added a "Browser extension — Coming soon" note in Integrations, shown only to plans that carry the `browser_extension` flag (Select and up) — reads as "coming to your plan" rather than a generic teaser. New `puzzle` icon registered in `Icon.jsx`.

## Known gap, not closed this session

**Emailed exports don't carry the user's Brand Kit.** The concurrent staging session (see below) shipped a Brand Kit system for downloads (PDF/CSV/MD/JSON all read `readBrandKit()` from browser localStorage). `export-email.js` calls the same builders without a `brandKit` argument, because the Brand Kit lives in the browser and the email endpoint has no access to it without the client forwarding it in the request body — which is exactly the paywall-bypass shape the *other* session's `report-email.js` had to close (client-supplied `brandKit` re-validated + re-checked against `white_label_pdf` server-side). `export-email.js` does not yet do that re-validation because it doesn't accept a `brandKit` field at all. Emailed exports currently render with default (unbranded) DatIQ styling regardless of plan. Worth closing in a follow-up by mirroring `report-email.js`'s pattern.

## Merge conflicts (this session's branch × a concurrent staging session)

A concurrent session (`claude/password-coupon-errors-5a13a1`, merged to staging as `bdae135` while this session was in flight) independently built an `exportBranding.js` "Brand Kit" system and, remarkably, **wrote the identical refactor of `pdfExport.js`** (same function names: `buildExtractionsPdf`, `extractionsPdfFilename`, `extractionsToPdf`, `extractionsPdfBuffer`) for the same underlying reason (one render path, not two, shared between browser and Node). Conflicts resolved by keeping staging's brand-kit-aware body (their `ctx`/`brandKit`/footer-loop additions) while keeping this session's corrected "Go plan" upgrade-toast wording in `Preview.jsx` (staging still had it as "Select/Pro plan" — stale, from before this session's plan re-tiering). `Icon.jsx` conflict was a pure two-sided addition (`Puzzle` + `Palette`) — kept both. All 22 prerendered `public/*/index.html` pages conflicted trivially (both sides regenerated them); resolved by taking one side arbitrarily and regenerating via `npm run prerender` after the code conflicts were settled.

## Verified

Full local gate, twice — once before the merge (this session's own work) and once after (against the merged tree):
- unit + contract + integration: **281 test files / 4467 tests passed / 14 skipped / 0 failed**
- system: **5 files / 8 tests**
- db: `test:db` green (`verify-referral` 17/17)
- `npm run build` clean, `check:prerender` — 23 pages, 69 asset references, all present
- `test:security` clean
- Pre-push hook green on both the feature-branch push and the `staging` push — **nothing bypassed**.

Also verified live in a browser (not just unit tests): the Integrations/Browser-extension rows on `/pricing` and the comparison matrix, the Collections dropdown fix, the Push menu's "Select plan+" lock badges for a Free-plan guest, and the EmailModal's format selector for a Select-plan account.

## Open for next session

- Wire Brand Kit support into `export-email.js` (see "Known gap" above), following `report-email.js`'s re-validation pattern exactly — don't trust a client-supplied `brandKit` without re-checking `white_label_pdf` server-side.
- `main` merge is the user's call, per this repo's standing convention — `staging` is now well ahead of `main`.
- The earlier giant request's "unit of measurement = extraction + scheduled-job counts" and "gap analysis, enforce measurement per plan definition" items were addressed narrowly (the integrations enforcement gap found and closed) rather than as a full standalone audit — worth a dedicated pass if the user still wants a systematic sweep of every capability for client/server enforcement parity.
