# Supabase Auth — Redirect URLs Master List

> **When to use this:** every time you add a new deployment URL (new branch
> deploy, new custom domain, new OAuth provider), copy the relevant rows
> below into the platform config. Without these, sign-in / sign-up /
> password-reset will silently redirect users to the wrong place (or fail
> outright).
>
> **Last updated:** 2026-08-10
> **Aligned with:** `public/runtime-config.js` v3 (main-only-prod routing)

---

## 1. The two Supabase projects

| Project | Project ref | Custom auth domain | Used by |
|---|---|---|---|
| **Production** | `sikkfxysjhirmtwkumpt` | `api.datiq.app` (CNAME → Supabase) | `datiq.app`, `www.datiq.app`, `main--datiqapp.netlify.app` |
| **Staging / dev** | `aubwooslkkrprdxuiyvj` | _(none — uses the project URL directly)_ | `staging.datiq.app`, `staging--datiqapp.netlify.app`, **all branch deploys**, `localhost:5173` |

The runtime-config decision is: **only `main` uses production**. Everything
else (staging, branch deploys, localhost) uses the staging project, which
has no custom auth domain — so the OAuth callback lands the user on whatever
branch they came from.

---

## 2. Supabase Dashboard — Additional Redirect URLs

Go to **Supabase Dashboard** → **Authentication** → **URL Configuration** →
**"Additional Redirect URLs"**. Add the values below per project.

### 2a. Production project (`sikkfxysjhirmtwkumpt`)

```
https://datiq.app
https://datiq.app/**
https://www.datiq.app
https://www.datiq.app/**
https://main--datiqapp.netlify.app
https://main--datiqapp.netlify.app/**
https://api.datiq.app/auth/v1/callback
```

> **Note:** The OAuth flow goes through `api.datiq.app/auth/v1/callback`
> (the custom auth domain). Adding this URL to the production project's
> allowlist ensures Supabase's own callback works.

### 2b. Staging project (`aubwooslkkrprdxuiyvj`)

```
http://localhost:5173
http://localhost:5173/**
https://staging.datiq.app
https://staging.datiq.app/**
https://staging--datiqapp.netlify.app
https://staging--datiqapp.netlify.app/**
https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback
```

> **Per-branch wildcard (for ANY branch deploy, including future ones):**
>
> Supabase supports wildcards in this list. Add this single line and every
> `*--datiqapp.netlify.app` branch deploy will be allowed automatically —
> no need to add a new URL for every branch:
>
> ```
> https://*--datiqapp.netlify.app/**
> ```
>
> You can leave it as a wildcard OR add specific branches (recommended for
> audit clarity):
>
> ```
> https://integration-with-outside-ecosystem--datiqapp.netlify.app
> https://integration-with-outside-ecosystem--datiqapp.netlify.app/**
> https://workflow-implementation-and-optimization--datiqapp.netlify.app
> https://workflow-implementation-and-optimization--datiqapp.netlify.app/**
> ```

---

## 3. Google Cloud Console — Authorized Redirect URIs

Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services**
→ **Credentials** → your OAuth 2.0 Client ID (the one used for DatIQ sign-in)
→ **"Authorized redirect URIs"**.

**Exact URIs only (no wildcards — Google does not support them).**

```
https://api.datiq.app/auth/v1/callback
https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback
https://sikkfxysjhirmtwkumpt.supabase.co/auth/v1/callback
```

> **What each is for:**
>
> - `api.datiq.app/auth/v1/callback` — used when the production project
>   is hit through the custom auth domain (main → prod → custom domain).
> - `aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback` — used when
>   staging, branch deploys, or localhost hit the staging project directly
>   (no custom domain).
> - `sikkfxyslhirmtwkumpt.supabase.co/auth/v1/callback` — fallback if
>   someone ever bypasses the custom auth domain and hits the production
>   project directly (e.g. during a DNS outage). Optional but safe to
>   include.

---

## 4. Microsoft Azure AD — Redirect URIs

