// VsCompare.jsx — /vs/compare, the comparison hub.
//
// The ONLY React page under /vs/. The five per-tool detail pages are
// static-owned hand-written HTML (see scripts/site-routes.mjs); this hub is
// React because it has to stay in step with pricing and the plan matrix, which
// a hand-maintained table demonstrably did not — the previous
// public/vs/compare.html still advertised prices the app had stopped using.
//
// Replaces public/vs/compare.html, which is 301'd here.
//
// ⚠️ Every tool in TOOLS must have a live detail page under /vs/<slug>/, and
// every detail page must appear here. scripts/page-ownership.test.mjs asserts
// both directions — the old table silently omitted Firecrawl, Apify and
// PhantomBuster even though all three pages existed and were being maintained.

import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";

/**
 * Column order is deliberate: closest competitor first, most different last.
 * `href` is a plain path — these are static pages, so the links below are
 * <a href>, not <Link>, or in-app navigation would fall through to NotFound.
 */
export const TOOLS = [
  { slug: "browse-ai",     name: "Browse.ai",     href: "/vs/browse-ai",     tagline: "Visual robot recorder" },
  { slug: "clay",          name: "Clay",          href: "/vs/clay",          tagline: "Spreadsheet enrichment" },
  { slug: "firecrawl",     name: "Firecrawl",     href: "/vs/firecrawl",     tagline: "Developer scraping API" },
  { slug: "apify",         name: "Apify",         href: "/vs/apify",         tagline: "Developer actor platform" },
  { slug: "phantombuster", name: "PhantomBuster", href: "/vs/phantombuster", tagline: "LinkedIn automation" },
];

// Values: "yes" | "partial" | "no" are rendered as ✓ / ~ / ✕ with a label.
const y = (label) => ({ v: "yes", label });
const p = (label) => ({ v: "partial", label });
const n = (label) => ({ v: "no", label });

