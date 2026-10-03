// Blog.jsx — DatIQ blog listing page with expandable inline posts.
import { useState } from "react";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { captureEmail } from "../lib/emailCaptureService.js";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const FEATURED_POST = {
  slug: "from-extraction-to-execution",
  tag: "Release",
  title: "From Extraction to Execution: DatIQ Is Now a Platform, Not a Scraper",
  excerpt:
    "Extraction was never the job. The job was the brief, the scored list, the competitor you needed to hear about on the day it changed. This release ships all three — workflow templates, bulk account intelligence with ICP scoring, competitor watchlists, and signal routing that puts the result where your team already works.",
  date: "September 4, 2026",
  readTime: "8 min read",
  coverIcon: "layers",
  fullContent: `
For most of its life, DatIQ answered one question well: *what is on this page?* You pasted a URL, you got back headings, links, contacts, pricing and a summary, and then you did the actual work yourself — in a spreadsheet, in a doc, in your head.

That gap is the whole product now.

## The problem with stopping at extraction

Nobody wants fields. A salesperson wants to know which forty of these four hundred accounts are worth a call this week. A competitive intelligence lead wants to know the day a competitor changed their pricing, not the quarter. A founder wants to walk into a first meeting already knowing the company.

Extraction is step one of a five-step loop, and until now DatIQ handed you step one and wished you luck. This release ships the rest of it: **read, reason, watch, act, share.**

## Workflow templates: the finished artefact, not the raw fields

**Templates** is a catalogue of named end-to-end jobs. Each one is an input form, the fields DatIQ will read, the analysis it will run, and the output blocks you get back. Seven ship today, filtered by persona so the ones that fit your job are the ones you see first:

- **Sales-ready Account Brief** — a company framed for a discovery call, a displacement, or an expansion
- **Bulk ICP Account Enrichment** — a list of domains in, a scored account table out
- **Competitor Pricing Tracker** — a pricing page as a structured tier table you can diff later
- **Customer Proof Extractor** — every named customer, case study, logo and quantified outcome on a site
- **AI Visibility & Competitive Brief** — you and up to four competitors, read under one shared schema
- **SEO / GEO / AEO Audit** — a page scored for search, answer engines and generative engines
- **Pre-Meeting Due Diligence Brief** — a source-backed company brief before a first call

You see a cost estimate before anything runs, and nothing is spent until you confirm. On Go and above you can fork any template and rewrite its fields, its prompts and its outputs; the shipped originals are never modified, so you always have a working baseline to fork again.

## Bulk account intelligence: 500 domains, scored, with the receipts

**Lists** is for the Monday morning where somebody hands you three hundred domains and asks which ones matter.

Paste or upload them. DatIQ normalises and de-duplicates on the way in — three spellings of one company become one account — then reads each company's public site for firmographics, pricing model, positioning, proof points and contacts, and scores every account against ICP rules you write yourself.

The rules are data, not a model you have to trust blindly: a field, an operator, a value, a weight, and a qualification threshold. Mark a criterion **required** and failing it disqualifies an account however well it scores elsewhere. Test the whole rule set against a sample domain and watch it re-score before you spend anything on a run.

Runs are chunked and durable, so a 500-account list survives a closed tab or a provider having a bad minute. Low-confidence extractions go to a **review queue** rather than quietly entering your table — because a 94%-accurate list where nobody can tell which 6% is wrong is a list nobody works.

## Watchlists: told on the day, not woken for nothing

A one-off competitor snapshot is stale the week you take it. A **watchlist** re-reads the pages you care about on a cadence, works out what changed, and classifies how much it matters.

Critical changes — a price, a tier added or removed — alert immediately. High-materiality changes like a positioning shift are batched daily. Medium goes weekly. Low-materiality noise like whitespace or a copyright year is recorded and never alerts at all.

Two design decisions do most of the work here:

**The first run is always a baseline and never alerts.** A tool that fires the moment you set it up is a tool you learn to ignore.

**A field that stopped being observed is not a deletion.** If a pricing table was readable last week and is not today, the overwhelmingly likely cause is a failed page render, not a competitor removing their pricing. So DatIQ reports it as unobserved. "They deleted all their pricing" is the most expensive false positive this category can produce, and we would rather tell you less than tell you that.

Facts and interpretation stay in separate columns, too. The old value, the new value and the page are one thing; what our AI thinks it means strategically is clearly labelled as a reading. You can take a fact into a pricing meeting. An interpretation is where a conversation starts.

## Signal routing: intelligence that leaves the tool

Intelligence nobody sees is intelligence nobody acts on. **Rules** is an if-this-then-that layer over everything above.

Trigger on a watchlist change, a bulk enrichment result — an account crossing your ICP threshold, say — or a workflow run finishing. Add conditions. Then send it to **Slack, email, a webhook, or HubSpot.**

Every rule has a *Test with sample payload* button that shows you the verdict and which conditions matched. The preview and the live runtime share the same evaluation engine, deliberately: a preview that can disagree with production is worse than no preview. Every dispatch is recorded whether it succeeded or not, unreachable destinations are retried on a backoff, and destinations are re-validated at the moment of dispatch rather than only when you saved the rule.

## Reports: send the result, not a screenshot

Any run, audit or extraction can be published as a **report** at its own link, with a visibility level you choose per report: private, anyone with the link, workspace only, named email addresses only, or public. Only public reports are indexable — everything else carries a noindex instruction, so a link you meant for one client does not surface in a search result. Revoke burns a link permanently, and reports can carry an expiry date.

On Business and Agency, your Brand Kit replaces DatIQ's attribution, so what you send a client looks like yours.

## The rule underneath all of it

Every field DatIQ returns is **observed**, **inferred and labelled as inferred**, or **absent**. There is no fourth state and no plausible-looking default.

That has a cost we have chosen to pay: an honest run sometimes comes back with less than you hoped. A company that does not publish its headcount produces a brief with no headcount in it. In exchange, every score carries a **coverage** figure, and an unmeasured signal is excluded with its weight redistributed rather than scored as zero — because scoring a missing measurement as zero drags your trend line down during someone else's outage and then shows a phantom improvement when it recovers.

We would rather hand you a shorter brief you can defend than a fuller one that eventually costs you a deal.

## Where to start

If you have never used DatIQ, start at **Templates** and run one brief against a company you know well. You will be able to check the output against what you already know, which is the fastest way to calibrate how much to trust it.

If you already use DatIQ for extraction, start at **Lists**: take a list you are already working and see what an ICP score with visible coverage tells you that your spreadsheet does not.

Free to start, no credit card. Questions to hello@datiq.app.
  `.trim(),
};