Go to [Azure Portal](https://portal.azure.com) → **App registrations** →
your app → **Authentication** → **"Redirect URIs"** (or **"Web"** platform
config).

**Exact URIs only (Microsoft does not support wildcards in this list).**

```
https://api.datiq.app/auth/v1/callback
https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback
https://sikkfxysjhirmtwkumpt.supabase.co/auth/v1/callback
```

(Same as Google — one per Supabase project + the custom domain for production.)

---

## 5. GitHub OAuth App — Authorization callback URL

Go to [github.com/settings/developers](https://github.com/settings/developers)
→ **OAuth Apps** → your DatIQ app → **"Authorization callback URL"**.

**One URL only (GitHub only allows one callback per OAuth app).** Use the
**production** project's callback — branch deploys using GitHub auth will
flow through the same OAuth app:

```
https://api.datiq.app/auth/v1/callback
```

> **Why the production one?** GitHub OAuth apps allow exactly ONE
> authorization callback URL. The custom auth domain (`api.datiq.app`) is
> what production uses; staging / branch deploys use the staging project's
> direct URL and DON'T go through GitHub OAuth in the typical flow (you'd
> add a second GitHub OAuth app for staging if you need branch-deploy
> GitHub sign-in).

---

## 6. Apple, Facebook, Twitter/X, etc.

If you add more OAuth providers in the future, follow the same pattern:
**one Supabase callback URL per Supabase project (or the custom domain for
production)**. Add to both the provider's developer console AND Supabase's
"Additional Redirect URLs" list.

---

## 7. Verification checklist

After updating any of the above:

- [ ] **Sign in with Google on `https://datiq.app`** → should land back on `datiq.app`
- [ ] **Sign in with Google on `https://staging.datiq.app`** → should land back on `staging.datiq.app`
- [ ] **Sign in with Google on `https://integration-with-outside-ecosystem--datiqapp.netlify.app`** → should land back on that branch URL (not `datiq.app`)
- [ ] **Sign in with email + password** on each of the three URLs → no redirect involved, but should land on `/dashboard` or wherever
- [ ] **Click "forgot password" on the branch URL** → email link should redirect back to the branch URL
- [ ] **Sign-up confirmation email** on the branch URL → email link should redirect back to the branch URL

If any of these dump you on `datiq.app` when you started on the branch
URL, the Supabase "Additional Redirect URLs" allowlist is missing that
URL. Add it (or add the wildcard `https://*--datiqapp.netlify.app/**`).

---

## 8. Why this is needed — the underlying flow

For a Google sign-in attempt originating on the branch URL
`https://integration-with-outside-ecosystem--datiqapp.netlify.app`:

```
1. SPA (on branch URL)
   → supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: branch URL } })
2. Supabase client (configured to staging project via runtime-config.js)
   → 302 redirect to https://accounts.google.com/o/oauth2/v2/auth?...
        (with state=...&redirect_uri=https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback)
3. Google
   → user authenticates → 302 to https://aubwooslkkrprdxuiyvj.supabase.co/auth/v1/callback?code=...
4. Supabase GoTrue
   → exchanges code for session
   → 302 to the `redirect_to` from step 1 (i.e. the branch URL)
5. Browser arrives back on the branch URL with the session
   → Supabase client picks up the session, AuthProvider sees the user
```

Steps 1, 4, 5 are URL/routing. Step 2 is the **Google → Supabase callback**
(needs the Google allowlist). Step 3 is the **Supabase → user callback**
(needs the Supabase "Additional Redirect URLs" allowlist).

**The chain only works if BOTH allowlists are configured.** If either
is missing, the user gets dumped to the Supabase primary URL
(`datiq.app` if the project has a custom auth domain, otherwise the
project's default URL).

---

## 9. Operator runbook — adding a new branch

When you push a new branch and Netlify creates a new branch deploy:

1. Wait for the build to complete.
2. **No action needed** if you added the wildcard
   `https://*--datiqapp.netlify.app/**` to the staging project's
   Additional Redirect URLs (per §2b above). The branch works
   immediately.
3. **If you didn't add the wildcard**: open Supabase Dashboard →
   Authentication → URL Configuration → Additional Redirect URLs → add
   `https://<branch-name>--datiqapp.netlify.app` and `**`.
4. Verify by signing in with Google on the branch URL.

---

## 10. Reference — current runtime-config decision (v3, 2026-08-10)

```js
// Only the main branch uses the production Supabase project.
// Everything else (staging, branch deploys, localhost) uses staging.
var _isMain =
  location.hostname === "datiq.app" ||
  location.hostname === "www.datiq.app" ||
  location.hostname === "main--datiqapp.netlify.app";

window.__DATIQ_RUNTIME__.supabaseUrl = _isMain
  ? "https://sikkfxysjhirmtwkumpt.supabase.co"   // production
  : "https://aubwooslkkrprdxuiyvj.supabase.co"; // staging

window.__DATIQ_RUNTIME__.authReturnUrl = _isMain
  ? "https://datiq.app"     // main → production primary
  : window.location.origin; // everyone else → their own branch
```

If you ever need a different routing rule (e.g. a "demo" deployment
that uses the production Supabase project but a different auth domain),
extend `_isMain` and the `authReturnUrl` ternary in `public/runtime-config.js`,
then redeploy.
