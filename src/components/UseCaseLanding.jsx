// UseCaseLanding.jsx — the shared body of a /use-cases/<role> landing page.
//
// The nine older use-case pages each carry their own copy of this markup.
// The role pages added in Phase D2 (plan §22) render through this one
// component instead, so a layout fix is made once. Copy lives in the page
// file as data; every DatIQ claim in it must name a feature that has shipped.
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

export default function UseCaseLanding({ eyebrow, title, answer, stats, whatYouGet, howItWorks, personas, honesty, cta, related }) {
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="uc-page container">
        <div className="uc-hero rise">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p className="uc-direct-answer">{answer}</p>
          <div className="uc-stats">
            {stats.map((s) => (
              <div key={s.label} className="uc-stat">
                <span className="uc-stat-num">{s.num}</span>
                <span className="uc-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="uc-section fade">
          <h2>What you get</h2>
          <div className="uc-three-col">
            {whatYouGet.map((item) => (
              <div key={item.title} className="uc-card">
                <div className="uc-card-icon"><Icon name={item.icon} size={20} /></div>
                <div className="uc-card-title">{item.title}</div>
                <p className="uc-card-desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="uc-section fade">
          <h2>How it works</h2>
          <div className="uc-steps">
            {howItWorks.map((step, i) => (
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

        <div className="uc-section fade">
          <h2>Who uses this</h2>
          <div className="uc-personas">
            {personas.map((p) => (
              <div key={p.label} className="uc-persona-chip">
                <Icon name={p.icon} size={15} />
                {p.label}
              </div>
            ))}
          </div>
        </div>

        {honesty && (
          <div className="uc-section fade">
            <h2>{honesty.title}</h2>
            <p className="uc-card-desc">{honesty.body}</p>
          </div>
        )}

        <div className="uc-cta rise">
          <h2>{cta.title}</h2>
          <p>{cta.body}</p>
          <Button variant="primary" icon="rocket" onClick={() => navigate(cta.to)}>
            {cta.label}
          </Button>
        </div>

        <div className="uc-section" style={{ marginTop: "32px", marginBottom: "0" }}>
          <h2 style={{ fontSize: "1em", fontWeight: 700, marginBottom: "12px", color: "var(--text-2)" }}>
            Related use cases
          </h2>
          <div className="uc-related">
            {related.map((r) => (
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
