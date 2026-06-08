# DatIQ Help

> This file covers everything a user needs to get value from DatIQ, followed by a separate API & developer reference for integrators and engineers.

---

## Contents

**User Guide**
1. [Getting started](#1-getting-started)
2. [Extracting a page](#2-extracting-a-page)
3. [Extraction options](#3-extraction-options)
4. [Reviewing results](#4-reviewing-results)
5. [Quick Enrichment](#5-quick-enrichment)
6. [Managing your extractions](#6-managing-your-extractions)
7. [Searching and filtering](#7-searching-and-filtering)
8. [Exporting your data](#8-exporting-your-data)
9. [Generating content](#9-generating-content)
10. [Sending extractions by email](#10-sending-extractions-by-email)
11. [Troubleshooting](#11-troubleshooting)

**Developer & API Reference**
12. [Webhook integration](#12-webhook-integration)
13. [Email API integration](#13-email-api-integration)
14. [Firecrawl API notes](#14-firecrawl-api-notes)
15. [Anthropic / Claude API notes](#15-anthropic--claude-api-notes)
16. [Webhook event reference](#16-webhook-event-reference)
17. [Export data formats](#17-export-data-formats)
18. [Configuration reference](#18-configuration-reference)
19. [Error codes & messages](#19-error-codes--messages)

---

---

# USER GUIDE

---

## 1. Getting started

DatIQ runs directly in your browser — no sign-up, no installation, no configuration required. Open the app, paste a URL, and hit **Extract**. Every feature works immediately using demo data; connecting real API keys in the background switches to live extraction.

**What you can do with DatIQ:**
- Pull the full heading structure and every link from any public webpage
- Get an instant AI-written summary of what the page is about
- Run one-click enrichments: find contact info, leadership, social links, company mission, and pricing
- Map every URL indexed on an entire domain
- Export everything as CSV or PDF
- Generate SEO outlines, competitor summaries, and social posts from any saved page
- Email saved extractions to colleagues

---

## 2. Extracting a page

1. Open DatIQ and go to the **Extract** screen (the home page)
2. Paste any public URL into the input field — `https://` is added automatically if you omit it
3. Click **Extract** (or press Enter)
4. The loading screen shows four steps as the page is processed: fetching, parsing structure, generating AI summary, and preparing results
5. You arrive at the **Preview** screen with your results

**Example URLs to try**
Click any of the three example chips below the input field (`lumio.io`, `stripe.com/pricing`, `notion.so/help`) to pre-fill with a known-good URL.

**What gets extracted automatically**
Every extraction returns three things without any configuration:
- The full **heading outline** (H1 through H6), in document order
- **Every link** on the page, deduplicated, with AI-assigned categories (Internal, External, Social, Email, Document, Media)
- An **AI summary** — a paragraph describing the page's purpose and structure

---

## 3. Extraction options

Four toggles below the URL input modify what DatIQ does with the page.

### Render JavaScript

Turn this on for pages built as single-page apps (React, Vue, Angular, etc.) or pages that load content dynamically. DatIQ waits an extra 3 seconds for JavaScript to finish executing before capturing the page.

**When to use it:** The page looks empty in a regular scrape, or headings/links are missing because they're rendered by JavaScript.

**Trade-off:** Extraction takes a few seconds longer.

### Map entire domain

Instead of scraping one page, this discovers **every URL indexed on the whole domain**. The result is a searchable list of all the site's pages.

**When to use it:** You want a site map, want to find a specific page on a large site, or are auditing a website's structure.

**Note:** When domain mapping is active, the other options (Render JavaScript, Contacts, Custom) do not apply — they are for single-page scrapes.

### Contacts & emails

Runs a focused extraction for the names, job titles, and email addresses of senior leadership, the board, and general company contacts.

**When to use it:** You want to find a company's executive team or contact details without manually digging through the About or Contact pages.

**Tip:** Works best on company About, Team, and Contact pages.

### Custom extraction

Reveals a free-text prompt box. Describe exactly what you want to extract in plain English and DatIQ's AI will pull it out as structured data.

**Example prompts:**
- `Extract the product name, price, and customer rating`
- `Find all job openings with job title, location, and salary range`
- `List every integration listed on this page with its description`
- `Extract the company's founding year, headquarters, and employee count`

**Quick Action chips** below the prompt box give you five ready-made templates — click one to fill in the prompt, then edit it or submit as-is.

---

## 4. Reviewing results

After an extraction you land on the **Preview** screen. This is where you review, enrich, and save.

### Page header
Shows the page title, URL (clickable), and a quick stat count (headings + links, or URL count for domain maps).

### AI Summary
The first card is always the AI-generated overview — a plain-English paragraph summarising what the page is about, how it's structured, and who it's aimed at.

### Overview tab

**Heading outline**
The full H1–H6 structure of the page, indented by heading level. H1 is the largest and most prominent; H6 is the deepest sub-heading. Use this to understand a page's information architecture at a glance.

**Link list**
Every link on the page, categorised by type:
- **Internal** — links to other pages on the same site
- **External** — links to a different website
- **Social** — links to social media profiles (LinkedIn, Twitter/X, GitHub, YouTube, etc.)
- **Email** — mailto links
- **Document** — downloadable files (PDFs, spreadsheets, archives, etc.)
- **Media** — images and video files

Filter the list using the **All / Internal / External** buttons. The category counts are shown in the card subtitle.

Click any link row to open the target URL in a new tab.

**Domain map list (when Map domain was used)**
A searchable list of every URL discovered on the domain. Use the filter field to find specific paths. Click any URL to open it.

### Enrichment tabs

After running any Quick Enrichment preset, a tab appears with the name of the capability (e.g. "Pricing & Plans"). Click the tab to see the structured data returned. Each tab also has a **Refresh** button to re-run the same extraction and update the result.

### Saving

Click **Save to Dashboard** to persist this extraction. It will appear in your Dashboard and can be retrieved, exported, or enriched again at any time.

Click **Discard** to throw away the extraction and return to the home screen.

---

## 5. Quick Enrichment

The Quick Enrichment panel is on every Preview screen. It gives you five one-click enrichment capabilities that run **in the background** — the page stays visible and a spinner appears on the button while the extraction runs.

| Button | What it finds |
|--------|--------------|
| **Find Contact Info** | Names, titles, emails, and phone numbers for key contacts and the general company |
| **Leadership & Board** | Senior leadership, C-suite, founders, and board members with names, titles, and emails |
| **Social Links** | All social media profile URLs for the company (LinkedIn, Twitter/X, Facebook, Instagram, YouTube, GitHub) |
| **Company Mission** | The company's mission statement, value proposition, and a short description |
| **Pricing & Plans** | Every pricing tier: plan name, price, billing period, and key features |

**How to use it:**
1. Run any extraction and arrive at the Preview screen
2. Click one of the five buttons in the Quick Enrichment card
3. A spinner appears on the button while the result is loading
4. When complete, a new tab appears with the capability name
5. Click the tab to view the structured data

**Re-running a preset:** Click the button again (it will show a checkmark). The existing tab refreshes with the new result.

**Persistence:** Enrichment results are saved automatically per URL. If you save the extraction and open it again from the Dashboard, all your enrichment tabs reappear.

---

## 6. Managing your extractions

The **Dashboard** is your history of everything you have saved.

### Opening a saved extraction
Click any row in the table (or any card in card view) to open it in the Preview screen, with all its enrichment tabs restored.

### Deleting an extraction
Click the trash icon on any row or card. The deletion is immediate. There is no undo.

### Layout
Toggle between **Table** view (default) and **Card** view using the icons in the top-right of the Dashboard header. Your choice is remembered.

### Pagination
The number of rows shown adapts to your screen height automatically. Use the pagination controls at the bottom to navigate through pages.

---

## 7. Searching and filtering

The **search field** in the Dashboard toolbar searches across everything:
- Page title
- URL
- AI summary
- All headings
- All link text and URLs

Type multiple words to narrow results — all words must match (AND logic). Results update instantly as you type. Click the **×** button to clear the search.

The count displayed on the right shows how many results match the current search out of your total saved extractions.

---

## 8. Exporting your data

### CSV export

Click **CSV** in the Dashboard header to download a spreadsheet containing all the data from your extractions.

**What's included:** Page metadata, headings, links, domain map URLs, and every Quick Enrichment capability you have run — all in a flat, analysis-ready format.

**Selection:** If you have rows checked (selected), only those rows are exported. If nothing is selected, all currently filtered rows are exported.

**Filename:** `datiq-{website}-{id}.csv` for a single page, `datiq-export-{n}-pages.csv` for multiple.

**Tip:** Open the CSV in Excel, Google Sheets, or any data tool. Enrichment data is flattened into `path → value` rows (e.g. `contacts[0].name → Jordan Avery`) so every field is queryable.

### PDF export

Click **PDF** in the Dashboard header to download a formatted report.

**What's included:** One page per extraction, with title, URL, extraction date, AI summary, headings, links, and enrichment sections.

**Same selection logic as CSV:** selected rows or all filtered rows.

### Emailing extractions

See [Section 10 — Sending extractions by email](#10-sending-extractions-by-email).

---

## 9. Generating content

DatIQ can turn any saved extraction into ready-to-use marketing content using AI.

**How to use it:**
1. Go to the Dashboard
2. Check one or more extractions using the row checkboxes
3. Click **Generate** in the selection bar that appears
4. Choose a format in the modal:

| Format | What you get |
|--------|-------------|
| **SEO Blog Outline** | A working title, meta description (≤ 155 characters), 4–6 H2 sections with H3 sub-points, and target keywords |
| **Competitor Summary** | A competitive brief: what they do, positioning, target customers, strengths, gaps |
| **Social Posts** | Three LinkedIn-tone social posts, each ≤ 3 sentences |

5. Wait a moment for the AI to generate the content
6. Click **Copy** to copy the markdown output to your clipboard

**Note:** Content generation uses the AI key if configured; otherwise it returns a well-structured demo output. The quality is significantly higher with a real Anthropic API key.

---

## 10. Sending extractions by email

**How to use it:**
1. Go to the Dashboard
2. Check the rows you want to send
3. Click **Send email** in the selection bar
4. Type one or more email addresses in the recipient field (separate multiple addresses with commas, spaces, or semicolons)
5. Click **Send**

**What the email includes:** For each extraction — page title, URL, extraction date, heading count, link count, and an AI summary excerpt.

**How email is delivered (in order):**
1. If a webhook URL is configured, the email event is posted to it — your webhook service (n8n, Zapier, Make, or a custom server) handles the actual send
2. If an email API URL is configured, the request goes directly there
3. If neither is configured, DatIQ opens your default email client (Gmail, Outlook, Apple Mail, etc.) with a pre-filled draft — no server required

---

## 11. Troubleshooting

### "Couldn't reach the page"
Your internet connection may be unstable, or the website is temporarily down. Check your connection and try again. If the problem persists, try a different URL.

### "This page blocked the request"
The website is preventing automated access to its content. This is common on apps that require a login, or sites with strict bot protection. Try a different page, or use a logged-in version if you have access.

### "Login required" (401)
The page is behind a login or paywall. DatIQ can only extract publicly accessible pages. Try a public URL on the same site (e.g. the homepage or a public blog post).

### "Access forbidden" (403)
The server is actively blocking the extraction tool. Try a different page on the same site.

### "Page not found" (404)
The URL doesn't exist. Check for typos in the address.

### "Slow down a moment" (429)
You've made too many requests in a short time. Wait a few seconds and try again.

### "Request timed out"
The page took too long to respond. It may be very slow or temporarily unavailable. Try again in a minute. If the page uses heavy JavaScript, try enabling **Render JavaScript** in the extraction options.

### "Service temporarily unavailable"
The extraction service had a temporary error. This is not your fault. Wait a moment and try again.

### Headings or links are missing
Some pages load their content via JavaScript after the initial HTML is delivered. Turn on the **Render JavaScript** toggle and try again.

### The AI summary is generic
The AI summary is generated from the page title and heading structure. If the headings are vague or there are very few, the summary will be less specific. Try extracting a more content-rich page.

### My enrichment tabs disappeared after a reload
Enrichment tabs are saved per-URL in your browser. If you cleared your browser storage, or opened the page in a different browser or private window, the tabs won't appear. Save the extraction to your Dashboard first — saved extractions restore all their enrichment tabs from the server.

### The Dashboard is empty after setting up Supabase
Extractions saved before Supabase was configured are in localStorage only (in your current browser). They won't appear in the Dashboard when Supabase is active unless you re-save them. New extractions will sync across devices.

### Export CSV is missing enrichment data
Enrichment data is included in the CSV only for enrichments that have been run. If you never clicked a Quick Enrichment button for that extraction, there's no data to include. Run the desired enrichments in Preview first, then export.

---

---

# DEVELOPER & API REFERENCE

---

## 12. Webhook integration

DatIQ can POST events to any HTTPS endpoint. Configure the webhook URL in `.env` or in `public/runtime-config.js` (for runtime changes without a rebuild).

```
VITE_WEBHOOK_URL=https://your-endpoint.example.com/datiq
```

The webhook URL is shared for both event types: `extraction.saved` and `email.send`. Your endpoint should inspect the `event` field to determine which handler to call.

### Request format

All webhook requests are:
- Method: `POST`
- Content-Type: `application/json`
- No authentication headers (add your own via n8n/Zapier if required)

### Signature verification

DatIQ does not sign webhook payloads. If your endpoint is public, protect it with:
- A secret query parameter (`?secret=…`) verified in your handler
- IP allowlisting (if your webhook provider supports it)
- n8n / Zapier / Make's built-in webhook authentication

### Error handling

Webhook failures are fire-and-forget: DatIQ logs a `[DatIQ] Webhook delivery failed` warning to the browser console but never blocks the save or email operation. Implement retries on your webhook processor side if guaranteed delivery is required.

### n8n quick-start

The app ships pre-configured to call `vkaruna.app.n8n.cloud/webhook-test/datiq` (dev) and `/webhook/datiq` (prod). Update `public/runtime-config.js` to point at your own n8n instance:

```js
window.__DATIQ_RUNTIME__ = {
  webhookUrl: _isLocal
    ? "https://YOUR-N8N.app.n8n.cloud/webhook-test/datiq"
    : "https://YOUR-N8N.app.n8n.cloud/webhook/datiq",
  emailApiUrl: ""
};
```

For the n8n workflow to receive requests, the workflow must be **active** (not just saved) and CORS must be configured for the app's origin.

---

## 13. Email API integration

If you prefer to call a dedicated email API rather than routing through your webhook, set:

```
VITE_EMAIL_API_URL=https://your-email-api.example.com/send
```

### Request format

```http
POST /send HTTP/1.1
Content-Type: application/json

{
  "to":      ["recipient@example.com", "another@example.com"],
  "subject": "DatIQ — 3 extractions",
  "body":    "Shared from DatIQ — 3 extracted pages:\n\n1. ...",
  "items":   [ { ...extraction object... }, ... ]
}
```

### Expected response

Any `2xx` response is treated as success. Non-2xx responses throw an error displayed to the user.

### Fallback chain

If `VITE_EMAIL_API_URL` is not set but `VITE_WEBHOOK_URL` is set, DatIQ sends an `email.send` event to the webhook instead (see [Section 12](#12-webhook-integration) and [Section 16](#16-webhook-event-reference)). If neither is set, the browser opens the user's default email client with a pre-filled draft.

---

## 14. Firecrawl API notes

DatIQ calls the Firecrawl API directly from the browser using your `VITE_FIRECRAWL_API_KEY`.

### Endpoints used

| Endpoint | Purpose |
|----------|---------|
| `POST https://api.firecrawl.dev/v1/scrape` | Single-page extraction (headings, links, optional LLM extraction) |
| `POST https://api.firecrawl.dev/v1/map` | Domain URL discovery |

### Scrape request body

```json
{
  "url": "https://example.com",
  "formats": ["html"],
  "onlyMainContent": false,
  "waitFor": 3000
}
```

When **Render JavaScript** is on: `waitFor: 3000` is added.

When **Custom extraction** is on: `"json"` is added to `formats` and the body includes:

```json
{
  "jsonOptions": {
    "prompt": "your custom extraction prompt here"
  }
}
```

### Scrape response handling

DatIQ reads `data.html` and parses it with the browser's `DOMParser`. It also checks `data.json`, `data.extract`, and `data.llm_extraction` (in that order) for custom extraction results.

### Map request body

```json
{ "url": "https://example.com" }
```

### Map response handling

DatIQ reads `data.links` (an array of strings or `{ url: string }` objects), deduplicates, and stores as `domain_map: string[]`.

### CORS

Firecrawl sets CORS headers permitting browser requests. If you see CORS errors, check that your API key is valid and not rate-limited.

### Rate limits

`429` responses are caught by the error classifier and shown as "Slow down a moment" with a prompt to retry.

---

## 15. Anthropic / Claude API notes

DatIQ calls the Anthropic Messages API directly from the browser using `VITE_AI_API_KEY`.

> ⚠️ **Security warning:** The API key is bundled into the JavaScript bundle and visible to anyone who opens browser DevTools. This is acceptable for internal tools, demos, and local development. For any public-facing deployment, proxy all AI calls through a server-side function (Netlify Functions, Vercel Edge, Cloudflare Workers, etc.).

### Endpoints used

All calls go to `POST https://api.anthropic.com/v1/messages`.

### Required headers

```http
x-api-key: {VITE_AI_API_KEY}
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
Content-Type: application/json
```

### AI summary call

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 400,
  "messages": [{
    "role": "user",
    "content": "Summarize this web page in a concise paragraph..."
  }]
}
```

### AI link categorisation call

Fires only when `hasAI` is true and the extracted link count is between 1 and 60.

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 360,
  "messages": [{
    "role": "user",
    "content": "Classify each link into exactly ONE category: internal/external/social/email/document/media. Return ONLY a JSON array of lowercase category strings..."
  }]
}
```

### Content generation call

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 1024,
  "messages": [{
    "role": "user",
    "content": "{format.instruction} Base everything on: [URL, Title, AI summary, Headings]"
  }]
}
```

### Model configuration

Change the model by setting `VITE_AI_MODEL` in `.env`. Any Anthropic Messages-compatible model ID works. Default is `claude-haiku-4-5-20251001`.

---

## 16. Webhook event reference

### `extraction.saved`

Fired after every successful save. The full extraction object is included.

```json
{
  "event":    "extraction.saved",
  "sent_at":  "2026-06-08T14:23:00.000Z",
  "data": {
    "id":         "550e8400-e29b-41d4-a716-446655440000",
    "url":        "https://example.com",
    "page_title": "Example Domain",
    "headings": [
      { "tag": "H1", "text": "Example Domain" }
    ],
    "links": [
      { "text": "More information", "href": "https://www.iana.org/domains", "category": "external" }
    ],
    "ai_summary":  "Example Domain is a placeholder webpage...",
    "custom_extraction": null,
    "domain_map":  null,
    "enrichments": {},
    "created_at":  "2026-06-08T14:23:00.000Z",
    "_saved":      true
  }
}
```

### `email.send`

Fired when the user sends extractions via email and a webhook URL is configured.

```json
{
  "event":    "email.send",
  "sent_at":  "2026-06-08T14:24:00.000Z",
  "to":       ["colleague@example.com"],
  "subject":  "DatIQ — 2 extractions",
  "body":     "Shared from DatIQ — 2 extracted pages:\n\n1. Example Domain\n   ...",
  "data": [
    { ...extraction object... },
    { ...extraction object... }
  ]
}
```

**Field reference:**

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type: `extraction.saved` or `email.send` |
| `sent_at` | ISO 8601 | When the event was generated |
| `data` | object \| array | The extraction(s) |
| `to` | string[] | (`email.send` only) Recipient addresses |
| `subject` | string | (`email.send` only) Email subject |
| `body` | string | (`email.send` only) Plain-text email body |

---

## 17. Export data formats

### CSV column reference

Every CSV row has five columns: `page`, `type`, `name`, `text`, `value`.

| `type` | `name` | `text` | `value` |
|--------|--------|--------|---------|
| `meta` | `url` | the page URL | — |
| `meta` | `title` | page title | — |
| `meta` | `summary` | AI summary text | — |
| `heading` | heading tag (H1–H6) | heading text | — |
| `link` | category name | anchor text | href URL |
| `mapped-url` | — | — | discovered URL |
| `enrichment` | capability label | JSON path | leaf value |
| `custom` | `Custom extraction` | JSON path | leaf value |

**Enrichment flattening example:**

A `Leadership & Board` enrichment returning:
```json
{ "contacts": [{ "name": "Jordan Avery", "email": "j@lumio.io" }] }
```

Produces these rows:
```
lumio.io,enrichment,Leadership & Board,contacts[0].name,Jordan Avery
lumio.io,enrichment,Leadership & Board,contacts[0].email,j@lumio.io
```

### PDF section reference

| Section | Condition | Content |
|---------|-----------|---------|
| Header | Always | Title (17 pt), URL (9 pt), extraction date (8 pt) |
| AI Summary | If `ai_summary` present | Full paragraph |
| Domain Map | If `domain_map` array present | Bulleted list of all discovered URLs |
| Headings | If `headings.length > 0` | All H1–H6 with tag + text |
| Links | If `links.length > 0` | Bulleted list: anchor text + href |
| Enrichments | One section per entry in `enrichments` | Section title + flattened `path: value` pairs |
| Custom extraction | If no `enrichments` but `custom_extraction` present | Flattened fields |

---

## 18. Configuration reference

### Full environment variable list

| Variable | Purpose | Default when absent |
|----------|---------|---------------------|
| `VITE_SUPABASE_URL` | Supabase project URL | localStorage only |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | localStorage only |
| `VITE_FIRECRAWL_API_KEY` | Firecrawl API key | Mock extraction |
| `VITE_AI_API_KEY` | Anthropic API key | Mock AI output |
| `VITE_AI_MODEL` | Claude model ID | `claude-haiku-4-5-20251001` |
| `VITE_WEBHOOK_URL` | Webhook endpoint | No webhook |
| `VITE_EMAIL_API_URL` | Email API endpoint | Mailto fallback |

### Runtime config object

```js
// public/runtime-config.js
window.__DATIQ_RUNTIME__ = {
  webhookUrl:   string,  // non-empty overrides VITE_WEBHOOK_URL
  emailApiUrl:  string,  // non-empty overrides VITE_EMAIL_API_URL
};
```

### Feature flags exposed by `config.js`

```js
hasSupabase:  boolean   // VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY
hasFirecrawl: boolean   // VITE_FIRECRAWL_API_KEY
hasAI:        boolean   // VITE_AI_API_KEY
hasWebhook:   boolean   // resolved WEBHOOK_URL non-empty
hasEmail:     boolean   // resolved EMAIL_API_URL non-empty
```

### localStorage keys

| Key | Value | Written by |
|-----|-------|-----------|
| `datiq.saved` | `Extraction[]` JSON | `extractionsRepo.js` |
| `datiq.enrichments` | `{ [url]: { [key]: entry } }` JSON | `enrichmentStore.js` |
| `datiq.current` | `Extraction` JSON | `enrichmentStore.js` |
| `datiq.theme` | `"light"` or `"dark"` | `ThemeProvider.jsx` |
| `datiq.dashLayout` | `"table"` or `"cards"` | `Dashboard.jsx` |

---

## 19. Error codes & messages

### Classifier patterns

The `classifyError(error)` function matches `error.message` (lowercased) against these patterns in order. First match wins.

| Pattern | `title` returned |
|---------|-----------------|
| `failed to fetch`, `network error`, `net::err`, `load failed`, `fetch error` | Couldn't reach the page |
| `cors`, `blocked by.*policy`, `access.control`, `cross.origin` | This page blocked the request |
| `401`, `unauthorized`, `authentication required` | Login required |
| `403`, `forbidden` | Access forbidden |
| `404`, `not found` | Page not found |
| `429`, `too many requests`, `rate.?limit` | Slow down a moment |
| `5[0-9]{2}`, `server error`, `internal error`, `bad gateway`, `service unavailable` | Service temporarily unavailable |
| `timeout`, `timed.?out`, `request timed` | Request timed out |
| `invalid url`, `not a valid url`, `invalid.*url` | Invalid URL |
| `supabase`, `postgre`, `database`, `relation.*does not exist`, `permission denied for table` | Database error |

### Context-specific error overrides

Three exported constants override the generic classifier when used as the second argument to `showError()`:

| Constant | `title` | When to use |
|----------|---------|-------------|
| `SAVE_ERROR` | Couldn't save your extraction | save operation failure |
| `LOAD_ERROR` | Couldn't load your history | Dashboard load failure |
| `DELETE_ERROR` | Couldn't delete this extraction | delete failure |

### `showError` API

```typescript
showError(
  error:    Error | string,
  override?: { title?: string; message?: string },
  onRetry?:  () => void
): void
```

When `onRetry` is provided, the modal shows a "Try again" button that calls the function when clicked. The modal always preserves data — the user can dismiss and continue working.

### `formatDetail(error)`

Returns a developer-readable string for the collapsible "Technical details" panel:

```
TypeError: Failed to fetch
    at notifyWebhook (webhook.js:11)
    at saveExtraction (extractionsRepo.js:141)
    ...
```

First 5 stack frames only (to keep the panel readable).

---

*DatIQ — datiq.app*
