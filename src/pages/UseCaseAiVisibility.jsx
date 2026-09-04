// UseCaseAiVisibility.jsx — /use-cases/ai-visibility landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "search",
    title: "Three scores, one page",
    desc: "Classic search, answer engines and generative engines are scored separately, because the things that win a blue link are not the things that win a citation.",
  },
  {
    icon: "layers",
    title: "A like-for-like comparison",
    desc: "You and every competitor are read with the same schema. Four differently-shaped summaries are not a comparison; a shared schema is.",
  },
  {
    icon: "file",
    title: "Copy-ready fixes",
    desc: "A prioritised list of what to change first, with ready-to-paste markup. Anything we could not observe is left as an explicit TODO rather than invented.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Enter your domain and up to four competitors",
    desc: "One form. DatIQ reads each site&rsquo;s positioning, pricing and proof points under a single shared schema.",
  },
  {
    title: "Get the scores and the gaps",
    desc: "Each page is scored across the three lenses, and each score carries the coverage it was computed from.",
  },
  {
    title: "Read the brief",
    desc: "What you say, what they say, where the overlap is, and the specific things to change first &mdash; framed for your go-to-market team, your founder, or your marketers.",
  },
  {
    title: "Re-run and watch the line move",
    desc: "Audit history keeps the trend, so when a score moves you know what you changed.",
  },
];

const PERSONAS = [
  { icon: "bar-chart", label: "SEO &amp; content" },
  { icon: "sparkles", label: "Product marketing" },
  { icon: "rocket", label: "Founders" },
];

const RELATED = [
  { label: "SEO Audit", path: "/use-cases/seo-audit" },
  { label: "Competitive Monitoring", path: "/use-cases/competitive-monitoring" },
  { label: "Competitor Research", path: "/use-cases/competitor-research" },
];

export default function UseCaseAiVisibility() {
  useSeo(seoFor("/use-cases/ai-visibility"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Marketing &amp; AI Search</div>
            <h1>Find out what an AI answer engine says about you &mdash; and your competitors</h1>
            <p className="uc-direct-answer">
              Buyers increasingly ask an assistant before they ask a vendor. DatIQ reads your site and up to four competitors under one identical schema, scores each page for classic search, answer engines and generative engines, and writes a brief on where you actually stand &mdash; with the evidence behind every claim.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">3</span>
                <span className="uc-stat-label">lenses: SEO, AEO and GEO</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">4</span>
                <span className="uc-stat-label">competitors per brief</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start &mdash; no card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What the brief contains</h2>
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
              A competitor whose site DatIQ could not read is named as unread and passed to the model as NOT READ, so it cannot invent a row for them. An unmeasured signal is excluded and its weight redistributed &mdash; never scored as zero &mdash; because a zero would drag your trend line down during someone else&rsquo;s outage and then show a phantom improvement when it recovered.
            </p>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>See where you stand in AI search</h2>
            <p>
              Run one brief against your own domain and the competitors you actually lose to. Free to start &mdash; no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/discoverability")}>
              Run a visibility audit
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
