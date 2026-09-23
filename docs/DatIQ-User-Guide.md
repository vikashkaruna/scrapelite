# DatIQ — User Guide & Help

> **Audience:** everyone who uses DatIQ — analysts, marketers, founders, researchers, and sales teams.
> This guide explains *what DatIQ does and how to use it*. It is written for people, not engineers:
> there are no code samples, database details, or setup instructions here. If you build software and
> want to call DatIQ programmatically, see the separate **[Developer API reference](developers.html)**.

DatIQ turns the public web into the work your team was going to do by hand. It reads any public page into
structured, usable data — headings, links, contacts, pricing, firmographics, and a plain-language AI summary —
then runs the workflow that turns that data into a finished brief, a scored account list, or a monitored
competitor, and routes what matters to wherever your team already works. No code, no browser extensions,
no scrapers to configure.

### Table of contents

**Getting data**

1. What DatIQ is
2. Quick start — your first extraction
3. The Home composer
4. What you can extract
5. Reviewing results — the Preview screen
6. Enrichment & content generation
7. Batch extraction
8. Scheduling & change monitoring
9. Your Dashboard

**Turning data into decisions**

10. Intelligence workflows — templates that finish the job
11. Bulk account intelligence & ICP scoring
12. Competitor watchlists & change intelligence
13. Signal routing — getting the right change to the right place
14. Shareable reports
15. Team workspaces

**Distribution, audits & account**

16. Exports & sharing
17. Discoverability — SEO, AEO & GEO audits
18. Plans, usage & billing
19. Accounts, trial & sign-in
20. Privacy & your data
21. Troubleshooting
22. Keyboard shortcuts
23. Glossary

---

## 1. What DatIQ is

DatIQ is **the unified web intelligence platform** — it turns the public web into the specific piece of
work your team was going to do by hand, and then keeps doing it.

Most tools in this space stop at extraction: they hand you fields and leave the thinking to you. DatIQ
runs the whole loop.

1. **Read** — give it a web address and it returns clean, structured information: headings, links,
   contacts, pricing, firmographics, or anything else you can describe in plain English.
2. **Reason** — a workflow template turns those fields into the finished artefact: an account brief, a
   competitive comparison, a scored account list, a discoverability audit.
3. **Watch** — a watchlist re-reads what matters on a cadence and works out what actually changed.
4. **Act** — a routing rule pushes the change that matters into Slack, your inbox, a webhook, or your CRM.
5. **Share** — any result becomes a report at its own link, with the access level you choose.

No code, no browser extensions, no scrapers to configure. If you only want step 1, step 1 works on its own
and always will — but the reason teams keep DatIQ is that steps 2 through 5 remove the work between having
data and having a decision.

Typical things people pull out of a page:

- **Structure** — the full heading outline (H1–H6) and every link, internal and external, de-duplicated.
- **An AI summary** — a short, plain-language overview of what the page is about.
- **Contacts** — leadership names, role titles, and contact emails where a page exposes them.
- **Pricing** — structured pricing tiers and plan details from a pricing page.
- **Firmographics** — industry, size band, pricing model, positioning and proof points for a company.
- **A site map** — the set of indexed URLs across a whole domain.
- **Anything else** — describe a field in plain English ("founding year", "office locations") and DatIQ extracts it.

DatIQ works in light and dark themes; use the sun/moon button in the top bar to switch. Your preference is remembered.

### The one rule everything else follows

**DatIQ never invents a fact.** Every field it gives you is either **observed** — read directly off a page,
with the page and the quote recorded — or **inferred** and labelled as inferred, or **absent**. There is no
fourth option and no plausible-looking default.

That has a consequence worth stating plainly: an honest run sometimes comes back with less than you hoped.
A company that does not publish its headcount produces a brief with no headcount in it. That is the correct
outcome. Every score DatIQ computes therefore carries a **coverage** figure alongside it, so you always know
how much of the picture the number is based on — because a confident number built from two of five signals
is not the same claim as one built from all five, and a tool that hides the difference is a tool that will
eventually cost you a deal.

### What DatIQ is made of

| Layer | What it is | Where it lives |
|---|---|---|
| **Web intelligence core** | Single, batch and scheduled URL extraction — the engine everything else runs on. | Home, Batch, Schedules |
| **Enrichment & insight** | AI summaries, contacts, pricing, firmographics, generated content. | Preview, Dashboard |
| **Intelligence workflows** | Named end-to-end jobs — account briefs, competitive briefs, audits, bulk scoring. | Templates, Lists |
| **Change intelligence** | Standing watches on competitors, with materiality classification. | Watchlists |
| **Signal routing** | If-this-then-that delivery into Slack, email, webhooks and CRM. | Rules, Integrations |
| **Distribution** | Exports, pushes, shareable reports, branded deliverables. | Everywhere results appear |
| **Collaboration** | Shared workspaces, roles, seats, workspace-scoped reports. | Workspace |
| **Programmatic access** | REST endpoints and webhooks for building DatIQ into your own systems. | Business plans and above |

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

The composer is the **only place you start an extraction** — single page, many pages, or recurring. There is
no separate "Batch" screen to go to first; paste what you have and DatIQ works out what it is.

**The input box** accepts:

- **A single URL** → a normal one-page extraction.
- **Several URLs** (pasted as a list, one per line) → DatIQ recognises them and runs a **batch**.
- **Text that happens to contain links** — an email, a Slack thread, a Markdown list — → DatIQ counts the
  links and **asks which you meant**: *"Extract all 8"* or *"Extract this text as one page"*. Both are
  reasonable readings of a newsletter with ten links in it, so DatIQ never guesses for you.
- **Pasted text or page content** → DatIQ can structure and summarise raw text you paste in, even without a URL.

**The toolbar (bottom of the box):**

- **＋** — the options menu: **Import CSV** (upload a list of URLs), **Add multiple URLs** (switch the box to
  a multi-line list), and **Run in background** (see below). A dot on the ＋ means background mode is on.
- **Batch** — force batch mode for multiple URLs.
- **Discover** — shown when the box holds exactly one URL. Takes that page to the **Discoverability** screen
  with the URL already filled in, so you can score it for search, answer engines and generative engines
  without retyping it. It does not start the audit — you pick the profile, device and page type and press the
  button yourself, so an audit is never spent on settings you did not choose.
- **Schedule** — arm a recurring cadence (e.g. *Daily*) so the extraction repeats automatically. Choose **Custom schedule…** to open the full scheduling screen.
- **Extract** — the action button. Its icon reflects the mode: a single page, a batch (layers), or a scheduled run (calendar).

