# Session handoff — 2026-08-23

## Compliance reporting · consent override · referral loop · public-share sync

**Branch:** `claude/linkedin-extraction-robots-errors-i0hx5t` → merged to `staging`.
**`origin/staging` = `870bb73`.** Promotion to `main` in the same session (see §7).

Started from one report — three LinkedIn URLs "failing" — and ended up fixing
four separate features. The through-line: **every one of them was reporting a
deliberate, correct decision as a fault**, and in two cases charging or
misleading the user on the way.

---

## 1. The reported bug: a robots.txt refusal reported as a crash

Three LinkedIn URLs showed *"Something went wrong / An unexpected error
occurred"* with a minified stack. **Nothing crashed.** LinkedIn's robots.txt
disallows `/` for `User-agent: *`, DatIQ advertises `DatIQBot/1.0`, and
`checkCompliance` refused all three correctly — FD3 working as designed and
advertised on `/blog`.

The failure was in the reporting, in four steps:

| # | Where | What |
|---|---|---|
| 1 | `extract.js` → `complianceEngine.js` | Correct 403 with `error: "robots.txt disallows…"` |
| 2 | `apiClient.js` | Turned it into `new Error(msg)` with `e.status = 403` — and **dropped `_complianceBlocked`** |
| 3 | `errorMessages.js` | `classifyError` matched on the **message only**. The string hit none of the 11 regexes — not even `/403\|forbidden/`, because "403" lives on `err.status`, not in the prose → generic DEFAULT |
| 4 | `ExtractionProvider.jsx` | Rendered a **"Try again"** button for a decision retrying cannot change |

### Two real defects found alongside

**A. A refused request was billed twice.** `consumeGuestCredit` (a DB RPC that
*decrements* quota) ran **before** the compliance check, and the client repeated
the charge in its catch — justified by a comment, *"A failed attempt still
consumed a provider call"*, that is untrue here: compliance declines before any
provider is contacted.

**B. User-agent over-matching.** `parseRobots` matched with
`ourUa.startsWith(agent)`, so a record aimed at `User-agent: D` captured us and
silently replaced the `*` rules we should have obeyed — making us *more*
permissive than the site asked. Now matched on the product token per RFC 9309.

**C.** The header claimed map mode was exempt from the check. It never was —
`extract.js` checks before branching on `mapMode`. The comment was the wrong half.

### Gate order in `extract.js` — load-bearing in both directions

```
SSRF  →  entitlement  →  compliance  →  guest charge  →  rate limiter
```

Everything above the charge can decline *without doing work*, so nothing above
it may bill. Entitlement sits above compliance because a denied account must
cost nothing on the wire — `entitlement-enforcement.test.js` pins that, and
reordering naively broke it, which is how the constraint surfaced.

---

## 2. Consent override (owner-chosen scope)

`0028_scrape_consent.sql`, `lib/scrapeConsent.js`, `/api/scrape-consent`,
`ScrapeConsentModal` — shown **only after a refusal**.

**The rules that keep it an override and not a bypass:**

1. **Signed-in only.** An anonymous cookie can be cleared and re-made without
   limit, so it is nobody to attribute a permission claim to.
2. **Resolved server-side from the JWT on every request.** `/api/extract`
   accepts **no `consented` flag** and ignores one if sent — regression-tested.
3. **Only `robots_disallowed` is overridable.** `host_not_permitted` is the
   *operator's* decision; a user must not attest past their own operator.
4. Per exact host (`www.` stripped, **subdomains not covered**), expires in
   180 days, revocable.
5. **`hasScrapeConsent` FAILS CLOSED** — the one lookup in the extract path
   that does. Failing open would let a Supabase blip grant everyone permission
   to scrape every disallowed host on earth.
6. `consentAvailable` also respects `degraded`: when the store cannot answer,
   the override is not *offered*, so the user sees the plain refusal rather
   than a dialog that can only error.

---

## 3. Terms

Acceptable Use now states that DatIQ honours robots.txt by default and that a
refusal is overridable **only** by a recorded confirmation of ownership or owner
permission, per named site, with responsibility on the user.

It also **resolves an internal contradiction**: item 1 excluded sites "protected
by technical or legal access controls", which a reader could take to cover a
robots.txt `Disallow`. Item 1 now *defines* the phrase (authentication,
paywalls, IP/geo blocking, licence terms), and a new item states robots.txt is a
request to automated clients rather than an access control.

⚠️ Added as **items**, never a new section — `SECTIONS` drives `#section-N`
anchors by array index.

---

## 4. Referral loop — rebuilt server-side

Reported symptom: an invite code of **`AAAAAAAA`**. Four defects, and every
load-bearing part of the feature was one of them:

1. **Every user got the same code.** `hashSessionId` ran
   `h = (h * 1103515245 + 12345) >>> 0`; that product reaches ~1e18, **110×
   past `Number.MAX_SAFE_INTEGER`**, so the double rounded the low bits to
   zero, `>>> 0` kept them, and `% 32` was always 0. Codes were **not unique** —
   attribution was impossible even in principle.
