# Session Handoff — 2026-08-13 — Supabase identity, integrations & enrichment

> **Read first next session.** Nothing is in flight. Working tree clean.
> `main` @ `4ad289a` — Phase-Gate ran **end to end** (run `31701256130`):
> gates → manual approval → production deploy → production smoke →
> re-lock, finished 12:59:38Z. **Production is released and locked again.**
> `staging` @ `d4b7a3c` — Staging Gate **success** (run `31700719683`).
> The two branches are content-identical (`git diff` empty).
>
> The remaining work is **operator-side env verification**, not code —
> see "Outstanding operator actions" at the bottom.

---

> ### ⚠️ Written retrospectively — the project has moved on since
>
> This handoff was authored at the end of the session it describes, but by the
> time it was written to disk the repo had advanced well past it. Read the state
> below as a **point-in-time record of 2026-08-13**, not as current state.
>
> - This session's work IS still released: `4ad289a` is an ancestor of
>   `origin/main`, so the Supabase-identity fixes are in the production lineage.
> - Several later sessions have shipped since (dashboard + Resend health,
>   discounts/coupons, analytics/consent/SEO, gallery curation, the footer
>   click fix, and the Home/Batch consolidation), each with its own handoff in
>   `docs/`. `CLAUDE.md`'s header is the source of truth for current state.
> - `CLAUDE.md` and `AGENTS.md` were deliberately **not** updated for this
>   session: doing so from this stale base would have reverted ~34 lines of
>   those later sessions' documentation and re-dated the header backwards.
>
> The root-cause analysis and the two lessons below are the durable part and
> remain accurate.

## The problem this session solved

Two user-facing features were broken in production *and* staging, and both
had survived several rounds of correct-but-insufficient fixes:

1. Every integration connect (Notion, Airtable, HubSpot, Slack, Zapier)
   returned `Invalid or expired session`.
2. Every Quick-enrichment button (Find Contact Info, Leadership & Board,
   Social Links, Company Mission, Pricing & Plans) saved a blank tab.

The through-line: **neither failure was observable.** Supabase's only
feedback is the string `Invalid API key`, which names *neither* side of
the comparison it just failed, and the enrichment path collapsed every
distinct cause into one blank panel.

## What shipped (in order)

### 1. `cb81139` — make both failures diagnosable, not silent

`getSupabaseForUser()` was **duplicated verbatim in 8 files** (the 5
`integrations-*.js`, plus `extractions.js`, `schedules.js`,
`invoice-email.js`, `invoice-pdf.js`, `lib/requireEntitlement.js`), each
reading `SUPABASE_ANON_KEY || VITE_SUPABASE_ANON_KEY`. Two defects:

- **Precedence** — a set-but-wrong `SUPABASE_ANON_KEY` beat a healthy
  `VITE_SUPABASE_ANON_KEY`.
- **Redaction** — Netlify's secret scanner rewrites JWT-shaped values to
  `****************<last4>`. `src/lib/config.js` had guarded the browser
  against this since the OAuth outage; the functions never did, and
  `SUPABASE_ANON_KEY` was missing from `SECRETS_SCAN_OMIT_KEYS`.

All 8 now share `authenticateBearer()` in
`netlify/functions/lib/supabaseServerClient.js`, which picks the first
candidate that is present **and** not redacted, and — the honesty fix —
answers **503 naming the variable** when the key is at fault instead of
401 telling a correctly-signed-in user to sign in again.

This also fixed the five files the 2026-08-12 handoff flagged as still
calling `getUser()` with no argument — each 401'd every authenticated
request under supabase-js v2.108+.

Enrichment: `/api/extract` now returns `_enrichment.reason`
(`ai_not_configured` | `ai_chain_failed` | `no_match`), threaded through
`firecrawlService` → `ExtractionProvider` → `Preview.jsx`, so an empty
tab says *which* empty it is. Absent on success, so existing clients are
unaffected.

### 2. `7bff758` — compare the key's project ref to the URL

