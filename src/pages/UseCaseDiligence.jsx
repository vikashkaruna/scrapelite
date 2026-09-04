// UseCaseDiligence.jsx — /use-cases/investor-diligence landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "file",
    title: "A company you can question",
    desc: "Positioning, product surface, pricing model and go-to-market, structured the same way every time so two companies are actually comparable.",
  },
  {
    icon: "trending-up",
    title: "Traction signals",
    desc: "The named customers, case studies, logos and quantified outcomes a company chooses to publish &mdash; the evidence they are willing to stand behind.",
  },
  {
    icon: "help-circle",
    title: "Questions worth asking",
    desc: "Framed for an intro call, a diligence deep-dive or a partnership conversation, and pointed at the gaps the public record does not close.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Enter the domain",
    desc: "Pick the meeting type &mdash; intro, diligence or partnership &mdash; and the brief is framed for it.",
  },
  {
    title: "Read the sourced brief",
    desc: "Every fact carries the page it came from and the quote behind it, so you can check anything that matters before you repeat it.",
  },
  {
    title: "Compare across a portfolio",
    desc: "Run a list of companies through the same template and get a like-for-like table instead of a folder of differently-shaped notes.",
  },
  {
    title: "Share it with the partnership",
    desc: "Publish as a report to a link, to your workspace, or to named email addresses only &mdash; and revoke it when the process closes.",
  },
];

const PERSONAS = [
  { icon: "rocket", label: "Founders" },
  { icon: "briefcase", label: "VC &amp; PE" },
  { icon: "bar-chart", label: "Corp dev &amp; strategy" },
];

const RELATED = [
  { label: "Market Research", path: "/use-cases/market-research" },
  { label: "Account Intelligence", path: "/use-cases/account-intelligence" },
  { label: "Competitive Monitoring", path: "/use-cases/competitive-monitoring" },
];

export default function UseCaseDiligence() {
  useSeo(seoFor("/use-cases/investor-diligence"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Founders &amp; Investors</div>
            <h1>Walk into a first call already knowing the company</h1>
            <p className="uc-direct-answer">
              A pre-meeting diligence brief in the time it takes to read one. DatIQ reads a company&rsquo;s public footprint into what they build, who they sell to, how they price, the traction signals they publish and the team behind them &mdash; and hands you the questions worth asking, with a source behind every claim.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">1</span>
                <span className="uc-stat-label">domain in, one sourced brief out</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">0</span>
                <span className="uc-stat-label">claims without a citation</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start &mdash; no card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What lands in the brief</h2>
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
              The brief will sometimes be shorter than you hoped. A company that does not publish its headcount produces a brief with no headcount in it, because the alternative &mdash; a plausible number with no source &mdash; is the one thing that makes a diligence document dangerous. Every score carries the coverage it was computed from.
            </p>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Brief your next first call</h2>
            <p>
              One domain, one template, one sourced brief. Free to start &mdash; no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/templates")}>
              Run a diligence brief
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
