// UseCaseAccountIntelligence.jsx — /use-cases/account-intelligence landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "building",
    title: "Firmographics",
    desc: "Industry, size band, headquarters, pricing model, and whether the company publishes pricing at all &mdash; read from their own site, not guessed from a name.",
  },
  {
    icon: "target",
    title: "An ICP score you can defend",
    desc: "Weighted rules you write and edit yourself. Every score travels with its coverage, so you always know how much of the picture it is based on.",
  },
  {
    icon: "link",
    title: "Provenance on every field",
    desc: "The page each fact came from and the quote that supports it. A rep who asks &ldquo;how do we know that?&rdquo; gets an answer instead of a shrug.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Import your domains",
    desc: "Paste a list or upload a CSV. DatIQ normalises and de-duplicates as it imports, so three spellings of one company become one account.",
  },
  {
    title: "Set your ICP rules",
    desc: "Field, operator, value, weight. Mark a criterion required if failing it should disqualify. Test the whole rule set against a sample domain before you spend anything.",
  },
  {
    title: "Run the enrichment",
    desc: "Work is chunked and durable, so a 500-account list survives a closed tab or a slow provider. You see a cost estimate before it starts.",
  },
  {
    title: "Work the qualified list",
    desc: "Export to CSV or JSON, or push straight into HubSpot, Notion, Airtable or Slack. Scores, coverage and sources travel with the export.",
  },
];

const PERSONAS = [
  { icon: "target", label: "Sales / SDR / BDR" },
  { icon: "bar-chart", label: "RevOps" },
  { icon: "building", label: "Agency researchers" },
];

const RELATED = [
  { label: "Lead Generation", path: "/use-cases/lead-generation" },
  { label: "Competitive Monitoring", path: "/use-cases/competitive-monitoring" },
  { label: "Market Research", path: "/use-cases/market-research" },
];

export default function UseCaseAccountIntelligence() {
  useSeo(seoFor("/use-cases/account-intelligence"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Sales &amp; RevOps</div>
            <h1>Turn a list of domains into a scored, worked account table</h1>
            <p className="uc-direct-answer">
              Paste or upload up to 500 company domains. DatIQ de-duplicates them, reads each company&rsquo;s public site for firmographics, pricing model, positioning and contacts, scores every account against ICP rules you control, and hands back a prioritised table your reps can work today &mdash; with the source URL behind every field.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">500</span>
                <span className="uc-stat-label">accounts per list</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">0</span>
                <span className="uc-stat-label">fields invented &mdash; ever</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start &mdash; no card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What comes back for every account</h2>
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

          {/* Honesty note — this product does not invent facts, and the page says so */}
          <div className="uc-section fade">
            <h2>Every number comes with its source</h2>
            <p className="uc-card-desc">
              A field DatIQ could not observe is marked absent, not filled with a plausible default &mdash; and an unmeasured field is never scored as zero. Its weight is redistributed across the criteria that were measured, and the coverage figure tells you how complete the picture is. That is deliberate: a 94%-accurate list nobody can tell the bad 6% inside is a list nobody works.
            </p>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Score your first list free</h2>
            <p>
              Import a handful of domains, write one ICP rule, and see the table. Free to start &mdash; no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/lists")}>
              Build an account list
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