2. **The bonus was cosmetic.** Redemption wrote `datiq.referralBonus`; the quota
   reads `subscription.bonusExtractions`. Nothing bridged them.
3. **The referrer was never credited** — redemption ran in the invitee's browser.
4. **Self-referral was farmable** from any second browser profile.

**Now:** `0029_referrals.sql` — codes from `issue_referral_code` (UNIQUE column
+ retry loop, not hash-and-hope), rewards from `redeem_referral_code` crediting
**both** sides' `entitlements.bonus_extractions` atomically and bumping
`version` so the 60s client cache busts. `invitee_user_id` is **UNIQUE** (one
redemption per account, ever — what makes the reward finite) and a CHECK
constraint refuses self-referral at the DB level.

**`npm run verify:referral`** (wired into `test:db`) drives the real module
against a real PGlite Postgres with all 29 migrations. It exists because the
mocked contract suite would pass if the module sent `p_userId` to a function
expecting `p_user_id`. **Demonstrated:** renaming that parameter fails 3
assertions there while all 14 mocked tests still pass.

---

## 5. Public share — "Sync public link"

Reported: sharing works, then Sync says *"Public publish failed — nothing was
saved locally. Check Supabase configuration."*

**Root cause.** The upsert on an existing slug becomes an UPDATE, gated by the
`owner update` policy in `0007`. Both its branches are unsatisfiable for an
anonymous sharer:

```sql
user_id::text = auth.uid()::text    -- null for an anon share
session_id = …->>'x-session-id'     -- a header sent NOWHERE in this repo
```

The link is live throughout; only the overwrite is refused. `shareExtraction`
now probes for the live row before deciding, returning `refreshed:false`.

🔴 **Do NOT fix this by sending an `x-session-id` header.** The `public read`
policy exposes **every column, `session_id` included**, to anyone with the slug
— header-based ownership would let any reader rewrite or delete the row. That
turns a fail-closed bug into a real vulnerability. **Open operator decision:**
drop the anon branch (signed-in updates only), or move the write behind a
service-key function.

**The copy** named an internal vendor the user can't act on, and claimed data
loss that hadn't happened. Both corrected.

---

## 6. E2E suite — every navigation depended on Google's CDN

`index.html` loads its typefaces from `fonts.googleapis.com` with a plain
render-blocking `<link>`. Playwright's default navigation wait is `load`, which
waits for that stylesheet. Where egress is filtered it hangs ~12.5s then resets:

```
total load 13407ms, 205 requests
  12546ms net::ERR_CONNECTION_RESET  https://fonts.googleapis.com/css2?...
```

Two navigations ≈ 26s against a 30s timeout. `e2e/support.js` now stubs the font
CDN (and Razorpay's SDK); `consent-tour.spec.js` calls the same helper directly
because it supplies its own runtime-config. **Result: 33 passed / 84 failed →
117 passed / 1 skipped / 0 failed, and ~3× faster.**

`og-preview.test.js` had the same class of bug — a real `dns.lookup` under the
5s timeout. Stubbed, keeping the scheme check.

---

## 7. Verification

| Gate | Result |
|---|---|
| Readiness | 5 pass · 2 warn · 0 fail |
| Unit | 2023 |
| Contract | 1390 (+14 skipped) |
| Integration | 309 |
| System | 8 |
| Database | 29 migrations · 161 assertions |
| Referral e2e | 17 assertions |
| Build / Security | clean |
| E2E smoke | 117 passed · 1 skipped · 0 failed |

**Every new test was confirmed to FAIL against the pre-fix code** before being
accepted. Staging Gate green on GitHub (run #181 on `aeb56a8`, all four checks).

### Two traps worth carrying

1. **A fail-open path can invert a test.** The first extract tests hit real DNS
   for `linkedin.com`; because `loadRobots` fails open on a network error, an
   unreachable host didn't slow the test — it turned the refusal under test into
   an allow. Any test of a refusal must be hermetic.
2. **Piping Playwright through `tail` reads `tail`'s exit code.** Two e2e runs
   were reported as green that had 23 and 84 failures. Capture the full log.

---

## 8. Open items

- 🔴 **`public_reports` `owner update` policy** — operator decision, §5.
- **Counsel's eye on Terms.** The document no longer contradicts itself, but the
  attestation override is a legal position, not just copy.
- **Production Supabase migrations.** `0028` and `0029` were confirmed applied
  to the project the owner was testing; **production is a separate project**
  (`sikkfxysjhirmtwkumpt` vs staging's `aubwooslkkrprdxuiyvj`). Both must be
  applied there before the features work in production. Until then each fails
  safe — null code, hidden banner, plain refusal.
- **No account-settings UI** for reviewing/withdrawing scrape-consent grants or
  seeing referral standing. The APIs exist and are tested; nothing renders them.
- ⚠️ **`PERMITTED_HOSTS` is EXCLUSIVE** — setting it blocks every host *not*
  listed. Leave unset outside a closed beta.
- **Production is locked by design.** Releasing needs a Netlify UI unlock **plus**
  an `approved` comment on the phase-gate issue.
