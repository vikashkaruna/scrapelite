// Blog.jsx — DatIQ blog listing page with expandable inline posts.
import { useState } from "react";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { captureEmail } from "../lib/emailCaptureService.js";

const FEATURED_POST = {
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

## What we shipped in V1.0

The current release (V1.0) includes:
- **Custom extraction** — describe any field in plain English ("find the pricing tiers") and the AI locates and structures it
- **Domain mapping** — crawl an entire site and return every indexed URL
- **Lead enrichment** — surface leadership contacts and emails from any company page
- **Persona-adaptive workflows** — the app adapts its examples, quick actions, and AI prompts based on your role
- **CSV, PDF, and email export** — get your data into whatever workflow you use next

## What's coming

We're building toward API access for developers, scheduled monitoring for change tracking, and HubSpot / Salesforce native export. If you have a use case we haven't covered yet, reach out at hello@datiq.app.

Start with any URL. No sign-up required.
  `.trim(),
};

const POSTS = [
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

If you've been using the old "paste the key each time" flow for Airtable or Notion, do this once: open **Account → Integrations**, click **Set up** on the destination, paste the key + IDs, and your field map is built and stored. The next push from Preview, Dashboard, or Batch is one click. If you had an Airtable connection from before this release, click **Load columns** on the Airtable push tab to backfill the field map (or re-connect from scratch — the flow is faster now).

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

Open **Account → Invoices & receipts**. Full detail in the [Plans, usage & billing](/help/11-plans-usage-and-billing.html) help guide. If a document ever looks wrong, tell us at **hello@datiq.app** — a correction is a credit note, and we would rather issue one than have your books disagree with ours.

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
    title: "How We Built a Zero-Code Enrichment Pipeline",
    excerpt: "A look under the hood at how DatIQ chains Firecrawl extraction, Anthropic AI enrichment, and a Supabase persistence layer — all without the user writing a line of code.",
    date: "April 25, 2026",
    readTime: "8 min read",
    coverIcon: "code",
    fullContent: `
Every time you paste a URL into DatIQ and click Extract, a multi-step pipeline runs in milliseconds. Here's how it works.

## Step 1: Extraction (Firecrawl)

The URL is sent to Firecrawl's /scrape API endpoint. Firecrawl handles:
- JavaScript rendering (for React/Vue/Angular SPAs, when enabled)
- Robots.txt compliance
- Rate limiting and retry logic
- Returning clean HTML + metadata

DatIQ requests the page in HTML format, then parses the response to extract headings (H1–H6), links (internal and external), and page metadata.

## Step 2: AI enrichment (Anthropic Claude)

The extracted content is passed to Claude via the Anthropic messages API. Depending on the extraction options:
- **Summary** — a single paragraph describing the page's purpose and structure
- **Custom extraction** — a structured JSON object based on the user's plain-English prompt
- **Contact extraction** — leadership names, titles, and emails

All AI calls route through a Netlify serverless function — the API key never touches the browser.

## Step 3: Persistence (Supabase)

Extraction results are saved to a Supabase PostgreSQL database, keyed by session ID and URL. This powers the Dashboard view, history, and the CSV/PDF export pipeline.

When Supabase isn't configured (local dev or demo mode), DatIQ falls back to localStorage automatically.

## The no-code part

The user sees none of this. They paste a URL, click a button, and get structured data. The entire pipeline — scraping, AI enrichment, persistence — runs transparently in the background, with progress shown via the animated loading screen.

This is what "zero-code" actually means in practice: not just no scraping scripts, but no infrastructure, no API keys, no configuration. Just data.
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
