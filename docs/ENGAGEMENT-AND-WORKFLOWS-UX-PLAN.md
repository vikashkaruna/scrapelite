# Engagement & Workflows — UX improvement plan (for approval)

> **Date:** 2026-09-24 · **Based on:** `staging` @ `949bc452` (after PR #221) · **Status:** ✅ **Phases A and B built**
> (branch `feat/engagement-ux-phase-ab`, PR #222); **Phase C (6b, 7, 8, 16–18) and Phase D (19–22) are planned, with decisions locked; nothing is built until the owner says build.** Each item says what was found in the code, what is proposed, what needs your decision,
> and how it will be tested.

**Legend:** 🟢 small (hours) · 🟡 medium (≈1 day) · 🔴 large (multi-day, schema change)

---

## 0. Summary and proposed order

| # | Item | Size | Phase |
|---|---|---|---|
| 1 | ✅ Pipeline board wraps to the page width — no horizontal scroll | 🟢 | A |
| 3 | ✅ Menu: divider inside the Workflows group (Engagement keeps its name) | 🟢 | A |
| 4 | ✅ Brand kit sign-off multi-line · test-mode banner non-technical | 🟢 | A |
| 6a | ✅ Workflows: stop the "ruleId is required." delete error | 🟢 | A |
| 9 | ✅ Home: hide the duplicate section; move its unique items; persona highlights | 🟢 | A |
| 10 | ✅ Import result names each duplicate and what it matched | 🟢 | A |
| 11 | ✅ Edit a prospect from the Prospects table (and the drawer) | 🟡 | A |
| 12 | ✅ Engagement docs brought up to date with everything shipped | 🟢 | A |
| 2 | ✅ Smart import: paste or upload CSV / Excel, row-by-row health, import healthy rows | 🟡 | B |
| 5 | ✅ Reuse the account Brand Kit in Engagement (Business / Agency) | 🟡 | B |
| 6b | Real links between lists / watchlists and rules; safe delete and unlink | 🔴 | C |
| 7 | Lists, Watchlists, Rules: busy indicator + UX rebuild | 🔴 | C |
| 8 | Workflows hub: proper name, wiring and layout | 🟡 | C |
| 16 | Home "Common jobs": 12 tiles (was 7), adding Discover / Compete / Engage / Connect / Templates jobs | 🟢 | C |
| 17 | Home "From signal to next step": DatIQ Engage (BETA) → Engagement, DatIQ Compete → Workflow hub; hero card gains an Engage tile (Discover · Connect · Compete · Engage) | 🟢 | C |
| 18 | `/templates` becomes the template hub: 9 new templates that run or open the right module | 🟡 | C |
| 19 | Eight roles replace the seven personas (existing ids kept where a role carries forward) | 🟡 | D (build first) |
| 20 | Onboarding face-lift: what each role can do, modules, outcome, first step | 🟡 | D |
| 21 | New roles applied everywhere personas are used (Templates filter, Home, Gallery, packs…) | 🟡 | D |
| 22 | Public pages refreshed (compare, use-cases, blog, changelog, help, FAQ); version numbers removed | 🟡 | D |

**Phase A** (now including 10–12) is safe to ship on its own in one PR. **Phase B** adds one small dependency. **Phase C** needs
migration **`0084`** (`0083` went to the account Brand Kit in Phase B) and changes how rules match events, so it gets its own PR and staging pass.

**Decisions** are collected in §13 — **all locked by the owner on 2026-09-24.** Nothing in Phase C or D is built until the owner says build.

---

## 1. Pipeline board — fit the page instead of scrolling 🟢

**Now:** 9 stage columns in one row (`grid-auto-flow: column`), ~5 visible at 1240px, the rest behind a
horizontal scrollbar. No single view of the whole funnel.

**Proposal**
- Columns **wrap into as many rows as the width needs**: `grid-template-columns: repeat(auto-fill, minmax(210px, 1fr))`.
  ≈5 per row on a laptop, 3–4 on a tablet, 1–2 on a phone — every stage visible without sideways scrolling.
- **Empty stages collapse** to a slim header (title + "0") so a sparse campaign doesn't spend a full row on
  "None". A "Show empty stages" toggle restores full columns.
- Stage order reads left→right, then the next row, so the funnel still reads in order.
- Long columns scroll **inside the column** after ~6 cards ("+ N more" link opens the Prospects tab filtered
  to that stage), so one busy stage can't push the rest off-screen.

**Tests:** component test — every stage renders with no horizontal overflow at 375 / 768 / 1280px
(via the harness screenshots); empty-stage collapse toggles.

---

## 2. Smart import — paste or upload, check every row, import the healthy ones 🟡

**Now:** a textarea only. Pasting cells copied from Excel already works (they arrive tab-separated),
but there is no file upload, no row-by-row preview, and nothing about files.

**Proposal**

*Input — any of these, in one drop zone:*
- **Paste text** — CSV, semicolon or tab-separated, including cells copied straight from Excel or Google Sheets.
- **Paste or drop a file** (Ctrl/⌘-V a copied file, or drag it in), or **Upload file** button under
  **Download template**.
- Formats: **`.csv`, `.tsv`, `.txt`, `.xlsx`**. `.xls` (Excel 97–2003) and `.numbers` are refused with
  "Save it as .xlsx or CSV and try again". Limits: 5 MB and 1,000 rows (the server's cap), each with its own message.
- Excel reading uses **`read-excel-file`** (MIT, lazy-loaded only when an .xlsx is picked, never in the main
  bundle). Multi-sheet workbooks ask which sheet. ⚠️ Not SheetJS: its npm package is unmaintained and carries
  known advisories that would fail the security gate.

*Check — before anything is sent:*
- A **preview table** of the rows with a status per row: ✅ ready · ⚠️ already in this campaign ·
  ⛔ opted out on email · ❌ problem (with the reason: bad email, no email/phone, shifted columns, repeated).
- Summary bar: **"212 ready · 9 need fixing · 4 already in the campaign · 2 opted out"**.
- **"Show problems only"** filter and **"Download problem rows (CSV)"** so rows can be fixed in Excel and re-uploaded.
- File-level messages: unreadable file, wrong format, empty sheet, no email or phone column (naming the columns found).
- "Already in the campaign" and "opted out" come from a new **read-only `preview_import`** action, so
  the preview matches what the import will do.

*Import:*
- **"Import 212 ready rows (skip 15)"** — enabled whenever at least one row is healthy; problem rows are skipped
  and listed in the result panel, which already exists.

**Tests:** parser unit tests for each format (fixture .xlsx, .csv with BOM, TSV from Excel paste, oversize,
.xls refusal); `preview_import` against real Postgres (two tenants, duplicates, suppressions); UI test for
partial import.

---

## 3. Menu — a visible workflow group 🟢

**Now (user menu → Workflows):** Overview · Engagement · Account Lists · Watchlists · Signal Rules, no separation.

**Proposal (owner direction 2026-09-24): keep "Engagement" as the menu item — no rename.**
```
WORKFLOWS
  Workflow hub          ← renamed from "Overview" (see §8)
  Engagement            ← unchanged, /engagement
  ─────────────         ← soft divider
  Account lists
  Watchlists
  Signal rules
```
Same order and divider in the mobile menu. The /engagement page heading is unchanged.

**Deferred (owner), now planned:** the home-screen "DatIQ Engage" link to /engagement is item §17 (Phase C).

**Tests:** TopBar tests assert order, divider and targets (desktop + mobile).

---

## 4. Brand kit sign-off, and a non-technical test-mode banner 🟢

**Sign-off:** becomes a multi-line field (e.g. "Priya Sharma\nHead of Growth, Acme"). The server keeps line
breaks (max 4 lines / 200 chars); the email body renders them as lines and the HTML version as `<br>`,
escaped. Existing single-line sign-offs are unaffected.

**Test-mode banner:** everyone sees the non-technical line:
> **Test mode — messages are not delivered from this environment.** Sends are simulated and marked "Test send".

The technical hint (`ENGAGEMENT_MOCK_SEND`, Resend) appears **only in non-production contexts**, from a
server flag (`ops_hint`) — so production never names internal settings or providers even if the banner
ever shows there. (Production already refuses simulated sending.)

**Tests:** generator test for multi-line sign-off in text and HTML (escaped); page test that the ops hint
is absent unless the server sets it.

---

## 5. Reuse the account Brand Kit in Engagement 🟡

**Found:** the account Brand Kit (Account → Brand kit) is gated to plans with `white_label_pdf`
(**Business, Agency**), has company name, tagline, accent colour, footer, website, contact email and logo —
and is stored **only in that browser's localStorage**. The server cannot see it.

**Proposal**
- In Engagement → Brand kit & sender, a **"Use my account brand kit"** button for Business/Agency accounts
  (for other plans: shown locked with "Available on Business and Agency").
- It **fills the form, it does not save**, so you review before saving. Mapping:

| Account Brand Kit | → Engagement |
|---|---|
| Company name | Company / product name |
| Tagline | What you offer (editable) |
| Website | Link URL |
| Contact email | Reply-to |
| Footer text | Sign-off (multi-line, §4) |

- **Decision (§13-D5):** because the account kit lives in one browser, the button only works on the device
  where it was set up. Option **B** stores the account Brand Kit's text fields server-side
  (new `account_brand_kits` table in `0083`; logo stays local), so it works on every device and the
  server can check the plan. I recommend B.

**Tests:** entitlement-gated rendering; mapping unit test; (option B) store + RLS tests in db-verify.

---

## 6. Workflows: links, unlinking and safe deletion

### 6a. The "ruleId is required." error 🟢 (root cause found)
The Workflows page builds the rows **"Account Lists (Unconnected)"** and **"Competitor Watchlists (Unconnected)"**
on the fly, whenever lists or watchlists exist with no rule listening. They are not stored workflows and have no
rule ID, but they still show a **Delete** button, which calls `deleteRule(undefined)`. The server correctly refuses,
and its raw message reaches the screen.

**Fix:** these rows get **"Connect a rule"** and **"Manage lists / watchlists"** instead of Delete. A real rule's
Delete names what stops ("Alerts for 3 watchlists will stop"). Error messages are written for people, never raw
server text.

### 6b. Real relationships between lists, watchlists and rules 🔴
**Found:** there are **no stored links**. A rule listens to a *kind* of event — every watchlist, or every list —
so "this rule is for these two watchlists" cannot be expressed, and deleting a watchlist can't say which rules use it.
List events already carry `list_id`; **watchlist events don't carry the watchlist ID** yet.

**Proposal**
- **Migration `0084`:** `signal_rule_sources (rule_id, source_type 'list'|'watchlist', source_id)`, unique per
  triple, cascading with the rule, RLS service-only (the `0044` pattern).
- **Scope per rule:** "All watchlists" (today's behaviour, and what existing rules keep) **or** "These watchlists: …".
- **Matching:** the rule dispatcher honours the scope; the watchlist monitor adds `watchlist_id` to its event.
  ⚠️ **A rule never widens silently:** if its last linked source is deleted or unlinked, it **pauses** with
  "No sources left", rather than falling back to "all".
- **Deleting a list or watchlist** that a rule uses returns a clear conflict:
  > "This watchlist is used by 2 rules: *Pricing alerts*, *Weekly digest*."
  > [Unlink and delete] [Open the rules] [Cancel]

  No silent cascade, no orphans.
- **Every screen can maintain the relationship:**
  - A list or watchlist shows **"Used by rules"**, with Unlink and Link to a rule.
  - The rule editor has a **Sources** picker (All / chosen ones).
  - The Workflows hub shows each real pipeline as rule + its sources, with Unlink.
- **Full CRUD everywhere:** add, edit (rename, change scope), pause/resume, unlink, delete (blocked while linked,
  or "unlink and delete"), with confirm dialogs, never `window.confirm`.

**Tests:**
- Real-Postgres two-tenant suite: scoped vs all rules, the no-silent-widening pause, delete conflict, unlink.
- A mutation check in the style of the P0 one for "scope ignored" and "silent widening".
- A contract test that watchlist events carry the watchlist ID.

---

## 7. Lists, Watchlists, Rules — busy indicator and a UX rebuild 🔴

**Found:** each page is 760–980 lines with **84–141 inline styles** each (≈420 in total), its own grey
"Loading…" blocks, `window.confirm` for deletes, and raw error text.

**Proposal**
- **Shared busy indicator:** the "DatIQ is working…" card from Engagement becomes a shared component plus a
  `useBusy()` hook, used on every load, save, delete, enrichment run and "Check now". Skeletons for the first load,
  the busy card for actions.
- **One page pattern for all three:** the same shell as the Engagement page.
  - Header with one primary action.
  - A list of items on the left and details on the right (stacked on mobile).
  - Empty states that say the next step.
  - Inline validation in forms.
- **Screen flows:**
  - **Account lists:** Create → paste or upload domains (reuses the §2 importer) → enrich → see scores →
    "Used by rules". Progress per row.
  - **Watchlists:** Create → add competitors → choose what to watch and how often → changes feed →
    "Alert me" (creates or links a rule).
  - **Signal rules:** a 3-step builder: *When* (source kind + scope) → *If* (conditions, with the existing dry-run
    preview) → *Then* (destination), with a live sentence summary: "When a watched competitor changes pricing,
    post to #sales".
- The ≈420 inline styles move to design tokens (dark mode by construction), error toasts use the error tone,
  and every confirm is a DatIQ dialog.

**Tests:**
- Page tests rewritten per screen (busy shown during slow calls, delete conflict dialog, empty states).
- Screenshot harness at light/dark × desktop/mobile for review before merge.

---

## 8. The Workflows page — name, wiring, layout 🟡

**"Overview" is too vague** — it reads like an account overview. Options:

| Name | Pros | Cons |
|---|---|---|
| **Workflow hub** *(recommended)* | Says what it is; pairs with the "Workflows" menu group | — |
| Pipelines | Accurate | Jargon for non-technical users |
| Automations | Familiar | Suggests Zapier-style builders |

**Proposed hub layout (top to bottom):**
1. **Needs your attention** — the existing issue list, with one-click fixes (kept first on purpose).
2. **Your pipelines** — one card per real pipeline (source(s) → rule → destination), health, last run,
   Pause / Edit / Unlink. The synthetic "Unconnected" rows become a **"Not connected yet"** strip with
   "Connect a rule".
3. **Building blocks** — counts and shortcuts for Account lists, Watchlists, Signal rules and Engagement.
4. **Recent runs** — the executions list.

**Optional wiring:** a rule action **"Add to an Engagement campaign"**, so a high-scoring account or a
competitor change can feed outreach. **Decision §13-D8** — it is new scope and needs its own consent rules
(an account signal is not consent to email a person).

---

## 9. Home page — remove the repetition 🟢

**Found:**

| "What can DatIQ extract from a page?" | also in "What do you want to extract?" | also in "Common jobs" |
|---|---|---|
| AI summary, Custom, Domain mapping, Contacts, Pricing | ✅ | Pricing, Contacts (as "Build a lead list") |
| **Heading structure, Every link** | ❌ | ❌ |
| **Content generation** | ❌ | ❌ |

**Proposal**
- **Hide** "What can DatIQ extract from a page?" (code kept, not rendered, so it can return).
- **"What do you want to extract?"** gains one brief chip: **"Page structure"** (headings + links).
- **"Common jobs"** gains one tile: **"Write a content brief"** (SEO outline and brief from a page).
- **Persona highlighting** moves to these two sections: each persona's `featuresHighlight` keys map to the
  matching chip or tile, which gets the persona colour and a "Recommended" tag (e.g. SEO → Page structure,
  Map site; Agency → Content brief; Sales → Find contacts, Build a lead list).
- The public help text and prerendered home page are regenerated.

**Tests:** Home tests assert the section is hidden, the new chip/tile exist and work, and persona recommendations
land on chips/tiles; prerender refreshed.

---

## 10. Import — say which rows were duplicates, and why 🟢

**Found:** the server already returns each duplicate row with the reason ("Duplicate email: ana@acme.com"),
but the result panel shows only a count ("Already in this campaign (skipped): 3"), so you cannot tell which
contacts were skipped or check them.

**Proposal:** the result panel lists every skipped row, grouped by reason:
- **Already in this campaign**: name, email, and what matched ("same email as *Ana Lopez*, added 12 Sep").
- **Repeated within your paste**: which line repeated which ("line 7 repeats line 3").
- **Rejected**: line and reason (already shown before import; repeated here for the record).

Plus a one-line headline such as **"Imported 18 of 25 — 5 were already in this campaign, 2 repeated in
your paste"**, a **"Download skipped rows (CSV)"** button, and a link to open an existing prospect.
The Phase B preview (§2) shows the same duplicates *before* you press Import.

**Tests:** UI test with a server response containing duplicates, asserting the names and reasons shown;
server test that the duplicate list names the matching existing prospect.

---

## 11. Edit a prospect 🟡

**Found:** there is no way to correct a prospect after import. The API has status, notes, opt-out and delete,
but no edit.

**Proposal**
- **Edit** on each Prospects-table row and in the drawer header. It opens a form with first/last name,
  email, phone, company, role, industry and country.
- New server action **`update_prospect`**:
  - Only those fields are accepted, and ownership is checked (the same safeguards as campaign edits).
  - Email and phone are normalised the same way as on import.
  - A duplicate within the campaign is refused with a name: "*ana@acme.com* is already *Ana Lopez* in this campaign".
- **Changing the email or phone:**
  - Consent follows the **address**, so the consent panel updates to the new address's status.
  - An opt-out recorded on the old address stays on the old address.
- **Open drafts** for that prospect are regenerated with the corrected details, using the same rules as the
  brand-kit refresh: edits made by hand are kept, and an approved but unsent message goes back to review.
- **Not editable:** stage (it has its own control), score, and history. A **"details edited"** entry is written
  to the prospect's activity log.

**Tests:**
- Real-Postgres tests: allow-list (a `user_id` or `status` in the body is ignored), cross-tenant edits are a 404,
  a duplicate email is refused with a name, and drafts refresh with hand edits kept.
- UI test for the edit form.

---

## 12. Documentation brought up to date 🟢

**Found:**
- `PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md` still walks through the pre-review UI: n8n, multi-channel
  dispatch, localStorage demo mode. It is only marked "superseded in part".
- The public user guide (`/help`) has **no Engagement section** at all.
- The review doc (`PROSPECT-ENGAGEMENT-ENGINE-REVIEW-AND-ROLLOUT.md`) is current for decisions and status,
  but not as a how-to.

**Proposal:**
1. **Rewrite `PROSPECT-ENGAGEMENT-ENGINE-TEST-AND-CONFIG.md`** as the current **user and operator walkthrough**.
   It covers every screen as it now exists:
   - campaigns (create, edit, delete, unique names);
   - import (template, paste and upload, header-less rows, the check and the result, duplicates);
   - pipeline;
   - review and send (test mode, Test send labels);
   - prospects (table, edit, drawer, consent per channel, notes, activity);
   - results;
   - brand kit and sender (refresh of unsent drafts, account brand kit);
   - the busy indicator and error messages;
   - configuration and the manual test script (M-1…M-16 plus new checks for 10, 11 and Phase B/C).

   Old content moves to a short "history" note, not deleted silently.
2. **User guide (public help):** add an **"Engagement (beta)"** section. **Decision §13-D12:** publish now
   (visible to everyone while the module is private beta) or keep it internal until general availability.
   I recommend internal until GA, so the public site doesn't advertise a feature most accounts cannot open.
3. The review doc and `CLAUDE.md` get a dated entry for each phase as it ships; this plan's items are ticked
   off in place.

---

## 16. Home "Common jobs" — 12 tiles that fill whole rows 🟢

**Now:** 7 tiles in a grid that is 6 columns on desktop, 3 on tablet and 2 on phone. The seventh tile
("Write a content brief", added in Phase A) sits alone on a second row at every width.

**Proposal:** **12 tiles**. Twelve divides evenly at every width: 2 rows of 6 on desktop, 4 rows of 3 on
tablet, 6 rows of 2 on phone. (A 9-tile set fits tablet but leaves a half row of 3 on desktop.)
The 7 existing tiles stay. 5 new tiles reach the modules beyond a single extraction:

| New tile | Module | What a click does |
|---|---|---|
| **AI visibility check** | Discover | Opens `/discoverability` with the URL in the box prefilled (never auto-runs, because an audit uses quota) |
| **Watch a competitor** | Compete | Opens `/watchlists` with a new watchlist prefilled from the URL in the box |
| **Account brief** | Templates | Opens `/templates?key=account_brief` with the domain prefilled |
| **Start an outreach campaign** | Engage | Opens `/engagement` → New campaign (beta accounts only, see below) |
| **Send results to your CRM** | Connect | Opens `/integrations` (HubSpot, Notion, Airtable, Slack, Google Sheets) |

- **Two kinds of tile, told apart on screen.** Today every tile fills the composer, where you still press
  Extract. The new ones open another screen, so they get a small "Opens Discover →" line and an arrow
  icon, so a click never lands somewhere unexpected.
- **Engagement is private beta.** For accounts not in it, that tile is replaced by **"Weekly pricing
  watch"** (a Schedules preset), so the count stays 12 (D16b). The Home page reads the existing
  engagement access call; if that call fails, the replacement tile is shown.
- **Persona "Recommended" tags** extend to the new tiles: SEO → AI visibility check; Sales → Account brief
  and Start an outreach campaign; Competitive intel → Watch a competitor.
- **Data:** `outcomeTiles.js` gains an optional `to` / `handoff` field beside `example` / `prompt`. It stays
  one list, so tests and analytics keep a single source.
- **Also updated:** the e2e specs (`claims-verification`, `home`) that pin 7 tiles, and the tile-count test.

**Tests:** 12 tiles with no empty cells at 375, 768 and 1280px (checked in the screenshot harness); each
new tile goes to the right route with the right prefilled state; Engagement is swapped for "Weekly pricing
watch" when access is denied or the access call fails; the Discover tile never starts an audit.

---

## 17. Home "From signal to next step" — Engage and Compete lead somewhere 🟢

**Now** (`src/lib/platformModules.js`):
- **DatIQ Engage** is marked *Upcoming* and has no link, which is now wrong: Engagement is in beta.
- **DatIQ Compete** links to `/watchlists`, which is one piece of the pipeline, not the whole of it.

**Proposal**

| Card | Status | Button | Goes to |
|---|---|---|---|
| DatIQ Engage | Upcoming → **Beta** | "Open Engagement" | `/engagement` |
| DatIQ Compete | Beta (unchanged) | "Open Workflow hub" | `/workflows` |

- A visitor outside the beta reaches Engagement's existing "private beta" page, which explains the beta
  instead of showing a 404 (D17). A signed-out visitor is asked to sign in, as on every private page.
- The Engage description changes from "organise … outreach workflows" to what ships: campaigns, reviewed
  drafts, per-channel consent, results.
- `/engagement` and `/workflows` are both private routes, and a link from Home does not change their
  noindex state.
- This closes the home-screen "DatIQ Engage" link deferred in §3.
- **The Engage card shows the "BETA" status badge** (the badge style the Discover, Compete and Connect cards
  already use) and its button goes to **`/engagement`** (owner, 2026-09-24).

**17b. The "DatIQ intelligence" hero card gets an Engage tile (owner, 2026-09-24).**

**Now:** the preview card beside the hero (`DashboardReveal` in `Home.jsx`) has 3 tiles:
- Discover → `/discoverability`;
- Connect → `/integrations`;
- Compete → `/lists`.

**Proposal:** 4 tiles, in this order.

| Tile | Icon | Goes to |
|---|---|---|
| Discover | scan-search | `/discoverability` (unchanged) |
| Connect | share | `/integrations` (unchanged) |
| Compete | eye | **`/workflows`** (Workflow hub), not `/lists` — so it matches the Compete card below (D17c) |
| **Engage** | users | **`/engagement`**, with a small "Beta" marker |

- **Layout:** the card is at most 430px wide, and `.hdr-signal-grid` is 3 columns today, so a 4th tile would
  sit alone on a second row. It becomes **4 across** in one row; the labels are short enough at the current
  size. Below 400px it becomes a **2 × 2** grid. No other style changes.
- **Access:** as with the Engage card, a visitor outside the beta lands on Engagement's "private beta" page,
  and a signed-out visitor is asked to sign in.
- **Accessibility:** each tile keeps its `aria-label` ("Open Engagement (beta)"), and the tiles stay in the
  same tab order.

**Tests:**
- 4 tiles in the order Discover, Connect, Compete, Engage, each with its route;
- Engage carries the Beta marker;
- no empty grid cell at 375, 768 and 1280px;
- the Home e2e smoke spec is updated.

**Tests:** `Home.test.jsx` checks both cards' status, button text and route. `hasModuleCta` now returns true
for Engage. The existing test that every card with a button leads somewhere real keeps passing.

---

## 18. `/templates` becomes the template hub 🟡

**Now:** 11 published templates, grouped by role. Two of them already open another module instead of
running on the page, through the `HANDOFF` map in `Templates.jsx`:
- *SEO / GEO / AEO Audit* opens Discoverability;
- *Bulk ICP Enrichment* opens Account lists.

There are no templates for watchlists, signal rules, Engagement, schedules or integrations, and the page
cannot be filtered by module.

**Proposal: 9 new templates**, all built on the existing `HANDOFF` pattern or the existing runner. None
needs a new engine.

| # | Template | Role | Module | Kind |
|---|---|---|---|---|
| T1 | **Competitor Change Monitor** — watch pricing and positioning pages; alert on change | Competitive intel | Compete → `/watchlists` | Opens module, prefilled (domains, cadence) |
| T2 | **Price-change Alert to Slack** — a signal rule on watchlist price changes | Competitive intel, RevOps | Compete → `/rules` | Opens module, prefilled (trigger, action) |
| T3 | **Account Research → Outreach Campaign** — enrich a list, then draft reviewed emails | Sales | Engage → `/engagement` | Opens module (beta), prefilled (campaign name, import) |
| T4 | **Event / Webinar Follow-up** — import attendees, one reviewed draft each | Sales, Marketing | Engage → `/engagement` | Opens module (beta) |
| T5 | **Weekly AI Visibility Monitor** — a scheduled discoverability audit with alerts | SEO | Discover → `/schedules` (audit monitor) | Opens module, prefilled |
| T6 | **Local & Directory Consistency Check** — NAP across directories | SEO, Agency | Discover → `/discoverability` (local) | Opens module |
| T7 | **Business Truth Setup** — confirm legal name, domain and facts before audits | SEO, Agency | Discover → `/discoverability` (truth record) | Opens module |
| T8 | **ICP List → CRM** — enrich an account list and push it to HubSpot / Airtable / Sheets | Sales, RevOps | Connect → `/lists` then Push | Opens module, prefilled |
| T9 | **Competitor Content Brief** — read a competitor page, write a brief that beats it | Marketing, SEO | Runs here | Existing runner, `summarize` + brief prompt |

That makes 20 templates (11 + 9). The seed file's rule "don't build 30 templates before seeing adoption"
still applies. Eight of the nine are entry points into shipped modules, not new extraction recipes, so they
add reach without new engines to maintain. Adoption per template is already tracked (`template_runs`,
analytics); read it before a further round (D18a).

**Page changes that make it a hub**
- **Two filter rows:** *Role* (as today) and **Module** (All · Extract · Discover · Compete · Engage ·
  Connect). The special-case "workflows" filter at `Templates.jsx:97` is replaced by a real `module` field
  on each template.
- **Each card shows its kind:** "Runs here · N credits" or **"Opens in Watchlists →"**. A card that opens a
  module prefills that module's form; it never starts work, spends credits or saves anything on the user's
  behalf.
- **Plan and beta gates are shown on the card, not discovered after the click:** Engage templates for
  accounts outside the beta, watchlists and rules on plans without `scheduled_monitoring` / `integrations`.
  A locked card says what unlocks it (D18b).
- **"Back to template" link:** a module opened from a template keeps a link back, so the hub works as a
  starting point you return to.
- The Workflow hub (§8) shows the templates that fit its empty-state gaps ("No watchlist yet → Competitor
  Change Monitor"), so both pages point at each other.

**Mechanics**
- New templates go in `seedTemplates.js`. `ensureSeeded` inserts any **new** key on the next catalogue read,
  so there is **no migration**. ⚠️ It does not republish an **existing** key, so any change to the 11
  current templates needs a version bump, not an edit in place.
- Each new module's page reads its prefill from router state, as `/discoverability` and `/lists` do.
  Watchlists, Rules, Schedules and Engagement need that small addition.
- ⚠️ **A published template that opens a module must have a `HANDOFF` entry.** Otherwise it falls through
  to the page runner, which would run an extraction the template never described (the runner-404 hazard the
  seed file warns about). `templateContract.test.js` gains that parity check, which also covers a `HANDOFF`
  entry whose template no longer exists.

**Tests:**
- the contract parity check above;
- per template, the module opened and the exact prefilled state;
- the module filter, and the role and module filters combined;
- locked cards for a plan without the capability and for a non-beta account;
- the Workflow hub's empty state links to the right template;
- screenshots at 375 / 768 / 1280px.

---

## Phase D — Roles, onboarding and the public story

> Added 2026-09-24 at the owner's request. **Plan only; nothing is built until the owner says build.**
> Phase D is independent of Phase C except in one place. §19 (the role model) feeds Phase C's persona
> "Recommended" tags (§16) and template roles (§18), so it is built **first**, and the rest of C and D
> build on it.

## 19. Eight roles replace the seven personas 🟡

**Now:** `personaConfig.js` has 7 personas: Sales, Competitive Intelligence, SEO / Content, Market
Researcher, Recruiter, Founder / VC, Agency / Enterprise. **The ids are stored data, not just labels.** They
live in:
- `localStorage` and the user's `user_metadata`;
- `public_reports.persona`, where a CHECK constraint (`0025`) allows only these 7 ids;
- `workflow_templates.persona`;
- analytics events and PQL activation rules.

**Proposal: the owner's 8 roles.** Existing ids are kept wherever a role carries forward, so no user's saved
choice, shared report or analytics history breaks.

| # | Role (label) | id | From today's persona |
|---|---|---|---|
| 1 | Sales, SDR & BDR | `sales` | Sales — kept |
| 2 | RevOps & Growth Operations | `revops` | **new** |
| 3 | Product Manager & Competitive Intelligence | `competitive-intel` | Competitive Intelligence — kept, relabelled |
| 4 | Product Marketing Manager | `pmm` | **new** |
| 5 | SEO, Content, AEO & GEO | `seo` | SEO / Content — kept, relabelled |
| 6 | Brand, Growth & CRO | `brand-growth` | **new** |
| 7 | Founder, VC & Market Research | `founder-vc` | Founder / VC — kept; **absorbs `market-research`** |
| 8 | Agency, Enterprise & Consultant | `agency` | Agency / Enterprise — kept, relabelled |

- **Retired ids stay valid.** `market-research` resolves to `founder-vc` through a `LEGACY_PERSONA_ALIASES`
  map, so a saved choice silently becomes the merged role. `recruiter` is not in the owner's list and has
  no close match. It stays a **hidden legacy role**: users who chose it keep their experience, but it is
  not offered in onboarding or the filters. Its template and `/use-cases/recruiting` stay reachable under
  "All" (D19b).
- **Each role gains the owner's content** as structured fields, so every surface reads one source:
  - `job` (the primary job, one line);
  - `jobs[]` (3–5 short jobs, each tagged with the module that does it);
  - `modules[]`;
  - `outcome`;
  - `firstStep` (the one best first action, with a route).

  The existing fields (tagline, example chips, quick actions, dashboard labels, guide tip, demo URL) are
  written for the 3 new roles and revised for the 5 relabelled ones.
- **Claims are checked before they ship.** The pasted copy names things at different stages of readiness:
  - some are shipped: share of voice, truth record, local/NAP, entity graph, benchmarks and rollups, branded
    reports, API and webhooks;
  - some are partial or not yet a feature: "visibility-to-landing-page intelligence", "experiment insights",
    "deduplication and scoring for inbound lists".

  Each module tag must name a real route. Anything not shipped is either dropped or shown as "Coming", the
  same rule `platformModules.js` already enforces. The `[datiq]` citation markers are removed.
- **Migration** (the next free number when built; `0085` if Phase C's `0084` lands first):
  - widen `public_reports_persona_check` to the 8 ids **plus** the 2 legacy ids;
  - mirror the list in `admin-gallery.js`.

  Legacy ids stay allowed so no existing row fails the constraint.

**Tests:**
- a parity test that derives from `PERSONAS`: every role has an entry in every per-role map (Home chips and
  tiles, recipe packs, discoverability persona packs, PQL, the AI summary framing, gallery, templates);
- a legacy test: `market-research` resolves to `founder-vc`, and `recruiter` still renders;
- db-verify: the widened CHECK accepts new and legacy ids and rejects an unknown one.

---

## 20. Onboarding face-lift — "what you can do here, and where to start" 🟡

**Now (`/onboarding`):** two steps.
1. "What best describes your work?" shows 7 small icon-and-label cards.
2. A starter pack, a name field and a welcome message.

The page never says what each role can **do** in DatIQ, which modules they will use or what they get out
of it.

**Proposal: same two steps, and each one does real work.** Built with the existing hero-card, `ob-*`,
theme tokens and persona colours; no new visual language.

*Step 1 — Choose your role*
- **Hero card** at the top, in Home's hero style: the eyebrow "Set up DatIQ for your work", the H1 "What do
  you want DatIQ to do for you?", and one supporting line.
- **8 role cards** in a grid: 4 columns on desktop, 2 on tablet, 1 on phone, so 8 fills whole rows. Each
  card shows the icon, the role and its **primary job** in one line, so the cards can be told apart without
  hovering.
- **Selecting a role opens a detail panel** beside the grid on desktop and below the chosen card on
  phones. It has:
  - **What you can do:** 3–5 jobs, each with a module chip (Extract · Enrich · Discover · Compete ·
    Engage · Connect · Templates · Workflows) showing its status (Available / Beta);
  - **Modules you'll use**, as chips linking to each module's page (open in a new tab only after
    onboarding ends, so the flow isn't broken);
  - **The outcome**, in one sentence;
  - **Start here:** the role's `firstStep`, for example SEO → "Run your first visibility audit".
- **Accessibility:** the grid is a `radiogroup` (arrow keys move, Enter selects), and the panel is linked by
  `aria-controls` and announced politely. Motion respects `prefers-reduced-motion`.

*Step 2 — Your starter setup*
- The starter-pack picker stays, filtered to the role.
- An optional name field.
- A **"Your first three steps" checklist**, built from the role's jobs. Each step links to its module, the
  third usually to a template in the hub (§18).
- **Finish** goes to the role's `firstStep`, not a blanket `/`.

*Everywhere:*
- The top bar stays.
- "Skip for now" is always visible.
- The choice saves to `user_metadata` as it does today.
- Choosing again later (Switch role) reopens the same page with the current role selected.

**Tests:**
- 8 cards render;
- keyboard selection;
- the detail panel content comes from `PERSONAS`;
- every module chip and `firstStep` resolves to a real route (the parity test from §19);
- Finish navigates to `firstStep`;
- a legacy `recruiter` user reopening onboarding sees no card selected, rather than an error;
- screenshots at 375 / 768 / 1280px, light and dark.

---

## 21. The new roles wherever personas are used 🟡

| Surface | Change |
|---|---|
| **`/templates`** | Role filter shows the 8 roles. A template can serve **several** roles (e.g. Account Brief → Sales, RevOps; Competitor Pricing → PM & CI, PMM). The roles come from a `TEMPLATE_ROLES` map in code, **not** from the stored `persona` column. That avoids republishing all 20 templates as new versions just to retag them, since `ensureSeeded` never updates an existing key. `?filter=market-research` still works through the alias. |
| **Home** | Hero tagline, example chips, quick actions, guide tip and "Recommended" chips and tiles for all 8 roles (feeds §16). |
| **Onboarding recipe packs** (`extractionTemplates.js` `RECIPE_PACKS`) and **`RecipeGallery`** | A pack per new role. |
| **Discoverability** `personaPacks.js` | Packs for PMM (claims and category language) and Brand & CRO (truth record, share of voice, trust). |
| **PQL** `pqlModel.js` | An activation condition for each new role. |
| **AI summaries** (`aiService.js` audience framing) | A framing line per new role. |
| **Dashboard / Workspace labels**, **TopBar** role dot, **Switch role** | Read from `PERSONAS`, so they need no change beyond the data. |
| **Gallery** persona filter + **Admin → Gallery** curation | 8 roles. Legacy-tagged reports keep showing under "All". |
| **About** "Who DatIQ is for" section and the **Integrations** page's role hints | 8 roles. |
| **`PersonaUsage`** (per-role usage attribution) | New ids. History under legacy ids is shown under the merged role. |

**Tests:** the §19 parity test covers every row, so a future role added to `PERSONAS` fails the build until
every surface has it. The Templates filter test covers multi-role templates and the legacy alias.

---

## 22. Public pages brought up to date, and version numbers removed 🟡

**Remove version numbers everywhere a visitor can see them.** Found in:
- `Changelog.jsx`: the title "What's in DatIQ V1.0.0", the badge and the SEO title;
- `Footer.jsx`: the version tag linking to /changelog, which becomes the word **"Changelog"**;
- `About.jsx`: "DatIQ V1.0.0";
- `Blog.jsx`: two "V1.0" mentions;
- `public/vs/compare/index.html`: "V1.0.0 — changelog";
- `public/llms-full.txt`: "V1.0 release".

⚠️ `/api/v1` and the developer page's API version are **API paths, not product versions**, and stay
unchanged. `__APP_VERSION__` stays defined for diagnostics but is no longer rendered. A new test fails the
build if a `V\d+\.\d+` string appears in public page text again.

| Page | Update |
|---|---|
| **/changelog** | Title "What's in DatIQ" with "Updated {date}". New groups: **Engagement (private beta)**, **Workflow hub**, **Template hub**, **Discoverability** (business truth, entity graph, local & directory, trust & proof, subject scores, monitors), **Credits** (one pool; the pre-flight matches what the server charges). The pinned group count in `Changelog.test.jsx` moves with it. The "V1.1 banner" comment is replaced. |
| **/vs/compare** and the 6 `/vs/*` pages | Rows for workflow intelligence (watchlists, signal routing, workflow hub), the templates hub, AI and answer-engine visibility, and outreach (Engagement, beta). Every DatIQ cell names a shipped feature. The changelog link loses its version. |
| **/use-cases** | The hub is regrouped by the **8 roles**. Each card shows the job, the modules and the outcome, and links to the existing page. **3 new pages** for roles with none today: RevOps (clean, score and route lists), Product Marketing (battlecards and claims), Brand & CRO (truth record, share of voice, trust). Recruiting stays. New routes are added in the four places the private/public route invariants check (`site-routes.mjs`, sitemap, prerender, `pageSeo.js`). |
| **/blog** | New posts: the template hub; the workflow hub; **Engagement private beta** (what it is, consent-first sending, request access); **roles-based onboarding**. The "V1.0" wording in the older post is removed. |
| **/help** | The User Guide gains sections for the **Template hub**, **Workflow hub** and **Choosing your role**. Existing sections are updated for the 12 Home tiles, the new menu and the file import on Account lists. Engagement stays out of public help per **D12 (locked)**; the help only says it is in private beta and how to ask for access. New sections renumber pages, so every old URL gets a 301 in `site-routes.mjs` + `netlify.toml`, as the renumbering in 2026-09 did. Screenshots are regenerated. |
| **/faq** | New questions, each added to **both** the visible list and the FAQPage JSON-LD: which role to pick and whether it can be changed later; what the template hub is; what the workflow hub is; what Engagement is and how to join the beta; how opt-outs work; which files the import accepts. |
| **`llms.txt` / `llms-full.txt`, `pageSeo.js` JSON-LD, sitemap** | Same facts, no version numbers. |

**Tests:**
- `publicPricingCopy`-style checks, extended to the new claims: the roles list must match `PERSONAS`, and
  the template count must match the catalogue;
- the version-string test above;
- `page-ownership` and redirect tests for renumbered help URLs;
- prerender and `check:prerender` for the new use-case pages;
- the readiness audit.

---

## 13. Decisions — locked

> **All locked by the owner on 2026-09-24** as recommended ("lock what you have recommended").

| # | Question | Locked decision |
|---|---|---|
| D3 | Menu: Workflow hub, Engagement (name unchanged), divider, then Account lists / Watchlists / Signal rules | ✅ Decided by owner; home-screen "DatIQ Engage" link deferred |
| D5 | Account Brand Kit: button only (this browser), or also store it server-side (`0083`)? | Server-side (option B) |
| D6 | Existing rules keep "All watchlists / All lists" scope after `0084`? | Yes — no behaviour change for them |
| D6b | A scoped rule that loses its last source: pause it, or delete it? | Pause, with the reason shown |
| D8a | Rename "Overview" → **"Workflow hub"**? | Yes |
| D8b | Add rule action "Add to an Engagement campaign"? | Later, as its own item (needs consent design) |
| D2 | Excel support via `read-excel-file` (lazy-loaded, ~2.4 MB unpacked, MIT)? | Yes |
| D1 | Collapse empty pipeline stages by default? | Yes, with a toggle |
| D11 | Editing a prospect's email/phone regenerates its open drafts (hand edits kept)? | Yes |
| D16a | Home "Common jobs" tile count | **12** — it divides evenly at every width (6 / 3 / 2 columns). 9 would leave a half row on desktop |
| D16b | The Engagement tile for accounts not in the beta | Swap it for a non-beta tile, so the count stays 12 |
| D17 | Engagement card on Home: status "Beta" and link to `/engagement` (private-beta page for everyone else)? | Yes |
| D17b | Hero "DatIQ intelligence" card: add Engage as the 4th tile (Discover, Connect, Compete, Engage), 4 across | Locked (owner) |
| D17c | Hero Compete tile goes to the Workflow hub (was `/lists`), matching the Compete card | Yes |
| D18a | How many new templates in this round? | 9 (catalogue 11 → 20); watch usage before adding more |
| D18b | Templates that only open another screen: same catalogue, marked "Opens in …"? | Yes, with a module filter beside the role filter |
| D12 | Publish an "Engagement (beta)" section in the public help now, or keep it internal until GA? | Internal until GA (a public "private beta — request access" mention is allowed, see §22) |
| D19a | Replace the 7 personas with the owner's 8 roles, keeping existing ids where a role carries forward? | Yes (§19) — locked by the owner's request |
| D19b | `recruiter` (not among the 8 roles) | Kept as a hidden legacy role: still works for users who chose it, not offered in onboarding or filters |
| D19c | `market-research` | Merged into Founder, VC & Market Research through an alias |
| D21 | Template roles: stored `persona` column, or a code map? | A `TEMPLATE_ROLES` map in code (a template can have several roles; no republishing) |
| D22a | Version numbers | Removed from every public page; `/api/v1` unchanged |
| D22b | New use-case pages | 3 (RevOps, Product Marketing, Brand & CRO) |

---

## 14. Delivery

- **Phase A** (items 1, 3, 4, 6a, 9, 10, 11, 12): one PR to `staging`.
- **Phase B** (items 2, 5): one PR.
- **Phase C** (6b, 7, 8, 16, 17, 18): one PR with migration `0084` (6b only), applied to staging Supabase
  before testing (runbook section added). Items 16–18 need no migration: new templates are seeded per key on
  first read. If you want them sooner, 16–18 can ship as their own small PR ahead of 6b/7/8.
- **Phase D** (19–22), in this order:
  - **D1:** §19 roles + migration, §20 onboarding, §21 roll-out. §19 lands before Phase C's §16/§18, which use it.
  - **D2:** §22 public pages, after C and D1, so the pages describe what has actually shipped.
- **Suggested overall order:** D1 → C → D2.
- **Every phase:** full pre-push gate; before/after screenshots (light/dark, desktop/mobile) attached for your
  review; **squash-merge** only.

---

## 15. Housekeeping found while planning

- **PR #221 was merged with a merge commit, not a squash.** That brought the branch history into `staging`, and
  it includes the original BRD/PRD source documents (commit `6a520e0f`, deleted later in `17f383fb`). They are
  **not in the current tree**, but they can be retrieved from `staging`'s history in this public repository.
  Removing them means rewriting `staging` history (a force-push), which is your call. Until then, treat those
  documents as public. Future PRs from this work will be squash-merged.
