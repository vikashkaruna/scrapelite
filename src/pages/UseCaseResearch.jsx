// UseCaseResearch.jsx — /use-cases/market-research landing page
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const WHAT_YOU_GET = [
  {
    icon: "globe",
    title: "Multi-Source Extraction",
    desc: "Extract structured data from any number of public web pages in a single session — pricing tables, team pages, product documentation, news articles.",
  },
  {
    icon: "download",
    title: "Structured CSV Export",
    desc: "Every extraction is exportable as a clean, structured CSV. Aggregate findings from multiple sources into a single spreadsheet in minutes.",
  },
  {
    icon: "sparkles",
    title: "AI-Powered Synthesis",
    desc: "Use DatIQ's AI enrichment to generate summaries, extract custom fields in plain English, or produce competitive benchmarks across a batch of URLs.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Identify your sources",
    desc: "List the websites, competitor pages, or news sources you need data from — company sites, product pages, pricing pages, press releases.",
  },
  {
    title: "Extract each source",
    desc: "Paste each URL into DatIQ. Headings, links, contacts, pricing, and any custom field you describe are extracted immediately.",
  },
  {
    title: "Save to your dashboard",
    desc: "Every extraction is saved to your DatIQ Dashboard. Search, filter, and compare across all your sources in one place.",
  },
  {
    title: "Export and synthesise",
    desc: "Download everything as CSV, generate a PDF report, or use DatIQ's AI to synthesise findings across multiple pages at once.",
  },
];

const PERSONAS = [
  { icon: "flask", label: "Market Researchers" },
  { icon: "bar-chart", label: "Analysts" },
  { icon: "building", label: "Strategy Teams" },
  { icon: "rocket", label: "Startup Founders" },
];

const RELATED = [
  { label: "Lead Generation", path: "/use-cases/lead-generation" },
  { label: "Competitor Research", path: "/use-cases/competitor-research" },
  { label: "SEO Audit", path: "/use-cases/seo-audit" },
];

export default function UseCaseResearch() {
  const navigate = useNavigate();

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <main id="main-content" className="page">
        <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Market Research</div>
            <h1>Aggregate structured data from any web source — no scrapers, no code, no setup</h1>
            <p className="uc-direct-answer">
              DatIQ extracts structured data from any public website — pricing tables, team pages, product
              documentation, or news articles — and lets researchers save, search, and export findings as
              clean CSV or PDF. Market researchers use DatIQ to benchmark industries and aggregate data
              from dozens of sources in a single session.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">50+</span>
                <span className="uc-stat-label">sources per session</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">CSV + PDF</span>
                <span className="uc-stat-label">clean export formats</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">Free</span>
                <span className="uc-stat-label">to start — no credit card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What you get from every extraction</h2>
            <div className="uc-three-col">
              {WHAT_YOU_GET.map((item) => (
                <div key={item.title} className="uc-card">
                  <div className="uc-card-icon">
                    <Icon name={item.icon} size={20} />
                  </div>
                  <div className="uc-card-title">{item.title}</div>
                  <p className="uc-card-desc">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="uc-section fade">
            <h2>How it works</h2>
            <div className="uc-steps">
              {HOW_IT_WORKS.map((step, i) => (
                <div key={step.title} className="uc-step">
                  <div className="uc-step-num">{i + 1}</div>
                  <div className="uc-step-body">
                    <h3>{step.title}</h3>
                    <p>{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Who uses this */}
          <div className="uc-section fade">
            <h2>Who uses this</h2>
            <div className="uc-personas">
              {PERSONAS.map((p) => (
                <div key={p.label} className="uc-persona-chip">
                  <Icon name={p.icon} size={15} />
                  {p.label}
                </div>
              ))}
            </div>
          </div>

          {/* Testimonial */}
          <div className="uc-section fade">
            <h2>What our users say</h2>
            <div className="uc-testimonial">
              <blockquote>
                "I benchmarked 30 competitors in one afternoon with DatIQ. What used to take a week of manual research now takes a single session."
              </blockquote>
              <cite>— Priya K., Market Research Lead</cite>
            </div>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Start your research</h2>
            <p>
              Paste your first source URL and start building a structured dataset in seconds.
              Free to start — no credit card required.
            </p>
            <Button variant="primary" icon="database" onClick={() => navigate("/")}>
              Start your research free
            </Button>
          </div>

          {/* Related use cases */}
          <div className="uc-section" style={{ marginTop: "32px", marginBottom: "0" }}>
            <h2 style={{ fontSize: "1em", fontWeight: 700, marginBottom: "12px", color: "var(--text-2)" }}>
              Related use cases
            </h2>
            <div className="uc-related">
              {RELATED.map((r) => (
                <button key={r.path} className="uc-related-link" onClick={() => navigate(r.path)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </main>
    </>
  );
}
