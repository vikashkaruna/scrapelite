// UseCaseCompetitor.jsx — /use-cases/competitor-research landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "dollar-sign",
    title: "Pricing Extraction",
    desc: "Structured pricing tiers pulled directly from any competitor's pricing page — plan names, prices, feature bullets, and limits.",
  },
  {
    icon: "eye",
    title: "Messaging Analysis",
    desc: "Full H1–H6 heading outline and key copy extracted from product and landing pages — track how competitors position against you.",
  },
  {
    icon: "users",
    title: "Leadership Tracking",
    desc: "Monitor org changes, new executive hires, and leadership signals from team pages and press releases.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Paste competitor URL",
    desc: "Enter any competitor page — pricing, about, team, or product — into DatIQ's extraction field.",
  },
  {
    title: "Select extraction type",
    desc: "Choose Pricing, Contacts, Headings, or Custom extraction depending on what intelligence you need.",
  },
  {
    title: "Compare across runs",
    desc: "Save each extraction to your Dashboard. Use the search and filter to compare results over time and spot changes.",
  },
  {
    title: "Export findings",
    desc: "Download a CSV or generate a formatted PDF report to share with your team or include in a competitive brief.",
  },
];

const PERSONAS = [
  { icon: "trending-up", label: "CI Analysts" },
  { icon: "target", label: "Product Managers" },
  { icon: "building", label: "Agencies" },
];

const RELATED = [
  { label: "Lead Generation", path: "/use-cases/lead-generation" },
  { label: "SEO Audit", path: "/use-cases/seo-audit" },
  { label: "Market Research", path: "/use-cases/market-research" },
];

export default function UseCaseCompetitor() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/use-cases/competitor-research/index.html this page now owns.
  useSeo(seoFor("/use-cases/competitor-research"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Competitive Intelligence</div>
            <h1>Monitor your competitors' pricing, messaging, and leadership — without writing a single line of code</h1>
            <p className="uc-direct-answer">
              DatIQ extracts structured data from any competitor website — pricing tables, product positioning,
              leadership changes, and tech stack signals — in seconds. Competitive intelligence analysts use DatIQ
              to benchmark dozens of competitors monthly without spreadsheets, browser extensions, or engineering support.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">4</span>
                <span className="uc-stat-label">materiality levels, so only real changes alert</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">2,000</span>
                <span className="uc-stat-label">audits / month on Agency</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start — no card</span>
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

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Start tracking competitors</h2>
            <p>
              Paste your first competitor URL and get structured intelligence in seconds.
              Free to start — no credit card required.
            </p>
            <Button variant="primary" icon="trending-up" onClick={() => navigate("/")}>
              Start tracking competitors
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
    </div>
  );
}
