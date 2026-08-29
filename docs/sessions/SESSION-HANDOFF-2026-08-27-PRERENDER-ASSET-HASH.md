# Session handoff — 2026-08-27 — the prerendered pages pointed at a bundle that was never deployed

**Outcome:** `UI-UX-and-discoverability-improvement` merged to `staging` (PR #118), which
immediately broke every page on staging; root-caused and fixed (PR #119); staging
re-verified working in a real browser. `main` untouched throughout — it is 23 behind
`staging` and still carries the latent defect.

| | |
|---|---|
| `origin/staging` | `34d5925` — deploy `ready`, verified live |
| `origin/main` | `24985b0` — untouched, 23 behind staging |
| PRs merged | [#118](https://github.com/vikashkaruna/scrapelite/pull/118) (feature), [#120](https://github.com/vikashkaruna/scrapelite/pull/120) (owner's, Staging Gate), [#119](https://github.com/vikashkaruna/scrapelite/pull/119) (this fix) |
| Open PRs | none |

---

## 1. What happened

The branch merged to `staging` and deployed clean. The site then rendered the home page
and **nothing on it worked** — no menu behaviour, no buttons, no clicks, on every page.

The deploy was `ready`. No build error. Every network request returned **200**.

## 2. Root cause

React never booted, because the entry bundle was not in the deploy.

```
/assets/index-rca5ZB4w.js   → 200, content-type: text/html,  11,399 bytes   ← SPA fallback
/assets/index-DGSNIGj5.css  → 200, content-type: text/css,  351,076 bytes   ← fine
/assets/apiClient-…js       → 200, application/javascript,    2,760 bytes   ← fine
```

The deployed `index.html` referenced `index-BZ2xIuwZ.js`. The committed prerendered pages
hardcoded `index-rca5ZB4w.js`. That file does not exist in the deploy, so the SPA fallback
(`/*` → `/index.html`, status 200) answered the request **with HTML**. The browser refuses
to execute a module script served as `text/html`, so `main.jsx` never ran.

Confirmed on the live site: no React fibers on `#root` or on any button; clicking
`Discover` did not navigate; the theme toggle did not toggle.

### Why the hashes differed

`public/<route>/index.html` is generated locally and **committed** (deliberately — so a
deploy can never fail on a Chromium download). Each page carries the `<script>`/`<link>`
tags of the build it was rendered against, and Vite asset filenames are **content-hashed**.

Netlify runs its own `npm run build` with the site's **19 `VITE_*` variables** inlined into
the bundle. Different bytes → different hash → different filename.

**This is not the "forgot to re-run `npm run prerender`" staleness documented twice before.**
The committed hashes can *never* be relied on to match a Netlify build. The earlier fixes
(regenerate and commit) only appeared to work because they compared a local build against a
local build.

⚠️ **Only the two config-inlining chunks diverged** — the entry and `supabaseClient`.
`index-*.css` and `apiClient-*.js` hashed **identically**. A partial match is what made this
survive review: three of four references resolved.

### Why `/` made it fatal

Before this branch, `/` served Vite's own `dist/index.html`, whose tags are written *by the
build* and are therefore always correct. This branch moved `/` to the committed prerendered
`public/home/index.html` behind a forced 200 rewrite. The same defect had been live on the
22 marketing pages for months; making the homepage a prerendered file is what turned a
degraded-SEO bug into a dead application.

### Why every gate stayed green

`scripts/check-prerender-assets.mjs` scanned **`public/`** and checked those references
against a **local `dist/`** — two copies of the same local build. It passes regardless of
what ships, and it was green throughout this incident (23 pages, 92 refs, all present).
`npm run build` was `vite build` alone, so nothing reconciled the references at deploy time.

## 3. The fix (PR #119)

**`scripts/sync-prerender-assets.mjs`** — new; runs after `vite build` as part of
`npm run build`. Repoints every `/assets/` reference in `dist/` to the filename this build
actually produced, matched by logical chunk name. **Fails the build** on an unresolved or
ambiguous reference; writes nothing unless every reference on every page resolves, because a
half-repointed set of pages is harder to diagnose than a stopped build.

`public/` is deliberately **not** rewritten. Those files stay the reviewable source of the
prerendered *content*; their asset hashes simply stop being load-bearing.

**`scripts/check-prerender-assets.mjs`** — now scans `dist/`, the artifact that reaches
visitors, instead of `public/`.

### Verified

| Scenario | Sync | Gate |
|---|---|---|
| Local build (hashes already match) | 0 references repointed | ✓ 23 pages, 92 refs |
| Build with staging's env (divergent) | 46 repointed across 23 pages | ✓ 23 pages, 92 refs |

Full pre-push gate green in 53s: readiness, unit **2336 / 140 files**, contract, integration,
system, db, build, prerender, security. `scripts` suite 173/173.

**Live re-verification after deploy** (real browser, not the deploy status):
entry is `index-BZ2xIuwZ.js`, `content-type: application/javascript`, 1,232,294 bytes;
React fiber attached to `#root`; `/` → `/discoverability` on click; theme light → dark.

## 4. Traps worth carrying

🔴 **A SPA catch-all rewrite turns every missing asset into a 200 of HTML.** It converts a
loud 404 into a silent MIME refusal. "All requests are 200" is *not* evidence the assets
exist — check `content-type`.

🔴 **Vite's content hash is base64url and can contain `-`.** The first version of the sync
script split the chunk stem at its last dash and mangled `supabaseClient-BzPp-WeK` into
`supabaseClient-BzPp`. The misparse is invisible whenever both hashes happen to be dash-free
and appears at random when one is not. It is caught only by testing the *divergent* path,
not the happy one. The script now matches the hash as a fixed-width suffix.

⚠️ **`netlify serve` serves a cached snapshot, not live `dist`.** An early "reproduction"
this session (`/` → 404) was entirely an artifact of that; it was caught by editing a file on
disk and watching the response *not* change. Verify the tool before trusting the symptom.

⚠️ **`netlify build --context <ctx>` locally does not inject the site's UI environment
variables.** It reproduced the local hash, not the deployed one, and briefly supported the
wrong conclusion that staging was healthy. Deployed evidence beats a local build.

⚠️ **`staging.datiq.app` is 401 for any browser without a Netlify session.** The live
diagnosis was only possible through the owner's own logged-in Chrome. Plan for this before
trying to debug a branch deploy.

⚠️ **The pre-push hook runs with whatever Node is on `PATH`.** The shell default here is
**v26.7.0** against a pinned `>=24 <25`; the hook failed `test:unit` on that alone. Run
`nvm use 24` *before* `git push`. Do not reach for `--no-verify` — this repo has an incident
about exactly that.

## 5. State and open items

- **`main` still carries this defect** for its 22 marketing pages. It is not fatal there
  (`/` still serves Vite's own entry on `main`), but it should land before the next
  production deploy — and **must** land before `/`-prerendering reaches `main`.
- **Migration `0032_account_state_and_audit_summary.sql`** has still only ever run against
  WASM Postgres. Apply to the **staging** Supabase project (`aubwooslkkrprdxuiyvj`), and to
  **production** before `main`.
- **Ops:** set `PAGESPEED_API_KEY`, or LCP/INP/CLS keep reading "not measured".
- Netlify `allowed_branches` is `main`, `staging`, `Integration-with-outside-ecosystem`.
  Any other branch produces **no branch deploy** on push — use a PR (previews bypass the
  list) or `netlify deploy --build --context branch-deploy --alias <name>`.
- `CLAUDE.md`'s prior entry called the feature branch "NOT MERGED"; that is now superseded.
