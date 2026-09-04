// UseCaseCompetitiveMonitoring.jsx — /use-cases/competitive-monitoring landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "eye",
    title: "Change with materiality",
    desc: "Critical, high, medium or low. Pricing and tier changes alert immediately; supporting copy is batched; whitespace is recorded and never alerts.",
  },
  {
    icon: "shield",
    title: "Facts kept apart from opinion",
    desc: "The old value, the new value and the page are one thing. What our AI thinks it means strategically is clearly labelled as a reading, so you can take the fact into a pricing meeting.",
  },
  {
    icon: "zap",
    title: "Delivery where you work",
    desc: "Slack, email, a webhook or HubSpot. Every dispatch is recorded whether it succeeded or not, and a destination that was unreachable is retried rather than dropped.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Add the competitors",
    desc: "Name the watchlist, add their domains, and choose how often DatIQ re-reads them.",
  },
  {
    title: "Take the baseline",
    desc: "The first run establishes the starting point and deliberately never alerts. A tool that fires the moment you set it up teaches you to ignore it.",
  },
  {
    title: "Let materiality do the filtering",
    desc: "DatIQ compares each new reading against the last and classifies the difference. You are woken for a price change, not a rotated testimonial.",
  },
  {
    title: "Route it to the team",
    desc: "A rule sends critical pricing changes to a Slack channel, high-materiality positioning shifts to a weekly digest, and anything you like to a webhook.",
  },
];

const PERSONAS = [
  { icon: "eye", label: "Competitive intelligence" },
  { icon: "bar-chart", label: "Product marketing" },
  { icon: "briefcase", label: "Pricing &amp; strategy" },
];

const RELATED = [
  { label: "Competitor Research", path: "/use-cases/competitor-research" },
  { label: "AI Visibility", path: "/use-cases/ai-visibility" },
  { label: "Account Intelligence", path: "/use-cases/account-intelligence" },
];

export default function UseCaseCompetitiveMonitoring() {
  useSeo(seoFor("/use-cases/competitive-monitoring"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Competitive Intelligence</div>
            <h1>Know the day a competitor changes their pricing &mdash; not the quarter</h1>
            <p className="uc-direct-answer">
              A watchlist re-reads the competitor pages you care about on a cadence, works out what actually changed, and classifies how much it matters. A price change alerts immediately. A copyright year never alerts at all. Routing rules push what matters into Slack, your inbox, a webhook, or your CRM.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">4</span>
                <span className="uc-stat-label">materiality levels</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">0</span>
                <span className="uc-stat-label">alerts on the first run &mdash; it is a baseline</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start &mdash; no card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What a watchlist actually gives you</h2>
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
              A field that stopped being observed is not treated as a deletion. If a pricing table was readable last week and is not today, the likely cause is a failed page render, not a competitor removing their pricing &mdash; so DatIQ reports it as unobserved. &ldquo;They deleted all their pricing&rdquo; is the most expensive false positive in this category, and it is not one we will hand you.
            </p>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Put your first competitor under watch</h2>
            <p>
              Add a domain, pick a cadence, and let the baseline settle. Free to start &mdash; no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/watchlists")}>
              Create a watchlist
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
