# Session handoff — 2026-08-23

## LinkedIn "extraction errors": a robots.txt refusal reported as a crash

**Branch:** `claude/linkedin-extraction-robots-errors-i0hx5t`, cut from `origin/staging` @ `9dbddda`.
**Not merged.** `staging` and `main` untouched.

---

## 1. What was reported

Three URLs, all the same shape:

```
Extracting https://www.LinkedIn.com/company/anthropic

Something went wrong
An unexpected error occurred. Try again — if the problem continues,
check the technical details below.

  robots.txt disallows scraping for DatIQBot/1.0 (path=/company/anthropic)
  async tl@https://datiq.app/assets/index-BGxPffpS.js:21:2173
```

## 2. What was actually happening

Nothing crashed. DatIQ refused the URLs **on purpose** and then mis-reported a
deliberate policy decision as an unexpected fault.

| # | Where | What |
|---|---|---|
| 1 | `netlify/functions/extract.js` → `lib/complianceEngine.js` | LinkedIn's robots.txt disallows `User-agent: *`; we advertise `DatIQBot/1.0`, which matches no named block. Correct 403. This is FD3 working as designed, and `/blog` advertises it as a feature. |
| 2 | `src/lib/apiClient.js` | Turned the body into `new Error(message)` with `e.status = 403` — and **dropped `_complianceBlocked`**, the one field that said "this was deliberate". |
| 3 | `src/lib/errorMessages.js` | `classifyError` matched on the **message text only**. The robots string hits none of the 11 regexes — not even `/403|forbidden/`, because "403" lives on `err.status`, not in the prose. → generic `DEFAULT`. |
| 4 | `src/components/ExtractionProvider.jsx` | `showError(err, {}, retry)` → a **"Try again"** button for a decision retrying cannot change, plus a minified stack as "technical details". |

### Two real defects found alongside

**A. A refused request was billed twice.** `consumeGuestCredit` (a DB RPC that
*decrements* quota) ran **before** the compliance check, and the client repeated
the charge in its catch block — justified by a comment, *"A failed attempt still
consumed a provider call"*, that is simply untrue here: compliance declines
before any provider is contacted. Three LinkedIn attempts spent 3 of 10 free
credits, twice over, for zero work.

**B. The map-mode comment was wrong, not the code.** `complianceEngine.js`'s
header claimed map mode skipped the check. It never did — `extract.js` checks
before branching on `options.mapMode`. Enforcement kept (a crawl that enumerates
a whole site is the last thing that should ignore robots.txt); comment corrected.

**C. User-agent over-matching.** `parseRobots` matched with
`ourUa.startsWith(agent)`, so a record aimed at `User-agent: D` — any prefix of
our name — captured us and silently replaced the `*` rules we should have obeyed,
making us *more* permissive than the site asked. Now matched on the product token
per RFC 9309.

### On `path=/vikashkaruna`

`new URL("https://www.LinkedIn.com/in/vikashkaruna").pathname` is
`/in/vikashkaruna`, and nothing in `normalizeUrl`/`extractUrls` rewrites paths.
The two `/company/…` messages matched their URLs exactly, so that line most
likely came from a separate attempt at `linkedin.com/vikashkaruna`. A test now
pins the path as echoed verbatim, so a real rewrite would surface rather than
being argued about again.

---

## 3. What shipped

### Honour robots.txt, report it honestly

- `checkCompliance` now returns a stable **`code`** (`allowed` /
  `robots_disallowed` / `host_not_permitted` / `invalid_url`) plus `host` and
  `path`. `reason` is unchanged byte-for-byte. **Branch on the code; the prose
  is for humans.**
- `apiClient` carries `code`, `host`, `complianceBlocked`, `consentAvailable`
  through onto the thrown Error.
- `errorMessages.js` gets a first-position compliance category, `isComplianceError()`,
  and a structured fallback so a 403 with an opaque body stops landing on the
  generic default.
- `ExtractionProvider` shows the refusal with **no "Try again"**, and does not
  charge a guest credit for it. Genuine provider failures still charge — that
  rule exists so a URL that always fails isn't free and endlessly repeatable.
- `HeroComposer` warns *before* submit for known-blocked hosts. A **hint only**:
  it never blocks submission, because live robots.txt on the server is the only
  authority and this list can go stale.

### Gate order in `extract.js` — load-bearing in both directions

```
SSRF  →  entitlement  →  compliance  →  guest charge  →  rate limiter
```

Everything above the charge can decline *without doing work*, so nothing above it
may bill. Entitlement sits above compliance because a denied account must cost
nothing on the wire — `entitlement-enforcement.test.js` pins that, and reordering
naively broke it, which is how the constraint surfaced. The entitlement denial
uses `respond`, not `reply`, because no cookie exists yet at that point.

### Consent override (scope chosen by the owner)

