# DatIQ design-sync notes

## ⚠️ SECURITY: guidelinesGlob is deliberately disabled — never re-enable the default

- **`cfg.guidelinesGlob: []` is load-bearing, not incidental.** The
  converter's default (`docs/*.md`) matched this repo's ENTIRE top-level
  `docs/` folder on the first build — DB migration runbooks
  (`DB-MIGRATION-RUNBOOK.md`), ops runbooks (`OPS-MONITORING-RUNBOOK.md`),
  and ~20 session-handoff docs full of infra/deploy/admin-PIN/migration
  detail. `CLAUDE.md` is explicit that anything code/DB/infra/env-specific
  "goes ONLY in `docs/internal/`... never published" — a Claude Design
  project is exactly the kind of surface that must never see this. Caught
  and removed before the first upload (never pushed remotely). **If a
  resync ever needs real design guidance synced, hand-pick specific files
  via `guidelinesGlob` (e.g. a real style-principles doc, if one is ever
  written) — never restore the bare `docs/*.md` default.**

## Repo shape gotchas

- **No TypeScript, no library build.** `src/components/*.jsx` is plain JSX, no
  `.d.ts` anywhere, no `dist/` library entry (`vite build` produces an *app*
  bundle, not a re-exportable ES module). `exportedNames()`/`propsBodyFor()`
  therefore find nothing automatically — every synced component MUST have a
  `componentSrcMap` entry (that's how the component list gets populated at
  all) and every prop body falls back to `[key: string]: unknown;`. This is
  expected, not a bug — don't chase `[DTS_REACT]`/empty-props warnings here.
- **All components are `export default function Name(...)`.** The
  converter's own no-dist fallback synthesizes `export * from '<file>'` for
  every src file, but `export *` does NOT re-export a `default` — that
  auto-synthesis would silently produce empty exports for every single
  component. Fixed by hand-authoring `.design-sync/entry.mjs` (named
  re-exports) and passing `--entry .design-sync/entry.mjs` explicitly. If a
  component is added/renamed/removed in `src/components/`, this file AND
  `cfg.componentSrcMap` AND `cfg.docsMap` all need the matching edit — there
  is no auto-discovery here to fall back on.
- **Two files export only named bindings, not a default matching the
  filename**: `Toast.jsx` → `ToastProvider` (+ `useToast` hook, not synced),
  `ErrorModal.jsx` → `ErrorModalProvider` (+ `useErrorModal` hook, not
  synced). Registered under those real names, not "Toast"/"ErrorModal".
- **`cssEntry` points at the compiled `dist/assets/index-<hash>.css`**, not
  the raw `src/index.css` + `design-system.css` + `screens.css` stack — the
  raw stack starts with `@tailwind base/components/utilities` directives
  that only mean anything after PostCSS/Tailwind compilation; pointing
  `cssEntry` at raw source would ship literal `@tailwind` at-rules (no
  styling at all beyond the custom-property files). **The hash changes on
  every `npm run build`** — `cfg.buildCmd` is `npm run build`; after running
  it, re-check `dist/assets/index-*.css` and update `cfg.cssEntry` if the
  hash moved before re-running the converter.
