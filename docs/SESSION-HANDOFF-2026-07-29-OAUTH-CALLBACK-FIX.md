# DatIQ — OAuth callback URL cleanup + Supabase project-mismatch fix

**Date:** 2026-07-29 (initial), 2026-07-29 updated with scanner fix
**Branch:** `staging`
**Status:** Code shipped (2 commits, both on staging). **Operator action required** for production deploy (see §3).

---

## 1. The bugs

Two distinct bugs presented as the same symptom ("user can't log in"):

### Bug A — OAuth callback URL doesn't get cleaned

After Google/Microsoft/GitHub sign-in the browser lands on
`datiq.app/#access_token=eyJ…&refresh_token=…&provider_token=…&…` and
the hash never gets cleaned. Even when the OAuth flow succeeds, the
user is left staring at a token-bearing URL in their address bar.

The Supabase auth-js v2 client (v2.45.4) is supposed to strip the
auth fragment on its own inside `_initialize()` (GoTrueClient.js:3193),
but it only does that if the project the tokens were issued by
matches the project the client is configured with. When they don't
match, the auto-init bails silently, the hash sticks, and no session
is established.

### Bug B (the real production killer) — Netlify secret scanner strips the anon key

The production bundle shipped
`VITE_SUPABASE_ANON_KEY:\`****************uqwM\`` — the actual anon
key was being **redacted by the Netlify secret scanner's "smart
detection"** because a Supabase anon key looks like a JWT.

Result: the `supabase` client was created with an invalid key, OAuth
callbacks couldn't validate the session, and the user appeared
unlogged in production. Staging was unaffected because the scanner
flagged the prod value (which contains a different last-4 fingerprint
than staging) and not the staging value.

Same false-positive class applied to the n8n webhook URL.

### How I confirmed Bug B was the real issue

I diffed the production and staging bundles side by side:

| Bundle | `VITE_SUPABASE_URL` | `VITE_SUPABASE_ANON_KEY` |
|---|---|---|
| `datiq.app` (production) | `https://sikkfxysjhirmtwkumpt.supabase.co` | `****************uqwM` ← **stripped** |
| `staging.datiq.app` | `https://aubwooslkkrprdxuiyvj.supabase.co` | `eyJhbGciOiJIUzI1NiIs…` ← full |

The URL was correct in both bundles. The anon key was redacted only
in production. The fingerprint `uqwM` matches the last 4 chars of the
prod anon key in `scripts/env/production.env` — that's the Netlify
scanner's redaction pattern (`****************<last4>`).

---

## 2. What this PR fixes (code)

Two commits, both on `staging`:

### 2.1 Commit `13a1a07` — PKCE + URL cleanup

**`src/lib/supabaseClient.js`** — force PKCE flow. The Supabase
auth-js v2 default `flowType` is `'implicit'`, which puts the tokens
in the URL hash. We now pass `flowType: 'pkce'` explicitly, so the
Supabase server returns a short-lived `?code=…` in the query string
and the client exchanges the code locally. The Supabase client always
cleans the `?code=` parameter after the exchange (GoTrueClient.js:3152)
— so the URL ends up clean even if §3's project-mismatch fix isn't
applied yet.

**`src/components/AuthProvider.jsx`** — defensive URL cleanup on
mount. Detects any auth-shaped hash or query (`#access_token=`,
`#refresh_token=`, `?code=`, `#error=`, `#type=recovery`), strips it
via `window.history.replaceState`, and (for success-shaped callbacks
that produced no session) surfaces a clear error in the auth modal.
The existing `#error=` path is preserved unchanged.

**Tests** — 4 new cases in `AuthProvider.integration.test.jsx` and
an updated `supabaseClient.test.js` U-71.

### 2.2 Commit `b347bf9` — Stop the scanner from stripping the anon key

**`netlify.toml`** — add `SECRETS_SCAN_OMIT_KEYS` listing
`VITE_SUPABASE_ANON_KEY` and `VITE_WEBHOOK_URL`. This is the primary
fix. Per Netlify's docs the scanner leaves env-var values alone when
their name is on this list. The anon key is the documented
*publishable* key (RLS protects data, not the key itself).

**`public/runtime-config.js` + `src/lib/config.js`** — defense in
depth. `public/runtime-config.js` is already in
`SECRETS_SCAN_OMIT_PATHS`, so the scanner never touches it. We add
the Supabase URL and anon key (one per project, env-aware via
`location.hostname`) as a runtime fallback. `config.js` detects the
scanner's redaction pattern (`****************<last4>`) and prefers
the runtime value when the build-time value matches it. This lets a
stripped build still log users in **without waiting for a redeploy
with the new toml config** — critical for getting prod back online
fast.

**`scripts/netlify-toml.test.mjs`** — guard tests for netlify.toml
so the scanner config and the no-`[context.*.environment]`
invariant are enforced by the test suite, not just by code review.
We lost hours to a previous regression of the same shape; this
prevents the next one.

**`src/lib/config.test.js`** — 4 new cases for the redaction
detection and the runtime-config fallback.

---

## 3. Deployment — **operator action required**

The two commits on `staging` are good. To get them into production:

1. **Open a PR from `staging` → `main`.** Standard flow — phase-gate
   workflow will run `test` + `smoke-staging`, then wait for your
   manual approval before deploying to production.
2. **After the production deploy lands**, the anon key will be
   unstripped in the bundle and OAuth will work. Verify with:
   ```bash
   curl -s https://datiq.app/assets/usageRepo-*.js \
     | grep -oE "VITE_SUPABASE_ANON_KEY:\`[^\`]+\`"
   # Should now print the full eyJ… key, not the redacted stars.
   ```
