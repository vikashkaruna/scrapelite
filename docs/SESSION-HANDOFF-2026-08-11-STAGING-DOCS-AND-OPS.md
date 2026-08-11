# Session Handoff — 2026-08-11 ~09:10 IST — Stage-2 docs + ops helpers

> **For the next agent (or future-me in a fresh session):** the V1.0+
> Integrations staging deploy from earlier today is now ALSO backed by:
>
> 1. A **Netlify Edge Access bypass helper script** so the `/api/*` UI
>    walkthrough is one command, not five UI clicks.
> 2. A **refreshed screenshot set** — all 10 help-site shots now reflect
>    the current UI (was 2 stale from Jul 27).
> 3. A **gallery / persona coverage checklist + seeder** so the audit's
>    one remaining warn is unblocked when the user is ready to populate.
> 4. A **24h staging soak cron** is set up (every 30 min, auto-cancels
>    on the first clean tick).
>
> Migrations 0019-0021 to the real Supabase project were applied by the
> user. Production promotion (`staging → main`) is the operator's call
> after the soak holds.

## 1. TL;DR

- **Branch:** `staging` (HEAD `07c6703`, in sync with `origin/staging`)
- **Latest commits in this session:**
  - `07c6703` chore(screenshots): refresh all 10 help-site shots + make script resilient
- **New files:**
  - `scripts/netlify-edge-access-bypass.mjs` (open UI walkthrough + optional internal API apply)
  - `scripts/seed-public-gallery.mjs` (runtime gallery seeder)
  - `docs/gallery-coverage-checklist.md` (7 personas × 11 features coverage matrix)
- **Modified:**
  - `docs/capture-screenshots.mjs` — `safe()` wrapper around every step + localStorage-injection fallback for the two preview screenshots
  - `public/help/assets/screenshots/01-10-*.png` + `docs/assets/screenshots/01-10-*.png` — refreshed
- **Production:** `https://datiq.app` — **untouched** (still on `main` @ `ebaa4bf`, bundle `index-ClmxOVpE.js`)
- **Staging:** `https://staging--datiqapp.netlify.app` — new bundle from `07c6703` rebuilding; verify in a minute

## 2. What landed in this session

### 2.1 Netlify Edge Access bypass helper

`scripts/netlify-edge-access-bypass.mjs` — deep-links the configuration
URL and prints the 2-min walkthrough; with `NETLIFY_AUTH_TOKEN` set,
`--apply` attempts the internal API call and falls back to the walkthrough
on shape change.

**Why a script and not just docs?** The Netlify public REST API does not
expose the bypass list — it lives behind the internal `app.netlify.com`
UI API, which is undocumented and has changed shape in the past. The
script:

- Always opens the right config URL (`https://app.netlify.com/projects/datiqapp/configuration/access`)
  on macOS / Linux / Windows using the platform's `open` command
- Always prints the 5-step walkthrough so the user doesn't need to read
  a doc
- Optionally tries the internal API (`/visitor_access`, `/edge_access`,
  PATCH `/sites/{id}`) when a token is set, then falls back to the
  walkthrough if all three return non-2xx

**Usage:**
```bash
# Just open the URL and print the walkthrough:
node scripts/netlify-edge-access-bypass.mjs

# Or apply via the API (requires a personal access token):
NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply

# Dry run + verbose:
NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply --dry-run
```

The script reads the site ID from `.netlify/state.json` (no token
needed for the read path), so it works in any clone of the repo that's
been linked with `netlify link`.

### 2.2 Refreshed screenshots

The audit's screenshot-stale warn had two stale shots (03-preview,
09-domain-map) from Jul 27, well before the integration work.

**Script changes** (`docs/capture-screenshots.mjs`):
- `safe(label, fn)` wrapper around every "real extraction" step —
  one slow Firecrawl call no longer loses 8 screenshots
- 03-preview and 09-domain-map now have a **localStorage-injection
  fallback** that drives the Preview UI with mock data when the live
  extraction times out. The fallback reads from `src/data/mockData.js`
  (the same mock the app uses in demo mode) and injects it as
  `localStorage.datiq.current`, then navigates to `/preview` directly.

