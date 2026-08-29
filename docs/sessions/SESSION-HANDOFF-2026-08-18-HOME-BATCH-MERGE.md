# Session handoff — 2026-08-18 — Home/Batch consolidation, guest-gate leak, auth gating

**Branch:** `merge-home-and-batch-run` (cut from `origin/staging` @ `3f8ec35`) → fast-forwarded into `staging`.
**`main` was NOT touched** — merging `staging` → `main` remains a deliberate separate step.

---

## 0. Branch state check (the first thing asked)

`origin/staging` already contained **every code commit** on `origin/main`. The only
divergence was one docs commit on staging (`3f8ec35`, the footer-click-fix handoff)
that main lacked; `git diff origin/main origin/staging` touched only `CLAUDE.md`
and that doc. No merge from `main` was needed.

---

## 1. What shipped (8 commits)

### Home is the only extraction entry point; `/batch` is the run + results surface

Home's `HeroComposer` already detected 2+ URLs and routed to `/batch`, so `/batch`
was not an independent feature — it was a screen users got *bounced to*. Batch is
removed from the top nav (`Extract` now matches `/batch` too); the route survives,
reached from the composer, from the progress dock, and from Dashboard's run history.
`<h1>Multi-URL extraction</h1>` → **`Batch extraction`**.

Two options existed **only** on `/batch` and so vanished the moment you ran from
Home. Both moved to Home's Advanced panel:
* **Generate AI content for each URL** (+ the `CONTENT_FORMATS` picker)
* the CSV **detected-URL-column** readout

### Smarter paste detection (`classifyInput`)

`classifyInput`'s `multi` branch requires `valid.length >= tokenCount - 1` — nearly
every whitespace token must itself be a URL. So an email, a Slack thread or a
markdown list carrying eight links failed that test, fell through to `text`, and the
whole blob was extracted as **one pasted document** — while `classification.urls`
already held the eight links that nothing on the text path ever read.

New `embedded` kind names that case; results now also carry
`urlCount` / `tokenCount` / `density`. It is deliberately **not** auto-routed: a
newsletter with ten links is genuinely ambiguous (extract the ten pages, or
summarise the newsletter?), so the composer shows an inline chooser —
*"Extract all 8" / "Extract this text as one page"*. Choosing the links reuses
`ingestUrls`, the same path drag-drop and CSV import already use.

**HTML stays on the `text` path on purpose:** `buildStructureFromText` runs it
through `parseHtml`, which extracts real headings and links. Routing it to
`embedded` would trade a good parser for whitespace tokenising.

That work exposed a real defect — **URLs lifted from prose kept the sentence's
punctuation**. `"…and Figma at https://figma.com/pricing."` extracted a URL with a
trailing full stop, i.e. scraped the wrong address. `extractUrls` now trims wrapping
punctuation while preserving a real trailing slash and a balanced paren
(Wikipedia-style links).

### Background runs + one progress surface

`runBatch()` was called inside `Batch.jsx`'s component body, holding its
`AbortController` and progress in that component's state — so **navigating away
abandoned the run**. New `src/components/BatchRunProvider.jsx` owns the run above
the router. The post-run persistence moved with it, because a run that finishes
after the user has navigated away must still save and record itself.

`ExtractionProgressDock` now renders both job kinds, so there is one progress
surface instead of an in-page bar on `/batch` and a floating dock everywhere else.
For a batch it shows `Extracting 3 / 12 URLs…` with a **real** percentage from
`completed/total` (the single-extraction stepper is cosmetic pacing — a lone scrape
reports no progress), the current URL, and Cancel.

**Run in background** is an item in the composer's `+` menu (not a third toolbar
chip), sticky across sessions, with a dot on `+` when active. It applies to single
and batch alike. With it on, a multi-URL run starts from Home and **stays there** —
routing to `/batch` first only to say "you can navigate away" would defeat the point.

### Addressable results — `/batch?run=<id>`

`saveBatchRun` now stores **every row including failures**. Failures previously
lived only in React state, so leaving the page lost the failure list *and* the
per-row Retry. Dashboard cannot stand in: only successes are saved as extractions,
so a failed URL has no row there at all. Dashboard's run banner links back when a
run had failures.

### Guest-gate leak (the reported bug)

