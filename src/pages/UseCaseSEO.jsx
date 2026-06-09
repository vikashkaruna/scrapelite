// UseCaseSEO.jsx — /use-cases/seo-audit landing page
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const WHAT_YOU_GET = [
  {
    icon: "hash",
    title: "Heading Structure",
    desc: "Every H1 through H6 from any public page — extracted instantly, ordered hierarchically, ready to audit or copy into a content brief.",
  },
  {
    icon: "link",
    title: "Link Profile",
    desc: "Every internal and external link on the page — deduplicated, labelled, and categorised — so you can spot orphaned content and link opportunities in seconds.",
  },
  {
    icon: "sparkles",
    title: "AI Content Brief",
    desc: "A one-click AI-generated content outline based on what DatIQ found — perfect for briefing writers or identifying content gaps against competitors.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Paste any URL",
    desc: "Enter any public web page — competitor content, your own site, a target keyword landing page — into DatIQ.",
  },
  {
    title: "View heading structure instantly",
    desc: "Receive a full H1–H6 outline the moment extraction completes. No plugins, no browser extensions, no login required.",
  },
  {
    title: "Analyse the link profile",
    desc: "Review every internal and external link on the page. Filter by category, sort by count, or export the full list.",
  },
  {
    title: "Generate a content brief",
    desc: "Use DatIQ's AI enrichment to produce an SEO content outline, competitive gap analysis, or rewrite brief in seconds.",
  },
];

const PERSONAS = [
  { icon: "trending-up", label: "SEO Professionals" },
  { icon: "file", label: "Content Marketers" },
  { icon: "building", label: "Digital Agencies" },
];

const RELATED = [
  { label: "Lead Generation", path: "/use-cases/lead-generation" },
  { label: "Competitor Research", path: "/use-cases/competitor-research" },
  { label: "Market Research", path: "/use-cases/market-research" },
];

export default function UseCaseSEO() {
  const navigate = useNavigate();

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <main id="main-content" className="page">
        <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · SEO &amp; Content Marketing</div>
            <h1>Audit any site's structure, headings, and link profile — in seconds, no setup required</h1>
            <p className="uc-direct-answer">
              DatIQ instantly extracts a full H1–H6 heading outline, every internal and external link,
              and an AI-generated content summary from any public URL. SEO professionals use it to audit
              competitor content architecture, identify content gaps, and generate briefs — all without
              installing plugins or writing scraping code.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">10s</span>
                <span className="uc-stat-label">average audit time</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">25K+</span>
                <span className="uc-stat-label">pages audited this month</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">Free</span>
                <span className="uc-stat-label">to start — no credit card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What you get from every audit</h2>
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
                "DatIQ replaced our $80/month heading audit tool. I audit competitor pages in 10 seconds now."
              </blockquote>
              <cite>— Jamie L., SEO Lead</cite>
            </div>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Audit your first page</h2>
            <p>
              Paste any URL and get a full heading structure, link profile, and AI content brief in under
              15 seconds. Free to start — no credit card required.
            </p>
            <Button variant="primary" icon="search" onClick={() => navigate("/")}>
              Audit your first page free
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
