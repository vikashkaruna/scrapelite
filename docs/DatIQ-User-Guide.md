# DatIQ — User Guide & Help

> **Audience:** everyone who uses DatIQ — analysts, marketers, founders, researchers, and sales teams.
> This guide explains *what DatIQ does and how to use it*. It is written for people, not engineers:
> there are no code samples, database details, or setup instructions here. If you build software and
> want to call DatIQ programmatically, see the separate **[Developer API reference](developers.html)**.

DatIQ turns any public web page into structured, usable data — headings, links, contacts, pricing,
and a plain-language AI summary — in seconds. No code, no browser extensions, no scrapers to configure.
Paste a URL (or many), choose what you want, and DatIQ does the rest.

### Table of contents

1. What DatIQ is
2. Quick start — your first extraction
3. The Home composer
4. What you can extract
5. Reviewing results — the Preview screen
6. Enrichment & content generation
7. Batch extraction
8. Scheduling & change monitoring
9. Your Dashboard
10. Exports & sharing
11. Plans, usage & billing
12. Accounts, trial & sign-in
13. Privacy & your data
14. FAQ & troubleshooting
15. Keyboard shortcuts
16. Glossary

---

## 1. What DatIQ is

DatIQ is a zero-code web-extraction and enrichment platform. Its promise is simple: **intelligence from
every URL.** Give it a web address and it returns clean, structured information you can read, filter,
enrich, export, or monitor over time.

Typical things people pull out of a page:

- **Structure** — the full heading outline (H1–H6) and every link, internal and external, de-duplicated.
- **An AI summary** — a short, plain-language overview of what the page is about.
- **Contacts** — leadership names, role titles, and contact emails where a page exposes them.
- **Pricing** — structured pricing tiers and plan details from a pricing page.
- **A site map** — the set of indexed URLs across a whole domain.
- **Anything else** — describe a field in plain English ("founding year", "office locations") and DatIQ extracts it.

DatIQ works in light and dark themes; use the sun/moon button in the top bar to switch. Your preference is remembered.

![DatIQ Home in dark mode](assets/screenshots/02-home-dark.png)

---

## 2. Quick start — your first extraction