const GROUPS = [
  {
    group: "Setup & access",
    rows: [
      {
        criteria: "Setup time",
        note: "Zero-code to first extraction",
        datiq: y("Under 30 seconds"),
        "browse-ai": p("2–5 min (robot setup)"),
        clay: p("5–15 min (table config)"),
        firecrawl: n("5–10 min (API key + SDK)"),
        apify: n("Requires coding"),
        phantombuster: p("3–10 min (phantom config)"),
      },
      {
        criteria: "No-code required",
        note: "Non-technical users can self-serve",
        datiq: y("Fully no-code"),
        "browse-ai": y("No-code"),
        clay: p("Low-code / formulas"),
        firecrawl: n("API only"),
        apify: n("Developer-first"),
        phantombuster: p("Semi-technical"),
      },
      {
        criteria: "Free tier",
        note: "Real features, no trial lock",
        datiq: y("10 extractions/mo + 25 trial credits"),
        "browse-ai": p("Limited robot runs"),
        clay: y("100 credits/mo"),
        firecrawl: p("500 pages (scrape credits)"),
        apify: p("Platform units"),
        phantombuster: p("Phantom slots only"),
      },
    ],
  },
  {
    group: "Extraction capabilities",
    rows: [
      {
        criteria: "Custom extraction prompts",
        note: "Plain-English field definitions",
        datiq: y("Any field in plain English"),
        "browse-ai": p("Visual selector only"),
        clay: p("Formula-based"),
        firecrawl: p("JSON schema, in code"),
        apify: p("Code-defined selectors"),
        phantombuster: n("Fixed schemas"),
      },
      {
        criteria: "AI summarisation",
        note: "Automatic page-level AI summary",
        datiq: y("Included on every plan"),
        "browse-ai": n("Not included"),
        clay: p("Via Clay AI (extra cost)"),
        firecrawl: n("Not included"),
        apify: n("Not built-in"),
        phantombuster: n("Not built-in"),
      },
      {
        criteria: "JavaScript rendering",
        note: "SPAs and dynamic pages",
        datiq: y("Toggle per extraction"),
        "browse-ai": y("Supported"),
        clay: p("Via HTTP enrichments"),
        firecrawl: y("Full headless Chrome"),
        apify: y("Full headless"),
        phantombuster: y("Headless Chrome"),
      },
      {
        criteria: "Batch / multi-URL mode",
        note: "Parallel extraction at scale",
        datiq: y("All plans (5–500 URLs)"),
        "browse-ai": y("Multiple robots"),
        clay: y("Table rows"),
        firecrawl: p("Via /crawl (one job, in code)"),
        apify: y("Actor runs"),
        phantombuster: y("Multi-profile"),
      },
      {
        criteria: "Domain mapping",
        note: "Discover every URL on a site",
        datiq: y("Built in"),
        "browse-ai": n("Not included"),
        clay: n("Not included"),
        firecrawl: y("/map endpoint"),
        apify: y("Crawler actors"),
        phantombuster: n("Not included"),
      },
    ],
  },
  {
    group: "AI & enrichment",
    rows: [
      {
        criteria: "Structured data enrichment",
        note: "Auto-enrich extracted data",
        datiq: y("One-click enrichment tabs"),
        "browse-ai": n("Raw data only"),
        clay: y("Deep enrichment options"),
        firecrawl: n("Not included"),
        apify: n("Not included"),
        phantombuster: n("Not included"),
      },
      {
        criteria: "AI content generation",
        note: "Outlines, summaries, social posts",
        datiq: y("3 formats included"),
        "browse-ai": n("Not included"),
        clay: p("Via Clay AI (add-on)"),
        firecrawl: n("Not included"),
        apify: n("Not included"),
        phantombuster: n("Not included"),
      },
    ],
  },
  {
    group: "Export & integrations",
    rows: [
      {
        criteria: "Export formats",
        datiq: y("CSV · PDF · Markdown · JSON"),
        "browse-ai": p("CSV · JSON"),
        clay: p("CSV · Spreadsheet"),
        firecrawl: y("Markdown · JSON · HTML"),
        apify: y("CSV · JSON · Excel"),
        phantombuster: p("CSV · JSON"),
      },
      {
        criteria: "Public shareable reports",
        note: "Read-only URL anyone can open",
        datiq: y("/p/:slug and /gallery"),
        "browse-ai": n("Not included"),
        clay: n("Not included"),
        firecrawl: n("Not included"),
        apify: p("Public dataset links"),
        phantombuster: n("Not included"),
      },
      {
        criteria: "API access",
        datiq: p("Business plan and above"),
        "browse-ai": y("All plans"),
        clay: y("All plans"),
        firecrawl: y("Core product"),
        apify: y("Core feature"),
        phantombuster: y("Pro plans"),
      },
    ],
  },
  {
    group: "Scheduling & monitoring",
    rows: [
      {
        criteria: "Scheduled monitoring",
        note: "Auto-rerun with change alerts",
        datiq: y("Pro plan and above, email alerts"),
        "browse-ai": y("Scheduled robots"),
        clay: n("Manual refresh"),
        firecrawl: n("Self-implement with cron"),
        apify: y("Scheduled actors"),
        phantombuster: y("Scheduled phantoms"),
      },
    ],
  },
  {
    group: "Privacy & compliance",
    rows: [
      {
        criteria: "Indian law compliance",
        note: "DPDP Act 2023, Indian arbitration",
        datiq: y("DPDP Act 2023 compliant"),
        "browse-ai": n("US / EU only"),
        clay: n("US / EU only"),
        firecrawl: n("US / EU focus"),
        apify: p("GDPR focus"),
        phantombuster: p("GDPR focus"),
      },
      {
        criteria: "INR / Razorpay payments",
        note: "Pay in Indian Rupees",
        datiq: y("UPI · Cards · NetBanking"),
        "browse-ai": n("USD only"),
        clay: n("USD only"),
        firecrawl: n("USD card only"),
        apify: p("Card only (USD)"),
        phantombuster: n("USD only"),
      },
    ],
  },
];

const MARK = { yes: "check", partial: "minus", no: "x" };

function Cell({ value, isDatiq }) {
  if (!value) return <td className="vsc-cell">—</td>;
  return (
    <td className={`vsc-cell vsc-${value.v}${isDatiq ? " vsc-datiq" : ""}`}>
      <span className="vsc-mark" aria-hidden="true">
        <Icon name={MARK[value.v]} size={12} strokeWidth={3} />
      </span>
      <span className="vsc-sr">{value.v === "yes" ? "Yes" : value.v === "partial" ? "Partial" : "No"}: </span>
      {value.label}
    </td>
  );
}