You can also **drag and drop a CSV file** anywhere onto the box to load a list of URLs.

### Run in background

Turn on **Run in background** in the ＋ menu and a run keeps going while you carry on working — browse your
Dashboard, start reading another page, or move around the app; the run is not tied to the screen you started
it from. Progress appears in a small **dock** in the corner showing `Extracting 3 / 12 URLs…`, the URL being
read right now, and a **Cancel** button. The setting is remembered between visits and applies to single and
batch runs alike.

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

**Advanced options** (the link under the chips) let you fine-tune a run. These apply to single **and** batch
runs, so a setting you pick here survives when DatIQ routes a multi-URL paste into a batch:

- **Render JavaScript** — waits a few seconds for React/Vue/Angular pages to finish drawing before reading them.
  Use it when a page looks empty in the results but fine in your browser.
- **Generate AI content for each URL** — drafts content per result as the run goes (adds roughly 1–2 s per URL).
  Pick the **content type** — *SEO blog outline*, *competitor summary*, or *social posts* — from the chips that
  appear. Not available in **Map site** mode.

When you import a CSV, DatIQ also shows **which column it detected the URLs in**, so you can confirm it picked
the right one before running.

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

When you need many pages at once, use **Batch**. You start it exactly the same way you start anything else —
**from the Home composer**. Paste several URLs (or import a CSV, or turn on **Batch** in the toolbar) and
DatIQ runs them as a batch and takes you to the batch screen. There is no separate Batch tab in the
navigation; **Extract** covers it.

![DatIQ batch results](assets/screenshots/04-batch.png)

How it works:

1. **Paste URLs** (one per line) into the Home composer, or **Import CSV**, or drag a CSV onto the box.
2. Choose an **intent** (the same chips as single extraction), and any **Advanced options** you want.
3. Click **Extract**.
4. Watch progress in the **dock** — `Extracting 3 / 12 URLs…` with the current URL and a **Cancel** button.
   With **Run in background** on, you can leave the page and the run continues.
5. When it finishes you get a **results table** — each row shows the page, a summary snippet, and a status.
   **Filter** by *All / Success / Failed* and **sort** the rows; each failed URL shows its reason and a
   **Retry** button.
6. All successful pages are **saved to your Dashboard automatically**, and grouped together as one batch run.
7. **Export ▾** the whole batch (CSV, PDF, Markdown, JSON), **Push** it to a connected destination, start a
   **New batch**, or **View in Dashboard**.

### Coming back to a batch later

Every batch run gets its **own address**. The results page is `datiq.app/batch?run=<id>`, so you can bookmark
it, reload it, or share it with yourself and the full results — **including the failures** — come back exactly
as they were, with Retry still working.

That matters because only *successful* pages become Dashboard entries. A URL that failed has no Dashboard row
at all, so the batch results page is the only place its failure and its Retry button live. Your Dashboard also
links back here from a run's banner when that run had failures.

> **Note:** each URL in a batch counts toward your monthly extraction allowance, and plans have a maximum
> number of URLs per batch. The page tells you your current limit.

---

## 8. Scheduling & change monitoring

Scheduling lets DatIQ **re-check a page on a recurring cadence and alert you when it changes** — perfect
for watching a competitor's pricing, a careers page, or any page that matters.

![DatIQ schedules screen](assets/screenshots/05-schedules.png)

**Two kinds of scheduled job live here.** When you create one, pick **What to run**:

| | What it watches | How often | What triggers an alert |
|---|---|---|---|
| **Extraction** | The page's content | Hourly to monthly, or a custom cadence | The content changed since the last check |
| **Discoverability** | The page's four scores | Daily, weekly or monthly | The overall score moved by more than your threshold — **or a new critical issue appeared, whatever the threshold is set to** |

A discoverability monitor asks you for the **audit profile** (which of the four views leads the report), the
**device** to audit as, and an **alert threshold in points**. All four scores are always calculated whichever
profile you choose — the profile only picks which one leads, so your scores never depend on the setting you
happened to pick.

> **Schedules are no longer in the top navigation.** You reach this screen from the composer's **Schedule**
> menu, from **Workspace**, from your Dashboard's run history, or from **Schedules & monitors** in your
> account menu. Nothing was removed — the page and every link to it still work.

> **Scheduling needs an account.** Recurring runs happen on DatIQ's servers, not in your browser — so a
> schedule has to be saved to your account before anything can run it. If you create one while signed out,
> DatIQ **holds onto it and prompts you to sign in**, then saves it for you automatically the moment you do.
> Any schedule that could not be saved is clearly labelled **"Not running — sign in to start this schedule"**
> rather than showing you a next-run time it can't honour.

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

