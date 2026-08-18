# Session handoff — 2026-08-18 — documentation + screenshot refresh (Home/Batch consolidation)

**Branch:** `claude/docs-screenshots-refresh-d71ebf` (reset onto `origin/staging` @ `ac4a812`) → merged into `staging`.
**`main` was NOT touched** — merging `staging` → `main` remains the owner's deliberate step.

This session shipped **no behaviour change**. Every `src/` edit is content (`Changelog.jsx`
feature lists, a new `Blog.jsx` post) or a test contract correction. Everything else is
documentation, screenshots, and marketing collateral.

---

## 0. Branch state check (asked first)

| Ref | Commit | Relationship |
|---|---|---|
| `origin/staging` | `ac4a812` | 10 commits **ahead** of `main` |
| `origin/main` | `17e6c82` | carries only the PR #92 merge commit |
| `origin/merge-home-and-batch-run` | `ac4a812` | **byte-identical to `origin/staging`** |

`git merge-base --is-ancestor origin/merge-home-and-batch-run origin/staging` returned true and
`git log origin/staging..origin/merge-home-and-batch-run` was empty, so the branch was fully
merged and **deleted** (local + remote), as requested.

The working branch started at `origin/main`, which is *behind* staging. It was reset onto
`origin/staging` before any work — the task said "use the latest staging branch".

---

## 1. Screenshots — all 10 regenerated

`node docs/capture-screenshots.mjs` against a dev server on the latest `staging`, then
`node docs/build-help.mjs` propagated them into `public/help/assets/screenshots/` (verified
byte-identical to `docs/assets/screenshots/`).

They now show the shipped UI: **no Batch nav item**, the `＋` / Batch / Schedule composer
toolbar, `Batch extraction` with Success/Failed filter chips and **Push** beside Export, and
Dashboard's **Push in the toolbar between Export and Refresh** with the floating selection bar
gone and the browser-only storage warning visible.

### The harness itself needed a fix

The GA4 consent banner (added 2026-08-16) is a **fixed-bottom overlay**, so it sat across the
lower ~15% of *every* screenshot and buried the thing each shot exists to show.
`capture-screenshots.mjs` now pre-seeds `datiq.consent` in its existing `addInitScript`:

* **`denied`, not `granted`** — it is the privacy-preserving option, and it also stops the
  capture run firing GA4 `page_view` hits for a headless browser walking the entire app.

### ⚠️ The readiness screenshot check compares GIT COMMIT TIMES, not mtimes

`newestCommitTime()` in `.claude/skills/production-readiness/scripts/audit.mjs` shells out to
git. **Re-running the capture does not clear the warn — committing the PNGs does.** Re-capturing
because the warn persisted is a wasted loop; it is also why editing any `.jsx`/`.css` *after*
capturing re-trips it.

---

## 2. External documentation

### `docs/DatIQ-User-Guide.md` → `public/help/` (16 sections + developers)

| § | Change |
|---|---|
| 1 | Pillar 0 no longer implies Batch is a place you submit a list on |
| 3 | Composer is the **sole entry point**; `＋` menu (Import CSV · Add multiple URLs · **Run in background**); the links-in-text chooser; new "Run in background" subsection |
| 4 | Advanced options now documents **Generate AI content for each URL** + content-type chips and the CSV detected-column readout, and states they apply to single *and* batch |
| 7 | Rewritten — started from Home, no Batch tab, dock progress, filter/sort/Retry, **"Coming back to a batch later"** (`/batch?run=<id>`, why failures live only there) |
| 8 | **Scheduling needs an account** callout — stash-and-prompt on sign-in, `"Not running"` labelling |
| 9 | Push in toolbar, inline selection row, shared selection semantics, **"Signed out? Your pages are saved in this browser only"** + claim-on-sign-in |
| 10 | **Export ▾ = downloads + clipboard; Push ▾ = destinations.** Corrected the destination table (Google Sheets is in Push and needs no setup — it was documented as living in Export ▾ and gated to Pro+); Zapier explained as a trigger, not a push target; "More destination options…" for field mapping |
| 12 | What signing in actually gets you (durable pages, working schedules, Push) |
| 14 | New entries: lost run, links-in-text, `"Not running"` schedule; batch-failure entry gained Retry + run link |

### `public/faq/index.html`

Five new Q&As added to **both** the visible `<details>` list and the `FAQPage` JSON-LD, kept in
sync: *do I need an account*, *where are my signed-out pages*, *can I keep working while a batch
runs*, *why does my schedule say "Not running"*, *I pasted an email full of links*.

Two stale claims corrected:
* *"Google Sheets export is available on Pro and above"* — it is **ungated and needs no setup**.
* **`jsPDF`** — an internal library name in customer-facing copy (violates the no-internals rule).

**Pre-existing defect fixed:** two `<details>` blocks shared `id="faq-share"` and rendered the
same answer twice. Duplicate removed.

