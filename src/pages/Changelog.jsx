// src/pages/Changelog.jsx — F12 (public changelog + Product Hunt social launch).
//
// URL: /changelog. Linked from TopBar Explore + Footer + llms.txt + sitemap.
//
// v1.0 release: this page lists the full set of product features available
// in the current V1.0 build, grouped by capability. The historical per-
// release log has been retired — V1.0 is the first externally-visible
// version number, so the page is now a one-stop "what's in the box" rather
// than a reverse-chronological journal.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { setMeta } from "../lib/seoMeta.js";

const VERSION = "V1.0";
const SHIPPED = "2026-07";

// Curated feature groups. Each group is a capability area; each entry is a
// single user-facing feature. Add a new entry to the right group when a
// feature ships — this is the single source of truth for "what's in
// DatIQ V1.0" and feeds the help-site, llms.txt, and the About page.
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
      "/batch page — paste URLs or import a CSV (up to 500 URLs / plan)",
      "Concurrent extraction (3 in parallel) with live progress",
      "Per-URL content generation toggle (SEO / competitor / social)",
      "Run history with intent + run count + delete per run",
      "Combined export (CSV / PDF / Markdown / JSON) across all successful items",
      "Copy-to-clipboard for CSV / Markdown / JSON (plan-gated same as downloads)",
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
      "Selection bar — Generate / Email / Export across multiple rows",
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
      "Open in Google Sheets / Airtable / Notion (adapters in F18 modal)",
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
      "7 plan tiers: Free, Go, Select, Pro, Business, Agency, Developer (coming H3 2026), Enterprise",
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
      "10 single-URL / 5 batch hard limit (non-dismissible block)",
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
      "Outcome tile multi-select with combined prompts",
    ],
  },
  {
    id: "docs",
    icon: "book-open",
    title: "Docs & help",
    items: [
      "Static help site at /help (15 user-guide sections + developer API reference)",
      "5 persona context chips (Sales, CI, SEO, Research, Recruiter, Founder, VC)",
      "In-app trust strip (Encrypted in transit / Auto-deleted in 30 days / Never used to train AI)",
      "Public AI crawler accessibility (llms.txt, GPTBot/ClaudeBot/PerplexityBot allowlist)",
      "Sitemap.xml + robots.txt + 3 JSON-LD schemas (Organization, WebSite, SoftwareApplication)",
      "About / Contact / Privacy / Terms / Use Cases / Integrations / Changelog pages",
      "Comparison pages (/vs/browse-ai, /vs/clay, /vs/apify, /vs/phantombuster)",
      "One support inbox — reach us at hello@datiq.app for product, billing, legal & privacy",
    ],
  },
  {
    id: "integrations",
    icon: "plug",
    title: "Integrations & sharing",
    items: [
      "Open in Google Sheets (one-click, no auth)",
      "Airtable adapter (paste API key + base/table IDs)",
      "Notion adapter (paste API key + database ID)",
      "Shareable public report links (/p/:slug) + /gallery",
      "Email delivery of extractions (multi-recipient)",
      "Slack alerts via Block Kit webhook for schedule changes",
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
      title: `${VERSION} — What's in DatIQ`,
      description:
        `Every feature available in DatIQ ${VERSION}, grouped by capability: extraction, batch, schedules, dashboard, auth, billing, and power-user tools.`,
      url: typeof window !== "undefined" ? `${window.location.origin}/changelog` : "/changelog",
    });
  }, []);

  const totalFeatures = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="page cl-page">
      <div className="container cl-container">
        <header className="cl-head rise">
          <span className="ws-eyebrow">
            <Icon name="package" size={12} />
            {VERSION}
          </span>
          <h1 className="cl-title">What's in DatIQ {VERSION}</h1>
          <p className="cl-sub">
            {totalFeatures} features across {FEATURE_GROUPS.length} capability areas — the
            full set of what ships in the {VERSION} build. No historical log; this is the
            starting point. Released {SHIPPED}.
          </p>

          {/* 2026-08 update banner — the V1.0 page is a one-stop snapshot, so
              we surface post-release deltas here rather than restarting the
              historical log. When V1.1 ships, replace this banner with a
              brief "what changed" callout pointing at /changelog/v1.1. */}
          <div className="cl-update-banner">
            <Icon name="sparkles" size={16} />
            <div>
              <strong>Updated 2026-08</strong>
              <span>
                Business now ships with <strong>white-label PDF</strong> and
                {" "}<strong>priority support</strong> (previously Agency-only).
                The <strong>Extra Workspace</strong> add-on now inherits your
                plan's features, capped at the parent plan's team-seats limit.
                Developer tier retargeted to <strong>H3 2026</strong>.
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
            <Icon name="info" size={12} />
            Source for each feature is tracked in the public GitHub repo —
            {" "}
            <a href="https://github.com/vikashkaruna/scrapelite" target="_blank" rel="noreferrer noopener">
              vikashkaruna/scrapelite
            </a>
            .
          </p>
          <p>
            <Link to="/">← Back to DatIQ</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