**If your plan lapses,** scheduled runs pause automatically and resume on their own when you renew — you
do not have to re-create or re-arm them. A schedule you paused yourself stays paused either way. See
[Plans, usage & billing](#11-plans-usage--billing).

---

## 9. Your Dashboard

The **Dashboard** is your saved archive. Every extraction (single, batch, or scheduled) is saved here automatically.

![DatIQ Dashboard, table view](assets/screenshots/06-dashboard-table.png)

Features:

- **Search** across your saved pages.
- **Type filter** — All / Single / Batch / Scheduled, with a chip on each row showing where it came from.
- **Grouping** — batch runs and scheduled runs collapse into a single parent row you can expand; single extractions stand alone.
- **Table or card view** — switch with the layout toggle.
- **Batch runs** — reopen any past run's full results, failures included.
- **Export ▾**, **Push ▾**, and **Refresh** sit together in the toolbar.

![DatIQ Dashboard, card view](assets/screenshots/07-dashboard-cards.png)

**Working with selections:** tick one or more rows and a selection row appears beside the filters with
**Generate** (content), **Email**, and a count you can **Clear**. **Export ▾** and **Push ▾** stay in the
toolbar and follow your selection: with rows ticked they act on those rows, and with nothing ticked they act
on everything currently filtered — so *"Export all 8"* and *"Push to (8)"* always agree. Each row also has
**View** (open in Preview) and **Delete**.

### Signed out? Your pages are saved in this browser only

You can extract without an account, and those pages are saved — but **only in the browser you used**. Clearing
site data or switching browsers loses them. The Dashboard says so plainly at the top, telling you how many
pages are browser-only. **Sign in and DatIQ moves them onto your account for you** — nothing to re-run and
nothing to re-import.

---

## 10. Intelligence workflows — templates that finish the job

Extraction gives you fields. A **workflow** gives you the finished piece of work those fields were for —
a brief you can open a call with, a comparison you can take into a pricing meeting, a scored account list
your reps can work today. Workflows are where DatIQ stops being a tool you operate and starts being a
process that runs.

Open **Templates** from the top bar. Every template is a complete, named job: an input form, the fields
DatIQ will read, the analysis it will run, and the output blocks you get back.

### The template catalogue

| Template | Built for | What you get |
|---|---|---|
| **Sales-ready Account Brief** | Sales / SDR / BDR | What a company does, who they sell to, how they price, and who to talk to — framed for a discovery call, a displacement, or an expansion. |
| **Bulk ICP Account Enrichment** | Sales / RevOps | A list of domains in, an enriched and scored account table out. See §11. |
| **Competitor Pricing Tracker** | Competitive intelligence | A competitor's pricing page as a structured tier table you can diff later — the starting snapshot for a watchlist. |
| **Customer Proof Extractor** | Competitive intelligence | Every named customer, case study, logo and quantified outcome on a site — the evidence layer under a battlecard. |
| **AI Visibility & Competitive Brief** | Competitive intelligence / Marketing | How you and up to four competitors describe, price and position yourselves — and what an AI answer engine would say about each of you. |
| **SEO / GEO / AEO Audit** | SEO / Content | A page scored for classic search, answer engines and generative engines, with a prioritised fix list. See §17. |
| **Pre-Meeting Due Diligence Brief** | Founder / VC | A source-backed company brief before a first call: what they do, traction signals, team, and what to ask. |

The catalogue is filtered by your persona by default, so the templates that fit your job are the ones you
see first. Switch personas from the user menu, or clear the filter to browse everything.

### Running a template

1. Pick a template. You get a short form — usually one domain or URL, plus one or two choices that set the
   angle (a discovery call versus a displacement, a diligence deep-dive versus an intro).
2. DatIQ shows you a **cost estimate before you commit** — how many pages it expects to read and how many
   AI calls it expects to make. Nothing is spent until you press Run.
3. The run streams its progress. When it finishes you get the output blocks: structured facts, the written
   analysis, and the sources behind them.
4. Every run is saved. Re-open it from the template's run history, share it as a report (§14), or export it.

### Every claim carries its source

Workflow output is **evidence-backed by construction**. Each extracted fact travels with where it came from —
the page it was read on, and the verbatim quote that supports it. A field DatIQ could not observe is marked
**absent**, not guessed. That distinction is the whole point:

> A brief that says "we don't know their headcount" is useful. A brief that invents one is worse than no
> brief at all, because somebody acts on it.

You will see this in the output as a coverage indicator — what proportion of the requested fields were
actually found. A low-coverage run is telling you something real about the target's website, not failing.

### Making a template your own

On the **Go plan and above** you can **duplicate** any template and edit it — change the fields it reads,
rewrite the prompts, adjust the output blocks. Your copy is private to your account and appears in your own
catalogue alongside the originals. The shipped templates are never modified, so you always have a working
baseline to fork again.

---

## 11. Bulk account intelligence & ICP scoring

**Lists** is where a spreadsheet of company domains becomes a worked, scored, prioritised account table.
It is built for the moment a rep or a RevOps lead is handed 300 domains and asked which ones matter.

Open **Lists** from the top bar.

### Building a list

1. **New list** — name it, and paste or upload the domains. CSV upload and plain paste both work.
2. DatIQ **normalises and de-duplicates** as it imports: `https://www.Acme.com/pricing`, `acme.com` and
   `ACME.COM` are one account, not three. The import summary tells you how many duplicates it collapsed.
3. Pick the persona the list is for — it seeds the scoring rules with a sensible starting profile.

### Enrichment that never invents a field

Running a list reads each company's public site and returns firmographics: industry, size band, pricing
model, whether they publish pricing at all, positioning, proof points, and contacts where a site exposes them.

Every field is one of exactly three things: **observed** (read directly off a page), **inferred** (derived
from what was observed, and labelled as such), or **absent**. There is no fourth state. Absent fields are
omitted rather than filled with a plausible-looking default — which means an honest run produces a lower
**coverage** number rather than a wrong **score**.

Runs are **durable and chunked**. A list of 500 accounts is processed in claimable batches, so closing the
tab, losing your connection, or a provider having a bad minute does not lose the work already done. Re-open
the list and the progress is where you left it.

### ICP scoring — rules you can actually edit

The **Rules** tab holds your Ideal Customer Profile as data, not as an opaque model. Each criterion is a
field, an operator, a value, and a weight — for example *industry is one of Software, Fintech* at weight 30,
or *employee count is at least 50* at weight 20. Mark a criterion **required** and an account that fails it
cannot qualify however well it scores elsewhere.

Two rules govern the maths, and both exist to stop the score lying to you:

- **An unmeasured field is never scored as zero.** If a company's headcount could not be found, that
  criterion is excluded and its weight is redistributed across the criteria that *were* measured. Scoring
  it zero would punish a company for our failure to read their site.
- **Coverage travels with every score.** A 70 computed from five of five criteria and a 70 computed from
  two of five are different claims, and the table shows you which one you are looking at. An account with
  zero coverage scores **no result**, not zero.

Set the qualification **threshold** (50 by default) and test it live against a sample domain before you
apply it to the whole list. Change a weight, watch the sample re-score, then run.

### The review queue

Low-confidence extractions land in **Review** rather than silently entering your table. You confirm,
correct, or discard them. This is deliberate: the alternative is a 94%-accurate table that nobody can tell
the bad 6% inside, which is a table nobody trusts.

### Getting the list out

Export the qualified accounts as CSV or JSON, or push them straight into HubSpot, Notion, Airtable or Slack
from the same screen. Scores, coverage, and the source URL behind each field travel with the export — so
the rep working the list can see *why* an account qualified, not just that it did.

> **Plan note.** Bulk lists use your plan's batch allowance, so the number of accounts you can enrich in one
> list matches the batch size your plan already includes (see §18). Top-up bundles raise it.

---

## 12. Competitor watchlists & change intelligence

A one-off competitor snapshot is out of date the week you take it. **Watchlists** turn that snapshot into a
standing watch: DatIQ re-reads the pages you care about on a cadence, works out what actually changed, and
tells you only when the change is worth your attention.

Open **Watchlists** from the top bar.

### Setting one up

1. **New watchlist** — name it, describe what you are watching for, and add the competitor domains.
2. Choose a **cadence** — how often DatIQ re-reads them.
3. Choose what to track: pricing, product and feature claims, positioning and messaging, leadership, or
   customer proof.

The first run is always a **baseline**. It never alerts — there is nothing to compare it against yet, and a
tool that fires an alert the moment you set it up teaches you to ignore its alerts.

### Pages you added, and pages we suggested

You do not have to know a competitor's site map to watch it usefully. When you add a domain, DatIQ reads
its homepage and **suggests the pages worth monitoring** — pricing, product, customers, and so on.

Suggested pages are labelled as such and kept visibly separate from the ones you added yourself, so
opening a watchlist never shows you pages you did not choose with no way to tell which were which.
Removing a suggestion is removing a suggestion; it does not undo a decision you made.

This distinction is not cosmetic: **every monitored page is a recurring crawl on your allowance**, so
being able to see what was added automatically — and prune it — is how you keep control of what a
watchlist costs.

### Materiality — why you are not woken up for a copyright year

Every detected change is classified by how much it matters, and the classification drives what happens next:

| Materiality | Examples | What DatIQ does |
|---|---|---|
| **Critical** | A price changes, a tier is added or removed, a plan is discontinued. | Alerts immediately. |
| **High** | A headline feature claim changes, positioning shifts. | Rolled into the daily digest. |
| **Medium** | Supporting copy, a new case study, a page reorganised. | Rolled into the weekly digest. |
| **Low** | Whitespace, a copyright year, a rotated testimonial. | Recorded, never alerted. |
| **Unknown** | DatIQ cannot tell how much it matters. | Sent to review rather than guessed at. |

One rule is worth stating on its own, because getting it wrong is expensive:

> **A field that stopped being observed is not a deletion.** If a pricing table was there last week and is
> unreadable today, the overwhelmingly likely cause is a failed page render, not a competitor removing their
> pricing. DatIQ reports it as unobserved. "They deleted all their pricing" is the costliest false positive
> in this whole product, and it is not one we will hand you.

### Facts and interpretation stay separate

A change record has two halves that never blend into each other. The **fact** is what changed — the old
value, the new value, the page, the timestamp. The **interpretation** is what DatIQ thinks it means
strategically, and it is always labelled as an AI reading rather than an observation. You can mark an
interpretation useful or wrong, and that feedback is kept with the record.

The reason for the split is simple: you may need to take the fact into a pricing meeting. A fact is
defensible. An interpretation is a starting point for a conversation.

### Where changes go

Changes appear in the watchlist's own feed, and — if you want them elsewhere — get routed by the rules in
§13 to Slack, email, a webhook, or your CRM.

> **Plan note.** A watchlist is a recurring monitor, so it uses your plan's scheduled-monitoring allowance
> (see §18). Plans without scheduled monitoring do not include watchlists.

---

## 13. Signal routing — getting the right change to the right place

Intelligence that stays inside a tool is intelligence nobody acts on. **Rules** is DatIQ's if-this-then-that
layer: it watches for the things you care about and pushes them where your team already works.

Open **Rules** from the top bar.

### Building a rule

A rule is three parts:

1. **Trigger** — where the signal comes from: a **competitor watchlist** change, a **bulk enrichment**
   result (for example, an account crossing your ICP threshold), or a **workflow run** finishing.
2. **Conditions** — which of those events actually qualify. Materiality is at least high; the ICP score is
   above 80; the domain is in this set. Conditions are combined, and an event has to satisfy all of them.
3. **Action** — what happens: post to **Slack**, send an **email**, call a **webhook**, or create or update
   a record in **HubSpot**.

### Test it before you trust it

Every rule has a **Test with sample payload** button. It runs your conditions against a realistic event and
shows you both the verdict and *why* — which conditions matched and which did not. The preview and the live
runtime share the same evaluation engine, so a rule that previews as matching is a rule that will match. A
preview that could disagree with production would be worse than no preview.

### What happens on every attempt

Each dispatch is recorded whether it succeeded or not, with the outcome and the response. A destination that
was unreachable is retried on a backoff schedule rather than dropped silently. You can see the execution
history on the rule itself, so "did that fire?" has an answer.

Destinations are re-validated at the moment of dispatch, not only when you saved the rule — a webhook URL
that was fine last month and points somewhere it should not today is refused.

> **Plan note.** Signal routing pushes into the same destinations as the Integrations feature, so it is
> available on the **Select plan and above** (see §18).

---

## 14. Shareable reports

Any workflow run, audit, or extraction can become a **report** — a clean, presentable page at its own link
that you can send to a colleague, a client, or a prospect without giving them an account.

Click **Share** on any result.

### Who can see it

You choose, per report, and you can change it later:

| Visibility | Who gets in | Indexed by search engines? |
|---|---|---|
| **Private** | Only you. No link exists yet. | — |
| **Anyone with the link** | Whoever you send it to. Unlisted. | No |
| **Workspace only** | Any member of that workspace. | No |
| **Specific people** | Only the email addresses you list. | No |
| **Public** | Anyone. Listed, and eligible for the public gallery. | Yes |

Only **Public** is indexable. Every other level ships a `noindex` instruction, so a link you meant for one
client does not turn up in a search result.

### Revoking

**Revoke** permanently burns a link. It cannot be un-revoked, and the slug is never reissued — which is the
point: an link you have revoked is one you needed to stop working, immediately and for good. If you want the
report back, publish it again and you get a fresh link.

Reports can also carry an **expiry date**, after which they close themselves.

### Branding

Reports carry DatIQ attribution by default. On **Business and Agency** plans your **Brand Kit** — your
company name, logo, accent colour, and footer — replaces it, so a report you send a client looks like yours.
Set it up under Account → Brand Kit; it applies to reports, PDF exports and emailed deliverables alike.

---

## 15. Team workspaces

A **workspace** is a shared container for work: the people in it, and what they are allowed to do.

Open **Workspace** from the user menu.

- **Create a workspace** and invite people by email. Invites are single-use, expire in 14 days, and can only
  be accepted by the address they were sent to.
- **Roles** — owner, admin, member. Owners and admins can invite and remove; members work.
- **Seats** — the seat count includes the owner. Your plan sets how many seats and how many workspaces you
  can own (see §18); the Agency plan adds client workspaces, and extra workspaces can be bought as an add-on.
- **Pause a seat** — a member you pause keeps their access to what they can read but cannot spend the
  workspace's allowance. Useful for a contractor between engagements.

Reports set to **Workspace only** visibility are readable by every member of that workspace, which is the
simplest way to circulate an internal brief.

---

## 16. Exports & sharing

**One menu, three sections.** Wherever results appear — Preview, the Dashboard, Batch results and a
workflow run — the same **Export** menu opens with the same three groups:

- **Download** — a file you save.
- **Copy to clipboard** — text you paste straight into a doc or a chat.
- **Send** — deliver it somewhere: email it to yourself, or push it into another tool.

It is deliberately one component rather than a menu per screen. Three separate copies is three places for
the format list, the plan rules and the wording to drift apart — and they had drifted, which is also how
workflow runs ended up with no export at all until it was noticed.

| Format | Best for |
|---|---|
| **CSV** | Spreadsheets and importing into other tools. |
| **Excel (.xls)** | Opening straight in Microsoft Excel with the columns already typed. |
| **PDF** | A polished, shareable report. |
| **Markdown** | Pasting into docs, wikis, or notes. |
| **JSON** | Structured data for further processing. |
| **Email** | Send selected extractions to yourself, as a real file attachment. |
| **Copy to clipboard** | Markdown, JSON or CSV, straight onto the clipboard. |

Some formats need a paid plan — the menu shows which, and the check runs again when you click, so what
the menu offers and what you are actually allowed are always the same answer.

### Push to your tools

**Send** is the single place destinations live, inside the Export menu on every screen that shows results.
Everything you can send to is in that one list, so there is no second menu to go hunting for.

| Destination | What you push | Setup |
|---|---|---|
| **HubSpot** | Contacts and companies from an extraction, mapped to the right HubSpot properties | Once, in `/account#integrations` |
| **Airtable** | Each extraction row into the table you choose, with a per-table field map | Once, in `/account#integrations` |
| **Notion** | Each extraction into a Notion database, with a title column and property mapping | Once, in `/account#integrations` |
| **Slack** | New extractions and change alerts into the channel you choose, formatted as a readable message | Once, in `/account#integrations` |
| **Google Sheets** | A CSV of the rows you picked, with a blank sheet opened ready to receive it | **No setup needed** |

Google Sheets is marked *"No setup needed"* in the menu because there is genuinely nothing to authorise —
DatIQ downloads the CSV and opens a fresh sheet for you to drop it into.

The four connected destinations are set up once in **Account → Integrations**; after that, pushing is a single
click and the destination receives the structured data directly — no copy-pasting, no CSV re-uploads. A
connected destination stays connected: **Test** it, **Edit** its label, or **Disconnect** it from the Account
screen. Tokens are stored server-side and never re-displayed; replacing a token re-fetches the schema where
that applies (Airtable / Notion).

Need to change an Airtable or Notion **field mapping**? Open **More destination options…** at the bottom of
the Push menu.

**Zapier** works differently and is not in the Push menu: it *listens* for new extractions as a trigger event
for any of 5,000+ apps, rather than being somewhere you push to. Set it up in `/account#integrations`.

### Sharing a single extraction

From any extraction on the Dashboard or Preview, click **Share** to get a public link. The link
opens a read-only report at `datiq.app/p/<short-code>` that anyone can view — no sign-in needed.
Public reports can be unshared at any time. Recent public extractions also surface on the
**`/gallery`** page.

---

## 17. Discoverability — SEO, AEO & GEO audits

Extraction answers *"what is on this page?"*. Discoverability answers a different
question about a page you usually already own: **"can this page be found, and
can an AI assistant quote it?"**

Open **Discoverability** in the top nav, paste a URL, and press **Run audit**.
You can also paste a URL into the Home composer and press **Discover**, which
carries it straight here.

![The DatIQ Discoverability screen](assets/screenshots/11-discoverability.png)

### The operating loop

The step ribbon at the top of every Discoverability screen shows where you are:

| Step | What happens |
|---|---|
| **1.1 Discover · 1.2 Score · 1.3 Diagnose · 1.4 Recommend** | One audit does all four in a single run — it reads the page, scores it, explains what is wrong and writes the fixes. |
| **2. Implement** | Record your canonical business facts and check your schema and trust signals. |
| **3. Validate** | Re-measure search-to-outcome friction and confirm fixes worked. |
| **4. Benchmark** | Score your brand, products and services and compare over time. |
| **5. Expand** | Grow your entity graph and check your local directory listings. |

### Which audit you are working on

Once an audit is open, a context bar shows it in brief — its short id in
brackets, then the domain, audit profile, device, page type and when it ran — for
example *Active audit (9a8b7c6d) acme.com · Balanced · Mobile · Pricing · 15 Sep 2026*.
The same audit stays selected as you move between tabs, so every tab works on the
same page until you open a different one.

Tabs show what you last saw on them straight away and then refresh from your
account, so you are never staring at an empty screen while data loads. Nothing
is kept in the browser after you sign out.

### What it measures

Search has split into three audiences that reward different things, so DatIQ
scores all three separately and shows you where they disagree.

| Score | Audience | Rewards |
|---|---|---|
| **SEO** | Classic search engines | Crawlability, rendering, canonicals, page speed |
| **AEO** | Answer engines (ChatGPT, Perplexity, AI Overviews) | Concise, answer-first passages that survive being quoted |
| **GEO** | Generative engines | A clear machine-readable identity, and being cited as the source |
| **Overall** | All three, weighted | A balanced view when you are not optimising for one in particular |

Underneath those sit four pillars, and every score traces back to them:

- **Answer Clarity** — is there a self-contained answer near the top, and would it still make sense quoted on its own?
- **Entity Authority** — can a machine tell who published this, and do answer engines already cite you?
- **Structural Hierarchy** — is the page segmented cleanly enough for a retrieval system to find the right section?
- **Technical Accessibility** — can bots reach, render and trust the page at all, including the crawlers that feed AI answers?

Open any pillar card to see every individual signal, its weight, and its score.

### "Not measured" is not zero

Some signals need something outside the page — Core Web Vitals come from
Google's field data, and citation footprint comes from sampling an answer
engine. When one of those is unavailable, DatIQ marks it **not measured** and
leaves it out of the score entirely, redistributing its weight across the
signals it *could* read.

That is why every score shows a **coverage** figure beside it. A 92 built on 70%
of the signals is not the same as a 92 built on all of them, and you should be
able to see which one you are looking at.

Some signals are marked **not applicable** instead. A pricing page has no
step-by-step procedure, so it is never asked for HowTo markup, and it is not
marked down for the absence.

### Blocking issues

A few problems undermine a page no matter how good the writing is — the page is
marked `noindex`, AI crawlers are disallowed, the content only appears after
JavaScript runs. These scale the whole score down rather than costing it a few
points, and the report shows you the arithmetic: your score before the blockers,
the multiplier, and the result.

### The fix list

Every finding becomes a prioritised recommendation with:

- **who** does it — content, SEO, engineering, brand or product
- **how much** it is worth on *your* page, not in general
- **how hard** it is, and how confident we are the finding is right
- **something to paste**, where one exists

That last one is the point. Where a fix is a piece of markup or a block of copy,
DatIQ writes a draft from what your page already contains — FAQ schema built
from your visible questions, an Organization block carrying your real profile
links, a corrected heading outline that leaves your wording alone and fixes only
the nesting.

Anything the audit could not observe appears as a `TODO:` placeholder rather
than an invention. Fill those in before you publish — a schema block containing a
made-up founder name is worse than no schema block, because it tends to get
published without being read.

Sort the queue by owner, accept what you will do, and dismiss what does not
apply. A dismissal asks for a reason, because three months later a dismissal
with no reason is indistinguishable from a mis-click.

### Proving the fix worked

An audit is a reading. Two are a direction.

Press **Re-audit** after you have made changes and DatIQ measures the page again
and compares it against the previous run: what moved, what was resolved, and —
most importantly — anything **new** that appeared, because a fix that introduces
a regression is exactly what you want to catch before it compounds.

The comparison only reports a change when both audits actually measured the same
thing. If Core Web Vitals were unavailable last week and available today, that
difference is labelled as not comparable rather than being presented as your
improvement.

The **History** panel plots every audit of that page over time. A gap in the line
is a run where that score could not be measured — it is drawn as a gap rather
than a straight line, because joining two points through a reading that never
happened would show a trend you did not have.

### Reading a report

Every report opens with the **page it is about** — the full URL, when the audit
ran, and the profile, device and page type it ran under — followed by a short
**written summary** of what the numbers mean. The summary names the findings that
matter rather than restating the scores, so somebody who reads only the first
paragraph still knows what was concluded.

It is written once, the first time the report is opened, and then kept with the
audit — so it travels into every export and does not change between readings.
Occasionally it is unavailable; the report says so, and the findings below it are
unaffected.

Below the summary, the four pillars are laid out in **two columns** across the
full width of the report — Answer Clarity beside Entity Authority, Structural
Hierarchy beside Technical Accessibility — and each can be **expanded
independently** to show the signals underneath it and what each one scored.
Opening a second pillar does not close the first, so two can be compared side by
side. Exported PDF and Markdown reports use the same two-column pillar layout.

### Entity graph approvals

Approving a relationship also approves the two entities it connects, if they are
still only proposed. Approval normally means a second person looked. If you work
alone, DatIQ records your approval as a single-founder approval — including when
you proposed one of the connected entities yourself. If a teammate proposed the
relationship but you proposed an entity it connects, you are told plainly and can
approve it as a single-founder approval or ask the teammate.

### Local directories that do not apply

The local directory list covers every source relevant to a region, and not every
source fits every business — a restaurant directory is no use to a software
company. Choose **Not applicable? Ignore** on a source, pick a reason, and it is
excluded from NAP checks for that business record. Ignored sources are hidden
under **Show ignored**, keep the reason and date you recorded, and can be
**restored** at any time.

### Exporting a report

Four formats, from the buttons at the top of the report. All four contain the
**whole** report — the summary, the four framework scores with their coverage,
every pillar and every signal, the blocking penalties, the full issue and fix
lists, the evidence (technical facts, which answer-engine crawlers are allowed,
the heading outline, the citation sample) and the comparison against your last
audit if there is one.

| Format | Best for |
|---|---|
| **Report** (Markdown) | Pasting into a ticket, a doc or a pull request |
| **PDF** | Sending to a client or attaching to a report |
| **CSV** | Spreadsheet work — one file with the scores, signals, issues and fixes stacked as sections |
| **JSON** | Feeding another tool |

The PDF also carries the **copy-ready assets** — the schema blocks and answer
blocks the fix list generates — so it is usable on its own.

### Watching a page

On Pro and above you can put a page on a schedule — daily, weekly or monthly.
DatIQ re-audits it in the background and emails you only when something material
moves: the overall score past a threshold you set, or a new critical issue.

A monitor that emails every week regardless is a monitor nobody reads by week
four, so it stays quiet when nothing has happened.

Create one from **Schedules** (choose **Discoverability** under *What to run*),
or from **Workspace → Schedule discoverability**. Your monitors are listed on the
Schedules screen alongside your extraction schedules, and on the
**Discoverability** tab of your Workspace.

### Comparing against competitors

A **benchmark** audits several URLs with the same profile and lines the results
up side by side, so "why is that page more answer-ready than mine?" becomes a
question you can answer from evidence rather than intuition.

### What an audit costs

Audits no longer have a separate allowance. They spend from the same pool of
credits as everything else, at **19 credits** for a standard run — an audit
fetches the page twice, checks crawl policy, looks up performance data, samples
citations and runs an AI pass, so it costs more than a single extraction. Each
citation prompt beyond the five included adds 2 credits.

That means you decide how to spend the month rather than being handed two
budgets that cannot be moved between. As a rough guide, if you spent a month's
credits on nothing else:

| Plan | Credits / month | ≈ audits |
|---|---|---|
| Free | 100 (one-time) | 5 |
| Go | 750 | 39 |
| Select | 2,500 | 131 |
| Pro | 6,000 | 315 |
| Developer | 25,000 | 1,315 |
| Business | 40,000 | 2,105 |
| Agency | 100,000 | 5,263 |

Scheduled monitoring needs Select or above. Benchmarks need Select or above.

### What it does not promise

Scores describe how discoverable and extractable your page is **today**. They
are not a prediction of rankings, citations or traffic, and no honest tool can
give you one. What they do give you is a reproducible measurement, the evidence
behind it, and a list of things to change — so that when the outcome does move,
you know what you changed.

### Sites that ask not to be read

DatIQ honours robots.txt. If a site's robots.txt disallows automated access,
the audit is refused rather than run.

If the site is yours, or you have the owner's permission, you can record that
once per site and re-run. That confirmation is tied to your account and to that
exact site, it expires after 180 days, and you can withdraw it at any time.

## 18. Plans, usage & billing

DatIQ is sold in one unit: **credits**. One credit is one page fetch, and
everything else is priced as a multiple of it — so there is a single number to
watch rather than a separate allowance per screen.

![DatIQ pricing page](assets/screenshots/08-pricing.png)

| What it costs | Credits |
|---|---|
| Reading a page (extraction, batch row, monitor check) | 1 |
| A fast AI call | 2 |
| A deep AI call | 5 |
| Enriching one account-list row | 3 |
| A Discoverability audit | 19 |

### Plans

Prices are set separately in US dollars and Indian rupees — the rupee price is
its own number, not a conversion, so the figure you are quoted is the figure you
are charged. Annual billing is billed twelve months upfront and works out
cheaper per month.

| Plan | Per month | Credits / month | Batch | Bulk list | Monitors |
|---|---|---|---|---|---|
| Free | Free | 100, one-time | 5 | — | — |
| Go | $5 · ₹490 | 750 | 20 | 20 | — |
| Select | $15 · ₹1,449 | 2,500 | 50 | 50 | 5 |
| Pro | $25 · ₹2,449 | 6,000 | 100 | 100 | 10 |
| Developer | $55 · ₹5,449 | 25,000 | 250 | 250 | 10 |
| Business | $85 · ₹7,849 | 40,000 | 250 | 250 | 25 |
| Agency | $200 · ₹19,449 | 100,000 | 500 | 500 | 100 |

Free's 100 credits are granted once and never reset. Every paid plan's credits
renew monthly and **roll over for one month**, so you can hold at most two
months' worth — unused credits are not lost the moment the month turns, and they
do not accumulate for ever either.

Integrations and signal routing start at Select; API access, extra seats and
white-label PDFs at Business. **Enterprise** is custom volume and terms — contact
sales.

### Credit packs and capacity add-ons

Two different things, and the difference matters:

- **Credit packs** buy credits outright — 500 for $5 / ₹490, 2,000 for
  $19 / ₹1,849, 10,000 for $89 / ₹11,449. They work on any plan including Free,
  and **they never expire**.
- **Capacity add-ons** buy the *right* to do something: a Scheduled Monitor slot
  ($5 / ₹490), a Batch Pack of 50 extra rows ($9 / ₹879), an Extra Workspace
  ($19 / ₹1,849). The doing still costs credits — an add-on raises a ceiling, it
  does not come with a budget attached.

### Your price is fixed for the period you paid for

If DatIQ's prices or plan limits change while you are subscribed, **nothing you
bought gets worse**. For the rest of the period you have paid for you keep the
price you were charged and the limits you bought, and if a limit goes *up* you
get the increase straight away. The new pricing applies when you renew, not
before — so a change is never something you discover mid-month.

### What each capability draws on

Everything spends from the one pool. What differs is the ceiling a plan puts on
a single run:

| Capability | Costs | Bounded by |
|---|---|---|
| Single extraction, enrichment, template runs | Credits | Your credit pool |
| Batch extraction | 1 credit per page | Your plan's **batch size** |
| **Bulk account lists** | 3 credits per row | Your plan's **bulk list size** |
| Scheduled monitors and **competitor watchlists** | 1–2 credits per check | Your plan's **monitor slots** |
| **Signal routing rules** | Free to dispatch | Included wherever **integrations** are (Select and above) |
| Discoverability audits | 19 credits per run | Your credit pool |
| Exporting and sharing a report | Nothing | Free on every plan, including Free |

### Knowing the cost before you spend it

Any job that reads more than one page — a template run, a bulk list, a watchlist check — shows you an
**estimate before it starts**: how many pages it expects to read and how many AI calls it expects to make.
Nothing is spent until you confirm.

Afterwards, the **usage ledger** on your Account screen records what each job actually consumed, itemised
by what it was spent on. Estimates and actuals are reconciled, so if a job costs materially more than it
quoted you can see that it did, rather than discovering it at the end of the month.

Manage everything from the **Account** screen: your current plan, usage this month, usage alerts,
coupon entry, and payment history. Before any charge, a confirmation shows the full breakdown (including taxes where applicable).

A detailed **plan comparison matrix** sits below the plan cards on the pricing page — it lists every
capability by tier so you can see at a glance which plan unlocks what.

### Invoices & receipts

Every completed payment produces its own numbered, itemised document, listed under **Invoices &
receipts** on the Account screen.

- **You get it automatically.** A copy is emailed to you as a PDF attachment as soon as the payment
  completes — you do not have to ask for it or download it to have a copy.
- **View, download, or re-send.** Open any document to see the full breakdown line by line, download
  the PDF again, or have it emailed to you a second time. Re-sending always goes to the address on
  your account, never to an address typed into the page.
- **Receipt or tax invoice.** Where DatIQ is registered for tax in your region, the document is a full
  tax invoice showing the tax split; elsewhere it is a payment receipt that states it is not a tax
  invoice. Either way the amounts reconcile exactly to what you were charged.
- **Documents are permanent records.** An issued document is never edited or re-numbered. If something
  needs correcting, a separate credit note is issued against it, so your records and ours always match.
- **They outlive the subscription.** Your billing documents stay available to you even if you cancel or
  your plan lapses.

### If a plan lapses

If a paid plan ends without renewing, the account moves through clearly-signposted stages rather than
disappearing:

1. **Suspended** — a banner explains the state. Your saved data is intact, and renewing restores full
   access immediately.
2. **Deactivated** — after a further period, if still unrenewed.

You are emailed at each stage, and again before anything is removed, so a lapse is never silent.
Scheduled monitoring **pauses** while a plan is lapsed and **resumes automatically** when you renew —
schedules you paused yourself stay paused. Renewing at any stage puts everything back.

### What you have used

Alongside your plan, the Account screen shows:

- **Credits** — how many you have left, and how many your plan renews with each month. If you are
  holding more than a month's worth, that is last month's rollover.
- **Discoverability** — audits run (19 credits each, from the same pool as everything else), how many
  distinct pages you have audited, how many monitors are running, and your average score across them.
- **Usage by role** — which persona was in use when each unit was spent, so on a team plan you can see
  which role is consuming the allowance. This started being recorded recently, so a month from before then
  says so rather than showing zeros.

### Freezing your account

**Freeze** stops everything that consumes your allowance — extractions, enrichments and discoverability
audits — for you and every team member. Reading and exporting keep working, so nothing becomes unreachable,
and you can unfreeze at any time.

> **Freezing does not pause billing.** Your subscription continues to be charged for the period you are on.
> Freezing is a way to stop *usage*, not a way to stop *paying*. To stop paying, change or cancel your plan.

You can also **pause a single team member** from **Workspace → Team** instead of freezing the whole account.
A paused member keeps read and export access and keeps their seat — pausing is not a way to free up a seat.
The workspace owner cannot be paused by anybody, including themselves.

### Deleting your account

**Delete account** removes your account and everything in it — extractions, audits, schedules, workspaces
and team members. You confirm by typing `DELETE`.

Deletion is **scheduled 30 days out, not immediate**. During those 30 days your account is frozen, nothing
is charged for usage, you can still read and export your data, and **you can cancel at any point** and go
straight back to normal. Invoices are retained after deletion, because we are required to keep them.

---

## 19. Accounts, trial & sign-in

- **Try without an account** — you can start extracting straight away. A trial banner shows how many free
  single extractions and batch runs remain. DatIQ never interrupts you on arrival: the limit is checked
  **when you start a run**, so you are only ever stopped at the moment it actually applies.
- **Sign up / sign in** — create an account with email, or continue with Google, Microsoft, or GitHub. An
  account keeps your work and lifts trial limits.
- **What signing in gets you** — three things stop being temporary:
  - **Your saved pages move onto your account** automatically, instead of living in one browser.
  - **Schedules actually run.** Recurring runs happen on DatIQ's servers, so they need an account (see
    [Scheduling](#8-scheduling--change-monitoring)).
  - **Push destinations** become available.
- **Personas** — optionally tell DatIQ what kind of work you do, and it tailors examples and labels to you. This is opt-in and changeable any time.
- **Sign out** — clears your session data from the device.

---

## 20. Privacy & your data

- DatIQ extracts only from **publicly accessible** pages you point it at.
- Your saved extractions are tied to your account (or kept on your device when you use DatIQ without signing in).
- You can **delete** any extraction at any time from Preview or the Dashboard.
- Signing out clears your session data from the device.
- For full details, see the **Privacy Policy** and **Terms** linked in the footer. DatIQ's privacy practices
  include coverage for applicable data-protection regulations.

---

## 21. Troubleshooting

> Looking for general questions — pricing, plans, sharing, keyboard shortcuts, what DatIQ can
> extract? Those all live in one place now: **[the DatIQ FAQ](https://datiq.app/faq)**. This section
> covers only what to do when something has gone wrong.

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
The results table shows the reason next to each failed URL, with a **Retry** button on that row. Common
causes are unreachable sites, non-HTML pages, or sites that block automated requests. Other URLs in the
batch still succeed. Failures are kept with the run, so you can come back to
`datiq.app/batch?run=<id>` later and retry from there — a failed URL has no Dashboard entry, because only
successful pages are saved there.

**I navigated away and lost my run.**
You shouldn't any more. Turn on **Run in background** in the composer's **＋** menu and runs continue while
you move around the app, with progress in the corner dock. To find a finished run afterwards, open **Batch
runs** on the Dashboard.

**I pasted an email / document full of links and it extracted the whole thing as one page.**
That is one of the two things DatIQ can reasonably do with it, so it asks rather than guesses. Look for the
inline chooser under the box: **"Extract all N"** pulls the individual links; **"Extract this text as one
page"** treats the paste as a single document.

**My schedule says "Not running".**
It was created while signed out and could not be saved to your account, so no server has it to run. Sign in
and DatIQ saves it for you automatically.

**Nothing here matches my problem.**
Check [the FAQ](https://datiq.app/faq) for general questions about sharing, exports, scheduling
alerts, keyboard shortcuts and what each screen does. If it is still not covered,
[contact us](https://datiq.app/contact) and we will help.

---

## 22. Keyboard shortcuts

DatIQ has power-user shortcuts for fast navigation and common actions. Press <kbd>?</kbd> any time
to see the full list.

| Shortcut | Action |
|---|---|
| <kbd>?</kbd> | Show this help. |
| <kbd>Esc</kbd> | Close any open modal or overlay. |
| <kbd>/</kbd> | Focus the search / URL input. |
| <kbd>⌘K</kbd> <span class="key-alt">(Mac)</span> / <kbd>Ctrl+K</kbd> <span class="key-alt">(Windows/Linux)</span> | Open the command palette (jump anywhere). |
| <kbd>g</kbd> then <kbd>d</kbd> | Go to Dashboard. |
| <kbd>g</kbd> then <kbd>b</kbd> | Go to Batch. |
| <kbd>g</kbd> then <kbd>s</kbd> | Go to Schedules. |
| <kbd>g</kbd> then <kbd>p</kbd> | Go to Pricing. |
| <kbd>g</kbd> then <kbd>w</kbd> | Go to Workspace. |
| <kbd>g</kbd> then <kbd>t</kbd> | Replay the onboarding tour. |

---

## 23. Glossary

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
- **Template** — a named end-to-end workflow: an input form, the fields DatIQ reads, the analysis it runs, and the output you get back.
- **Workflow run** — one execution of a template, saved with its inputs, outputs and sources.
- **List** — a set of company domains imported for bulk enrichment and ICP scoring.
- **ICP** — Ideal Customer Profile: the weighted rules an account is scored against.
- **Coverage** — how much of the requested information was actually found. A score always travels with its coverage.
- **Observed / inferred / absent** — the only three states a DatIQ field can be in. Nothing is ever invented.
- **Watchlist** — a standing watch on competitor domains that re-reads them on a cadence.
- **Materiality** — how much a detected change matters (critical, high, medium, low), which decides whether it alerts.
- **Baseline** — the first reading of a watched page. It never alerts, because there is nothing to compare it against yet.
- **Signal rule** — an if-this-then-that rule routing a change or result to Slack, email, a webhook, or your CRM.
- **Report** — a shareable page for any result, with a visibility level you choose.
- **Visibility** — who can open a report: private, link, workspace, specific people, or public.
- **Brand Kit** — your company name, logo, colour and footer, applied to reports, PDFs and emailed deliverables.
- **Usage ledger** — the itemised record of what each job actually consumed.
- **Workspace** — a shared container for work: the people in it and what they may do.
- **Public report** — a read-only shareable link at `datiq.app/p/<short-code>`.
- **Provenance** — a label that tells you where each piece of extracted data came from.
- **Command palette** — press <kbd>mod</kbd>+<kbd>k</kbd> to jump anywhere.
