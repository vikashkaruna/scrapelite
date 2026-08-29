# Session handoff — 2026-07-18 — Home screen UX cleanup (post-v1.0)

> **Post-v1.0 UX cleanup pass on the Home page.** All four issues flagged
> by the user are fixed; v1.0 production screenshots are refreshed; all
> tests green on `main`.

## TL;DR

Four issues on the Home page were addressed:

1. **"What do you want to extract?" label was duplicated** — once on the
   outcome-tiles section (above the composer) and once on the
   intent-chips section (below the composer). The outcome-tiles section
   now uses a dedicated **"Common jobs"** label.
2. **Outcome tiles were multi-select** — the combined-prompt UX was
   confusing for the first interaction. OutcomeTiles is now **single-select**:
   click a tile to seed the composer, click it again to clear.
3. **"Recent extractions" was capped at 760px** while every other
   content section runs to 1080. Now page-content-width (1080) with a
   1 / 2 / 3 / 5 column responsive grid.
4. **"Recent extractions" was NOT user-specific** — it showed every item
   in `datiq.saved` regardless of who saved it. Now filtered to the
   current owner (auth user id for signed-in users, per-browser session
   id for guests), via a new `getOwnerId()` helper that mirrors
   `usageRepo`'s existing pattern.

| | |
|---|---|
| **Branch** | `main` |
| **Latest commit** | `ca13fa3` — fix(home): deduplicate label + single-select tiles + user-scoped recent |
| **Based on** | `2a204b1` (the post-v1.0 deploy-blocker fix) |
| **Tests** | vitest **1299 / 1299** (146 files, 13.7s) · vite build clean · Playwright e2e **388 / 388** (3 browsers, ~4m) |

## What was done

### 1. OutcomeTiles → single-select (Q-UI-2)

| Before | After |
|---|---|
| Multi-select tiles combine into one prompt | Single-select: click to set, click again to clear |
| "Clear (N)" button with `__clear__` sentinel | No clear button (the active tile is its own clear) |
| Custom-prompt concatenation via `setIntent("custom")` | Tile maps to its own intent (summary / contacts / pricing / map / custom) |
| Combined-prompt UX was confusing for first-time users | One tile = one job; combine prompts explicitly via Custom intent |

**Files changed:**
- `src/components/OutcomeTiles.jsx` — rewritten as single-select; `activeKeys` → `activeKey` (string | null); `onToggle` now passes the tile on activation and `null` on deselection
- `src/pages/Home.jsx` — `handleTileToggle` rewritten; new `tileToIntent` map; `setActiveTileKey` (string) replaces `setActiveTileKeys` (array)
- `src/components/OutcomeTiles.test.jsx` — 9 tests rewritten for single-select
- `src/pages/Home.outcome-multiselect.integration.test.jsx` — **deleted** (the feature is gone)
- `src/pages/Home.outcome-singleselect.integration.test.jsx` — **new** (4 tests covering single-select, label uniqueness, no Clear button, REPLACES-not-combines)

### 2. "Common jobs" label (Q-UI-1)

The outcome-tiles section now reads "**Common jobs**" (a fast-path picker).
The intent-chips section below the composer still reads "What do you want
to extract?" (a precise intent selector). The two sections now have distinct
labels — no more duplicate "What do you want to extract?".

| Section | Label | Role |
|---|---|---|
| Outcome tiles (above composer) | **Common jobs** | Fast-path picker — click to seed the composer |
| Intent chips (below composer) | What do you want to extract? | Precise intent selector |
| Custom prompt (when intent = custom) | Custom extraction | Free-text prompt |

### 3. RecentExtractions → page-content width (Q-UI-3)

Wrapper maxWidth bumped from `760` → `1080`. The recent grid now has
**1 / 2 / 3 / 5 columns** across viewports:

| Viewport | Columns |
|---|---|
| < 640px | 1 |
| 640–899px | 2 |
| 900–1179px | 3 |
| ≥ 1180px | 5 (matches `MAX_SHOWN`) |

**Files changed:**
- `src/pages/Home.jsx` — wrapper `maxWidth: 760` → `maxWidth: 1080`
- `src/styles/screens.css` — added 900px and 1180px breakpoints

### 4. User-specific recent extractions (Q-UI-4)

The Recent Extractions widget on Home now shows only the current user's
extractions. Items owned by a different session (or by another signed-in
user on a shared device) are hidden. Pre-existing items with no owner
field are also hidden from the per-user widget (they still appear in
the full Dashboard — the safer default).

**How it works:**

1. **`saveExtraction` (in `extractionsRepo.js`) now tags every saved
   item** with `user_id` (auth user id, when signed in) or `session_id`
   (per-browser UUID, for guests), via a new `getOwnerId()` helper that
   mirrors the existing `usageRepo.getSessionId()` pattern.
2. **`RecentExtractions.jsx` resolves the current owner** on mount and
   when the auth user changes. Items are filtered via `matchesOwner()`.
3. **The widget is hidden** when the owner cannot be resolved or when
   the owner has zero items (no empty box flashing on Home).