New: `0028_scrape_consent.sql` (2 tables, 1 function, 1 trigger →
**42 tables / 17 functions / 6 triggers**), `netlify/functions/lib/scrapeConsent.js`,
`POST/GET/DELETE /api/scrape-consent`, `src/lib/scrapeConsentService.js`,
`src/components/ScrapeConsentModal.jsx`.

**The rules that keep this an override and not a bypass:**

1. **Signed-in only.** An anonymous cookie can be cleared and re-made without
   limit, so it is nobody to attribute a permission claim to.
2. **Resolved server-side from the JWT on every request.** `/api/extract`
   accepts **no `consented` flag** and ignores one if sent — regression-tested.
3. **Only `robots_disallowed` is overridable.** `host_not_permitted` is the
   *operator's* decision; a user must not attest past their own operator.
4. **Per exact host** (`www.` stripped, **subdomains not covered**), expires in
   **180 days**, and is **revocable** — consent you cannot revoke is not consent.
5. **`hasScrapeConsent` FAILS CLOSED** — the one lookup in the extract path that
   does. Failing open would let a Supabase blip grant everyone permission to
   scrape every disallowed host on earth. Do not "harden" it to match
   `requireEntitlement`.
6. The modal is shown **only after a refusal**, and Confirm is disabled until the
   checkbox is ticked (the server re-checks `confirmed === true`).

---

## 4. Verification

| Gate | Result |
|---|---|
| `npm test` | **245 files · 3705 passed · 14 skipped · 0 failed** |
| `npm run test:db` | **28 migrations · 145 assertions · 0 failed** |
| `npm run build` | clean |
| `node scripts/build-run-all.mjs --check` | up to date (regenerated — it is GENERATED and CI checks it) |
| `npm run test:security` | clean |
| `npm run readiness` | 5 pass · 2 warn · 0 fail |

**Every new test was confirmed to FAIL against the pre-fix code before being
accepted** — all 7 server refusal tests, the client double-charge test, and the
UA-prefix regression. A test that has never failed has not been shown to test
anything.

### ⚠️ A trap worth carrying forward

The first version of the extract tests hit **real DNS** for `linkedin.com`.
Because `loadRobots` **fails open on a network error**, an unreachable host did
not merely slow the test — it *inverted* it, turning the refusal under test into
an allow. `publicUrl.js` is now mocked in that suite. Any future test of a
refusal must be hermetic for exactly this reason.

### Readiness warns (both pre-existing, neither a blocker)

- **Gallery / persona coverage** — unconditional, can never clear from source
  (documented in CLAUDE.md).
- **Screenshot integrity** — fires because UI source changed. The new UI is
  conditional (the composer hint needs a blocked host; the modal needs a
  refusal) and appears in none of the captured views, so regenerating would be
  churn with no content change. Not regenerated.

---

## 5. Open items for the owner

- ✅ **Terms updated with owner approval.** The audit was smaller than first
  reported: `/vs/*` carries no robots.txt claim at all (its "Multiple robots" /
  "Scheduled robots" rows are Browse.ai *bot* features — I had conflated the
  words), `llms-full.txt` already said "by default", and `/blog`'s bullet
  attributes robots handling to Firecrawl. Acceptable Use now states that DatIQ
  honours robots.txt by default and that a refusal is overridable only by a
  recorded confirmation of ownership or owner permission, per named site, with
  responsibility resting on the user. Added as **items**, never a new section —
  `SECTIONS` drives `#section-N` anchors by array index.
- ⚠️ **Open, and a legal judgement rather than a code one.** Acceptable Use
  item 1 also permits sites "publicly accessible and not protected by technical
  or legal access controls". If counsel reads a robots.txt `Disallow` as a
  technical access control, no attestation should override it and the feature
  needs revisiting rather than a copy edit.
- **Two accuracy fixes left unmade, neither a blocker:** the `/blog` bullet
  credits Firecrawl for robots handling (DatIQ runs its own engine before any
  provider, and three of the four providers do none), and `llms-full.txt`
  claims to honour `noindex` — which has never been true. Nothing in the
  extract path parses a target page's noindex; `seoMeta.js`'s noindex code sets
  it on DatIQ's own admin pages.
- **Apply `0028_scrape_consent.sql`** to Supabase before this reaches an
  environment where the override is expected to work. Until then the endpoint
  returns a storage error and the refusal simply stands — which is the safe
  direction.
- ✅ **`consentAvailable` now respects `degraded`.** The server no longer
  advertises the override when the consent store cannot answer — unconfigured,
  unmigrated, or unreachable. Without that, every signed-in user hitting a
  refusal was offered a dialog that could only error: tick the box, the POST
  502s, nothing granted. That is the state the product is in until `0028` is
  applied, so it mattered immediately.
- **No account-settings UI yet** for reviewing or withdrawing grants.
  `listScrapeConsents` + `revokeScrapeConsent` exist and are tested; nothing
  renders them. Withdrawal is currently API-only.
- ⚠️ **`PERMITTED_HOSTS` is exclusive, not additive.** Setting it blocks every
  host *not* listed. A one-host value takes the product down for everything
  else. Left unset.