3. **If you need a faster fix on production** (without waiting for
   the PR/phase-gate), the runtime-config.js fallback in
   `b347bf9` means a hot-patch to `public/runtime-config.js`
   alone (no rebuild) is enough to restore login — but the
   netlify.toml fix should still land to prevent the redaction
   from recurring on every future prod build.

The Supabase project-mismatch issue (different Supabase project for
prod vs staging, with the OAuth callback going to prod's
`api.datiq.app`) is a **separate** problem and may still need a
dashboard fix on the staging Supabase project. See §4.

---

## 4. The Supabase project-mismatch — still pending

The code changes above fix the **scanner-stripping** and the **URL
cleanup**. They do NOT fix the deeper "staging can't validate
sessions" issue, which is a **Supabase project-mismatch** problem:

| Surface | What it points to |
|---|---|
| `api.datiq.app/auth/v1/callback` (the OAuth redirect_uri sent to Google) | the **prod** Supabase project — ref `sikkfxysjhirmtwkumpt` (the original `DatIQ-prod`, see `supabase/.temp/linked-project.json`) |
| `scripts/env/production.env` `VITE_SUPABASE_URL` | `https://sikkfxysjhirmtwkumpt.supabase.co` — same project ✓ |
| `scripts/env/staging.env` and local `.env` `VITE_SUPABASE_URL` | `https://aubwooslkkrprdxuiyvj.supabase.co` — a **different** project ✗ |
| Staging deploy's Netlify env (production context) | TBD — set in the Netlify UI, not in git |

The Supabase auth server at `api.datiq.app` (custom domain mapped to
`https://sikkfxysjhirmtwkumpt.supabase.co`) issues a JWT with
`iss: https://sikkfxysjhirmtwkumpt.supabase.co/auth/v1`. The Supabase
client in the browser, on the other hand, is initialized with whichever
project ref the Netlify env's `VITE_SUPABASE_URL` points to.

**If staging's Netlify env is `aubwooslkkrprdxuiyvj`** (the new dev
project), then the JWT issued by the prod project's auth server will
not validate, the session will not be created, and the user will
appear unlogged. The AuthProvider now surfaces this as a friendly
error, but the user still can't sign in.

**Operator fix (one of):**

1. **Recommended — add a custom auth domain to the staging Supabase
   project.** In the `aubwooslkkrprdxuiyvj.supabase.co` dashboard →
   Authentication → URL Configuration → add a custom auth domain like
   `api-staging.datiq.app` (or whatever you want to use), then in DNS
   point it at the Supabase auth CNAME. Then in Google Cloud Console,
   add `https://api-staging.datiq.app/auth/v1/callback` as a new
   authorized redirect URI on the same OAuth client. The
   `signInWithOAuth` call doesn't need to change — Supabase picks the
   correct callback from its own config. The user lands on the
   staging Supabase project's session, which validates cleanly.

2. **Use the default Supabase auth URL on staging.** Stop using
   `api.datiq.app` for staging — use the default
   `https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback` instead.
   This means updating the Google Cloud Console OAuth client to add
   that URL as a second authorized redirect URI, and possibly changing
   the Supabase provider's "Callback URL" in its own dashboard. Less
   work but less consistent (the prod URL stays custom, the staging
   URL is the default).

3. **Single Supabase project for both prod and staging.** Cheapest
   short-term, but loses the isolation that the NETLIFY-ENVIRONMENTS
   split was designed to give you. **Not recommended.**

The same fix applies to **Microsoft (Azure)** and **GitHub** — they
all go through the same `api.datiq.app/auth/v1/callback` Supabase
proxy, so the same project mismatch would affect all three providers.

---

## 5. Verification

After the deploy:

1. **Build:** `npm run build` — clean.
2. **Tests:** `npx vitest run --root . --exclude '.claude/**'` —
   185 files, 2513 tests, 1 pre-existing failure
   (`netlify/__tests__/invoice-pdf.test.js` "503s when Supabase is
   not configured" — unrelated, fails on `main` and `staging`
   alike).
3. **Anon key in production bundle:**
   ```bash
   curl -s https://datiq.app/assets/usageRepo-*.js \
     | grep -oE "VITE_SUPABASE_ANON_KEY:\`[^\`]+\`"
   ```
   Should print the full `eyJ…` key, not `****************uqwM`.
4. **URL cleanup:** Click "Continue with Google" on
   `staging.datiq.app`, complete the OAuth, watch the address bar.
   URL ends up as `https://staging.datiq.app/` (or the post-auth
   route) with no hash and no query.
5. **Microsoft / GitHub:** Same flow, same code path, same
   behaviour.

---

## 6. Files changed

```
modified:   netlify.toml                                 (commit b347bf9)
modified:   public/runtime-config.js                     (commit b347bf9)
modified:   src/lib/config.js                            (commit b347bf9)
modified:   src/lib/config.test.js                       (commit b347bf9)
new file:   scripts/netlify-toml.test.mjs                (commit b347bf9)
modified:   src/components/AuthProvider.jsx              (commit 13a1a07)
modified:   src/components/AuthProvider.integration.test.jsx  (commit 13a1a07)
modified:   src/lib/supabaseClient.js                    (commit 13a1a07)
modified:   src/lib/supabaseClient.test.js               (commit 13a1a07)
new file:   docs/SESSION-HANDOFF-2026-07-29-OAUTH-CALLBACK-FIX.md  (this file)
```

No Netlify function code, no SQL migrations, no new dependencies.
