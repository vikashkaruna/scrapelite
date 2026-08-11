# Gallery / Persona Coverage Checklist

> **What this is.** The `/gallery` page in the React app is runtime-populated
> from `src/lib/shareService.js` — it reads `localStorage.datiq.publicGallery`
> (with a Supabase `public_reports` fallback). The audit's coverage check
> can't see that data because it lives in the user's browser, not in source.
> This file is the human-readable coverage list, and `scripts/seed-public-gallery.mjs`
> is the actual seeder that injects curated samples into a fresh browser.
>
> **Static gallery is already 7/7 covered.** `public/gallery/index.html`
> has one curated sample per persona, with anonymised structured data. It
> is the AI-crawler view of the gallery (Google, ChatGPT, Perplexity etc.
> see real content even when Supabase is empty). The runtime gallery is
> what logged-in users browse, and that's what this checklist targets.
>
> **Use-case page link targets.** Each cell below links to a public
> /use-cases/<slug> page so the gallery card doubles as a use-case demo.
> None of the URLs contain PII, credentials, or private data.

---

## How to add a new sample

Two paths. Pick the one that matches your environment.

### Path A — Production / Supabase-backed
1. Extract a real public URL through the DatIQ app (e.g. open the
   Composer, paste the URL, hit Extract).
2. Click **Share** on the resulting Preview. The Supabase `public_reports`
   table now holds the row; `localStorage.datiq.publicGallery` mirrors it
   for the originating browser.
3. The new card appears on `/gallery` for any visitor whose Supabase
   `public_reports` query returns it (cache TTL ≈ 60s).

### Path B — Local-only seed (no Supabase write)
Run the seeder script:

```bash
node scripts/seed-public-gallery.mjs            # all 7 samples
node scripts/seed-public-gallery.mjs --only=ci # just one persona
```

This injects anonymised structured data into the localStorage of the
calling browser via the Playwright-driven dev server (or via a
`localStorage.setItem` block in the browser console if you prefer).
See the seeder for the exact localStorage keys it touches.

---

## Coverage matrix

7 personas × 11 headline features from `src/pages/Changelog.jsx`.
A green ✓ means the static gallery (`public/gallery/index.html`) has a
representative sample; a 🔵 means the seeder populates a runtime gallery
entry too; an empty cell needs a new sample.

| Persona | single-URL | batch | schedules | dashboard | enrichment | auth/billing | integrations | domain-map | SEO audit | content-gen | pricing |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Sales / SDR / BDR** | ✓🔵 stripe.com | | | | 🔵 contacts | | 🔵 hubspot push | | | | |
| **Competitive Intelligence** | ✓🔵 notion.so/pricing | | | | 🔵 pricing tab | | | | | 🔵 social | 🔵 pricing |
| **SEO / Content Marketer** | ✓🔵 moz.com/blog | | | | | | | | 🔵 map | | |
| **Market Researcher** | ✓🔵 ycombinator.com | 🔵 payments batch | | | 🔵 leadership | | | | | | |
| **Recruiter** | ✓🔵 stripe.com/jobs | | | | 🔵 contacts | | | | | | |
| **Startup Founder / VC** | ✓🔵 notion.so | | | | | | | 🔵 map | | | |
| **Agency / Enterprise** | ✓🔵 hubspot.com | | | | | | | 🔵 1,247 URLs | | | |

Legend: ✓ = static gallery card; 🔵 = runtime seeder entry.

---

## Sample detail (what to add for any new cell)

For each cell, record:

- **URL** — the public page being extracted (no auth wall, no JS-required
  dynamic content; a static blog post is easier to extract reliably than a
  React SPA)
- **Intent** — one of: `summary` · `custom:contacts` · `custom:leadership` ·
  `custom:mission` · `custom:pricing` · `custom:social` · `custom:jobs` ·
  `map` · `pricing` · `contacts` · `custom:<your-prompt>`
- **Title** — short label that goes on the gallery card and the public
  report page (e.g. "stripe.com — leadership & mission")
- **Tags** — comma-separated, lowercase, hyphenated (e.g. `fintech,
  payments, api`)
- **Summary line** — 1-sentence AI-style description for the card
- **Demo URL** — a link to a /use-cases/<slug> page that explains why
  this sample is useful (the existing 7 use cases cover most cells)

---

## Existing samples (already shipped)

These are the 7 curated samples the static gallery already shows. The
seeder also adds them to the runtime gallery so logged-in users see
content immediately.

| # | Persona | URL | Intent | Title |
|---|---|---|---|---|
| 1 | Sales / SDR / BDR | stripe.com | contacts | "stripe.com — leadership & mission" |
| 2 | Competitive Intelligence | notion.so/pricing | pricing | "notion.so/pricing — pricing teardown" |
| 3 | SEO / Content Marketer | moz.com/blog | summary | "moz.com/blog — heading & link audit" |
| 4 | Market Researcher | ycombinator.com | batch | "payments market — 20-company batch" |
| 5 | Recruiter | stripe.com/jobs | contacts | "stripe.com/jobs — hiring signals" |
| 6 | Startup Founder / VC | notion.so | summary | "notion.so — due diligence brief" |
| 7 | Agency / Enterprise | hubspot.com | map | "hubspot.com — full domain map" |

---

## What the audit cannot prove (manual eyeball required)

The audit is right to flag this — none of the following is provable from
source:

1. The runtime gallery actually has content for a new visitor
   (depends on whether they have `localStorage.datiq.publicGallery`
   seeded, or whether the seeder has been run for their browser).
2. The Supabase `public_reports` table has rows (depends on whether
   anyone has hit **Share** in production).
3. The published slugs resolve to a public report (depends on RLS
   policy + service role key).

Manual check after a production promotion:

```bash
# 1. Live API hits the public_reports table via the shareService
curl -s "https://datiq.app/api/health" | head -3   # should be 200

# 2. Browse /gallery in an incognito window
open "https://datiq.app/gallery"

# 3. If empty, run the seeder in the browser console:
#    Open /  →  DevTools console  →  paste:
#    (function(){ const s = document.createElement('script');
#      s.src='/seed-public-gallery.js'; document.head.appendChild(s); })()
#    Or import the seed module in the app and call window.__datiqSeedGallery().
```

---

## Re-seeding on every new release

Add this to the release checklist (handoff doc):

- [ ] Audit gallery coverage before staging promotion
- [ ] Regenerate `docs/assets/screenshots/` if any persona's demo flow changed
- [ ] Add a new sample to this checklist if a new persona or headline
      feature shipped
- [ ] Re-run `node scripts/seed-public-gallery.mjs --only=<new persona>`
      to add the new sample to the runtime gallery seeder
- [ ] After production promotion, open `/gallery` in an incognito
      window and confirm ≥1 card renders