**A Supabase anon key is a JWT whose payload carries the project `ref`.**
So "does this key match this URL?" is answerable **offline, with no
network call**. Nothing had ever asked.

`diagnoseSupabaseIdentity()` now reports `ref_mismatch` (naming **both**
projects), `custom_domain`, `key_expired`, and
`service_role_in_anon_slot` — that last outranking everything else,
because a service key in an anon slot is compiled into the browser
bundle and bypasses RLS for every visitor.

`src/lib/runtimeConfigIdentity.test.js` fails the build if a mismatched
`(url, anonKey)` pair is ever committed again.

### 3. `c2ec699` — fix the probe's own false positive

**This one was our bug.** The key check called `GET /rest/v1/`, the
PostgREST OpenAPI root — which Supabase **closed to anon keys** on
11 Mar 2026 (new projects) and 8 Apr 2026 (all). It refuses every anon
key by design with `"Secret API key required"`. The probe read that
refusal as proof the key was wrong and reported an **already-fixed**
staging environment as critically down.

Two changes: ask `/auth/v1/settings` (which accepts anon keys), and —
the part that prevents a repeat — **classify the refusal instead of
assuming it**. Only a body actually saying `invalid api key` counts as a
bad key; a privilege requirement or any unrecognised message reports the
key as *unverified* and leaves the component up.

### 4. `d4b7a3c` — show which env var won, and catch cross-project drift

An audit for hardcoded values found **none reaching the functions**:
`netlify.toml` declares no `[context.*.environment]` blocks, no `.env` is
committed, `api.datiq.app` is in no JS bundle, and the project URLs in
`public/runtime-config.js` are a browser-only static asset the functions
never load.

What was missing was the ability to *see* that. `detail` now carries
`url` and `urlSource`, because the value can legitimately arrive from the
`VITE_SUPABASE_URL` fallback when the variable you edited is unset,
**scoped to Builds instead of Functions**, or set on a different deploy
context.

Also added the check one level up: `SUPABASE_URL` vs `VITE_SUPABASE_URL`
(and the two anon keys) are set independently and nothing compared them.
If they name different projects, the browser gets its session from one
and the functions validate it against the other — every signed-in
request fails while both values look individually correct.

## The root causes, and why it took four passes

1. **Staging** — the anon key committed in `public/runtime-config.js` was
   issued for project `aubwooslkk·y·prdxuiyvj` while its URL said
   `aubwooslkk·r·prdxuiyvj`. **One character, position 11.** The `y`
   spelling appeared *nowhere* in the repo as text — only base64-encoded
   inside the JWT — so reading the file could never reveal it. That file
   is also the documented source operators copy into Netlify, so the
   wrong key propagated into the environment.
2. **Production** — `SUPABASE_URL` was `https://api.datiq.app`, a custom
   **auth** domain that fronts `/auth/v1` only, leaving every `/rest/v1`
   call the functions make with nothing behind it.
3. **The probe itself** — see `c2ec699` above.

## Two transferable lessons

- **Compare the key to the URL before trusting any error message.** It is
  free, needs no network, and would have ended this on day one. When a
  Supabase call fails with `Invalid API key`, check the two refs FIRST —
  it is almost never the token.
- **Classify a rejection; never assume it.** "This key is invalid" and
  "this endpoint needs a more privileged key" are different findings, and
  collapsing them is what turned a green environment red. The probe now
  honours the rule its own file states: *"we did not ask" is never "it is
  down"*.

## Current state (verbatim)

```
main:    4ad289a Merge branch 'staging'
staging: d4b7a3c fix(health): show which env var supplied the Supabase URL, ...
branch:  integration-and-environment-fixes @ d4b7a3c (same content)
git diff origin/main origin/staging  →  empty
```