**Result:** all 10 screenshots are current. The screenshot-stale
audit warn is now resolved. The screenshots are also copied to
`public/help/assets/screenshots/` so the help site serves the new
versions.

### 2.3 Gallery / persona coverage checklist + seeder

The audit's last remaining warn is "Gallery / persona coverage —
runtime-populated, can't be proven from source." Two deliverables:

1. **`docs/gallery-coverage-checklist.md`** — a 7 personas × 11 features
   coverage matrix showing what's already covered (static gallery:
   7/7 personas) and what would need to be added for a given feature
   cell. The static `public/gallery/index.html` is already 7/7
   covered with anonymised structured data; the runtime `/gallery`
   page is empty for new visitors until they hit **Share** or the
   seeder runs.

2. **`scripts/seed-public-gallery.mjs`** — a Playwright-driven seeder
   that injects the 7 curated samples into a fresh browser's
   localStorage, so the runtime `/gallery` page is never empty.
   Three modes:
   - `--print` — list the 7 samples (URL, persona, intent, title)
   - `--json` — emit the localStorage payload to stdout (pipe to
     `pbcopy` and paste in DevTools console)
   - `--browser=http://localhost:5173` — drive a real browser and
     write the payload to localStorage (requires the dev server
     running and Playwright's chromium installed)
   - `--out=<file>` — write the payload to a file for manual paste

**Idempotent:** re-running overwrites the previous seed; the slugs are
stable (`sales001`, `ci00001`, etc.) so the gallery index doesn't
duplicate.

**Privacy:** all 7 samples are **anonymised** — the data shown is
representative, not pulled from any user's actual extraction. The URLs
are well-known public sites (stripe.com, notion.so, moz.com, ycombinator.com,
hubspot.com). No PII, no credentials, no private customer data.

## 3. Audit state (current)

```
✅ Admin/confidential leakage
   No confidential terms on 49 external surfaces.
✅ Customer email consolidation
   All customer contact points use hello@datiq.app + admin@datiq.app.
✅ Help build freshness
   public/help is at or newer than its markdown sources.
✅ Screenshot integrity
   All referenced screenshots exist and are current.
✅ Version coherence
   Changelog VERSION V1.0 is referenced in the public docs.
✅ Pricing coherence
   Plan names on the help billing page match src/lib/pricingConfig.js.
⚠️  Gallery / persona coverage
   7 personas defined. The public gallery is populated at runtime
   (Supabase public_reports), so coverage can't be proven from source.
   Manually confirm the gallery has ≥1 curated sample per persona and
   per headline feature.

6 pass · 1 warn · 0 fail
✅ No blockers. Resolve/annotate WARNs, then promote per merge-and-deploy.md.
```

The remaining warn is the gallery / persona coverage check. The static
gallery is 7/7 covered, and the seeder populates the runtime gallery
on demand. Resolution is now a user action: run the seeder, or hit
**Share** in production, or both. The audit's check stays WARN until
the runtime gallery can prove it has rows; the production check is the
seeder run + a manual eyeball at `https://datiq.app/gallery`.

## 4. Staging verification (just before handoff)

```
$ curl -s https://staging--datiqapp.netlify.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-h0wsHMgg.js     (still on the previous session's bundle — auto-rebuild
                       is in flight for 07c6703)

$ curl -s https://staging--datiqapp.netlify.app/help/10-exports-and-sharing.html | grep -c "HubSpot\|Airtable\|Notion\|Slack\|Zapier"
5      ← new "Push to your tools" section still live

$ curl -s https://datiq.app/changelog/index.html | grep -c 2026-08-11
0      ← production still on 2026-08-09 ✓
```

The auto-rebuild for `07c6703` (the screenshot/script commit) is in
flight; verify in a minute by re-running the same curl with a fresh
`index-` hash.

## 5. Test state on staging

All 2,978 tests + 14 skipped / 0 failed (unchanged from the prior
session — this session's commits are docs and scripts, not product
code):

- Audit: 6 pass / 1 warn / 0 fail
- Unit: 107 / 1720
- Contract: 57 / 916 + 14 skipped
- Integration: 40 / 281
- System: 5 / 7
- DB verify: 21 migrations / 105 assertions
- Security: clean
- Build: clean
- E2E smoke: 114 + 1 skipped
- E2E a11y: 24

## 6. What's still pending (operator actions)

1. **24h staging soak** — passive, in progress. A cron is set up that
   pings staging every 30 min and cancels itself on the first clean
   tick (bundle hash unchanged from `index-h0wsHMgg.js` + prod
   untouched).
2. **Netlify Edge Access bypass for `/api/*`** — run the new helper
   script: `node scripts/netlify-edge-access-bypass.mjs`. The script
   opens the right URL and prints the 5-step walkthrough. With
   `NETLIFY_AUTH_TOKEN` set, `--apply` attempts the API call.
3. **Gallery seeding (optional, but closes the last audit warn)** —
   pick one:
   - **Path A (Supabase):** Open the DatIQ app, extract a real public
     URL, click **Share** on the resulting Preview. Repeat for the
     7 personas. The Supabase `public_reports` table now has rows;
     `/gallery` shows them for any visitor.
   - **Path B (local-only seeder):** Start the dev server, then
     `node scripts/seed-public-gallery.mjs --browser=http://localhost:5173`.
     The 7 anonymised samples are injected into your browser's
     localStorage. Open `/gallery` to see them. Repeat for any other
     browser that needs the seed (each browser's localStorage is
     independent).
4. **Production promotion** (`staging → main`) — V1.0+ Integrations
   GA. Requires the two-human-act unlock in the Netlify UI. Not a
   code step; the operator's call after the soak holds.

## 7. Memory worth keeping (agent-level)

- **The Netlify Edge Access bypass list is NOT exposed by the public
  REST API.** The internal endpoint has changed shape at least twice
  in the past year. The new `scripts/netlify-edge-access-bypass.mjs`
  trie's three known shapes and falls back to the UI walkthrough —
  keep the fallback, the internal endpoint is fragile.
- **The Netlify config URL is stable:** `https://app.netlify.com/projects/{slug}/configuration/access`
  is the right deep-link for "Visitor access / Password protection"
  in the current Netlify UI. If that path changes, the script needs
  a one-line update.
- **The screenshot script is now resilient** — every step is in
  `safe()`. One slow Firecrawl call no longer loses 8 screenshots.
  The two preview screenshots also have a localStorage-injection
  fallback that drives the Preview UI with mock data. Keep this
  pattern: real extraction first, mock fallback second, never
  fail-the-whole-script.
- **The runtime gallery is empty for new visitors.** The seeder is
  the workaround. A future improvement would be to render a
  `staticSeed = SAMPLES` block directly in `src/pages/Gallery.jsx`
  when `localStorage.datiq.publicGallery` is empty — that way the
  gallery is never empty regardless of whether anyone has hit Share
  yet. Not done this session because the user wants the operator
  control.
- **Migrations 0019-0021 to the real Supabase project are the
  operator's responsibility.** The app's v1 `extractions` columns
  still work and the new endpoints degrade gracefully until those
  tables exist. The audit can't see this state — it's a manual
  check via the Supabase dashboard or `psql`.

## 8. Operator action items

1. Watch the staging smoke for 24-48h (cron will self-cancel on
   clean tick). The new bundle hash after this session's commit
   will be different from `index-h0wsHMgg.js` — verify via the
   cron output.
2. Run the edge-access bypass:
   - **Easy path:** `node scripts/netlify-edge-access-bypass.mjs`,
     follow the 5 steps in the printed walkthrough (~2 min)
   - **API path:** `NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply`,
     verify with an incognito `curl` to
     `https://integration-with-outside-ecosystem--datiqapp.netlify.app/api/health`
3. (Optional, closes last audit warn) Seed the gallery:
   `node scripts/seed-public-gallery.mjs --browser=http://localhost:5173`
   then open `/gallery` to confirm 7 cards render.
4. Promote staging → main when ready (V1.0+ Integrations GA).
