// UseCaseRecruiting.jsx — /use-cases/recruiting landing page
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";

const WHAT_YOU_GET = [
  {
    icon: "users",
    title: "Leadership and team structure",
    desc: "Names, role titles and published contact details where a company exposes them &mdash; from team, leadership and board pages.",
  },
  {
    icon: "building",
    title: "A company you can describe",
    desc: "What they do, who they serve, how they position themselves, and the proof points they lead with. Enough to answer &ldquo;why should I move?&rdquo; credibly.",
  },
  {
    icon: "eye",
    title: "A watch on their hiring pages",
    desc: "Put a careers page under a watchlist and hear about a new opening or a team expansion when it happens, not when it is on a job board.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Paste the company domain",
    desc: "Or upload a list of the accounts on your desk and run them together.",
  },
  {
    title: "Pull the brief",
    desc: "The account brief template returns positioning, firmographics, proof points and contacts in one pass.",
  },
  {
    title: "Watch what changes",
    desc: "Add their careers or leadership page to a watchlist so a departure or a new opening reaches you first.",
  },
  {
    title: "Share it with the candidate",
    desc: "Publish the brief as a report at its own link, with the access level you choose, and send it before the call.",
  },
];

const PERSONAS = [
  { icon: "users", label: "Agency recruiters" },
  { icon: "briefcase", label: "In-house talent" },
  { icon: "target", label: "Executive search" },
];

const RELATED = [
  { label: "Lead Generation", path: "/use-cases/lead-generation" },
  { label: "Account Intelligence", path: "/use-cases/account-intelligence" },
  { label: "Market Research", path: "/use-cases/market-research" },
];

export default function UseCaseRecruiting() {
  useSeo(seoFor("/use-cases/recruiting"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

          {/* Hero */}
          <div className="uc-hero rise">
            <div className="eyebrow">Use Case · Talent &amp; Recruiting</div>
            <h1>Research a company properly before you pitch a candidate on it</h1>
            <p className="uc-direct-answer">
              Recruiters lose candidates to vague answers. DatIQ turns a company&rsquo;s public site into a briefing you can actually use in a call &mdash; what they build, who they sell to, how they are funded and positioned, who leads which function, and where the hiring pages and team pages actually are.
            </p>
            <div className="uc-stats">
              <div className="uc-stat">
                <span className="uc-stat-num">500</span>
                <span className="uc-stat-label">companies per bulk run</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">H1&ndash;H6</span>
                <span className="uc-stat-label">full site structure and links</span>
              </div>
              <div className="uc-stat">
                <span className="uc-stat-num">$0</span>
                <span className="uc-stat-label">to start &mdash; no card</span>
              </div>
            </div>
          </div>

          {/* What you get */}
          <div className="uc-section fade">
            <h2>What you get before the call</h2>
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
              DatIQ surfaces what a company publishes publicly &mdash; team pages, leadership pages, press contacts. It does not generate or guess personal email addresses, and a detail it could not find is reported as absent rather than filled in. A briefing you can stand behind is worth more than a fuller one you cannot.
            </p>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Brief yourself before the next call</h2>
            <p>
              Run one company through the account brief and see what you would have walked in without. Free to start &mdash; no credit card required.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/templates")}>
              Run a company brief
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