Verified programmatically: JSON-LD parses, 17 questions, **all 17 render on the page**, no
duplicate ids. Angle-bracket placeholders were reworded out — `&lt;id&gt;` would render
literally inside `<script type="application/ld+json">` (script content is not entity-decoded)
while being correct in the HTML, and one string serves both.

### Other external surfaces

* `public/llms.txt` / `public/llms-full.txt` — batch section (composer entry, background runs,
  addressable runs, failure semantics), export/push answer, `jsPDF` removed.
* `public/vs/firecrawl/index.html` — no longer advertises `/batch` as a destination.
* `src/pages/Blog.jsx` — new release post, *"One Box to Start Anything"*; the older integrations
  post corrected (**Load columns** moved behind "More destination options…").
* `src/pages/Changelog.jsx` — batch / dashboard / preview / integrations / schedules / guest / ux
  items updated, `UPDATED` bumped, `15 user-guide sections` → **16**.
  **Group count left at 11 — `Changelog.test.jsx` pins it**, so add items, never groups.

---

## 3. Internal documentation

`docs/internal/DatIQ-Product-Documentation-Internal.md` — §6.1, §7.1, §7.3, §7.4, §7.5, §9.

**§7.1 was stale by two releases**: it still described the four-toggle v2.0 Home (Map entire
domain / Contacts & emails / Custom toggles) and a full-screen 4-step loader. The document's own
header had flagged "full screen-by-screen refresh is the next internal pass" — that pass is now
done for the screens this consolidation touched.

`CLAUDE.md` — new "Last updated" entry; the previous one demoted to "Prior". The route map was
already correct (the prior session updated it).

---

## 4. Three stale e2e specs — found, and fixed

**The previous session reported all-green, but its 8 pre-push gates do not include e2e.** Three
smoke specs asserting the *old* nav contract had shipped to `staging` broken:

| Spec | Was asserting | Now asserts |
|---|---|---|
| `e2e/smoke/home.spec.js:69` | nav order Extract / **Batch** / Schedules / Dashboard | Extract / Schedules / Dashboard, **plus a new test that the Batch nav item stays gone** |
| `e2e/smoke/batch.spec.js:12` | `<h1>Multi-URL extraction` | `<h1>Batch extraction` |
| `e2e/smoke/claims-verification.spec.js:47` | "Batch mode is accessible from the main nav" | "pasting multiple URLs in the Home composer routes to batch" |

The claims spec exists to catch marketing claims drifting from behaviour; since the *claim itself*
changed, it was rewritten rather than deleted — same call the previous session made for S-02.

### ⚠️ e2e in this sandbox needs `--workers=2`

`playwright.config.js` sets `workers: process.env.CI ? 2 : undefined`, so a local run uses one
worker per CPU. An unconstrained run produced **9 failures**, including tests that had passed
minutes earlier (`home composer is visible`) — all 30 s timeouts against a half-rendered page,
i.e. resource exhaustion, not real breakage. The same specs passed **24/24** with `--workers=2`
and a second dev server shut down. The prior handoff documented the same symptom.

**Diagnose an e2e failure here by re-running the single spec with `--workers=2` before believing it.**

---

## 5. Verification

| Gate | Result |
|---|---|
| `npm run test:unit` | **124 files / 1975 passed** |
| `npm run test:contract` | **69 files / 1330 passed / 14 skipped** |
| `npm run test:integration` | **41 files / 300 passed** |
| `npm run test:system` | **5 files / 8 passed** |
| `npm run test:db` | **25 migrations / 124 assertions / 0 failed** |
| `npm run build` | clean |
| `npm run test:security` | clean |
| e2e smoke (`--workers=2`) | see §6 |
| `npm run readiness` | see §6 |

---

## 6. Known / carried forward

* **`npm run readiness` keeps one warn: gallery / persona coverage.** The public gallery is
  populated at runtime from Supabase `public_reports`, so coverage cannot be proven from source.
  The `/admin/gallery` curation tooling exists to satisfy it once reports are curated.
* **🔴 Salesforce is marketed but not implemented.** `src/lib/pricingConfig.js` lists
  *"3 seats + HubSpot / Salesforce"* on Business and `src/lib/pageSeo.js` repeats it in meta
  descriptions, but **no Salesforce integration exists anywhere in `src/` or `netlify/`** —
  `PUSH_PROVIDERS` is HubSpot / Notion / Airtable / Slack. This is a pricing-claim decision for
  the owner, so it was **flagged, not silently rewritten**. (The `/vs/clay` and
  `/vs/phantombuster` mentions are in the *competitor's* column and are fine.)
* The guest gate is still `localStorage`-backed (`datiq.guestTrial`), so clearing site data
  resets it. Unchanged this session; closing it needs server-side guest identity.
* No migrations added; nothing to apply to Supabase.

---

## 7. Next steps

1. **Merge `staging` → `main` when ready to ship** — deliberately not done here.
2. Decide the Salesforce claim (§6): implement, or remove it from `pricingConfig.js` + `pageSeo.js`.
3. Optional `/design-sync` — `screens.css` changed substantially in the prior session and has
   still not been re-synced.