const POSTS = [
  {
    slug: "the-workflow-hub",
    tag: "Release",
    title: "The Workflow Hub: Every Pipeline on One Screen, and the Gaps Named",
    excerpt:
      "Lists, watchlists and rules were one pipeline shown as three unrelated screens, so a pipeline could be silently not wired while every screen looked fine. The workflow hub puts them together, leads with what needs your attention, and lets a rule listen to exactly the lists you choose.",
    date: "September 25, 2026",
    readTime: "5 min read",
    coverIcon: "git-merge",
    fullContent: `
A signal rule that listens to nothing looks exactly like a signal rule that has had a quiet week. That is the problem the workflow hub exists to solve.

## One pipeline, three screens

An account list gets enriched and scored. A watchlist notices a competitor change. A signal rule sends the result to Slack, email, a webhook or HubSpot. Those are three steps of one job, but they lived on three screens — so a list nobody routed, or a watchlist no rule heard, was invisible until someone asked why nothing had arrived.

## What the hub shows

- **Needs your attention** comes first. The issues lead; the diagram is context.
- **Building blocks** — your lists, watchlists and rules, with counts, and a starter template for any block you have not set up yet.
- **Your pipelines**, each with Pause and Resume in place.
- **Not connected yet** — every list or watchlist that no active rule is listening to, by name.
- **Recent runs**, so you can see what actually fired.

## Rules can listen to chosen sources

Until now a rule listened to a *kind* of event: every watchlist, or every list. Now a rule can listen to the watchlists or lists you pick. The editor reads the rule back as one sentence — *"When something changes on the watchlist Rivals and materiality is critical, post to Slack #alerts"* — so you can check it before you save.

Two things we were careful about:

- **A rule never widens on its own.** If a rule loses the last source it was listening to — you unlink it, or the list is deleted — the rule is paused, with the reason shown. It does not quietly start listening to everything.
- **Deleting a list or watchlist that a rule uses names those rules first**, and offers to unlink and delete in one step.

On a watchlist, **Alert me** opens a new rule already limited to that watchlist, with the most useful default — email me on critical changes — filled in.

Open it from the menu: **Workflow hub**.
    `.trim(),
  },
  {
    slug: "the-template-hub",
    tag: "Release",
    title: "Twenty Templates, Filtered by Role, and Some That Just Set Things Up",
    excerpt:
      "The template catalogue grew from seven to twenty, and some of the new ones do not run at all: they open the right screen with the fields already filled in. Every template shows what it reads, what it returns and what it costs before you start.",
    date: "September 25, 2026",
    readTime: "4 min read",
    coverIcon: "library",
    fullContent: `
A template is a named job: an input form, the fields DatIQ reads, the analysis it runs, and the blocks it returns. There are twenty now, and the template hub filters them by your role and by module.

## Two kinds of template

Most templates **run**: you give them a domain or a list, see the cost estimate, confirm, and get a finished brief or table.

Some templates **hand off**. *Competitor Change Monitor*, *ICP List → CRM*, *Price-change Alert to Slack*, *Business Truth Setup* and others open the screen that does the job — a watchlist, an account list, a rule — with the fields already filled in. They never run and never charge on their own; you review and save on the screen you land on.

## A template can serve several roles

An account brief is as useful to RevOps as to Sales, so a template can belong to more than one role and appears under each. Pick **All roles** to see everything.

## Nothing is spent until you confirm

Every run shows its cost first, worked out by the same rule the server charges by. A run you start keeps going if you leave the page — it reports through the progress dock at the bottom of the screen.

Open it from **Templates** in the menu.
    `.trim(),
  },
  {
    slug: "engagement-private-beta",
    tag: "Beta",
    title: "Engagement Is in Private Beta: Outreach That Checks Consent at Send Time",
    excerpt:
      "Engagement turns the accounts you have already researched into outreach. It is in private beta, it is consent-first, and a message that cannot be sent is recorded as failed — never reported as sent. Here is what it does and how to ask for access.",
    date: "September 25, 2026",
    readTime: "3 min read",
    coverIcon: "send",
    fullContent: `
Research that ends in a spreadsheet still leaves the hardest step to you: reaching out. **Engagement** closes that loop, starting with email, for a small group of beta users.

## Consent first

- **Opt-outs are per channel**, and they are checked at the moment a message is sent — not only when it was approved. Someone who opts out between approval and sending is not emailed.
- **A person approves every message** before it goes out.
- **A message that cannot be sent is recorded as failed.** It is never reported as sent.

## Bring your prospects

Import prospects from a CSV, TSV, TXT or Excel file. Every row is checked and you see the problems before anything is imported, and you can edit a prospect afterwards.

## How to join

Engagement is in private beta while we learn from real use. To ask for access, write to hello@datiq.app with the account email you use for DatIQ and a line about what you want to send.
    `.trim(),
  },
  {
    slug: "choosing-your-role",
    tag: "Product",
    title: "Eight Roles Instead of Seven Personas: What Changes When You Pick One",
    excerpt:
      "DatIQ now asks which of eight roles fits your work — from Sales and RevOps to Product Marketing and Brand & CRO. Your role decides what you see first, never what you are allowed to use, and you can change it at any time.",
    date: "September 25, 2026",
    readTime: "3 min read",
    coverIcon: "users",
    fullContent: `
The first thing DatIQ asks now is what you do. There are eight answers:

- Sales, SDR & BDR
- RevOps & Growth Operations
- Product Manager & Competitive Intelligence
- Product Marketing Manager
- SEO, Content, AEO & GEO
- Brand, Growth & CRO
- Founder, VC & Market Research
- Agency, Enterprise & Consultant

## What your role changes

Your role picks the examples, the Home tiles and the templates you see first. It never locks anything: every feature is available whichever role you choose, and **All roles** in the template hub shows the full catalogue.

## What happened to the old personas

Most carried straight over under a clearer name. Market Research now sits with Founder & VC, because the jobs — sizing a market, mapping a landscape, briefing before a call — are the same. If you chose a persona before, you do not need to do anything.

## Changing it

Open the account menu and choose **Switch persona**. It takes effect straight away.
    `.trim(),
  },
  {
    slug: "introducing-datiq",
    tag: "Product",
    title: "Introducing DatIQ: From URL to Intelligence in Seconds",
    excerpt:
      "We built DatIQ because extracting structured data from the web shouldn't require a PhD in scraping. Today we're sharing the story behind the product, the personas it was designed for, and where we're taking it next.",
    date: "June 9, 2026",
    readTime: "5 min read",
    coverIcon: "layers",
    fullContent: `
  DatIQ started with a frustration shared by nearly every person doing research, sales, or marketing: copying data from websites into spreadsheets — one cell at a time.

  Whether it was scouting competitor pricing, building a lead list, auditing a competitor's content strategy, or just understanding what a company does before a call — the work was always manual, tedious, and error-prone.

  ## The idea

  The premise was simple: if a human can read a web page and extract structured information from it, an AI system should be able to do the same — instantly, for any URL, without writing a line of code.

  DatIQ is built on that premise. Paste any publicly accessible URL and get back its headings, links, contacts, metadata, and an AI-generated summary — in under 10 seconds.

  ## What we shipped first

  The first public release included:
  - **Custom extraction** — describe any field in plain English ("find the pricing tiers") and the AI locates and structures it
  - **Domain mapping** — crawl an entire site and return every indexed URL
  - **Lead enrichment** — surface leadership contacts and emails from any company page
  - **Persona-adaptive workflows** — the app adapts its examples, quick actions, and AI prompts based on your role
  - **CSV, PDF, and email export** — get your data into whatever workflow you use next

  ## What's coming

  Everything on that list has since shipped — API access, scheduled monitoring, and one-click push to HubSpot, Notion, Airtable and Slack — alongside a workflow layer we had not yet imagined when this was written. If you have a use case we haven't covered yet, reach out at hello@datiq.app.

  Start with any URL. No sign-up required.
    `.trim(),
  },
  {
    slug: "the-five-hundred-domain-monday",
    tag: "Use Case",
    title: "The 500-Domain Monday: What to Do When Someone Hands You a List",
    excerpt:
      "A territory drop lands in your inbox. Five hundred domains, no context, and a quota. Here is how to turn that into forty accounts worth calling — with the reasoning visible enough that your reps actually trust the ranking.",
    date: "September 4, 2026",
    readTime: "6 min read",
    coverIcon: "target",
    fullContent: `
Every RevOps team knows this Monday. A list arrives — from a conference, a data vendor, a new territory split — and it is five hundred rows of domain names with nothing attached. Somewhere in there are the forty accounts worth a call this quarter. Finding them by hand is a week of tab-opening that nobody has.

## Step 1: stop the list lying to you before you start

The first thing DatIQ does on import is boring and it matters more than anything else in this post: it **normalises and de-duplicates**. \`https://www.Acme.com/pricing\`, \`acme.com\` and \`ACME.COM\` become one account, not three.

Lists arrive dirty. If you skip this, your enrichment bill is inflated, your reps work the same company twice, and your conversion maths is quietly wrong all quarter.

## Step 2: write the ICP down, properly

Most teams have an ICP that lives in a slide and a slightly different one that lives in each rep's head. DatIQ makes you write it as data: a field, an operator, a value and a weight.

    industry is one of Software, Fintech      weight 30
    employee count is at least 50             weight 20
    publishes pricing publicly                weight 15
    sells to businesses                       weight 20  (required)

A **required** criterion is the important one. Mark "sells to businesses" required and an account that fails it cannot qualify however well it scores elsewhere — which is what you actually mean, and not what a pure weighted average would do.

Then test it. Type in a domain you already have an opinion about and watch it score. If your best customer comes back at 41, your rules are wrong and you have found that out for free, before spending anything on a run of five hundred.

## Step 3: run it, and let it be honest

Enrichment reads each company's own public site. Every field comes back as **observed**, **inferred and labelled**, or **absent** — never invented. There is no hardcoded "55 employees" for a company that does not publish headcount.

The consequence is worth internalising: an account with thin public information gets a **lower coverage**, not a **wrong score**. The unmeasured criterion is excluded and its weight is redistributed across the criteria that were measured.

This is why the table has two numbers per row instead of one. A 78 computed from four of four criteria and a 78 computed from two of four are different claims, and a rep deciding how to spend their morning deserves to know which one they are looking at.

## Step 4: work the queue, not the whole list

Low-confidence extractions land in a **review queue** rather than entering your table silently. Confirm, correct, or discard them.

It is tempting to skip this. Do not. The failure mode of every enrichment tool is a table that is 94% right where nobody can tell which 6% is wrong — and the rational response to that table is to distrust all of it. A visible review queue is what makes the other 94% usable.

## Step 5: get it in front of the rep

Export as CSV or JSON, or push straight into HubSpot, Notion, Airtable or Slack. Scores, coverage and the **source URL behind every field** travel with it.

That last part is the difference between a list your reps work and a list they argue with. When someone asks "why is this account an 82?", the answer is a page and a quote, not a shrug.

## Then automate the next one

Once the rules are right, a **signal routing rule** means you do not have to run the list at all. Trigger on a bulk enrichment result, condition on an ICP score above your threshold, action into a Slack channel or straight into HubSpot. New accounts qualify themselves and arrive where your reps already are.

Start with a handful of domains and one rule. The setup is measured in minutes, and you will know within one sample whether your ICP says what you think it says.
    `.trim(),
  },
  {
    slug: "knowing-the-day-not-the-quarter",
    tag: "Use Case",
    title: "Knowing the Day, Not the Quarter: Competitive Monitoring That Doesn't Cry Wolf",
    excerpt:
      "Most change monitoring fails the same way — it alerts on everything, so you mute it, and then you miss the price change. Materiality classification is the fix, and a silent first run is the part everyone gets wrong.",
    date: "September 4, 2026",
    readTime: "6 min read",
    coverIcon: "eye",
    fullContent: `
Competitive intelligence has a quiet failure mode. You set up monitoring, it fires forty times in the first week for copyright years and rotated testimonials, you mute the channel, and three months later you find out about a competitor's repricing from a customer on a renewal call.

The tool worked. The alerting is what failed. So that is where the design effort went.

## Materiality is the whole feature

Every detected change on a DatIQ watchlist is classified by how much it matters, and the classification decides what happens:

| Materiality | Examples | What happens |
|---|---|---|
| **Critical** | A price changes, a tier is added or removed | Alerts immediately |
| **High** | A headline feature claim changes, positioning shifts | Daily digest |
| **Medium** | Supporting copy, a new case study | Weekly digest |
| **Low** | Whitespace, a copyright year, a rotated quote | Recorded, never alerted |
| **Unknown** | Cannot be classified confidently | Review, not a guess |

The point is not that low-materiality changes are discarded — they are all recorded and searchable. The point is that they never interrupt you, which is what keeps the critical alert credible when it arrives.

## The first run never alerts

A watchlist's first reading is a **baseline**. There is nothing to compare it against yet, so it is stored and nothing is sent.

This sounds obvious and almost nothing does it. A tool that fires a burst of alerts the moment you configure it teaches you, in its very first interaction, that its alerts are noise. That lesson is hard to unlearn.

## The most expensive false positive we refuse to send

Here is the one that shapes the rest of the architecture.

Suppose a competitor's pricing table was readable last week and is not readable today. The dramatic interpretation is that they pulled their pricing — which, if true, is a genuine strategic signal.

It is also almost never what happened. Far more often the page failed to render, a script timed out, or a layout change moved the table behind an interaction.

So DatIQ reports the field as **unobserved**, not deleted. A field that stopped being observed is not a deletion. Getting this wrong sends an executive into a Monday meeting saying a competitor has abandoned public pricing, on the strength of a render failure — and that is a mistake a team remembers about a tool for a very long time.

## Facts in one column, opinions in another

A change record has two halves that never blend.

The **fact** is the old value, the new value, the page and the timestamp. It is defensible; you can put it on a slide.

The **interpretation** is what our AI reads into the change strategically, and it is always labelled as an AI reading. It is a good starting point for a conversation and a bad thing to quote as evidence. You can mark an interpretation useful or wrong, and that stays with the record.

Keeping them apart is not modesty. It is so that the fact remains usable when the interpretation is wrong — which it sometimes will be.

## Then send it where people actually are

A watchlist that you have to visit is a watchlist you will stop visiting. **Signal routing rules** push the changes that clear your bar into Slack, an inbox, a webhook or HubSpot, with conditions you set — say, critical and high materiality only, for these four domains.

Every dispatch is recorded whether it succeeded or not, and a destination that was unreachable is retried rather than silently dropped. "Did that fire?" has an answer.

## Setting one up

Add the domains, choose a cadence, let the baseline settle, and set one routing rule for critical changes only. Widen it later once you have seen a week of what the watchlist considers material.

Watchlists are included from the Select plan upwards, on the same allowance as scheduled monitoring.
    `.trim(),
  },
  {
    slug: "why-we-refuse-to-guess",
    tag: "Deep Dive",
    title: "Why We Refuse to Guess: Observed, Inferred, or Absent",
    excerpt:
      "The most valuable thing an intelligence tool can do is tell you when it does not know. Here is the rule every DatIQ field obeys, the bug that taught us to enforce it, and why an honest low score beats a confident wrong one.",
    date: "September 4, 2026",
    readTime: "7 min read",
    coverIcon: "shield",
    fullContent: `
There is a category of software defect that never throws an error, never fails a test, and quietly costs you money for months. It happens when a system that does not know something produces a plausible answer anyway.

We shipped one. It is worth writing about, because the fix became the rule the whole platform now runs on.

## The bug

An early version of our bulk enricher was supposed to read company firmographics off each company's public site. What it actually did, for some fields, was pattern-match the domain name and fill in defaults. Every company on earth came back with the same employee count. Every company was recorded as publishing pricing.

None of that is the bad part. The bad part is that it stamped a **high confidence score** on the invention, and every ICP score in the product was computed from it.

A wrong field that announces itself as wrong is an inconvenience. A wrong field wearing a confidence badge is a decision you make incorrectly and never revisit — a rep working a list that was ranked by fiction, and no signal anywhere that anything was off.

## The rule that replaced it

Every field DatIQ returns is now exactly one of three things:

- **Observed** — read directly off a page, with the page and the supporting quote recorded alongside it.
- **Inferred** — derived from what was observed, and labelled as inferred so you can weigh it accordingly.
- **Absent** — we could not determine it, and we say so.

There is no fourth state. There is no default value. An absent field is omitted rather than filled in.

## What this costs, honestly

It costs completeness. A company that does not publish its headcount produces a brief with no headcount in it. Someone comparing us to a competitor that always returns a number will see fuller-looking output over there.

That competitor's number is frequently a guess wearing a suit. Ours is a gap you can see. We think the gap is worth more, and here is the mechanism that makes it worth more rather than just worthy.

## Coverage: the number beside the number

Because fields can be absent, every score DatIQ computes travels with a **coverage** figure — what proportion of the intended signals were actually measured.

A 70 computed from five of five criteria and a 70 computed from two of five are different claims about the world. Reporting them both as "70" is the same failure as inventing a headcount: it hides uncertainty behind a confident-looking number.

## Never score a missing measurement as zero

This is the part that is genuinely counterintuitive, and the reason it matters shows up in trend lines.

Suppose an ICP criterion depends on a field we could not read. The naive implementation scores it zero and moves on. But zero is a *measurement* — it means "we looked, and this company scores nothing here." That is not what happened. What happened is we did not look successfully.

So an unmeasured criterion is **excluded** from the score and its weight is **redistributed** across the criteria that were measured.

If you score missing data as zero instead, here is what your customers experience: during a third-party outage every score drops several points, and when the outage resolves every score jumps back up. Your trend line — the entire reason for tracking anything over time — becomes a record of our infrastructure rather than of your market. Every "improvement" it shows is a fiction, and somebody will present one of those fictions in a meeting.

## The same rule, everywhere

Once you accept it in one place you have to accept it everywhere, or the exceptions become the bugs:

- A **discoverability audit** excludes an unmeasured signal and redistributes its weight, rather than scoring the page zero for it.
- A **watchlist** reports a field that stopped being observed as unobserved, never as a deletion.
- A **competitive brief** names a competitor whose site could not be read as unread, and passes that to the model explicitly, so it cannot invent a row for them.
- A **generated schema block** emits an explicit TODO for anything we could not observe, rather than a plausible placeholder — because these get pasted into live sites and published without being read.

## What you should ask any tool in this category

Three questions, and they are not rhetorical:

1. **What does it do when it does not know?** If the answer is "returns a reasonable default", every downstream number is unreliable in a way you cannot detect.
2. **Can you see where a fact came from?** If a field does not carry its source, you cannot check it, and you will eventually repeat something wrong in a meeting that matters.
3. **What happens to a score when a signal is missing?** If it silently becomes zero, the trend line is measuring the vendor, not the market.

We built DatIQ to answer all three the same way, and we would rather be caught knowing less than caught making things up.
    `.trim(),
  },
  {
    slug: "discoverability-seo-aeo-geo-audits",
    tag: "Release",
    title: "Three Audiences, Three Scores: Auditing for Search, Answers and AI Citation",
    excerpt:
      "Your page can rank perfectly and still never be quoted. DatIQ now scores SEO, AEO and GEO separately, shows you where they disagree, and writes the fixes for you.",
    date: "August 26, 2026",
    readTime: "6 min read",
    coverIcon: "scan-search",
    fullContent: `
Search stopped being one audience.

A page can be crawled, indexed and ranking well, and still never appear in a ChatGPT answer. Not because it is worse — because it is optimised for a reader who arrives via a results page, and answer engines are looking for something else: a passage they can lift out, quote whole, and attribute.

Those are different jobs, and a single "SEO score" hides the gap between them. So **Discoverability** scores three audiences separately.

## What the three scores mean

**SEO** is the classic one. Can a crawler reach the page, render it, and trust the canonical? Is it fast enough?

**AEO** — answer engine optimisation — asks whether an assistant could lift a passage off your page and quote it. That rewards something quite specific: a self-contained answer near the top, roughly 40 to 60 words, that still makes sense when the surrounding page is gone. A passage that opens with "This is why it matters" is useless quoted alone, however good the paragraph is.

**GEO** — generative engine optimisation — asks whether a machine can work out *who published this*, and whether answer engines already cite you. That is entity identity: schema that names you, profile links that confirm it is you, an author with a real page behind their byline.

When those three scores disagree, the gap is the finding. A page scoring 88 for SEO and 41 for AEO is a page that ranks and never gets quoted, and now you can see that in one screen instead of inferring it.

## Four pillars, and every score traces back

Underneath sit Answer Clarity, Entity Authority, Structural Hierarchy and Technical Accessibility. Open any pillar and you see every signal that fed it, its weight, and its score — because a number you cannot interrogate is a number you cannot act on.

## "Not measured" is not zero

This is the part we spent the longest on, and it is the part most audit tools get wrong.

Some signals need something outside the page. Core Web Vitals come from Google's field data. Citation footprint comes from actually asking an answer engine. Those services are sometimes unavailable, rate-limited, or simply have no data for a low-traffic URL.

The tempting thing is to score a missing signal as zero. It keeps the maths simple. It is also a lie, and a corrosive one: it would subtract points from every audit during an outage, then show you a phantom "improvement" when the service came back — an improvement you did nothing to earn. Your trend line, the whole reason to audit twice, would become fiction.

So an unmeasured signal is **excluded**, and its weight is redistributed across the signals we could read. Every score then carries a **coverage** figure, because a 92 built on 70% of the evidence is not the same as a 92 built on all of it, and you should be able to tell which one you are looking at.

Some signals are marked *not applicable* instead — a pricing page has no step-by-step procedure, so it is never asked for HowTo markup and never marked down for its absence.

## Blocking issues scale, they do not deduct

A page marked \`noindex\` is not "a good page minus a few points". Neither is one whose content only appears after JavaScript runs — to a crawler that does not execute JavaScript, that page is blank.

So those failures scale the whole score down rather than costing it a slice, and the report shows the arithmetic: your score before the blockers, the multiplier, and the result. No hidden penalties.

## It writes the fix

Every finding becomes a recommendation with an owner, an effort estimate, and how much it is worth **on your page** — not in general. Fixing FAQ markup on a page already at 61 is worth less than on one at 12, and the queue sorts accordingly.

Where a fix is markup or copy, DatIQ drafts it from what your page already contains. FAQ schema built from your visible questions. An Organization block carrying the profile links you actually have. A corrected heading outline that fixes the nesting and leaves your wording completely alone, because renaming your sections is not a defect fix.

Anything we could not observe comes back as an explicit \`TODO:\` rather than a plausible guess. A schema block containing an invented founder name is worse than no schema block, because it tends to get published without being read.

## Proving the fix worked

An audit is a reading. Two are a direction.

Re-audit after you have made changes and DatIQ compares the runs: what moved, what was resolved, and — the line we care about most — anything **new** that appeared. A fix that introduces a regression is exactly what you want to catch before it compounds.

The comparison only reports a change when both runs actually measured the same thing. If Core Web Vitals were unavailable last week and available today, that is labelled *not comparable* rather than being handed to you as your improvement.

The trend chart draws a gap where a score could not be measured, rather than a straight line through it. A line implies a continuity nobody observed.

## What we will not tell you

Discoverability scores describe how findable and extractable a page is **today**. They are not a prediction of rankings, citations or traffic, and any tool that promises you one is selling something.

What you get instead is a reproducible measurement, the evidence behind it, and a list of specific things to change — so that when the outcome does move, you know what moved it.

Free accounts get three audits a month. Paste a URL and see where your page actually stands.
    `.trim(),
  },
  {
    slug: "one-composer-background-runs-addressable-batches",
    tag: "Release",
    title: "One Box to Start Anything: Background Runs and Batches You Can Come Back To",
    excerpt:
      "Batch is no longer a place you go — it's something the composer does. Runs now survive navigation, every batch gets its own link, and failed URLs stop disappearing when you leave the page.",
    date: "August 18, 2026",
    readTime: "4 min read",
    coverIcon: "layers-2",
    fullContent: `
DatIQ had two ways to start an extraction, and only one of them was real.

The Home composer already noticed when you pasted more than one URL and sent you to the Batch screen. So Batch was never a separate feature you chose — it was a screen you got *bounced to*. Worse, two useful options lived **only** on that screen, which meant they silently vanished the moment you started a run from Home, which is how almost everyone starts a run.

This release makes the composer the single place anything begins.

## Batch is a behaviour, not a destination

**Batch is gone from the navigation.** Paste one URL or fifty; import a CSV or drag one onto the box. DatIQ works out what you gave it and runs it. The batch screen still exists — you just arrive there because you ran a batch, not because you went looking for it first.

The two orphaned options moved to **Advanced options** on Home, where they now apply to single and batch runs alike:

- **Generate AI content for each URL**, with the content-type picker
- The **detected URL column** readout when you import a CSV

## Runs no longer die when you navigate

A batch used to be tied to the screen that started it. Click away and the run was abandoned mid-flight.

Turn on **Run in background** in the composer's **＋** menu and a run keeps going while you do something else — read a page you extracted earlier, browse your Dashboard, whatever. Progress follows you in a small dock: how many URLs are done, which one is being read right now, and a Cancel button. The setting sticks between visits, and it applies to single extractions too.

## Every batch has an address

Batch results now live at their own link, so a run survives a reload, a bookmark, or a week.

That fixes something quietly frustrating. Only *successful* pages become Dashboard entries — a URL that failed has no Dashboard row at all. Previously the failure list lived in the page's memory, so leaving the screen lost both the failures **and** the per-row Retry. Now failures are saved with the run, each with its reason and a working Retry button, and your Dashboard links back to the run when it had any.

## Pasted a newsletter full of links?

A page of prose with eight links in it is genuinely ambiguous: do you want the eight pages, or a summary of the thing containing them? DatIQ used to quietly pick the second and extract the whole blob as one document.

Now it asks. Paste text that contains links and you get an inline chooser — **"Extract all 8"** or **"Extract this text as one page"**. Neither is a guess.

## One Push, one list

Destinations used to be reachable two ways, with two different lists — and the shorter list was the more prominent one. There is now a single **Push ▾** menu everywhere: HubSpot, Notion, Airtable, Slack, and Google Sheets, which needs no setup at all. **Export ▾** is now strictly downloads and clipboard. Two menus, two jobs, no overlap.

## Signed out? You'll know what that costs

Working without an account still works — but DatIQ no longer lets it look more permanent than it is. Your Dashboard says how many pages are saved in that browser only, and signing in moves them onto your account automatically.

Schedules got the honest version of the same treatment. Recurring runs execute on our servers, so a schedule created while signed out could never actually run — but it used to list itself as active with a next-run time. Now DatIQ holds the schedule, asks you to sign in, and saves it for you; anything unsaved says **"Not running"** rather than promising a run that was never going to happen.

Start with any URL. No sign-up required.
    `.trim(),
  },
  {
    slug: "one-click-integrations-hubspot-airtable-notion-slack-zapier",
    tag: "Release",
    title: "One-Click Push to HubSpot, Airtable, Notion, Slack, and Zapier",
    excerpt:
      "DatIQ now ships with first-class, server-stored connections to the destinations you already use. Connect once in Account → Integrations, and every push from Preview, Dashboard, or Batch is a single click. No more paste-the-key-every-time, no more re-mapping fields, no more broken Airtable field names.",
    date: "August 11, 2026",
    readTime: "5 min read",
    coverIcon: "plug",
    fullContent: `
Until this week, pushing an extraction to HubSpot, Airtable, Notion, or Zapier meant opening a modal on every push, pasting an API key, and (for Airtable/Notion) telling DatIQ which base/table/database to use. It worked — but it was friction you paid every time, and the key only lived in your browser's session. If you cleared cookies, you started over.

Now, every supported destination is a one-time setup in **Account → Integrations**. After that, every push is a single click — Preview, Dashboard, and Batch results all show the same **Push to …** menu, and pushing either delivers the structured data or tells you the connection needs attention. Tokens are stored server-side, never re-displayed, and re-rotatable in one place.

## What you can push to

- **HubSpot** — Contacts and Companies from an extraction, with the right property mapping. Connect a HubSpot private-app token, name the connection, and you can edit the label or rotate the token later without re-doing the field map.
- **Airtable** — Each extraction into the table you choose, with a per-table field map built automatically on first connect. The **Load columns** button re-fetches the schema if you change the table.
- **Notion** — Each extraction into a Notion database, with the title column and property count surfaced in the modal. Editing the database ID re-runs the schema refresh for you.
- **Slack** — New extractions and change alerts into the channel you choose, formatted as a readable message. Block Kit payloads are long-title-safe (we hit a real Slack 400 on news-site titles in testing and fixed the character budgeting).
- **Zapier** — New extractions as a trigger event for any of 5,000+ apps. The DatIQ private-app exposes a "new extraction" event with the full payload.
- **Google Sheets** — A new sheet from any extraction (no auth required — still one-click from any Export ▾ menu).

## The Account page redesign

The **/account#integrations** section is no longer a list of disconnected toggles. Each connected row now shows the per-provider detail the server already knew — token hint, IDs, field map summary, title column, column count — and three actions: **Test** (verifies the connection with a provider-specific check), **Edit** (label, IDs, or token rotation), and **Disconnect**.

If you haven't connected any destination yet, the same row shows a clear "Not connected — set up" prompt with a one-click path to the connect modal. No more hunting for setup links.

## Workspace tabs and the rest

While we were here, we folded Collections and Active Schedule into a single **Workspace** view so you don't lose your place moving between saved extractions and the monitors that produce them. White-label PDF, coupons, and top-up bundles are reordered for clarity on the Account page — the order they appear in is now the order most users care about them.

## Who this is for

**Anyone with a CRM.** One click from "I just extracted a company" to "it's in HubSpot with the right properties" is the difference between research that lands and research that sits in a spreadsheet.

**Anyone managing a content pipeline.** Airtable and Notion push let you route extracted data straight into the database your content team already lives in. The schema refresh on Edit means renaming a column in Notion is a 3-second fix in DatIQ.

**Anyone running scheduled monitors.** Slack change alerts now show in the "Push to" menu alongside every other destination, so a single monitor can email the team and post a channel alert in one push.

## What you need to do

If you've been using the old "paste the key each time" flow for Airtable or Notion, do this once: open **Account → Integrations**, click **Set up** on the destination, paste the key + IDs, and your field map is built and stored. The next push from Preview, Dashboard, or Batch is one click. If you had an Airtable connection from before this release, use **Load columns** to backfill the field map — it now lives under **More destination options…** at the bottom of the Push menu (or re-connect from scratch — the flow is faster now).

Questions? We read every message at **hello@datiq.app**.
`.trim(),
  },
  {
    slug: "invoices-receipts-and-what-happens-when-a-plan-lapses",
    tag: "Release",
    title: "Every Payment Now Has a Document: Invoices, Receipts, and a Kinder Way to Lapse",
    excerpt:
      "Your finance team asks for the invoice. You dig through your inbox, find a payment confirmation that isn't an invoice, and email support. That round trip is now gone: every DatIQ payment issues a numbered, itemized document, emails it to you as a PDF, and keeps it in your Account — even after you cancel.",
    date: "July 27, 2026",
    readTime: "5 min read",
    coverIcon: "receipt",
    fullContent: `
![The Invoices & receipts card on the DatIQ Account screen.](/help/assets/screenshots/10-account-billing.png)

Nobody buys a data tool because of its invoices. But everybody eventually needs one — for a reimbursement, a quarterly close, a tax filing, or the simple question "what exactly did we pay for in March?"

Until now, DatIQ answered that question with a payment confirmation email. That is not an invoice, and if you have ever forwarded one to a finance team, you know precisely how that conversation goes.

This release fixes it properly.

## What you get

**A real document for every payment.** The moment a payment completes, DatIQ issues its own numbered, itemized document and lists it under **Invoices & receipts** on your Account screen. Where we are registered for tax in your region, it is a full tax invoice with the tax split shown; elsewhere it is a payment receipt that says plainly that it is not a tax invoice. Either way, the numbers reconcile exactly to what you were charged — line by line.

**It arrives without you asking.** A PDF copy is emailed to you automatically on payment. You do not have to log in, find the screen, and download it to have a copy on file.

**Re-send it whenever.** Lost the email? Open the document and have it emailed again, or download the PDF. Re-sends always go to the address on your account — never to an address typed into a page — so a billing document cannot be redirected by someone who happens to have a link.

**Documents don't change under you.** An issued document is never edited or renumbered. If something genuinely needs correcting, we issue a separate credit note against it. Your records and ours stay identical, which is the entire point of a numbered series.

**They outlive the subscription.** Cancel, downgrade, or let a plan lapse — your billing history stays available to you. The one thing worse than not having an invoice is losing access to it exactly when the auditor asks.

## Who this is for

**Founders and finance leads.** Month-end stops involving a support ticket. Every charge has a document with a number you can reference.

**Agencies re-billing clients.** Itemized lines and a stable numbering series mean you can attach DatIQ costs to a client invoice without re-typing anything.

**Anyone claiming expenses.** The PDF is already in your inbox before you think to look for it.

## And when a plan lapses

The other half of this release is what happens when a paid plan ends without renewing — because "silently stops working" is not an acceptable answer either.

Instead, the account moves through clearly-signposted stages. First **suspended**, with an in-app banner that explains exactly what state you are in. Your saved data is intact throughout, and renewing restores full access immediately. If it stays unrenewed, it moves to **deactivated**. You are emailed at each stage, and again before anything is removed — so a lapse is never a surprise you discover by finding your work missing.

Scheduled monitoring behaves sensibly through all of it: your schedules **pause** while the plan is lapsed and **resume on their own** when you renew. You do not rebuild them. And a schedule you deliberately paused yourself stays paused — renewing does not quietly switch your monitors back on.

## The theme here is boring on purpose

None of this makes extraction faster. It makes DatIQ safe to put on a company card: predictable documents, a paper trail that survives cancellation, and a lapse path that warns you instead of deleting your work.

## Where to find it

Open **Account → Invoices & receipts**. Full detail in the [Plans, usage & billing](/help/12-plans-usage-and-billing.html) help guide. If a document ever looks wrong, tell us at **hello@datiq.app** — a correction is a credit note, and we would rather issue one than have your books disagree with ours.

Every payment, one document, permanently yours.
`,
  },
  {
    slug: "monitor-any-page-for-changes",
    tag: "Release",
    title: "Set It and Know: Monitor Any Web Page for Changes with DatIQ Schedules",
    excerpt:
      "Your competitor drops their price at 2am. A target account posts a new job that signals budget. A supplier quietly edits their terms. You shouldn't have to refresh a tab to catch it — DatIQ Schedules watches the page for you and emails you the moment it changes.",
    date: "July 22, 2026",
    readTime: "4 min read",
    coverIcon: "calendar-clock",
    fullContent: `
![The DatIQ Schedules screen — a saved monitor with its cadence, target, and run history.](/help/assets/screenshots/05-schedules.png)

If your job depends on what a web page says today versus last week, you already know the tax: the manual re-check. Open the pricing page. Compare it to the screenshot you took. Open the careers page. Scan for the role that wasn't there Monday. It's the kind of work that's too important to skip and too dull to do reliably — so it gets skipped, and you find out late.

DatIQ Schedules exists to end that ritual. Point it at a page, pick a cadence, and DatIQ re-extracts on your schedule, fingerprints the result, and tells you **only when something actually changed**.

## Who this is for

**Competitive intelligence & revenue teams.** Watch a competitor's pricing, plans, and positioning. The day they change a number, it's in your inbox — not discovered three weeks later by a prospect on a call.

**Sales & recruiting.** Monitor target-account careers pages and leadership pages. A new senior hire or an open req is a buying signal; catch it while it's fresh.

**SEO & content.** Track a rival's key landing pages and title tags for the edits that hint at a strategy shift.

## How it works

You don't need a scraper, a cron server, or a single line of code.

- **Pick a target and a cadence.** Hourly, daily, weekly, or a custom builder (frequency · weekday · time). Add a "run until" date to time-box a launch you're watching.
- **DatIQ does the runs.** Each run re-extracts the page, fingerprints the content, and diffs it against the last known state.
- **You hear about it only when it matters.** On a real change, DatIQ emails you a diff preview — and posts the same event to Slack if you've wired a webhook. No change, no noise.

Every run is saved to your Dashboard under the **Scheduled** type, so you always have the history of what changed and when.

## From "I should check that" to "I'll know"

The quiet win here isn't automation for its own sake — it's confidence. You stop carrying a mental list of pages you're supposed to babysit. You set the monitor once, and the next move surfaces itself.

## Try it

Open the **Home composer**, paste a URL, choose a schedule from the cadence dropdown, and you're monitoring. Full walkthrough in the [Scheduling & change monitoring](/help/08-scheduling-and-change-monitoring.html) help guide. Questions? We read every message at **hello@datiq.app**.

Set it once. Know the moment it changes.
`,
  },
  {
    slug: "extract-competitor-pricing",
    tag: "Guide",
    title: "How to Extract Competitor Pricing in 60 Seconds",
    excerpt: "Stop manually checking competitor sites. DatIQ's pricing extraction pulls structured tier data from any pricing page in one click.",
    date: "June 5, 2026",
    readTime: "3 min read",
    coverIcon: "hash",
    fullContent: `
Tracking competitor pricing used to mean bookmarking a dozen pricing pages and checking them manually every week. With DatIQ, you can pull structured pricing tiers from any page in under 60 seconds.

## How it works

1. Paste the competitor's pricing URL into DatIQ
2. Enable **Custom extraction** and type: "Extract all pricing tiers, prices, and included features"
3. Click Extract — DatIQ sends the page to the AI, which locates and structures every plan

The result is a clean JSON object with plan names, prices, billing periods, and feature lists. Export to CSV and paste straight into your competitive analysis spreadsheet.

## Tips

- Works on any pricing page — SaaS, e-commerce, marketplaces, even PDF-style pricing tables embedded in HTML
- Use **domain mapping** to discover whether a site has a separate /pricing/enterprise page
- Save multiple extractions to Dashboard and use the CSV export to track pricing over time

## What's next

DatIQ's scheduled monitoring feature (coming on Pro plan) will let you set a URL and get an alert whenever pricing changes. Perfect for sales teams who want to know the moment a competitor drops their price.
    `.trim(),
  },
  {
    slug: "lead-research-at-scale",
    tag: "Use Case",
    title: "Lead Research at Scale: Surface Contacts from Any Domain",
    excerpt: "Sales teams use DatIQ to pull leadership contacts and emails from hundreds of target company sites — without a single API key.",
    date: "May 28, 2026",
    readTime: "4 min read",
    coverIcon: "users",
    fullContent: `
Building a targeted lead list traditionally means buying a data subscription, waiting for a CSV export, and manually de-duplicating stale data. DatIQ flips this: start with the domains you already care about and extract contacts directly from source.

## The contacts & emails mode

Enable **Contacts & emails** in DatIQ's extraction options and paste any company URL. DatIQ will:

1. Scrape the page (and linked /about, /team, /leadership pages)
2. Pass the content to the AI with a leadership extraction prompt
3. Return a structured list of names, titles, and emails

No API key required. No account on the target site.

## What you get

- Senior leadership names and titles (CEO, CTO, VP Sales, etc.)
- Email addresses surfaced from the page (where publicly listed)
- LinkedIn profile links when available in the page content

## Scaling it up

Use DatIQ's domain mapping to first discover all pages on a company's site, then run targeted contact extraction on /about and /team pages specifically. Export to CSV and you have a clean, verified lead list in minutes.

Business plan users get API access to automate this workflow across hundreds of domains.
    `.trim(),
  },
  {
    slug: "domain-mapping",
    tag: "Deep Dive",
    title: "Domain Mapping: Discover Every URL on a Site",
    excerpt: "The domain map feature crawls an entire site and returns a structured list of every indexed page. Here's how to use it for SEO and competitor research.",
    date: "May 20, 2026",
    readTime: "6 min read",
    coverIcon: "network",
    fullContent: `
Most web extraction tools work on individual URLs. DatIQ's **Map entire domain** mode is different: it discovers every indexed URL on a site in a single operation, giving you a complete map of what exists before you decide what to extract.

## How domain mapping works

Enable the **Map entire domain** toggle and paste any root domain (e.g. \`https://example.com\`). DatIQ calls Firecrawl's /map endpoint, which:

1. Follows internal links from the starting URL
2. Returns a deduplicated list of every discoverable page
3. Groups results by path pattern (blog posts, product pages, docs, etc.)

The result is a flat list of URLs you can export to CSV, inspect in the Dashboard, or use as a seed list for targeted extraction.

## SEO applications

- Audit a competitor's full content inventory — how many blog posts, product pages, case studies?
- Identify which pages are indexed vs. blocked by robots.txt
- Find pages that don't appear in their sitemap

## Competitive research applications

- Map a competitor's entire product catalogue
- Find hidden pricing pages, case study PDFs, or documentation sections
- Track when new product pages appear (with scheduled monitoring)

## Tips

- Start with the root domain (https://example.com) not a subpath
- Very large sites (100K+ pages) may return a truncated list — focus on key subdirectories
- Combine with single-page extraction: map first, then extract the pages that matter
    `.trim(),
  },
  {
    slug: "custom-extraction",
    tag: "Tutorial",
    title: "Custom Extraction: Ask for Any Field in Plain English",
    excerpt: "With DatIQ's custom extraction mode you describe what you want — 'find the product SKUs' — and the AI locates and structures it. No XPath required.",
    date: "May 12, 2026",
    readTime: "4 min read",
    coverIcon: "sparkles",
    fullContent: `
XPath selectors. CSS selectors. Regex. The tools for targeted web scraping have always assumed the user knows the page's structure before they start. DatIQ's custom extraction mode takes a different approach: just describe what you want.

## How it works

Enable **Custom extraction** in DatIQ and type a plain-English description of the data you want:

- "Extract the product name, price, and customer rating"
- "Find all job titles and locations listed on this page"
- "Pull the pricing tiers, monthly prices, and feature lists"
- "List all partner logos and their linked URLs"

DatIQ passes this description to Claude AI along with the page's scraped content. The model identifies the matching data and returns it as a structured JSON object.

## Quick actions

If you're not sure how to phrase your request, use DatIQ's built-in **Quick actions** chips:
- Extract contacts & leadership
- Find pricing tiers
- Pull product features
- Identify technical stack

These are pre-written prompts that work on most common page types.

## When it works best

Custom extraction works best on:
- Product pages with clear, structured content
- Pricing pages with plan-feature tables
- Company pages with team listings
- Documentation pages with API endpoints or code examples

It works less well on heavily visualised pages (charts, infographics) or pages with mostly image-based content.
    `.trim(),
  },
  {
    slug: "persona-adaptive-workflows",
    tag: "Product",
    title: "Persona-Adaptive Workflows: DatIQ Learns Your Role",
    excerpt: "When you tell DatIQ you're a researcher vs. a sales rep, the entire app adapts — different examples, quick actions, and AI prompts out of the box.",
    date: "May 3, 2026",
    readTime: "3 min read",
    coverIcon: "target",
    fullContent: `
Most tools treat every user the same. DatIQ is different: from the moment you select your role in the onboarding flow, the entire app adapts to your workflow.

## The seven personas

DatIQ recognises seven distinct user types, each with its own optimised experience:

1. **Sales & SDR** — lead enrichment and contact extraction in focus
2. **Researcher** — deep extraction and domain mapping
3. **Marketer** — content analysis and competitor benchmarking
4. **Developer** — API access and structured data export
5. **Consultant** — client research and data packaging
6. **Founder** — market intelligence and competitive monitoring
7. **Agency** — multi-client workflows and white-label PDF

## What changes for each persona

When you select a persona, DatIQ updates:
- The **hero headline** and **sub-copy** to match your use case
- The **example URLs** in the input field (relevant sites for your industry)
- The **quick-context chips** above the URL field
- The **recommended features** highlighted in the capability grid

## Switching roles

You can switch your persona at any time from the **UserDropdown → Switch Role** option in the top navigation. Your extraction history stays intact — only the UI adapts.

## Building on it

The persona system is used to feed AI prompts too. A Sales persona extracts contacts and company intelligence. A Researcher persona focuses on page structure and domain mapping. The same URL, different intelligence output.
    `.trim(),
  },
  {
    slug: "zero-code-enrichment-pipeline",
    tag: "Engineering",
    title: "How We Built an AI-Enabled Enrichment Pipeline",
    excerpt: "A look under the hood at how DatIQ chains Firecrawl extraction, Anthropic AI enrichment, and a Supabase persistence layer — all without the user writing a line of code.",
    date: "April 25, 2026",
    readTime: "8 min read",
    coverIcon: "code",
    fullContent: `
Every time you paste a URL into DatIQ and click Extract, a multi-step pipeline runs in milliseconds. Here's how it works.

## Step 1: Compliance check

Before any page is fetched, DatIQ reads the site's own robots.txt and checks the URL against it as **DatIQBot/1.0**. If the site disallows that path, the extraction is declined then and there — no page is requested, and nothing is charged. Any Crawl-delay the site publishes is honoured too.

This check is ours, and it runs first, whichever fetcher handles the page afterwards.

## Step 2: Extraction (provider chain)

Permitted URLs go to the first available fetcher in a fallback chain — **Firecrawl → Spider.cloud → Jina AI → a direct fetch** — so extraction keeps working when one provider is down or unconfigured. Between them they handle:
- JavaScript rendering (for React/Vue/Angular SPAs, when enabled)
- Retry logic and clean HTML + metadata

DatIQ adds a per-host rate limiter in front of the chain, so one busy account can't hammer someone else's site. DatIQ requests the page in HTML format, then parses the response to extract headings (H1–H6), links (internal and external), and page metadata.

## Step 3: AI enrichment

The extracted content is passed to an AI model through a second fallback chain — **Google Gemini → Anthropic Claude → OpenAI** by default, configurable per deployment. Depending on the extraction options:
- **Summary** — a single paragraph describing the page's purpose and structure
- **Custom extraction** — a structured JSON object based on the user's plain-English prompt
- **Contact extraction** — leadership names, titles, and emails

All AI calls route through a Netlify serverless function — the API keys never touch the browser.

## Step 4: Persistence (Supabase)

Extraction results are saved to a Supabase PostgreSQL database, keyed by session ID and URL. This powers the Dashboard view, history, and the CSV/PDF export pipeline.

When Supabase isn't configured (local dev or demo mode), DatIQ falls back to localStorage automatically.

## The AI-enabled part

The user sees none of this. They paste a URL, click a button, and get structured data. The entire pipeline — scraping, AI enrichment, persistence — runs transparently in the background, with progress shown via the animated loading screen.

This is what "AI-enabled" actually means in practice: not just no scraping scripts, but no infrastructure, no API keys, no configuration. Just data.
    `.trim(),
  },
];

