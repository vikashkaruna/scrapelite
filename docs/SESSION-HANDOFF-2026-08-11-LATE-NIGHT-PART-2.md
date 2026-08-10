# Session Handoff — 2026-08-11 01:42 IST — Integrations overhaul + Workspace tabs

> **For the next agent (or future-me in a fresh session):** this is the
> complete state of the `Integration-with-outside-ecosystem` branch after
> the late-night-2 session of 2026-08-11 (~00:30 → ~01:42 IST). Six
> concerns shipped, one is the last 30% of a larger refactor (see §6).

## 1. TL;DR

- **Branch:** `Integration-with-outside-ecosystem`
- **HEAD:** `a910477` (chore: trigger fresh branch redeploy)
- **Branch deploy URL:** `https://integration-with-outside-ecosystem--datiqapp.netlify.app` ✅ live
- **Production:** `https://datiq.app` — **untouched** (still on `main` @ `ebaa4bf`)
- **Last redeploy trigger fired:** `a910477` — Netlify is currently rebuilding
- **Single remaining operator action:** none from this session
  (the previous session's "add `/api/*` to Netlify Edge Access bypass"
  action item still applies)

## 2. Commits in this session (chronological, oldest first)

| # | Commit | What it does |
|---|---|---|
| 1 | `bf9e68e` | **Airtable "Load columns" + per-table field map.** Browser-side `fetchAirtableSchema` + `autoMapAirtableFields`. Per-table persistence in `localStorage` keyed by `baseId::tableId` (so flipping between tables doesn't wipe the previous table's map). Modal "Load columns" button + schema display. Better 422 errors with hint to rename or click Load columns. |
| 2 | `54fc8ab` | **Collections → Workspace + Active Schedule fix.** Tabs on `/workspace?tab=overview\|collections\|schedules`. Top-level "Collections" nav item removed; `/collections` is a redirect to `/workspace?tab=collections`. Real fix for "Active Schedule not listed": `listSchedules()` was wiping `localStorage` when the server returned `[]`; now merges server + local + preserves local-only items. First-paint hydrated from `listSchedulesLocal()` so no more "No schedules yet" flash. |
| 3 | `327d97e` | **Integrations page status labels.** Webhook/n8n → Coming Soon, Salesforce → Roadmap, the 5 push providers → Available (Beta). New `.int-status-beta` CSS class with indigo color. |
| 4 | `70ba7d7` | trigger fresh branch redeploy of #3 |
| 5 | `c4d5b45` | **Account CTA reorder + Workspace tab CSS.** "Explore top-up bundles" moved to the top of the right column. The Workspace tab CSS (`.ws-tabs`, `.ws-tab`) was bundled into this commit along with two new client helpers in `src/lib/integrationsClient.js`: `patchIntegrationConnection(slug, patch)` and `testIntegrationConnection(slug)`. These are server-side counterparts of the new PATCH /connect + POST /test endpoints added in the Account-page redesign. |
| 6 | `a910477` | trigger fresh branch redeploy of #5 |

## 3. The Account-page Integrations redesign (commits not in this session — they were already on the branch when this session started)

The Account page (`/account#integrations`) was completely overhauled. Each of the 5 providers now exposes:

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /api/integrations/{slug}/status` | Returns the connection details (account_label, token_hint, base_id, table_id, database_id, field_map, table_meta, …) for the UI to render. | All 5 providers ✓ |
| `POST /api/integrations/{slug}/connect` | Initial connect: probe + store. | All 5 providers ✓ |
| `PATCH /api/integrations/{slug}/connect` | Partial update (accountLabel, baseId, tableId, refreshSchema for Airtable; webhookUrl for Slack; databaseId + refreshSchema for Notion). Token is NEVER changeable via PATCH. | All 5 providers ✓ |
| `DELETE /api/integrations/{slug}/connect` | Disconnect. | All 5 providers ✓ |
| `POST /api/integrations/{slug}/test` | Probe stored credentials. Returns `{ ok, tableName, fieldCount, … }` for Airtable, `{ ok, titleColumn, columnCount, title }` for Notion, `{ ok, portalId }` for HubSpot. Existing /test for Slack (welcome message) and Zapier (token verify) unchanged. | All 5 providers ✓ |

The Account page UI itself was NOT updated this session — it still shows the old "Connected / Disconnected" + "Disconnect" rows. The full UI redesign (each row showing account label, token hint, IDs, last-tested, with Test / Edit / Disconnect actions and a provider-specific `<EditIntegrationModal>`) was the user-requested follow-up in this session but **was not started**. The server is ready; the client is the next step. See §6.

## 4. The 3-item batch from the user (status)

The user pasted 4 screenshots and reported:

1. **Workspace tabs got messed up** — icons stacked above labels, no padding. **FIXED** in `c4d5b45` (added `.ws-tabs` / `.ws-tab` CSS to `screens.css`). Tabs now render as a horizontal pill nav.

2. **Airtable API key doesn't persist + sending to Airtable from batch mode gives error** — two related symptoms. **PARTIALLY FIXED**:
   - The "API key doesn't persist" part is **by design** — Airtable PATs are never persisted. The right UX is to use the server-stored connection (the user already has one). The modal needs the one-click refactor (§6) to make this seamless.
   - The "422 Unknown field name: URL" part is **fixed at the server** (the new connect handler auto-loads the schema and persists a per-table field map; the push handler reads the stored map). But the user is still on the old browser-side push, which uses `defaultAirtableFieldMap()`. The modal refactor (§6) will route the push through the server, picking up the stored map.

3. **"Send to destination" should work like Preview's "Push to" menu** — the user wants one-click push (no API-key form), checking connection status. **NOT STARTED.** This is the main pending work — see §6.

## 5. Tests, build, deploy

- **Tests:** 2917 passed, 14 skipped (209 test files). No new failures.
- **Build:** clean (843ms). No new warnings.
- **Deploy:** trigger is `a910477`. Preview is at
  `https://integration-with-outside-ecosystem--datiqapp.netlify.app`.

