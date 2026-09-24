# Engagement & Workflows — UX improvement plan (for approval)

> **Date:** 2026-09-24 · **Based on:** `staging` @ `949bc452` (after PR #221) · **Status:** ✅ **Phases A and B built**
> (branch `feat/engagement-ux-phase-ab`); Phase C awaits approval. Each item says what was found in the code, what is proposed, what needs your decision,
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

**Phase A** (now including 10–12) is safe to ship on its own in one PR. **Phase B** adds one small dependency. **Phase C** needs
migration **`0083`** and changes how rules match events, so it gets its own PR and staging pass.

**Decisions I need from you** are collected in §13.

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

**Deferred (owner):** a "DatIQ Engage" link from the home screen to /engagement — a later item, not in this plan.

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
- **Migration `0083`:** `signal_rule_sources (rule_id, source_type 'list'|'watchlist', source_id)`, unique per
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

## 13. Decisions needed

| # | Question | My recommendation |
|---|---|---|
| D3 | Menu: Workflow hub, Engagement (name unchanged), divider, then Account lists / Watchlists / Signal rules | ✅ Decided by owner; home-screen "DatIQ Engage" link deferred |
| D5 | Account Brand Kit: button only (this browser), or also store it server-side (`0083`)? | Server-side (option B) |
| D6 | Existing rules keep "All watchlists / All lists" scope after `0083`? | Yes — no behaviour change for them |
| D6b | A scoped rule that loses its last source: pause it, or delete it? | Pause, with the reason shown |
| D8a | Rename "Overview" → **"Workflow hub"**? | Yes |
| D8b | Add rule action "Add to an Engagement campaign"? | Later, as its own item (needs consent design) |
| D2 | Excel support via `read-excel-file` (lazy-loaded, ~2.4 MB unpacked, MIT)? | Yes |
| D1 | Collapse empty pipeline stages by default? | Yes, with a toggle |
| D11 | Editing a prospect's email/phone regenerates its open drafts (hand edits kept)? | Yes |
| D12 | Publish an "Engagement (beta)" section in the public help now, or keep it internal until GA? | Internal until GA |

---

## 14. Delivery

- **Phase A** (items 1, 3, 4, 6a, 9, 10, 11, 12): one PR to `staging`.
- **Phase B** (items 2, 5): one PR.
- **Phase C** (6b, 7, 8): one PR with migration `0083`, applied to staging Supabase before testing (runbook
  section added).
- **Every phase:** full pre-push gate; before/after screenshots (light/dark, desktop/mobile) attached for your
  review; **squash-merge** only.

---

## 15. Housekeeping found while planning

- **PR #221 was merged with a merge commit, not a squash.** That brought the branch history into `staging`, and
  it includes the original BRD/PRD source documents (commit `6a520e0f`, deleted later in `17f383fb`). They are
  **not in the current tree**, but they can be retrieved from `staging`'s history in this public repository.
  Removing them means rewriting `staging` history (a force-push), which is your call. Until then, treat those
  documents as public. Future PRs from this work will be squash-merged.