*"Cancel the prompt, retry, and keep extracting; the alert never comes back."*
Two independent causes:

1. `GuestTrialModal`'s auth buttons ran `openAuth(...); dismiss()`, and in hard mode
   `dismiss` cleared `showHardBlock`. Opening the auth modal is not *completing*
   auth — closing it without signing up left the gate visibly gone while the
   counters stood.
2. **Four extraction paths never called a check at all** — batch per-row Retry
   (`Batch.jsx` → `extractOne`), Schedules "Run now" (`Schedules.jsx` →
   `extractStructure`), `BattleCard.jsx`, and quick-action enrich
   (`ExtractionProvider.enrich`). Once the dialog was out of the way nothing
   re-evaluated the limit on those paths.

Checking and blocking were two steps each caller wired up itself, which is how they
drifted. Both now live in one **`requireGuestCredit(kind)`** on the provider, called
from all six entry points.

Counters were success-only, so a failing URL was free and starting a batch then
cancelling was free — both endlessly repeatable. Once a provider call is made it
counts; tracking moved to the failure/`finally` paths. The battle card charges 2.

### Auth gating for persistence

**Schedules — a real functional bug.** `saveSchedule` posts to `/api/schedules`; a
signed-out user got 401, and `schedulerService.shouldFallback` treated 401 as
"backend unreachable", keeping the schedule in `localStorage`. But what *executes*
schedules is `netlify/functions/scheduled-runner.js` — hourly, reading Supabase. It
has no view of a browser's storage. **The schedule listed as active, advertised a
next run time, and was inert.**

The same-named helper in `extractionsRepo` lists 401 **correctly** — an extraction in
localStorage still works. That asymmetry is now stated in both files, since sharing
a function name is what made them look interchangeable.

* 401/403 removed from `schedulerService.shouldFallback`; `saveSchedule` rethrows and
  rolls the optimistic local write back. Reads (`listSchedules`/delete/toggle) still
  tolerate auth errors — showing and removing a local draft signed out is harmless.
* `ScheduleEditor` stashes the schedule (`lib/pendingSchedule.js`, **sessionStorage**
  because OAuth navigates the document away and back) and prompts sign-in. A global
  `PendingScheduleFlush` saves it once a session exists. It triggers on
  *the presence of a stash plus a user*, **not** a signed-out → signed-in transition:
  an OAuth callback can land with the session already restored, so the transition may
  never be observed.
* Any schedule that did degrade to local-only is flagged `_localOnly`; the card says
  **"Not running" / "Sign in to start this schedule"** instead of a fake next run.

**Extractions** keep working signed out but no longer pretend to be durable:
Dashboard shows how many pages are browser-only, and on sign-in
`claimLocalExtractions()` replays them onto the account. A row that merely fell back
to localStorage again is **not** counted as claimed — otherwise the warning would
disappear while the data was still browser-only.

### One Push, one destination list

Destinations were reachable two ways with two different lists: the Push menu
(HubSpot / Notion / Airtable / Slack) and `Export ▾ → Send to →` the
`ExportIntegrations` modal (those four **plus Google Sheets**).

Google Sheets was missing from Push because it isn't a push — nothing to authorise,
it downloads a CSV and opens a blank sheet. It's now a row marked *"No setup
needed"*, running the same `openInGoogleSheets()` helper. **"Send to" is gone from
all three Export dropdowns** (Batch, Dashboard header, Dashboard selection bar);
Export ▾ is downloads + clipboard only. The button is always **"Push"**, never
"Push N" — the count belongs in the menu header.

`ExportIntegrations` is **not deleted**: its Airtable pane carries the only
"Load columns" recovery for an empty `field_map`, which nothing else offers
(Account → Integrations has no field mapping). It moved behind an optional
**"More destination options…"** link inside the Push menu.

### Dashboard floating selection bar removed

It duplicated the page: count / Clear / Generate / Email are the inline selection row
beside the filter chips, and its `Export ▾` is the toolbar's. **Push was the only
thing unique to it** — the only reason it existed. Push moved to the toolbar between
**Export and Refresh** and shares Export's selection semantics via `exportTargets()`
(the selection when there is one, everything filtered otherwise), so
*"Export all 8"* and *"Push to (8)"* agree. Removed with it: the `SelectionBar`
component, `.dash-float-*` CSS, and the `float-bar-in` keyframe.

