// UseCases.jsx — /use-cases — aggregate hub linking to all use-case pages.
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

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
];

export default function UseCases() {
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
          <h1>What will you build with DatIQ?</h1>
          <p className="uc-hero-sub">
            From lead generation to SEO auditing, DatIQ adapts to your workflow.
            Paste a URL — get structured intelligence — no setup, no code.
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
            All use cases are available on the free plan — 10 extractions per month, no credit card required.
            Sign up once and your 25-extraction trial credit is added automatically.
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