| Gate | Result |
|---|---|
| Unit + contract + integration + system | **3405 passed / 14 skipped** |
| `npm run build` | clean |
| `node scripts/security-check.mjs` | clean |
| `npm run test:db` | 22 migrations · 106 assertions · 0 failed |
| Release readiness | 5 pass · 2 warn · 0 fail (warns pre-existing: screenshot staleness, gallery coverage) |
| Staging Gate `31700719683` | success |
| Phase-Gate `31701256130` | success — deployed + smoked + re-locked |

## Files added/modified this session

**Added**
- `netlify/__tests__/supabaseServerClient.test.js`
- `netlify/__tests__/supabaseIdentity.test.js`
- `netlify/__tests__/healthProbes-supabase-auth.test.js`
- `src/lib/runtimeConfigIdentity.test.js`
- `src/pages/Preview.emptyEnrichment.test.js`

**Modified (core)**
- `netlify/functions/lib/supabaseServerClient.js` — the shared client,
  env resolution, `decodeSupabaseKey`, `diagnoseSupabaseIdentity`
- `netlify/functions/lib/healthProbes.js` — `probeSupabaseAuth`
- `netlify/functions/lib/requireEntitlement.js`
- `netlify/functions/integrations-{slack,airtable,notion,zapier,hubspot}.js`
- `netlify/functions/{extractions,schedules,invoice-email,invoice-pdf}.js`
- `netlify/functions/extract.js` — `_enrichment.reason`
- `src/lib/firecrawlService.js`, `src/components/ExtractionProvider.jsx`,
  `src/pages/Preview.jsx`, `src/lib/config.js`
- `public/runtime-config.js` — wrong staging key removed, precedence
  comment corrected
- `netlify.toml` — `SUPABASE_ANON_KEY` added to `SECRETS_SCAN_OMIT_KEYS`
- `CLAUDE.md` §5/§6 of the auth section, and
  `docs/SESSION-HANDOFF-2026-07-29-OAUTH-CALLBACK-FIX.md` §4 (the
  "project-mismatch — still pending" section is now marked resolved)

## Next session — recommended entry point

```bash
# 1. Confirm the env fix actually landed (this is the only open item)
#    /admin/health → "Supabase auth (GoTrue)" card, in BOTH contexts.
#    It now prints url, urlSource, urlRef, keyRef.
#      - urlRef must equal keyRef
#      - url must be the *.supabase.co project URL, NOT api.datiq.app
#      - if urlSource reads VITE_SUPABASE_URL when you set SUPABASE_URL,
#        that variable's SCOPE excludes Functions, or it is set on a
#        different deploy context

# 2. Then re-test the two features end to end
#    - Account → Integrations → Connect (any provider)
#    - Preview → each of the 5 Quick-enrichment buttons
#    - Airtable push, single and batch

# 3. Branch `integration-and-environment-fixes` is fully merged into
#    both staging and main and can be deleted.
```

## Outstanding operator actions

None block a fresh session; all are Netlify-side values the code cannot set.

- **Verify the Supabase env fix landed.** Production deployed at 12:58Z,
  so `/admin/health` reflects the live values now. See step 1 above.
- **Staging's anon key now lives only in Netlify.** `runtime-config.js`
  carries `""` for it deliberately — `src/lib/config.js` falls back to the
  build-time `VITE_SUPABASE_ANON_KEY`. To restore the belt-and-braces
  copy, paste the key for project `aubwooslkkrprdxuiyvj`; the guard test
  verifies whatever is put there belongs to its project.
- **At least one AI provider key** — `GEMINI_API_KEY`, `AI_API_KEY` or
  `OPENAI_API_KEY`. Still believed unset, and the likely reason Quick
  enrichment returns nothing. The tabs now say so explicitly rather than
  rendering a blank panel, so this is verifiable in one click.
- **Netlify env changes need a redeploy.** Values are baked in per deploy;
  editing one in the UI does not affect the already-published deploy.
- Two names typed as `VITE_SUPBASE_URL` and `SSUPBASE_SERVICE_KEY` in an
  earlier message — if those are the literal variable names in Netlify,
  they are misspelled and silently ignored.