- **Full app provider tree required.** Nearly every component reads
  `useAuth()`/`useBilling()`/`useExtraction()`/`usePersona()`/`useToast()`/
  `useErrorModal()`/`useGuestTrial()`/theme context, and several use
  `react-router-dom` hooks (`useNavigate`, `Link`). `cfg.provider` nests the
  same 8-provider chain `src/main.jsx`/`App.jsx` uses, wrapped in
  `BrowserRouter` (pulled in via `cfg.extraEntries: ["react-router-dom"]`
  since it's not otherwise a DatIQ export). If a 9th provider is ever added
  to `App.jsx`'s tree, add it here too or new components using it will
  render blank with a context error.
- **Grouping is manual.** All 50 components live flat in one directory (no
  subfolders to derive a group from, no JSDoc `@category` in source), so
  `.design-sync/docs/<Name>.md` stub files (frontmatter-only, `category: …`)
  drive `cfg.docsMap` purely for grouping. If a new component is added,
  either add a stub here or accept it landing in "general".

## Component quirks found while authoring previews

- **`WatchlistCard` writes a real localStorage watermark on mount**
  (`writeLastVisitedAt()` → key `datiq.workspaceLastVisitedAt`), and the
  capture harness's browser profile persists localStorage ACROSS separate
  `package-capture.mjs` runs, not just across cells within one page. An
  early multi-story attempt wrote a "just visited" timestamp that then
  leaked into every later capture (including a rebuilt single-story
  version), permanently misclassifying every row as stale/unchanged no
  matter what `lastChangeAt` the mock data used. Fixed two ways: (1) the
  preview clears that key at module scope before the component ever
  mounts, so this preview's classification is deterministic regardless of
  browser-profile history; (2) consolidated to ONE story
  (`MixedWatchlist`) showing changed/unchanged/never-run rows together —
  realistic anyway (a real watchlist is always a mix), and avoids ever
  relying on multiple `WatchlistCard` instances sharing one page's storage
  state cleanly.
- **Preview mock timestamps must be relative to `Date.now()` at render
  time, never a hardcoded calendar date.** `WatchlistCard`'s own
  `formatNextRun`/`classifyDelta` call `Date.now()` internally; an initial
  attempt hardcoded `now = new Date("2026-08-06T09:00:00Z")` to compute
  offsets, which produced "next check in 813d" once the real render
  clock (whatever day the build actually runs) disagreed with that fixed
  date. Fixed by computing offsets from `Date.now()` directly in the
  preview file.
- **A component with no seam to render real content is a floor-card case,
  not a `cfg.overrides.<Name>.skip` case.** `ExtractionProgressDock` (reads
  ephemeral in-flight state from `ExtractionProvider` that no prop/
  localStorage/exported-context lets a preview inject) and `SuspendedBanner`
  (reads `useAuth()`+`useBilling()` and correctly renders nothing unless a
  real suspended account is logged in) were first authored as one honest
  "shows nothing" story each and given `cfg.overrides.<Name>.skip:
  ["<StoryName>"]`. That's wrong: `skip` excludes a story from grading, not
  from `package-validate.mjs`'s render check, which still opens the `.html`
  and fails `[RENDER] root empty` — `skip` only helps when OTHER stories on
  the same component DO render. With exactly one always-empty story, the
  right fix is deleting the preview file entirely and letting the component
  fall back to the floor card, whose crash-prevention rendering path
  already swaps a truly-empty root for the honest "preview not yet
  authored" placeholder — exactly the right message for a component that
  structurally cannot show content outside a live app session.
- **Portal/fixed-position components need `cfg.overrides.<Name>.cardMode:
  "single"` with a `primaryStory` pick.** Every modal (`AuthModal`,
  `CommandPalette`, `ContentModal`, `DemoPaymentModal`, `EmailModal`,
  `ErrorModalProvider`, `GuestTrialModal`, `HotkeyHelp`, `InvoiceModal`,
  `NotifyMeModal`, `PaymentConfirmModal`, `PaymentProcessingModal`,
  `PlanChangeWarning`, `ToastProvider`, `TopupBundleModal`) renders via
  `position:fixed` or `createPortal(..., document.body)`, which escapes the
  product's grid cell — `package-validate.mjs` flags this as
  `[GRID_OVERFLOW]` and the fix is exactly what the warning suggests. Two
  components with real *in-flow* content that's simply wide
  (`ExtractSimilarCard`, `RecentExtractions`) needed `cardMode: "column"`
  instead (keeps every story, full width, one per row) rather than
  `"single"` (which drops all but one story). This is a config change, not
  a preview edit — it requires a FULL `package-build.mjs` re-run (not the
  scoped `preview-rebuild.mjs`), which fails fast with `[CONFIG_STALE]` if
  you try the scoped path after an overrides change.
- **`useErrorModal`/`useToast` are hooks, not components, and weren't in
  the original `.design-sync/entry.mjs`** (only the `*Provider` components
  were re-exported, to avoid giving them their own browsable card). But a
  provider-only component structurally CANNOT show visible content in a
  preview without something calling its hook — so the hooks needed
  re-exporting too (added to `entry.mjs`, without adding them to
  `componentSrcMap`, so they still don't get their own card — only
  `ErrorModalProvider`/`ToastProvider` do). Each preview composes the real
  pattern: a `ToastProvider`/`ErrorModalProvider` wrapping a tiny trigger
  child that calls the hook in a `useEffect` on mount.

## Capture-harness quirk: `.ds-single{transform:translateZ(0)}` traps fixed-position content

The single-story capture wrapper sets `transform: translateZ(0)` (a paint-perf
hint), which per spec makes it the CSS containing block for any
`position:fixed` descendant. A component whose own markup is a raw
`position:fixed` backdrop (not `createPortal`-ed to `document.body`) gets
trapped inside that wrapper's box instead of the real viewport — the
wrapper has no in-flow siblings so its auto height collapses near 0, and a
vertically-centered modal ends up centered around a point near the top of
the frame, cropping most of it off-screen. Three fixes were used across
this effort, pick whichever fits the component:
1. **`createPortal(<Component .../>, document.body)`** in the preview
   story — escapes `.ds-single` entirely by mounting outside it. Used for
   `DemoPaymentModal`, `PaymentConfirmModal`, `PaymentProcessingModal`,
   `TopupBundleModal`. (`PlanChangeWarning`/`InvoiceModal`/`ContentModal`/
   `EmailModal` already portal in their own source, so needed nothing.)
2. **`<style>{'.ds-single{transform:none!important}'}</style>`** rendered
   alongside the component — removes the containing-block trigger
   directly. Used for `GuestTrialModal` and `ToastProvider` (the real
   `.toast` rule is `position:fixed; bottom:28px` — same trap, initially
   missed because `ToastProvider` doesn't look like a "modal").
3. **A spacer wrapper with real in-flow height**
   (`<div style={{minHeight:680}}><Modal .../></div>`) — gives `.ds-single`
   non-zero auto height so `inset:0` resolves against the full frame. Used
   for `HotkeyHelp`, `NotifyMeModal`.

This is a **preview-harness-only** artifact — the real DatIQ Shell never
wraps route content in a `transform`, so none of this reflects an app bug.
Any future preview for a component with a centered, non-portaled
`position:fixed` overlay will likely need one of these three.

**Secondary, scroll-fold issue** (`PaymentConfirmModal`, `TopupBundleModal`):
cards with `max-height:90vh; overflow-y:auto` can have real trailing
content (a "Cancel" link, an upsell section) sit below the scrollable fold
at the 900×700 capture size. Fixed per-story with a `useLayoutEffect` that
raises the card's `max-height` to `calc(100vh - 24px)` and top-aligns the
backdrop (`alignItems:'flex-start'`) instead of centering it.

**`GuestTrialModal`'s soft-prompt state has no mount-time path and is a
permanent gap of this static, mount-only capture harness** — `showPrompt`
is set exclusively inside `trackGuestExtraction()`/`trackGuestBatchRun()`,
both of which only run after a real extraction completes; there's no prop,
localStorage seed, or context override that reaches it from a cold page
load. Only the two hard-block stories are authored; this is not a missed
story, it's unreachable from a preview.

## Real DatIQ bugs found while authoring previews (NOT fixed here — flagged to the user)

Design-sync only ever synthesizes previews; app source under `src/` is
never touched by this process. These were found incidentally while
authoring realistic previews and are genuine pre-existing bugs:

- ~~`BulkUploadModal.jsx` renders entirely unstyled in production.~~
  **FIXED** (cherry-picked from `claude/busy-wilson-a2efbf`, commit
  `f5d93ad` on this branch) — real `.modal-overlay`/`.modal-card`/
  `.modal-header`/`.modal-title`/`.modal-footer` rules added to
  `screens.css`. Re-graded `good` on the next resync. **This also newly
  triggered `[GRID_OVERFLOW]`** (the modal now genuinely uses
  `position:fixed`, so it hits the same `.ds-single` capture-harness trap
  as every sibling modal — see the section above) — added
  `cfg.overrides.BulkUploadModal: {cardMode:"single", primaryStory:
  "Default"}` and the same `.ds-single{transform:none!important}` preview
  fix used elsewhere. **Lesson for future resyncs: a shared-CSS-only fix
  does NOT change any component's `sourceKeys` hash** (that's keyed on the
  component's own `.jsx`/`.d.ts`/`.prompt.md` stub files, not the app's
  real source it re-exports), so the resync driver correctly reported "0
  changed" even though this component's actual rendered output changed
  completely. Don't trust "0 changed" alone after a styling-only upstream
  fix — check `[GRID_OVERFLOW]`/`[RENDER_THIN]`/`[TOKENS_MISSING]` in the
  validate output for components whose look plausibly shifted, and
  `--force` a recapture on anything the warnings flag.
- ~~`CreditEstimator.jsx` renders the literal string `(Infinity after this
  run)`~~ **FIXED** (cherry-picked, commit `2bd1202`) — non-compact trailer
  now guards on `isUnlimited` the same way the compact path already did.
  Not re-captured: the authored preview deliberately never demonstrated
  the buggy unlimited+non-compact combination, so no existing story's
  pixels change; nothing to re-grade.
- ~~`ReferralBanner.jsx` reads `plan?.bonusExtractions`~~ **FIXED** (same
  commit) — now reads `subscription?.bonusExtractions` like
  `UsageUpsellBanner` always did. Not re-captured: the authored
  `NearQuotaInvite` story's mock data didn't exercise the bonus-extensions
  field either way, so its render is unchanged.
- ~~`paywallCopy.js`'s default case hardcodes "free extractions"~~ **FIXED**
  (same commit) — only says "free" when the plan id actually is `"free"`.
  Not re-captured: the authored `UsageUpsellBanner` story used a Free-plan
  scenario, where "free extractions" was always correct copy; a paid-plan
  story would be needed to see this fix's effect, and none was authored.

## Known render warns (triaged, not new)

- `[DTS_REACT]` (`@types/react not found`) — expected on every build; this
  repo has no TypeScript at all, so React's utility-type inheritance was
  never in play anyway (nothing in `src/` extends `ComponentPropsWithoutRef`
  etc. — there's no TS to write that in). Not worth adding `@types/react` as
  a devDependency to the app just to silence this.
- `[TOKENS_MISSING]` — `--shadow-md`, `--r-xl`, `--danger`, `--r-md`,
  `--text-1` are referenced in `src/styles/screens.css` but never defined in
  `src/styles/design-system.css` (only `--shadow`/`--shadow-sm`/`--shadow-lg`,
  `--r-sm`/`--r-lg`/`--r-pill`, `--text-2`/`--text-3` exist). **This looks
  like a real, pre-existing bug in DatIQ's own CSS** (a handful of rules —
  e.g. `screens.css:2968` `border-radius: var(--r-xl)` with no fallback —
  silently lose that declaration in every browser), not a design-sync
  artifact. Flagged to the user as a follow-up outside this sync's scope;
  not fixed here.
- `[FONT_MISSING]` "Hanken Grotesk" — DatIQ loads it at runtime via a Google
  Fonts `<link>` in `index.html` (`fonts.googleapis.com/css2?family=Hanken+
  Grotesk...`), never as a shipped local file — this is how the real app
  behaves too, not a workaround. Suppressed via `cfg.runtimeFontPrefixes:
  ["Hanken Grotesk"]`. "Plus Jakarta Sans" is also preloaded in `index.html`
  but never referenced by any CSS custom property — dead weight, left alone.
- `[RENDER_THIN]` on `Icon` — the unauthored floor card mounts `<Icon/>` with
  no `name` prop (crash-prevention defaults only), which paints nothing.
  Expected until `Icon` gets an authored preview (§4) sweeping several
  `name=` values.

## Re-sync risks

- `cssEntry`'s hash-named path goes stale on every `npm run build` — see
  above. A resync that runs `buildCmd` without re-checking `cssEntry` will
  fail `[CSS_IMPORT_MISSING]` (or silently point at a file that no longer
  exists) the moment the old hashed filename is gone from `dist/`.
- `.design-sync/entry.mjs` is hand-maintained, not generated — it will not
  pick up a new component automatically. Same for `componentSrcMap` and
  `docsMap`.
- Provider chain in `cfg.provider` mirrors `App.jsx`'s tree by hand; if that
  tree changes (provider added/removed/reordered) this config silently goes
  stale rather than erroring — a newly-context-dependent component would
  just render blank.
- No TypeScript in the source repo — this is a structural fact of the
  DatIQ app, not something a future resync can "fix." All prop bodies will
  continue to be `[key: string]: unknown` unless hand-authored via
  `cfg.dtsPropsFor` per component (not done here — 50 components; deferred).