1. Open DatIQ. You land on the **Home** screen with the composer in the middle.
2. Paste a URL into the box (for example, a company's home page or pricing page).
3. Pick **what you want to extract** using the intent chips below the box — start with **AI summary**.
4. Click **Extract**.
5. In a few seconds you're taken to the **Preview** screen with the results, and the page is saved to your **Dashboard** automatically.

That's the whole loop: **paste → choose → extract → review.** Everything else in this guide builds on it.

---

## 3. The Home composer

The composer is the single box at the centre of the Home screen. It adapts to what you type and which
toolbar options you pick, so one box handles single pages, many pages, and recurring jobs.

![DatIQ Home screen](assets/screenshots/01-home.png)

**The input box** accepts:

- **A single URL** → a normal one-page extraction.
- **Several URLs** (pasted as a list, one per line) → DatIQ recognises them and runs a **batch**.
- **Pasted text or page content** → DatIQ can structure and summarise raw text you paste in, even without a URL.

**The toolbar (bottom of the box):**

- **＋ Add content** — import a CSV of URLs, or paste a long list of links.
- **Batch** — force batch mode for multiple URLs.
- **Schedule** — arm a recurring cadence (e.g. *Daily*) so the extraction repeats automatically. Choose **Custom schedule…** to open the full scheduling screen.
- **Extract** — the action button. Its icon reflects the mode: a single page, a batch (layers), or a scheduled run (calendar).

You can also **drag and drop a CSV file** anywhere onto the box to load a list of URLs.

> **Tip:** the quick-example chips above the box ("SaaS pricing page", "Company about page", "Blog / content")
> fill the box with a sample so you can try DatIQ instantly.

---

## 4. What you can extract

Below the input box is **"What do you want to extract?"** with a row of **intent chips**. Pick one before you extract:

| Intent | What you get |
|---|---|
| **AI summary** | A plain-language overview of the page, plus its heading outline and links. |
| **Find contacts** | Leadership names, role titles, and any contact emails the page exposes. |
| **Scrape pricing** | Structured pricing tiers and plan details from a pricing page. |
| **Map site** | A list of indexed URLs across the whole domain — useful for SEO and site audits. |
| **Custom…** | Describe any field in plain English and DatIQ extracts just that. |

**Advanced options** (the link under the chips) let you fine-tune a run — for example, asking DatIQ to
render JavaScript-heavy pages before reading them.

When you choose **Map site**, the Preview shows the discovered URLs grouped for easy scanning:

![DatIQ domain map preview](assets/screenshots/09-domain-map.png)

---

## 5. Reviewing results — the Preview screen

After an extraction you land on **Preview**. This is where you read, verify, and act on a single page's results.

![DatIQ Preview screen](assets/screenshots/03-preview.png)

What you'll see:

- **Page header** — the page title, its URL, and counts of headings and links found.
- **AI summary** — the generated overview of the page's intent and structure.
- **Quick enrichment & content** — one-click buttons to pull more out of the page (contacts, leadership, social links, company mission, pricing) and a **Generate content** button.
- **Headings** — the full H1–H6 outline, in order.
- **Links** — every link found, automatically tagged **internal / external / social**, with filters so you can focus.

**Action bar (top):**

- **View Dashboard** — go to your saved archive (the page is already saved).
- **Download ▾** — export this page as CSV, PDF, Markdown, or JSON.
- **Delete** — remove this extraction.

---

## 6. Enrichment & content generation

Enrichment digs deeper into a page you've already extracted, and content generation turns a page into ready-to-use copy.

**Enrichment** (from the Preview's *Quick enrichment* card): click any focus — **Find contacts**,
**Leadership & board**, **Social links**, **Company mission**, or **Pricing & plans** — and DatIQ runs a
targeted pass and adds the result as its own tab. Enrichment runs quietly in the background; it never
interrupts what you're reading.

**Content generation** (the **Generate content** button on Preview, or on the Dashboard when pages are
selected): choose a format and DatIQ drafts it from the page:

- **SEO blog outline** — a ready-to-write structure with H2/H3 sections.
- **Competitor summary** — a concise competitive brief on the page's company.
- **Social posts** — a few short promotional posts for social channels.

Copy the result and use it anywhere.

---

## 7. Batch extraction

When you need many pages at once, use **Batch**. Reach it from the **Batch** tab in the top navigation,
or just paste several URLs into the Home composer.

![DatIQ batch results](assets/screenshots/04-batch.png)

How it works:

1. **Paste URLs** (one per line) or **Import CSV** of links.
2. Choose an **intent** (the same chips as single extraction).
3. Click **Extract N URLs**.
4. Watch progress; when it finishes you get a **results table** — each row shows the page, a summary
   snippet, and a status. Failed URLs are listed with a reason.
5. All successful pages are **saved to your Dashboard automatically**, and grouped together as one batch run.
6. **Export ▾** the whole batch (CSV, PDF, Markdown, JSON), start a **New batch**, or **View in Dashboard**.

Your typed list is remembered if you navigate away and come back, so you won't lose a long list of URLs.

> **Note:** each URL in a batch counts toward your monthly extraction allowance, and plans have a maximum
> number of URLs per batch. The page tells you your current limit.

---

## 8. Scheduling & change monitoring

Scheduling lets DatIQ **re-check a page on a recurring cadence and alert you when it changes** — perfect
for watching a competitor's pricing, a careers page, or any page that matters.

![DatIQ schedules screen](assets/screenshots/05-schedules.png)

**Two ways to create a schedule:**

- **From Home** — pick a preset cadence (e.g. *Daily*) in the composer's **Schedule** menu, then Extract. This arms a recurring job for that URL (or batch).
- **From the Schedules screen** — click **New schedule** for the full editor.

**In the schedule editor you set:**

- The **URL** to watch and the **intent** (what to extract each time).
- A **cadence** — presets (Every 6 hours, Twice daily, Daily, Every weekday, Weekly, Monthly) or a **custom** builder (frequency · day · time).
- An optional **"run until" end date**.
- An optional **alert email** to notify when the page changes.
- A **name** so you can recognise it later.

**On the Schedules list**, each schedule shows its cadence, when it last ran, and when it runs next. For each one you can:

- **Run now** — check the page immediately and see whether it changed.
- **Edit**, **Pause / Resume**, or **Delete**.
- Expand it to see all its settings.

When an automated run detects a change, DatIQ records it and — if you set an alert email — sends you a notification.

---

## 9. Your Dashboard

The **Dashboard** is your saved archive. Every extraction (single, batch, or scheduled) is saved here automatically.

![DatIQ Dashboard, table view](assets/screenshots/06-dashboard-table.png)

Features:

- **Search** across your saved pages.
- **Type filter** — All / Single / Batch / Scheduled, with a chip on each row showing where it came from.
- **Grouping** — batch runs and scheduled runs collapse into a single parent row you can expand; single extractions stand alone.
- **Table or card view** — switch with the layout toggle.
- **Refresh** — re-load your archive at any time.

![DatIQ Dashboard, card view](assets/screenshots/07-dashboard-cards.png)

**Working with selections:** tick one or more rows and a toolbar appears with **Generate** (content),
**Email**, and **Export ▾**. Each row also has **View** (open in Preview) and **Delete**.

---

## 10. Exports & sharing

DatIQ exports your data in the format that fits your workflow. Exports are available from **Preview**
(**Download ▾**), the **Dashboard** (**Export ▾**), and **Batch** results (**Export ▾**).

| Format | Best for |
|---|---|
| **CSV** | Spreadsheets and importing into other tools. |
| **PDF** | A polished, shareable report. |
| **Markdown** | Pasting into docs, wikis, or notes. |
| **JSON** | Structured data for further processing. |
| **Email** | Send selected extractions straight from the Dashboard. |
| **Copy to clipboard** | Paste Markdown / JSON / CSV straight into a doc or chat. Available from the same Export menu. |

Some formats are available on higher plans — the export menu shows which.

### Sharing a single extraction

From any extraction on the Dashboard or Preview, click **Share** to get a public link. The link
opens a read-only report at `datiq.app/p/<short-code>` that anyone can view — no sign-in needed.
Public reports can be unshared at any time. Recent public extractions also surface on the
**`/gallery`** page.

---

## 11. Plans, usage & billing

DatIQ offers a free tier plus paid plans for heavier use. Pricing is shown in your local currency where
supported, with monthly and annual billing (annual saves you money).

![DatIQ pricing page](assets/screenshots/08-pricing.png)

- **Free** — a monthly allowance of extractions, full core features, and a one-time bonus credit when you sign up.
- **Paid plans** (Select, Pro, Business, Agency) — higher allowances, larger batches, more workspaces, and additional capabilities such as API access on Business and above.
- **Top-up bundles** — add extra batch capacity to your current plan without changing tiers.
- **Enterprise** — custom volume and terms; contact sales.

Manage everything from the **Account** screen: your current plan, usage this month, usage alerts,
coupon entry, and payment history. Before any charge, a confirmation shows the full breakdown (including taxes where applicable).

A detailed **plan comparison matrix** sits below the plan cards on the pricing page — it lists every
capability by tier so you can see at a glance which plan unlocks what.

---

## 12. Accounts, trial & sign-in

- **Try without an account** — you can start extracting straight away. A trial banner shows how many free runs remain.
- **Sign up / sign in** — create an account with email, or continue with Google, Microsoft, or GitHub. An account keeps your work and lifts trial limits.
- **Personas** — optionally tell DatIQ what kind of work you do, and it tailors examples and labels to you. This is opt-in and changeable any time.
- **Sign out** — clears your session data from the device.

---

## 13. Privacy & your data

- DatIQ extracts only from **publicly accessible** pages you point it at.
- Your saved extractions are tied to your account (or kept on your device when you use DatIQ without signing in).
- You can **delete** any extraction at any time from Preview or the Dashboard.
- Signing out clears your session data from the device.
- For full details, see the **Privacy Policy** and **Terms** linked in the footer. DatIQ's privacy practices
  include coverage for applicable data-protection regulations.

---

## 14. FAQ & troubleshooting

**My extraction came back thin or empty.**
Some pages block automated access or load their content with heavy JavaScript. Try enabling JavaScript
rendering in **Advanced options**, or try a more specific page (e.g. the pricing page rather than the home page).

**The AI summary looks generic.**
Summaries reflect what the page actually exposes. Pages with little text, or that hide content behind
logins, give the model less to work with.

**"App updated — please refresh."**
DatIQ ships improvements regularly. If you've had a tab open for a while and an export or action shows
this message, just refresh the page and try again.

**A batch URL failed.**
The results table shows the reason next to each failed URL. Common causes are unreachable sites,
non-HTML pages, or sites that block automated requests. Other URLs in the batch still succeed.

**Will scheduled runs email me?**
Only if you add an alert email to the schedule. Automated runs that detect a change send the alert;
the manual **Run now** button just shows you the result on screen.

**How do I export to a spreadsheet?**
Use **CSV** from any export menu, then open it in your spreadsheet tool.

**Can I share an extraction with someone who doesn't have a DatIQ account?**
Yes — every extraction has a **Share** button that creates a public link at
`datiq.app/p/<short-code>`. The recipient sees a read-only report, no sign-in required. You can
revoke the link at any time.

**How do I get to a specific page fast?**
Press <kbd>mod</kbd>+<kbd>k</kbd> (or <kbd>ctrl</kbd>+<kbd>k</kbd>) anywhere to open the command
palette. Type a page name (Home, Dashboard, Pricing, Schedule, etc.) and press <kbd>Enter</kbd>.

**What are those chips above the URL box?**
Those are **outcome tiles** — pre-wired shortcuts for the six most common jobs (AI summary, lead
list, pricing, competitor research, job board, custom). Click one to pre-fill the URL, intent, and
prompt. Click several to combine prompts into one extraction.

**What is the Workspace page?**
When you sign in, the top nav gains a **Workspace** entry — a logged-in command center for your
recent extractions, schedules, batch runs, and notifications.

**What is the Gallery?**
`/gallery` lists recent public extractions. Useful for browsing what others have shared and for
discovering new use-cases.

---

## 15. Keyboard shortcuts

DatIQ has power-user shortcuts for fast navigation and common actions. Press <kbd>?</kbd> any time
to see the full list.

| Shortcut | Action |
|---|---|
| <kbd>?</kbd> | Show this help. |
| <kbd>Esc</kbd> | Close any open modal or overlay. |
| <kbd>/</kbd> | Focus the search / URL input. |
| <kbd>mod</kbd>+<kbd>k</kbd> | Open the command palette (jump anywhere). |
| <kbd>g</kbd> then <kbd>d</kbd> | Go to Dashboard. |
| <kbd>g</kbd> then <kbd>b</kbd> | Go to Batch. |
| <kbd>g</kbd> then <kbd>s</kbd> | Go to Schedules. |
| <kbd>g</kbd> then <kbd>p</kbd> | Go to Pricing. |
| <kbd>g</kbd> then <kbd>w</kbd> | Go to Workspace. |
| <kbd>g</kbd> then <kbd>t</kbd> | Replay the onboarding tour. |

(`mod` = <kbd>⌘</kbd> on Mac, <kbd>Ctrl</kbd> on Windows / Linux.)

---

## 16. Glossary

- **Extraction** — one run of DatIQ against a page, producing structured results.
- **Intent** — what you want from a page (summary, contacts, pricing, map, or custom).
- **Enrichment** — a targeted follow-up pass that adds more detail (e.g. contacts) to an extraction.
- **Batch** — extracting many URLs in one run.
- **Schedule** — a recurring extraction that watches a page and alerts you to changes.
- **Preview** — the screen where you review a single extraction.
- **Dashboard** — your saved archive of all extractions.
- **Content generation** — turning an extracted page into a draft (blog outline, competitor summary, or social posts).
- **Map site** — discovering the set of indexed URLs across a domain.
- **Top-up bundle** — extra capacity added to your current plan.
- **Outcome tile** — a pre-wired shortcut chip above the URL box (lead list, pricing, etc.).
- **Template** — a pre-built extraction recipe (YC companies, SaaS pricing, etc.) you can apply in one click.
- **Workspace** — your logged-in command center for recent extractions and activity.
- **Public report** — a read-only shareable link at `datiq.app/p/<short-code>`.
- **Provenance** — a label that tells you where each piece of extracted data came from.
- **Command palette** — press <kbd>mod</kbd>+<kbd>k</kbd> to jump anywhere.
