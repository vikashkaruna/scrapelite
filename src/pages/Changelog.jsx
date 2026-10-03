// src/pages/Changelog.jsx — F12 (public changelog + Product Hunt social launch).
//
// URL: /changelog. Linked from TopBar Explore + Footer + llms.txt + sitemap.
//
// This page lists the full set of product features available today, grouped
// by capability — a one-stop "what's in the box" rather than a
// reverse-chronological journal. Product version numbers are deliberately NOT
// shown (plan §22, D22a); "Updated {date}" is what tells a reader it is fresh.

import { useEffect } from "react";
import { Link } from "react-router";
import Icon from "../components/Icon.jsx";
import { setMeta , canonicalUrl } from "../lib/seoMeta.js";

const SHIPPED = "2026-07";
const UPDATED = "2026-09-25";

// Curated feature groups. Each group is a capability area; each entry is a
// single user-facing feature. Add a new entry to the right group when a
// feature ships — this is the single source of truth for "what's in
// DatIQ" and feeds the help-site, llms.txt, and the About page.
const FEATURE_GROUPS = [
  {
    id: "extraction",
    icon: "wand",
    title: "Extraction & enrichment",
    items: [
      "Single-URL extraction with headings, links, metadata, and structured content",
      "AI summary (provider-agnostic chain: Gemini → Claude → OpenAI)",
      "Custom extraction — ask for any field in plain English",
      "5 intent chips: AI summary, Find contacts, Scrape pricing, Map site, Custom",
      "12 built-in templates (startup pricing pages, leadership contacts, job listings, etc.)",
      "Background enrichment tabs on /preview (re-run, persist, multi-capability)",
      "Per-field provenance (each value tagged with its source span and confidence)",
      "Generate content: SEO blog outline, competitor summary, social posts",
      "Multi-provider scrape chain (Firecrawl → Spider.cloud → Jina AI → Direct fetch)",
      "Headless / render-JS mode (opt-in advanced option)",
    ],
  },
  {
    id: "batch",
    icon: "layers-2",
    title: "Batch & multi-URL",
    items: [
      "Batch starts from the Home composer — paste a list, import a CSV, or drop one on the box (up to 500 URLs / plan)",
      "Concurrent extraction (3 in parallel) with live progress",
      "Run in background — a run survives navigation; progress follows you in a dock with live count, current URL, and Cancel",
      "Per-URL content generation toggle (SEO / competitor / social), set in the composer's Advanced options",
      "Addressable runs — every batch has its own link, so results reopen after a reload or days later",
      "Failures are kept with the run, with a per-row reason and Retry",
      "Filter results by All / Success / Failed, and sort them",
      "Run history with intent + run count + delete per run",
      "Combined export (CSV / Excel / PDF / Markdown / JSON) across all successful items",
      "Copy-to-clipboard for CSV / Markdown / JSON (plan-gated same as downloads)",
    ],
  },
  {
    id: "account-control",
    icon: "shield",
    title: "Account control",
    items: [
      "Freeze your account — stops everything that consumes your allowance for you and every team member, while reading and exporting keep working",
      "Freezing does not pause billing, and the screen says so before you do it",
      "Pause a single team member instead of the whole account; a paused member keeps their seat and their read access",
      "Delete your account, scheduled 30 days out and cancellable at any point in that window — nothing disappears the moment you click",
      "Plan & usage now shows your discoverability allowance separately, and which role consumed what",
    ],
  },
  {
    id: "workflows",
    icon: "wand",
    title: "Intelligence workflows",
    items: [
      "Workflow templates — a named end-to-end job, not just an extraction: input form, fields read, analysis run, output blocks returned",
      "Sales-ready Account Brief — a company framed for a discovery call, a displacement, or an expansion",
      "Competitor Pricing Tracker — a pricing page as a structured tier table you can diff later",
      "Customer Proof Extractor — every named customer, case study, logo and quantified outcome on a site",
      "AI Visibility & Competitive Brief — you and up to four competitors read under one shared schema",
      "Pre-Meeting Due Diligence Brief — a source-backed company brief before a first call",
      "Bulk ICP Account Enrichment — a list of domains in, a scored account table out",
      "Persona-filtered catalogue, so the templates that fit your job are the ones you see first",
      "Cost estimate shown before every run — nothing is spent until you confirm",
      "Fork and edit any template — change the fields, the prompts and the output blocks (Go and above)",
      "Saved run history per template, re-openable, shareable and exportable",
      "Evidence contract on every field: observed, inferred, or absent — never invented",
    ],
  },
  {
    id: "workflow-hub",
    icon: "git-merge",
    title: "Workflow hub",
    items: [
      "One screen for Lists → Watchlists → Rules, so a pipeline that is silently not wired shows up as a problem, not a blank",
      "Needs your attention comes first — the issues lead and the diagram is context",
      "Building blocks with counts, and a starter template for any block you have not set up yet",
      "Your pipelines, each with Pause and Resume in place",
      "A 'Not connected yet' strip naming every list or watchlist that no active rule hears",
      "Signal rules can listen to chosen lists or watchlists instead of every one",
      "A rule reads back as one plain sentence before you save it",
      "A rule that loses its last source is paused with the reason shown — it never widens to 'everything'",
      "Deleting a list or watchlist a rule uses names those rules and offers Unlink and delete",
      "'Alert me' on a watchlist opens a rule already limited to it",
      "Dry trace: pick an event and see which rules fire and which condition turned the others away — nothing is sent",
    ],
  },
  {
    id: "template-hub",
    icon: "library",
    title: "Template hub",
    items: [
      "20 templates, filtered by role, each showing what it reads, what it returns and what it costs",
      "Hand-off templates open the right module with the fields already filled — they never run or charge on their own",
      "Starter templates for account lists, competitor change monitors and price-change alerts",
      "A template can belong to several roles, so it appears wherever it fits your job",
      "Template runs report through the shared progress dock, so leaving the page does not abandon them",
      "If the template store is unavailable, templates that run are held back while hand-offs keep working",
    ],
  },
  {
    id: "roles",
    icon: "users",
    title: "Roles & onboarding",
    items: [
      "Eight roles: Sales, SDR & BDR · RevOps & Growth Operations · Product Manager & Competitive Intelligence · Product Marketing Manager · SEO, Content, AEO & GEO · Brand, Growth & CRO · Founder, VC & Market Research · Agency, Enterprise & Consultant",
      "Your role shapes the examples, tiles and templates you see first — every feature stays available whichever you pick",
      "Change your role at any time from the account menu (Switch persona)",
      "Twelve common jobs on Home, each a single click to a pre-filled run",
    ],
  },
  {
    id: "engagement",
    icon: "send",
    title: "Engagement (private beta)",
    items: [
      "Outreach from the accounts you have already researched, in a private beta — ask us for access",
      "Consent first: opt-outs are honoured per channel and checked at the moment of sending, not only when a message is approved",
      "Every message is approved by a person before it goes out",
      "Import prospects from CSV, TSV, TXT or Excel, with every row checked before anything is imported",
      "A send that cannot go out is recorded as failed — never reported as sent",
    ],
  },
  {
    id: "credits",
    icon: "gauge",
    title: "Credits",
    items: [
      "One credit pool for extraction, enrichment, audits, monitoring and templates",
      "The cost estimate before a run uses the same rule the server charges by, so it never refuses a run the server would allow",
      "Unused monthly credits carry over for one month",
      "A refused request — for robots.txt, a private address, or your plan — costs nothing",
    ],
  },
  {
    id: "accounts",
    icon: "target",
    title: "Bulk account intelligence",
    items: [
      "Import company domains by paste or CSV, normalised and de-duplicated on the way in",
      "Durable chunked enrichment — a 500-account run survives a closed tab or a slow provider",
      "Firmographics read from each company's own site: industry, size band, pricing model, positioning, proof points",
      "Editable ICP rules — field, operator, value, weight, plus required criteria and a qualification threshold",
      "Live rule testing against a sample domain before you spend anything on a run",
      "Unmeasured criteria are excluded and their weight redistributed, never scored as zero",
      "Coverage travels with every score, so a 70 from five signals is distinguishable from a 70 from two",
      "Review queue for low-confidence extractions instead of silently entering them into your table",
      "Export scored accounts as CSV or JSON, or push them to HubSpot, Notion, Airtable or Slack",
    ],
  },
  {
    id: "watchlists",
    icon: "eye",
    title: "Change intelligence & signal routing",
    items: [
      "Competitor watchlists — standing watches that re-read chosen domains on a cadence",
      "Page discovery — add a domain and DatIQ suggests the pages worth watching, labelled separately from the ones you added yourself",
      "Materiality classification: critical alerts immediately, high daily, medium weekly, low never",
      "First run is always a silent baseline, so setting up a watch never fires a false alert",
      "A field that stopped being observed is reported as unobserved, never as a deletion",
      "Objective change facts kept separate from labelled AI interpretation, with feedback on each",
      "Signal routing rules — trigger on a watchlist change, a bulk enrichment result, or a workflow run",
      "Conditions builder with a live 'Test with sample payload' that shares the runtime's own evaluator",
      "Actions: Slack, email, webhook, and HubSpot",
      "Every dispatch recorded whether it succeeded or not, with retries on a backoff schedule",
      "Destinations re-validated at dispatch time, not only when the rule was saved",
    ],
  },
  {
    id: "reports",
    icon: "share",
    title: "Reports & collaboration",
    items: [
      "Publish any run, audit or extraction as a report at its own link",
      "Five visibility levels: private, anyone with the link, workspace only, named people only, public",
      "Only public reports are indexable — every other level ships a noindex instruction",
      "Permanent revoke that burns a link for good, plus optional expiry dates",
      "Your Brand Kit on reports, PDFs and emailed deliverables (Business and Agency)",
      "Team workspaces with owner / admin / member roles and email-bound, single-use invites",
      "Workspace-scoped reports readable by every member, for circulating an internal brief",
      "Per-seat pause for a member who should keep access but stop spending the allowance",
    ],
  },
  {
    id: "discoverability",
    icon: "scan-search",
    title: "Discoverability — SEO, AEO & GEO",
    items: [
      "Audit any page for classic search (SEO), answer engines (AEO) and generative engines (GEO) — three scores, one run",
      "Four-pillar model: Answer Clarity, Entity Authority, Structural Hierarchy, Technical Accessibility, each traceable to its individual signals",
      "Blocking issues scale the whole score and show their arithmetic — your score before them, the multiplier, the result",
      "Unmeasured signals are excluded and their weight redistributed, never scored as zero; every score carries its evidence coverage",
      "Prioritised fix queue with owner, effort, confidence and the lift this page can actually recover",
      "Copy-ready constructs: FAQ and Organization JSON-LD built from your visible content, answer blocks, corrected heading outlines, robots.txt",
      "Evidence panels: heading tree, schema inventory, extracted answer preview, entity and citation footprint, crawler access",
      "Re-audit and compare — resolved, remaining, and anything new a fix introduced",
      "Trend chart across every audit of a page, drawing gaps where a score could not be measured",
      "Scheduled monitoring (Pro+) that emails only on material movement, and competitive benchmarks (Select+)",
      "Every report opens with the page it audited and a written summary of what the scores mean",
      "Pillars expand independently, so two can be compared side by side",
      "Markdown, PDF, CSV and JSON exports — each carrying the whole report: summary, pillars, every signal, penalties, evidence and the comparison against your last audit",
      "Create a monitor from the Schedules screen or from Workspace, and see your audits and monitors on the Workspace Discoverability tab",
      "Business truth record — the facts about your company, approved by a person, checked against what your pages say",
      "Entity graph of your company, products, people and competitors, approved edge by edge",
      "Local & directory checks that treat 'Pvt Ltd' and 'Private Limited' as the same name, and name every source not yet checked",
      "Trust & proof scored by evidence quality, never volume — one verifiable third-party record outweighs any number of self-published ones",
      "Brand, product and service scores, stored with their coverage so a trend never shows a phantom jump",
      "Signed webhook on completion",
    ],
  },
  {
    id: "schedules",
    icon: "calendar-clock",
    title: "Schedules & monitoring",
    items: [
      "/schedules route with custom cadence builder (frequency · weekday · time → cron)",
      "Preset cadences (hourly / daily / weekly / monthly) on Home composer",
      "'Run until' end dates for time-boxed monitoring",
      "Hourly Netlify scheduled-runner (Firecrawl → fingerprint → change diff)",
      "Email alerts via Resend on detected changes (with diff preview)",
      "Slack alerts via Block Kit webhook (parallel to email)",
      "Manual 'Run now' on /schedules with change detection toast",
      "Schedules are saved to your account before they can run — create one signed out and DatIQ holds it, prompts sign-in, then saves it for you",
      "A schedule that isn't saved says 'Not running' instead of advertising a next run it can't honour",
    ],
  },
  {
    id: "dashboard",
    icon: "layout-grid",
    title: "Dashboard & history",
    items: [
      "Saved extractions (table + cards layouts, persistent in Supabase)",
      "Type column (Single / Batch / Scheduled) with collapsible groupings",
      "Batch run history filter (BatchRunsDropdown + active-filter banner)",
      "Search + sort + pagination over extractions",
      "Export ▾ (CSV / PDF / Markdown / JSON) with plan hints",
      "Push ▾ in the toolbar beside Export — both act on your selection, or on everything filtered when nothing is selected",
      "Inline selection row — Generate / Email / Clear beside the filters",
      "Browser-only pages are flagged, and signing in moves them onto your account automatically",
      "Delete with confirmation",
      "Per-user owner scoping (signed-in user, or per-browser session for guests)",
    ],
  },
  {
    id: "preview",
    icon: "file-text",
    title: "Preview & enrichment",
    items: [
      "Quick enrichment tabs: AI summary, Custom, Contacts, Pricing, Map site",
      "Download ▾ dropdown in action bar (CSV / PDF / Markdown / JSON)",
      "'View Dashboard' CTA after auto-save",
      "AI summary thumbs up/down feedback (with comment)",
      "Shareable public report links (/p/:slug) + /gallery listing",
      "Push ▾ — one menu for every destination, including Google Sheets with no setup",
    ],
  },
  {
    id: "auth",
    icon: "shield",
    title: "Auth & accounts",
    items: [
      "Email + password sign-up / sign-in (with email confirmation)",
      "Google, Microsoft (Azure), GitHub OAuth",
      "'Forgot password?' flow with /reset-password landing page",
      "Friendly error mapping (Supabase auth errors → actionable copy + CTAs)",
      "Persona-based onboarding (7 personas: Sales, CI, SEO, Research, Recruiter, Founder, VC)",
      "One-time 25-extraction trial credit on first sign-in (Free plan)",
      "Per-account usage tracking + monthly reset",
    ],
  },
  {
    id: "billing",
    icon: "credit-card",
    title: "Plans & payments",
    items: [
      "7 plan tiers: Free, Go, Select, Pro, Business, Agency, Developer (upcoming), Enterprise",
      "Annual + monthly billing (~17% annual discount, computed live from each plan's prices)",
      "USD + INR pricing (INR promotional annual amounts, GST-inclusive)",
      "Razorpay one-time Order payments (INR) — server-authoritative amounts",
      "Top-up bundles (Extractions Bundle, Scheduled Monitor, Extra Workspace) with quantity selector",
      "Coupons (% off or bonus extractions) with server-enforced maxUses + one-per-user",
      "Payment-confirm modal with itemized GST breakdown + in-modal Monthly/Annual toggle",
      "Task-aware paywall copy (recommends the right plan for the current task)",
      "Numbered, itemized invoice or receipt issued for every completed payment",
      "Invoice PDF emailed automatically on payment, with view / download / re-send in Account",
      "Issued documents are permanent records — corrections are separate credit notes, never edits",
      "Billing documents stay available after a plan is cancelled or lapses",
      "Lapsed-plan stages are signposted in-app and by email, and renewing restores access",
      "Scheduled monitoring pauses while a plan is lapsed and resumes on renewal",
      "White-label PDF (Business + Agency): upload a single-page PDF template in /account; every PDF export and invoice is rendered on top of your branded background",
      "Priority support (Business + Agency): contact-form submissions route through a faster SLA",
      "Extra Workspace add-on: same features as the parent plan, capped at the parent plan's team-seats limit",
    ],
  },
  {
    id: "guest",
    icon: "user",
    title: "Guest trial",
    items: [
      "3 free extractions (soft prompt every 2; can dismiss and continue)",
      "10 single-URL / 5 batch hard limit, enforced on every extraction path — never as a page-load interstitial",
      "Bypass prevention: guest counter never cleared on login/logout",
      "GuestTrialBanner between TopBar and page content",
      "Smart paywall — annual discount anchored when the limit is hit",
    ],
  },
  {
    id: "ux",
    icon: "zap",
    title: "UX & power-user",
    items: [
      "Inline extraction progress on Home (4-step indicator + Preview CTA in the preview area)",
      "Keyboard shortcuts (/?/g d/b/s/p/w/t, mod+K command palette)",
      "Command palette — 7 actions with fuzzy filter",
      "Onboarding tour (7 steps, spotlight + popover, replayable via g t)",
      "Try-an-example demo (5-step auto-playing walkthrough)",
      "Recent extractions widget (owner-scoped, responsive grid)",
      "Credit estimator (pre-flight, disables Run when over the plan cap)",
      "Outcome tiles (6 fast-path picks: summary, contacts, pricing, map, etc.)",
      "Smart multi-input composer (auto-routes single / multi-URL / CSV / raw text)",
      "Links-in-text detection — a pasted email or thread offers 'Extract all N' or 'Extract as one page' rather than guessing",
      "Outcome tile multi-select with combined prompts",
    ],
  },
  {
    id: "docs",
    icon: "book-open",
    title: "Docs & help",
    items: [
      "Static help site at /help (23 user-guide sections + developer API reference)",
      "5 persona context chips (Sales, CI, SEO, Research, Recruiter, Founder, VC)",
      "In-app trust strip (Encrypted in transit / Auto-deleted in 30 days / Never used to train AI)",
      "Public AI crawler accessibility (llms.txt, GPTBot/ClaudeBot/PerplexityBot allowlist)",
      "Sitemap.xml + robots.txt + 3 JSON-LD schemas (Organization, WebSite, SoftwareApplication)",
      "About / Contact / Privacy / Terms / Use Cases / Integrations / Changelog pages",
      "Comparison pages (/vs/browse-ai, /vs/clay, /vs/apify, /vs/phantombuster, /vs/firecrawl)",
      "One support inbox — reach us at hello@datiq.app for product, billing, legal & privacy",
    ],
  },
  {
    id: "integrations",
    icon: "plug",
    title: "Integrations & sharing",
    items: [
      "One Push ▾ menu on Preview, Dashboard, and Batch results — every destination in one list",
      "Push destinations: HubSpot, Airtable, Notion, Slack, plus Google Sheets (no setup needed)",
      "Server-stored connections — set up once in /account#integrations, push forever",
      "Zapier receives new extractions as a trigger event for 5,000+ apps",
      "Per-provider rich status (token hint, IDs, field map, title column, column count) on /account#integrations",
      "Test / Edit / Disconnect actions on every connected row",
      "Airtable + Notion auto-built field maps; 'Load columns' re-fetches schema for legacy connections",
      "Airtable / Notion field mapping lives behind 'More destination options…' in the Push menu",
      "Shareable public report links (/p/:slug) + /gallery",
      "Email delivery of extractions (multi-recipient)",
      "Slack alerts via Block Kit webhook for schedule changes (long-title-safe)",
      "Workspace view consolidates Collections and Active Schedule",
    ],
  },
];

