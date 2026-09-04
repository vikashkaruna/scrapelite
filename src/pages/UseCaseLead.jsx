// UseCaseLead.jsx — /use-cases/lead-generation landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "mail",
    title: "Contact Extraction",
    desc: "CEO names, email addresses, LinkedIn profiles, and other leadership contacts — all pulled from the target company's public web pages.",
  },
  {
    icon: "building",
    title: "Company Data",
    desc: "Headquarters location, founding year, technology stack signals, revenue indicators, and product positioning — structured and ready to use.",
  },
  {
    icon: "sparkles",
    title: "AI Company Summary",
    desc: "A one-paragraph plain-English overview of what the company does, who they serve, and how they differentiate — generated automatically.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Paste the company URL",
    desc: "Enter any company website — homepage, about page, or team page — into DatIQ's URL field.",
  },
  {
    title: "Click \"Contacts & Emails\"",
    desc: "Select the Contacts extraction type from the enrichment tab. DatIQ immediately begins scanning the page.",
  },
  {
    title: "View structured contacts",
    desc: "Receive a clean list of names, titles, emails, and social profiles — no manual copying or parsing required.",
  },
  {
    title: "Export to CSV or copy to CRM",
    desc: "Download the full contact list as CSV, or copy individual entries directly into your CRM or outreach tool.",
  },
];

const PERSONAS = [
  { icon: "target", label: "SDR / BDR" },
  { icon: "users", label: "Recruiters" },
  { icon: "building", label: "Agency Researchers" },
];

const RELATED = [
  { label: "Competitor Research", path: "/use-cases/competitor-research" },
  { label: "SEO Audit", path: "/use-cases/seo-audit" },
  { label: "Market Research", path: "/use-cases/market-research" },
];

export default function UseCaseLead() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/use-cases/lead-generation/index.html this page now owns.
  useSeo(seoFor("/use-cases/lead-generation"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Sales &amp; Lead Generation</div>
            <h1>Turn any company website into a qualified prospect — in under 30 seconds</h1>
            <p className="uc-direct-answer">
              DatIQ extracts structured contact data from any company website — CEO name, email addresses,
              LinkedIn profiles, and company metadata — with a single URL paste. No scrapers to build,
              no API keys to manage. Sales teams and SDRs use DatIQ to build targeted prospect lists in
              minutes instead of hours.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">500</span>
                <span className="uc-stat-label">accounts scored per list</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">4</span>
                <span className="uc-stat-label">CRM &amp; chat destinations</span>
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
            <h2>Start building your prospect list</h2>
            <p>
              Paste a company URL and get structured contacts back in under 30 seconds.
              Free to start — no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Start extracting contacts
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
