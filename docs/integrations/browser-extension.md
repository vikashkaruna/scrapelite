# DatIQ Browser Extension

> Right-click any page and extract it with DatIQ. No URL copying, no
> context-switching. Available for Chrome, Edge, Firefox, and Brave.

## What it does

- **Right-click → "Extract this page with DatIQ"** — saves the page to
  your DatIQ dashboard using your API key.
- **Right-click a link → "Extract this link with DatIQ"** — extracts
  the link's URL instead of the current page.
- **Toolbar popup** — paste your API key, then click "Extract this
  page" for a one-click extraction with auto-open of the result.
- **Keyboard shortcut** — `Ctrl+Shift+E` (Windows/Linux) or
  `Cmd+Shift+E` (Mac) opens the popup.

## Install (development)

The extension is in `extensions/datiq-extension/`. The simplest install
is the "unpacked" load:

```bash
npm run build:extension
# Output: dist-extension/

# Then in Chrome:
#   1. Open chrome://extensions
#   2. Toggle "Developer mode" (top right)
#   3. Click "Load unpacked"
#   4. Select the dist-extension/ directory
```

For Firefox, the same build works in `about:debugging#/runtime/this-firefox`
under "Load Temporary Add-on".

## Connect to your DatIQ account

1. Sign in at [datiq.app](https://datiq.app) on a **Business** or
   **Enterprise** plan (the plan that unlocks the public API).
2. Go to **Account → API keys** and click **Create key**. Give it a
   label (e.g. "Browser extension — work laptop") and copy the
   `dq_live_…` value.
3. Click the DatIQ icon in your browser toolbar.
4. Paste the key, click **Save & connect**.

The key is stored in `chrome.storage.local` (browser-local). It's
never sent to a third party; only `api.datiq.app` sees it.

## Permissions, explained

| Permission | Why |
|---|---|
| `contextMenus` | Register the right-click menu item. |
| `storage` | Persist your API key across browser restarts. |
| `activeTab` | Read the current tab's URL when you right-click. |
| `tabs` | Open the DatIQ preview/dashboard after an extraction. |
| `notifications` | Show a "Saved!" toast after each extraction. |
| `host_permissions: datiq.app` | Talk to the DatIQ API + dashboard. |

The extension does **not** read your browsing history, log keystrokes,
or touch any page's DOM. The content script is a no-op reserved for
future page-aware features.

## After an extraction

The result lands in your DatIQ dashboard. From there, route it to any
of the other integrations:

- **HubSpot** — push contacts + companies
- **Notion** — create database rows
- **Airtable** — append records
- **Slack** — channel notification
- **Zapier** — 5,000+ downstream apps

See `docs/INTEGRATIONS.md` for the per-integration setup.

## Publishing to the Chrome Web Store

This branch ships the **source** and a **build script**. Publishing to
the Chrome Web Store is an operator task (one-time $5 registration fee
+ review process) and is documented in `ENABLEMENTS.md`.

The build script produces `dist-extension/`, which is the directory you
zip and upload. Icons are rendered from `icon.svg` at build time using
`sharp` (optional — committed PNGs are present in the repo as a
fallback).

## Troubleshooting

- **"No API key" toast** — open the popup and paste your key.
- **HTTP 401 from the API** — your key was revoked. Mint a new one in
  Account → API keys.
- **Right-click doesn't show the option** — reload the page after
  installing the extension; the context-menu registration is
  service-worker-scoped.
- **Service worker errors** — go to `chrome://extensions`, find DatIQ,
  click "Service worker" → "Inspect". The console will show the
  network responses.