## 6. PENDING — ExportIntegrations one-click refactor

The user wants `/dashboard` and `/batch` "Send to destination" modal to
mirror the `/preview` "Push to" dropdown: server-stored connection,
no API-key form, one-click push, "Connected as [label]" or "Not
connected → set up in Account → Integrations".

**Server side is done.** Client-side is partially started.

### What exists (DO NOT redo)

- `src/lib/integrationsClient.js` — new helpers:
  - `patchIntegrationConnection(slug, patch)` — PATCH /connect wrapper
  - `testIntegrationConnection(slug)` — POST /test wrapper
- `src/components/PushIntegrationMenu.jsx` — the working "Push to"
  pattern on the Preview screen. Read this first; the ExportIntegrations
  refactor is essentially "PushIntegrationMenu with a modal wrapper
  around it per destination tab".

### What needs to happen

1. **Rewrite `src/components/ExportIntegrations.jsx`** to:
   - Remove the API-key + Base/Table ID forms for HubSpot, Notion, Airtable tabs
   - On tab open, fetch `getIntegrationStatus(slug)` (already used for Slack + HubSpot)
   - If connected: show "Connected as [label]" banner + one-click "Push N records" button (use `pushToIntegration(slug, list)`)
   - If connected but `field_map` is empty (Airtable only): show "No columns loaded yet" + "Load columns" button that calls `patchIntegrationConnection("airtable", { refreshSchema: true })` and re-fetches status
   - If not connected: show "Not connected. Set up in Account → Integrations →" link
   - Keep Google Sheets as-is (no auth, CSV download flow)
   - Keep Slack as-is (already server-stored, one-click works)

2. **Update `src/components/ExportIntegrations.test.jsx`** — the existing
   tests assert the API-key form flow. They need to be rewritten to
   assert the new one-click flow (status fetch + pushToIntegration
   with a stored connection). A clean set of tests would be:
   - Each tab fetches status on open
   - Connected tab shows "Connected as [label]" + button
   - Clicking the button calls `pushToIntegration` (not browser-side
     `pushToAirtable`)
   - Not-connected tab shows the setup link
   - Airtable with empty field_map shows the "Load columns" affordance

3. **Verify the Batch page** (`src/pages/Batch.jsx` line 1179) which
   uses `ExportIntegrations` — it should automatically pick up the
   one-click flow once the modal is refactored. The Batch page also
   has `PushIntegrationMenu` for individual rows; that one is
   already correct (it's the same component as Preview's).

### Design hints

- The 4 server-stored tabs (HubSpot, Notion, Airtable, Slack) can
  share a single render path: a `StatusGatedPushPane` component that
  takes `{ slug, label, fieldMapKey?, status, loading, busy, onPush }`
  and renders the right shape per status.
- For Airtable specifically, the field_map is shown as a small chip
  list: "URL→Link, Title→Name (+2 more)" so the user can confirm
  the push will hit the right columns.
- The "Set up" link should navigate to `/account#integrations` and
  close the modal on click (so the user lands on the setup form
  pre-scrolled to the right provider).

## 7. Other observations worth a future pass

- **Airtable field_map for users who connected BEFORE `bf9e68e`** —
  their `integration_connections.config.field_map` is `null`. The new
  push handler falls back to `defaultAirtableFieldMap()` (URL/Title/
  Host/Summary), which 422s on tables with different columns. A
  one-time migration that calls `fetchAirtableSchema` for every
  user with `provider='airtable'` and PATCHes the field_map would
  fix this. Not urgent; the modal's "Load columns" button is the
  user-facing workaround.