### Two long-carried defects

* **`Button` never destructured `loading`**, so it fell through `...rest` onto the
  native `<button>` (React: *"Received `true` for a non-boolean attribute
  `loading`"*) and rendered nothing. 15 call sites already passed it. Now consumed —
  the shared `.spinner` replaces the left icon and the button is disabled while busy,
  which closes a real **double-click window** on `Pricing.jsx` (in-flight payment)
  and `PushIntegrationMenu.jsx` (in-flight push).
* **`getGallery()` was `localStorage`-only** even though `publish()` already writes
  to Supabase `public_reports` (that write is what makes `/p/:slug` resolve in
  another browser). `/gallery` is a public page, so any visitor who had never shared
  anything saw an empty feed. It now reads `public_reports` and **merges** with local
  rows by slug — reports published while signed out exist only in localStorage, and
  `listExtractions()` already had to learn that a query legitimately returning `[]`
  must not be trusted as authoritative.

### Follow-ups fixed on request

* **Batch paywall headline.** `kind:"batch"` in `paywallCopy` means *"this batch is
  too **big** for your plan"* (a `batch_max_urls` cap). The guest modal reused it for
  *"you've used all your free batch **runs**"* — a count of runs. Result: *"You need
  20 URLs in one batch"*, a limit the user never hit, quoting `BATCH_LIMIT * 4`. New
  `batch_runs` context: *"You've used all 5 free batch runs"*, recommending the
  **Free** plan (a guest out of runs needs an account, not an upgrade).
  Found alongside: the same dialog advertised **"Batch mode (up to 200 URLs)"** as a
  benefit of the free account it was offering. 200 is Business; Free allows **5**.
* **No more page-load interstitial.** An over-limit guest was shown the full-viewport
  hard block on *mount* (R17 #118, system-tested as S-02). That existed because an
  attempt was the only trigger while four paths didn't check — so "only on attempt"
  really did mean "sometimes never". With `requireGuestCredit` on every path the
  dialog enforces **nothing** at mount: it can be closed, and closing grants nothing.
  `GuestTrialBanner` already reports the state without blocking the page. Dropped.
  **S-02 was rewritten, not deleted** — it still guards that a reload can't hand an
  over-limit guest a fresh allowance, but asserts the *enforcement* survives rather
  than the dialog's visibility.

---

## 2. Verification

| Gate | Result |
|---|---|
| `npm test` | **239 files / 3613 passed / 14 skipped / 0 failed** |
| `npm run build` | clean |
| `npm run test:db` | **124 assertions / 25 migrations** (no migrations added) |
| `npm run readiness` | 5 pass / **2 warn** / 0 fail |
| `npm run test:security` | clean |
| pre-push hook | all 8 gates green on every push |

Both readiness warns are expected: **stale screenshots** (UI changed this session —
run `node docs/capture-screenshots.mjs` before shipping customer-facing visuals) and
**gallery/persona coverage** (runtime-populated, unprovable from source).

**Browser-verified**, not just unit-tested: background batch surviving navigation to
Dashboard mid-run; the dock's `n / N` + Cancel; `/batch?run=<id>` rehydrating after a
hard reload; the embedded-links chooser; the guest gate re-blocking after the exact
reported sequence; Push showing five destinations from its new toolbar position with
and without a selection; no `loading` console warning.

---

## 3. Known / carried forward

* **The guest gate is `localStorage`-backed** (`datiq.guestTrial`), so clearing site
  data or switching browsers still resets it. Closing that needs server-side guest
  identity — a separate piece of work. Accepted explicitly.
* Archived batch rows carry `url/status/error/title` only — enough for the table,
  filters, sort and Retry, but not headings/links counts. The saved pages are on
  Dashboard; the results view says so.
* `PushIntegrationMenu`'s `compact` prop now has **no caller** (the floating bar was
  its only one). Kept — it is part of the component's documented API.
* No migrations were added, so nothing to apply to Supabase.

---

## 4. Next steps

1. Regenerate screenshots (`node docs/capture-screenshots.mjs`) before the next
   customer-facing release.
2. Merge `staging` → `main` when ready to ship — deliberately **not** done here.
3. Optional: `/design-sync`, since `screens.css` changed substantially.