function CoverIcon({ name, large }) {
  return (
    <div className={"blog-card-cover" + (large ? " blog-cover-lg" : "")}>
      <Icon name={name} size={large ? 52 : 36} strokeWidth={1.6} />
    </div>
  );
}

function PostCard({ post, large, onOpen }) {
  return (
    <div
      className={"blog-card" + (large ? " blog-featured-main" : "") + " blog-card-clickable"}
      onClick={() => onOpen(post)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen(post)}
      aria-label={`Read: ${post.title}`}
    >
      <CoverIcon name={post.coverIcon} large={large} />
      <div className="blog-card-body">
        <span className="blog-tag">{post.tag}</span>
        <h2 className={"blog-card-title" + (large ? " blog-card-title-lg" : "")}>{post.title}</h2>
        <p className="blog-card-excerpt">{post.excerpt}</p>
        <div className="blog-card-meta">
          <span>{post.date}</span>
          <span className="blog-card-meta-sep">·</span>
          <span>{post.readTime}</span>
          <span className="blog-card-link" style={{ marginLeft: "auto" }}>
            Read more <Icon name="arrow-right" size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}

function PostModal({ post, onClose }) {
  if (!post) return null;

  // Parse minimal markdown: ## headings, ![alt](src) images, **bold**, `code`
  function renderContent(text) {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("## ")) {
        return <h3 key={i} className="blog-post-h3">{line.slice(3)}</h3>;
      }
      const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) {
        return (
          <img key={i} className="blog-post-img" src={img[2]} alt={img[1]} loading="lazy" />
        );
      }
      if (!line.trim()) return <br key={i} />;
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={j}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={j} className="blog-inline-code">{part.slice(1, -1)}</code>;
        }
        return part;
      });
      return <p key={i} className="blog-post-p">{parts}</p>;
    });
  }

  return (
    <div className="blog-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="blog-modal" role="dialog" aria-modal="true" aria-label={post.title}>
        <div className="blog-modal-head">
          <div className="blog-modal-meta">
            <span className="blog-tag">{post.tag}</span>
            <span className="blog-card-meta-sep">·</span>
            <span>{post.date}</span>
            <span className="blog-card-meta-sep">·</span>
            <span>{post.readTime}</span>
          </div>
          <button className="blog-modal-close" onClick={onClose} aria-label="Close post">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="blog-modal-cover">
          <CoverIcon name={post.coverIcon} large />
        </div>
        <h1 className="blog-modal-title">{post.title}</h1>
        <div className="blog-modal-body">
          {renderContent(post.fullContent)}
        </div>
        {/* Ghost/Beehiiv placeholder — wire up when CMS is ready */}
        {/* TODO: Replace with hosted blog (Ghost or Beehiiv) for full post routing and SEO */}
        <div className="blog-modal-footer">
          <Button variant="secondary" size="sm" icon="arrow-left" onClick={onClose}>
            Back to blog
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Blog() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/blog/index.html this page now owns.
  useSeo(seoFor("/blog"));

  const [email, setEmail] = useState("");
  const [subStatus, setSubStatus] = useState("idle");
  const [selectedPost, setSelectedPost] = useState(null);

  async function handleSubscribe(e) {
    e.preventDefault();
    if (!email.includes("@")) { setSubStatus("error"); return; }
    setSubStatus("loading");
    try {
      const result = await captureEmail(email, "blog-newsletter");
      setSubStatus(result.alreadySubscribed ? "already" : "success");
    } catch {
      setSubStatus("error");
    }
  }

  return (
    <div className="page">
      <div className="blog-page container">

        {/* Hero */}
        <div className="blog-hero rise">
          <div className="eyebrow">
            <Icon name="newspaper" size={14} />
            DatIQ Blog
          </div>
          <h1>Insights, tutorials &amp; product news</h1>
          <p>
            Tips on web extraction, data enrichment, AI workflows, and how data-driven teams
            are turning URLs into intelligence with DatIQ.
          </p>
        </div>

        {/* Featured post */}
        <div className="blog-featured">
          <PostCard post={FEATURED_POST} large onOpen={setSelectedPost} />
          <PostCard post={POSTS[0]} onOpen={setSelectedPost} />
          <PostCard post={POSTS[1]} onOpen={setSelectedPost} />
        </div>

        {/* More posts */}
        <div className="blog-section-head">More articles</div>
        <div className="blog-grid">
          {POSTS.slice(2).map((post) => (
            <PostCard key={post.slug} post={post} onOpen={setSelectedPost} />
          ))}
        </div>

        {/* Newsletter CTA */}
        <div
          className="rise"
          style={{
            marginTop: 64,
            padding: "40px 32px",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)",
            background: "var(--accent-soft)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 16,
          }}
        >
          <div className="eyebrow">
            <Icon name="mail" size={14} />
            Stay in the loop
          </div>
          <h2 style={{ margin: 0, fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 800, letterSpacing: "-.025em" }}>
            Get product updates and tutorials
          </h2>
          <p style={{ margin: 0, color: "var(--text-2)", maxWidth: "44ch", lineHeight: 1.6 }}>
            No spam. Just new features, use-case guides, and the occasional deep-dive when we ship something interesting.
          </p>
          {subStatus === "success" && (
            <p style={{ margin: 0, color: "#16a34a", fontWeight: 600 }}>You're subscribed! We'll be in touch.</p>
          )}
          {subStatus === "already" && (
            <p style={{ margin: 0, color: "var(--text-2)", fontWeight: 600 }}>You're already subscribed — we've got you covered.</p>
          )}
          {(subStatus === "idle" || subStatus === "loading" || subStatus === "error") && (
            <form onSubmit={handleSubscribe} style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <input
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (subStatus === "error") setSubStatus("idle"); }}
                style={{
                  padding: "10px 16px",
                  borderRadius: "var(--r)",
                  border: `1px solid ${subStatus === "error" ? "#e0556b" : "var(--border)"}`,
                  background: "var(--surface)",
                  color: "var(--text-1)",
                  fontSize: ".95em",
                  width: 260,
                  outline: "none",
                  fontFamily: "inherit",
                }}
                aria-label="Email address"
              />
              <Button variant="primary" type="submit" icon="mail" disabled={subStatus === "loading"}>
                {subStatus === "loading" ? "Subscribing…" : "Subscribe"}
              </Button>
            </form>
          )}
          {subStatus === "error" && (
            <p style={{ margin: "-4px 0 0", color: "#e0556b", fontSize: ".85em" }}>Please enter a valid email address.</p>
          )}
        </div>

      </div>

      {/* Inline post modal */}
      {selectedPost && <PostModal post={selectedPost} onClose={() => setSelectedPost(null)} />}
    </div>
  );
}