**Files changed:**
- `src/lib/extractionsRepo.js` — added `getOwnerId()`; `saveExtraction` now attaches `user_id` / `session_id` before persisting
- `src/components/RecentExtractions.jsx` — added owner resolution + `matchesOwner()` filter; reads auth user via `useAuth` + `supabase.auth.getUser`
- `src/components/RecentExtractions.integration.test.jsx` — 3 new tests for user-scope behaviour (HIDES non-owned, HIDES when owner unresolvable, hidden for empty filtered set)

## Production migration impact

**None.** This is a pure UX + test change on the v1.0 production build.
No new env vars, no new Supabase tables, no schema migration. Saved
extractions made before this change simply lack the `user_id` /
`session_id` field — they're hidden from the per-user Home widget but
still appear in the full Dashboard. No data loss.

## Test counts (this branch)

```
vitest: 1299/1299 (146 files, 13.7s)
  - +9 OutcomeTiles.test.jsx (rewritten, same count)
  - -5 Home.outcome-multiselect.integration.test.jsx (deleted)
  - +4 Home.outcome-singleselect.integration.test.jsx (new)
  - +3 RecentExtractions.integration.test.jsx (new user-scope tests)
  Net: +2 (1297 → 1299)

vite build: clean in 1.86s
  (1.0 MB main bundle, 281 KB gzipped)

Playwright e2e: 388/388 (3 browsers × smoke + visual + a11y +
  journeys + claims-verification, ~4m)
  (390 → 388: net -2 from the deleted test files)
```

## What to read

| Doc | Purpose |
|---|---|
| `docs/PRODUCTION-RELEASE-V1.0.md` | The full v1.0 production runbook (unchanged) |
| `docs/internal/V1.0-RELEASE-CANDIDATE.md` | The v1.0 RC changelog (unchanged) |
| `docs/SESSION-END-2026-07-18-V1.0-CUTOVER.md` | The v1.0 cutover handoff (unchanged) |
| `docs/capture-home-only.mjs` | The script to recapture just the home-page screenshots |
| `docs/V1.0-Screenshots/01-home-desktop-light.png` | Updated home screenshot showing the new layout |
| `docs/V1.0-Screenshots/23-home-outcome-tile-active.png` | Updated home screenshot with an active outcome tile |

## Files touched in this session

| Status | Path | What |
|---|---|---|
| modified | `src/components/OutcomeTiles.jsx` | Single-select rewrite; new "Common jobs" label |
| modified | `src/components/OutcomeTiles.test.jsx` | 9 tests rewritten for single-select |
| modified | `src/components/RecentExtractions.jsx` | Owner resolution + per-user filter |
| modified | `src/components/RecentExtractions.integration.test.jsx` | +3 user-scope tests |
| modified | `src/lib/extractionsRepo.js` | `getOwnerId()` + `saveExtraction` tagging |
| modified | `src/pages/Home.jsx` | Single-select handler, maxWidth 1080, label fix |
| modified | `src/styles/screens.css` | 2 new recent-grid breakpoints |
| deleted | `src/pages/Home.outcome-multiselect.integration.test.jsx` | Multi-select feature gone |
| new | `src/pages/Home.outcome-singleselect.integration.test.jsx` | Single-select integration test |
| modified | `docs/V1.0-Screenshots/01-home-desktop-light.png` | Updated screenshot |
| modified | `docs/V1.0-Screenshots/23-home-outcome-tile-active.png` | Updated screenshot |
| new | `docs/capture-home-only.mjs` | Re-capture script for the home page |

## Open caveats (none blocking)

- **Pre-existing extractions** (no `user_id` / `session_id`) are hidden
  from the per-user Home widget. They still appear in the full
  Dashboard. If a user reports "my extractions disappeared" — they
  probably need to be re-saved or the migration could back-fill
  `session_id` from a one-shot script. Not a v1.0 issue.
- **The 5-column grid at ≥ 1180px** is dense. If feedback comes in that
  the cards feel too cramped at that width, drop to 4 columns at 1180px
  and reserve 5 for ≥ 1400px.

## Universal pattern (apply across projects)

- **When two on-screen affordances feel duplicated**, change the
  *labels* and clarify the *roles* — don't just remove one. Here
  "Common jobs" (fast-path picker) vs "What do you want to extract?"
  (precise selector) are two different things; the label change made
  the difference obvious.
- **Multi-select is rarely the right first interaction.** Default to
  single-select for pickers that pre-fill something; let the user
  combine explicitly via a free-text input if they need to. The Custom
  intent in this case is the right place for that.
- **Per-user widgets need owner tagging on the data, not just at read
  time.** Filtering on read is correct, but the data has to be tagged
  at write time — otherwise you can't distinguish "user A's item on a
  shared device" from "an item with no owner field". The new
  `getOwnerId()` in `extractionsRepo` mirrors the existing
  `getSessionId()` in `usageRepo` — same pattern, same data shape.

---

*Last updated: 2026-07-18 — Home UX cleanup shipped to main, tests green.*