export default function VsCompare() {
  const navigate = useNavigate();

  useSeo({
    title: "DatIQ vs Browse.ai, Clay, Firecrawl, Apify & PhantomBuster (2026) | DatIQ.app",
    description:
      "A side-by-side comparison of DatIQ against Browse.ai, Clay, Firecrawl, Apify and PhantomBuster: setup time, no-code support, custom extraction, AI summaries, batch mode, exports, scheduling, and INR billing.",
    canonical: "https://datiq.app/vs/compare",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "DatIQ vs the alternatives",
        url: "https://datiq.app/vs/compare",
        description:
          "Feature-by-feature comparison of DatIQ against five web extraction tools.",
        isPartOf: { "@type": "WebSite", name: "DatIQ", url: "https://datiq.app" },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://datiq.app/" },
          { "@type": "ListItem", position: 2, name: "Compare tools", item: "https://datiq.app/vs/compare" },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "DatIQ comparisons",
        itemListElement: TOOLS.map((t, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `DatIQ vs ${t.name}`,
          url: `https://datiq.app${t.href}`,
        })),
      },
    ],
  });

  return (
    <div className="page">
      <div className="vs-page container">
        <div className="vs-hero rise">
          <div className="eyebrow">Comparison</div>
          <h1>DatIQ vs the alternatives</h1>
          <p className="vs-answer">
            DatIQ turns any public URL into structured data with no code and no per-site setup.
            The tools below solve overlapping problems in different ways — visual robot recorders,
            spreadsheet enrichment, and developer APIs. This table is the short version; each
            detailed comparison goes deeper.
          </p>
        </div>

        {/* Header links to every detail page. Plain <a> on purpose: these are
            static-owned pages with no React route, so <Link> would land on
            NotFound. */}
        <div className="vsc-toollinks fade" aria-label="Detailed comparisons">
          {TOOLS.map((t) => (
            <a key={t.slug} href={t.href} className="vsc-toollink">
              <span className="vsc-toollink-name">DatIQ vs {t.name}</span>
              <span className="vsc-toollink-tag">{t.tagline}</span>
              <Icon name="arrow-right" size={14} />
            </a>
          ))}
        </div>

        <div className="uc-section fade">
          <h2>Feature comparison</h2>
          <div className="vsc-table-wrap">
            <table className="vsc-table">
              <caption className="vsc-sr">
                DatIQ compared with Browse.ai, Clay, Firecrawl, Apify and PhantomBuster
              </caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="vsc-datiq-head">DatIQ</th>
                  {TOOLS.map((t) => (
                    <th key={t.slug} scope="col">
                      <a href={t.href}>{t.name}</a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((g) => (
                  <Rows key={g.group} group={g} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="vsc-legend">
            <span className="vsc-yes"><Icon name="check" size={11} strokeWidth={3} /></span> full support ·{" "}
            <span className="vsc-partial"><Icon name="minus" size={11} strokeWidth={3} /></span> partial or paid add-on ·{" "}
            <span className="vsc-no"><Icon name="x" size={11} strokeWidth={3} /></span> not available.
            Competitor details reflect publicly documented features at the time of writing and can change.
          </p>
        </div>

        <div className="vs-cta fade">
          <h2>Try it on your own URL</h2>
          <p>Free plan, no credit card. Paste a URL and see the structured output in about 30 seconds.</p>
          <Button variant="primary" icon="arrow-right" onClick={() => navigate("/")}>
            Start extracting free
          </Button>
        </div>
      </div>
    </div>
  );
}

function Rows({ group }) {
  return (
    <>
      <tr className="vsc-grouprow">
        <th scope="rowgroup" colSpan={TOOLS.length + 2}>{group.group}</th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.criteria}>
          <th scope="row" className="vsc-rowhead">
            {row.criteria}
            {row.note && <span className="vsc-rownote">{row.note}</span>}
          </th>
          <Cell value={row.datiq} isDatiq />
          {TOOLS.map((t) => (
            <Cell key={t.slug} value={row[t.slug]} />
          ))}
        </tr>
      ))}
    </>
  );
}
