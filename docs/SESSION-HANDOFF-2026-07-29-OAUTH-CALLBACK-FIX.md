# DatIQ — OAuth callback URL cleanup + Supabase project-mismatch fix

**Date:** 2026-07-29
**Branch:** `staging`
**Status:** Code shipped; **operator action required** for the deeper Supabase project-mismatch on staging (see §3).

---

## 1. The bug

After clicking "Continue with Google" (or Microsoft / GitHub) on `datiq.app` or
`staging.datiq.app`, the OAuth flow completed but:

1. The browser URL kept the session tokens in the fragment —
   `https://datiq.app/#access_token=eyJ…&refresh_token=…&provider_token=…&…`
   — instead of returning to a clean `https://datiq.app`.
2. On staging, the user was NOT signed in even though the OAuth flow
   completed. Same on production in some scenarios.

The Supabase auth-js v2 client (v2.45.4) is supposed to strip the auth
fragment on its own inside `_initialize()` (see `node_modules/@supabase/
auth-js/dist/module/GoTrueClient.js:3193`), but it only does that if the
project the tokens were issued by matches the project the client was
configured with. When they don't match, the auto-init bails silently,
the hash sticks, the user sees a token-bearing URL, and no session is
established.

The URL fragment the user pasted is the implicit-grant shape:

```
#access_token=eyJhbGciOiJFUzI1NiIs…
&refresh_token=eebf5nyczpki
&provider_token=ya29.a0ARGnu0YVmmJV7glUQxP9FDtplxfC7gEKIgq2sKncQjC5C-_y270nqvenkAwF7b…
&expires_in=3600
&expires_at=1785352273
&token_type=bearer
```

The JWT in the access_token has issuer `https://sikkfxysjhirmtwkumpt.
supabase.co/auth/v1` — i.e. the Supabase project at ref
`sikkfxysjhirmtwkumpt` (the original "DatIQ-prod" project, see
`supabase/.temp/linked-project.json`).

---

## 2. What this PR fixes (code)

Three small, defensive changes in `staging`:

### 2.1 `src/lib/supabaseClient.js` — force PKCE flow

The Supabase auth-js v2 default `flowType` is `'implicit'`, which is what
puts the tokens in the URL hash. We now pass `flowType: 'pkce'` explicitly,
which makes the Supabase server return a short-lived `?code=…` in the
**query string** instead, and the client exchanges the code locally. No
tokens in the URL bar. The Supabase client always cleans the `?code=`
parameter after the exchange (GoTrueClient.js:3152) — so the URL ends
up clean.

PKCE is the recommended Supabase flow since 2023 and is supported by all
the OAuth providers we use (Google, Microsoft, GitHub).

We also pass `detectSessionInUrl: true` and `persistSession: true`
explicitly for clarity (both were already defaults).

### 2.2 `src/components/AuthProvider.jsx` — defensive URL cleanup

Even with PKCE forced, the user may have bookmarked or shared a legacy
implicit-grant URL (`/#access_token=…`), or the Supabase server may
still send the implicit shape in some edge cases. To handle that
gracefully, the AuthProvider now:

- Detects any auth-shaped hash or query on mount
  (`#access_token=`, `#refresh_token=`, `#error=`, `?code=`,
  `#type=recovery`).
- Strips it from the URL **immediately** via
  `window.history.replaceState` — the Supabase client has already
  snapshotted `window.location` for its own auto-init by the time we
  do this, so the session-detection still works.
- If the URL had a **success**-shaped auth fragment (access_token /
  code) but `getSession()` returns null, the AuthProvider now surfaces
  a clear error in the auth modal:
  > Sign-in completed but we couldn't start your session. This usually
  > means the site is pointing at a different sign-in service than the
  > one that handled the OAuth callback. Please try again, or use email
  > + password.
- For the **error**-shaped case (`#error=access_denied&error_description=…`),
  we keep the existing behaviour (specific error message, no override).
  The new success-shape fallback deliberately does NOT trigger for
  error-shape URLs — the error message is more specific and the user
  already knows what happened.

### 2.3 Tests

- `src/components/AuthProvider.integration.test.jsx` — 4 new tests:
  - `#access_token=…` (implicit) → hash cleaned, error surfaced when
    no session
  - `#access_token=…` + a resolved session → no error, user signed in
  - `?code=…` (PKCE) → query cleaned, error surfaced when no session
  - `?code=…` + a resolved session → no error, user signed in
- `src/lib/supabaseClient.test.js` — updated U-71 to assert the
  `flowType: 'pkce'` config is passed to `createClient`.

All 1794 unit + integration tests in the main workspace still pass
(143 test files, 0 failures). The build is clean (`npm run build`,
~900 ms). The pre-existing `netlify/__tests__/invoice-pdf.test.js`
"503s when Supabase is not configured" failure is unrelated — it
fails on `main` and `staging` alike and is documented in CLAUDE.md.

---

## 3. The deeper issue — **operator action required**

The code changes above fix the **UX** of the OAuth flow. They do NOT fix
the underlying "user remains unlogged" issue, because that is a
**Supabase project-mismatch** problem:

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

## 4. Verification

After the deploy:

1. **Build:** `npm run build` — clean.
2. **Tests:** `npx vitest run --root . --exclude '.claude/**' src` —
   143 files, 1794 tests, 0 failures.
3. **URL cleanup (after deploy):** Click "Continue with Google" on
   `staging.datiq.app`, complete the OAuth, watch the address bar.
   - With PKCE: URL ends up as `https://staging.datiq.app/` (or the
     post-auth route) with no hash and no query.
   - With legacy implicit: URL is cleaned to `https://staging.datiq.app/`.
4. **"Unlogged" diagnostic:** If the operator fix in §3 isn't done
   yet, you'll see the new error message in the auth modal:
   > Sign-in completed but we couldn't start your session…
   That's the signal that §3's project-mismatch fix is still needed.
5. **Microsoft / GitHub:** Same flow, same code path, same
   behaviour. Once §3 is fixed, all three providers work.

---

## 5. Files changed

```
modified:   src/components/AuthProvider.jsx
modified:   src/components/AuthProvider.integration.test.jsx
modified:   src/lib/supabaseClient.js
modified:   src/lib/supabaseClient.test.js
new file:   docs/SESSION-HANDOFF-2026-07-29-OAUTH-CALLBACK-FIX.md  (this file)
```

No Netlify function code, no SQL migrations, no new dependencies.