const PRODUCT_HUNT = {
  status: "upcoming",
  badge: "Launching soon",
  tagline: "DatIQ is preparing for its Product Hunt launch. Subscribe to be notified on launch day.",
};

function FeatureGroup({ group }) {
  return (
    <section className="cl-group" id={`feature-${group.id}`} aria-labelledby={`feature-${group.id}-title`}>
      <header className="cl-group-head">
        <span className="cl-group-icon" aria-hidden="true">
          <Icon name={group.icon} size={18} />
        </span>
        <h2 className="cl-group-title" id={`feature-${group.id}-title`}>{group.title}</h2>
        <span className="cl-group-count">{group.items.length} features</span>
      </header>
      <ul className="cl-group-list">
        {group.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export default function Changelog() {
  useEffect(() => {
    setMeta({
      title: "What's in DatIQ — Changelog",
      description:
        "Every feature available in DatIQ today, grouped by capability: extraction, workflows, the workflow and template hubs, discoverability, credits, and power-user tools.",
      url: canonicalUrl("/changelog"),
    });
  }, []);

  const totalFeatures = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="page cl-page">
      <div className="container cl-container">
        <header className="cl-head rise">
          <span className="ws-eyebrow">
            <Icon name="package" size={12} />
            Changelog
          </span>
          <h1 className="cl-title">What's in DatIQ</h1>
          <p className="cl-sub">
            {totalFeatures} features across {FEATURE_GROUPS.length} capability areas — the
            full set of what ships today. Updated {UPDATED}; first released {SHIPPED}.
          </p>

          {/* Latest-changes callout. Replace its text when something ships;
              the groups below are the full list. */}
          <div className="cl-update-banner">
            <Icon name="sparkles" size={16} />
            <div>
              <strong>Updated {UPDATED}</strong>
              <span>
                <strong>Workflow hub</strong> and <strong>template hub</strong> — rules can now listen to
                {" "}chosen lists and watchlists, and every pipeline is on one screen. <strong>Eight roles</strong> replace
                {" "}the old personas. <strong>Engagement</strong> is in private beta.
              </span>
            </div>
          </div>

          <div className="cl-ph-banner">
            <Icon name="rocket" size={16} />
            <div>
              <strong>{PRODUCT_HUNT.badge}</strong>
              <span>{PRODUCT_HUNT.tagline}</span>
            </div>
            <a
              className="cl-ph-link"
              href="mailto:hello@datiq.app?subject=Notify%20me%20on%20Product%20Hunt%20launch"
            >
              Notify me →
            </a>
          </div>
        </header>

        <nav className="cl-toc" aria-label="Feature groups">
          <span className="cl-toc-label">Jump to:</span>
          {FEATURE_GROUPS.map((g) => (
            <a key={g.id} href={`#feature-${g.id}`}>
              {g.title}
            </a>
          ))}
        </nav>

        <div className="cl-list">
          {FEATURE_GROUPS.map((g) => (
            <FeatureGroup key={g.id} group={g} />
          ))}
        </div>

        <footer className="cl-foot">
          <p>
            <Link to="/">← Back to DatIQ</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
