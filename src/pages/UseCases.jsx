// UseCases.jsx — /use-cases — aggregate hub linking to all use-case pages.
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const USE_CASES = [
  {
    slug: "lead-generation",
    icon: "users",
    title: "Lead Generation",
    desc: "Surface leadership contacts, emails, and company intelligence from any domain — without a CRM or scraping script. Build targeted lists in minutes.",
    highlights: ["Extract contact details from any company page", "Enrich with AI summaries and role data", "Export to CSV / HubSpot in one click"],
    cta: "Explore lead generation",
  },
  {
    slug: "competitor-research",
    icon: "eye",
    title: "Competitor Research",
    desc: "Track competitor pricing, product changes, and positioning in real time. Set up scheduled monitors so you're always first to know when something shifts.",
    highlights: ["Extract pricing tables from any URL", "Monitor competitor pages for changes", "Compare structured data across multiple sites"],
    cta: "Explore competitor research",
  },
  {
    slug: "seo-audit",
    icon: "bar-chart",
    title: "SEO Audit",
    desc: "Pull the full heading structure, metadata, link profile, and on-page content from any URL. Feed the results straight into your SEO workflow or brief.",
    highlights: ["Full H1–H6 outline extraction", "Internal and external link analysis", "AI-generated SEO briefs in one click"],
    cta: "Explore SEO auditing",
  },
  {
    slug: "market-research",
    icon: "search",
    title: "Market Research",
    desc: "Map entire domains, extract product catalogs, and surface structured intelligence from industry sites — all without writing a single line of code.",
    highlights: ["Domain mapping to discover every indexed URL", "Structured data extraction in plain English", "Export to CSV or PDF for reporting"],
    cta: "Explore market research",
  },
  {
    slug: "account-intelligence",
    icon: "target",
    title: "Account Intelligence",
    desc: "Turn a list of up to 500 company domains into an enriched, ICP-scored account table your reps can work today — with the source URL behind every field.",
    highlights: ["Bulk enrich from each company's own site", "Score against ICP rules you write and edit", "Push qualified accounts to HubSpot, Notion, Airtable or Slack"],
    cta: "Explore account intelligence",
  },
  {
    slug: "competitive-monitoring",
    icon: "eye",
    title: "Competitive Monitoring",
    desc: "Standing watches on competitor pricing, features and positioning. Materiality classification means a price change wakes you and a copyright year never does.",
    highlights: ["Cadence-based re-reads with a silent baseline", "Critical / high / medium / low change classification", "Routed to Slack, email, a webhook or your CRM"],
    cta: "Explore competitive monitoring",
  },
  {
    slug: "ai-visibility",
    icon: "sparkles",
    title: "AI Visibility",
    desc: "What an AI answer engine says about you and up to four competitors, read under one shared schema and scored across search, answer and generative engines.",
    highlights: ["SEO, AEO and GEO scored separately", "Like-for-like competitor comparison", "Prioritised, copy-ready fixes"],
    cta: "Explore AI visibility",
  },
  {
    slug: "recruiting",
    icon: "users",
    title: "Recruiting Research",
    desc: "Brief yourself properly before you pitch a candidate on a company — what they build, how they position, who leads what, and a watch on their hiring pages.",
    highlights: ["Leadership and team structure from public pages", "A company you can actually describe in a call", "Alerts when careers pages change"],
    cta: "Explore recruiting research",
  },
  {
    slug: "investor-diligence",
    icon: "briefcase",
    title: "Investor Diligence",
    desc: "A sourced pre-meeting brief: product, pricing, published traction signals, the team, and the questions worth asking — with a citation behind every claim.",
    highlights: ["Every fact carries its page and quote", "Same schema across a whole pipeline", "Share to a link, a workspace, or named people only"],
    cta: "Explore investor diligence",
  },
];

export default function UseCases() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/use-cases/index.html this page now owns.
  useSeo(seoFor("/use-cases"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

        {/* Hero */}
        <div className="uc-hero rise">
          <div className="eyebrow">
            <Icon name="target" size={14} />
            Use cases
          </div>
          <h1>What will you run on DatIQ?</h1>
          <p className="uc-hero-sub">
            DatIQ is not one tool with one job. It reads the public web, runs the workflow that turns
            what it found into a finished brief or a scored list, watches what matters, and routes the
            result to where your team already works. Nine ways teams use it — no setup, no code.
          </p>
          <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
            Try it free
          </Button>
        </div>

        {/* Use case cards */}
        <div className="uc-hub-grid">
          {USE_CASES.map((uc) => (
            <div key={uc.slug} className="uc-hub-card card card-pad fade">
              <div className="uc-hub-icon">
                <Icon name={uc.icon} size={22} />
              </div>
              <div className="uc-hub-title">{uc.title}</div>
              <p className="uc-hub-desc">{uc.desc}</p>
              <ul className="uc-hub-highlights">
                {uc.highlights.map((h) => (
                  <li key={h}>
                    <Icon name="check" size={12} strokeWidth={3} />
                    {h}
                  </li>
                ))}
              </ul>
              <Button
                variant="secondary"
                size="sm"
                iconRight="arrow-right"
                onClick={() => navigate(`/use-cases/${uc.slug}`)}
                style={{ marginTop: "auto" }}
              >
                {uc.cta}
              </Button>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="uc-cta rise" style={{ marginTop: 48 }}>
          <h2>Start extracting intelligence today</h2>
          <p>
            All use cases are available on the free plan — 100 credits to start, no credit card required.
            They are granted once when you sign up and never expire.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Try DatIQ free
            </Button>
            <Button variant="secondary" icon="credit-card" onClick={() => navigate("/pricing")}>
              See pricing
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