- **The Account page's right column now starts with "Explore top-up
  bundles"** as a full-width ghost button. If you want to make it
  more prominent (e.g. secondary variant with a subtle accent
  border), it's a 5-line CSS change in `screens.css`.

- **The Workspace tab nav** (`.ws-tabs`) is a pill bar. If you want
  the count chip on the Schedules tab to also show on Collections
  ("Collections · 3"), the cleanest way is to lift the collections
  count into Workspace state and pass it down to the tab — but
  the current "load collections only on the Collections tab" is
  fine and avoids a heavy import on first paint.

## 8. Memory worth keeping

These are observations from this session that future me would benefit
from (not user prefs, so Agent Memory not User Memory):

- **Slack Block Kit header.text hard-cap is 150 chars**, NOT 3000.
  We learned this the hard way in 2026-08-10 — see MEMORY.md entry
  "Slack incoming webhook + Block Kit: hard character limits".
- **Netlify secret scanner redacts the Supabase anon key** in
  production builds. Fix is `SECRETS_SCAN_OMIT_KEYS` in
  `netlify.toml`. See MEMORY.md entry from 2026-07-29.
- **Airtable typecast: true does NOT add new fields** — it only
  coerces existing-field VALUES to the column's declared type.
  Always send fields using the user's actual column names. This is
  the bug behind the user's "Unknown field name: URL" report.
- **vitest vi.mock with `...actual` is a leaky pattern** when the
  module exports an object with methods (like `apiClient`).
  Spreading `actual` and adding `listExtractions: ...` at the top
  level does NOT override the method on the exported object —
  extractionsRepo still imports the original. The fix is to
  spread the nested object: `apiClient: { ...actual.apiClient,
  listExtractions: ... }`. See `src/pages/Workspace.test.jsx`
  for the working pattern.

## 9. Files touched in this session

```
modified:  netlify/functions/integrations-airtable.js    (status, PATCH /connect, POST /test, field_map persistence)
modified:  netlify/functions/integrations-hubspot.js     (status, PATCH /connect, POST /test, token_hint)
modified:  netlify/functions/integrations-notion.js      (status, PATCH /connect, POST /test, token_hint)
modified:  netlify/functions/integrations-slack.js       (status, PATCH /connect, webhook_hint)
modified:  netlify/functions/integrations-zapier.js      (status unchanged; existing test endpoint)
modified:  src/lib/airtable.js                           (defaultAirtableFieldMap, autoMapAirtableFields, fetchAirtableSchema, per-table persistence)
modified:  src/lib/airtable.test.js                      (+22 tests)
modified:  src/lib/schedulerService.js                   (server merge fix — preserves local-only items)
modified:  src/lib/schedulerService.test.js              (+10 tests)
modified:  src/lib/integrationsClient.js                 (patchIntegrationConnection, testIntegrationConnection)
modified:  src/pages/Workspace.jsx                       (tabs, CollectionsTab, SchedulesSummaryCard, schedule fix)
modified:  src/pages/Workspace.test.jsx                  (+8 tests)
modified:  src/pages/Account.jsx                        (right-column CTA reorder)
modified:  src/pages/Account.integration.test.jsx       (+1 test)
modified:  src/pages/Integrations.jsx                    (status labels: beta, coming-soon, roadmap)
modified:  src/pages/static-pages.test.jsx               (+1 test)
modified:  src/components/ExportIntegrations.jsx         (Airtable schema flow — partially; modal refactor pending)
modified:  src/components/ExportIntegrations.test.jsx    (mock + flow updated)
modified:  src/styles/screens.css                        (ws-tabs, ws-tab, int-status-beta, .ws-tab-count, .ws-tab-spin)
deleted:   src/pages/Collections.jsx
deleted:   src/pages/Collections.integration.test.jsx
created:   src/components/workspace/CollectionsTab.jsx
```

## 10. Operator action items

1. **Wait for Netlify build** on `a910477` to land (~2 min). Verify at
   `https://integration-with-outside-ecosystem--datiqapp.netlify.app`
   that:
   - `/workspace` shows a horizontal pill nav with 3 tabs (Overview,
     Collections, Schedules)
   - `/account` shows "Explore top-up bundles" at the top of the
     right column
   - `/integrations` shows the new status labels (5× "Available
     (Beta)", 1× "Coming Soon" for Webhook/n8n, 1× "Roadmap" for
     Salesforce)

2. **(Still from previous session)** Add `/api/*` to the Netlify Edge
   Access bypass list — see the previous handoff's §4 for the
   walkthrough. Until this is done, in-browser Connect/Push calls
   hit the SSO gate on the branch preview.

3. **Next session priority:** finish the ExportIntegrations
   one-click refactor (§6) — server is ready, client is partially
   started. The user is waiting for this to make "Send to
   destination" work like the Preview "Push to" menu.
