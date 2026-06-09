// VsBrowseAI.jsx — /vs/browse-ai comparison page
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const TABLE_ROWS = [
  { criteria: "Pricing", datiq: "Free–$199/mo", other: "$19–$99/mo", datiqWins: true },
  { criteria: "Setup required", datiq: "None — paste a URL", other: "Per-site robot recording", datiqWins: true },
  { criteria: "Custom fields", datiq: "Plain English prompts", other: "Visual point-and-click", datiqWins: true },
  { criteria: "AI enrichment", datiq: "Built-in (contacts, summary, pricing)", other: "Not included", datiqWins: true },
  { criteria: "Export", datiq: "CSV + PDF", other: "CSV", datiqWins: true },
  { criteria: "Team features", datiq: "Business plan", other: "All plans", datiqWins: false },
  { criteria: "API access", datiq: "Agency plan", other: "All plans", datiqWins: false },
  { criteria: "Browser extension", datiq: "Roadmap", other: "Yes", datiqWins: false },
];

export default function VsBrowseAI() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="vs-page container">

          {/* Hero */}
          <div className="vs-hero rise">
            <div className="eyebrow">Comparison</div>
            <h1>DatIQ vs Browse.ai — which web extraction tool is right for you?</h1>
            <p className="vs-answer">
              DatIQ and Browse.ai both extract data from websites, but take different approaches.
              Browse.ai uses visual robot recorders that require setup per site. DatIQ uses AI to
              extract any field you describe in plain English — no per-site configuration, no recording
              sessions. DatIQ is also significantly cheaper, starting free vs Browse.ai's $19/month minimum.
            </p>
          </div>

          {/* Comparison table */}
          <div className="uc-section fade">
            <h2>Feature comparison</h2>
            <div className="vs-table">
              <div className="vs-table-head">
                <div className="vs-cell-head">Criteria</div>
                <div className="vs-cell-head">DatIQ</div>
                <div className="vs-cell-head">Browse.ai</div>
              </div>
              {TABLE_ROWS.map((row) => (
                <div key={row.criteria} className="vs-table-row">
                  <div className="vs-cell vs-cell-label">{row.criteria}</div>
                  <div className="vs-cell vs-cell-datiq">
                    {row.datiq}
                    {row.datiqWins && (
                      <span className="vs-win vs-win-datiq" style={{ marginLeft: "8px" }}>
                        <Icon name="check" size={12} strokeWidth={3} />
                        Better
                      </span>
                    )}
                  </div>
                  <div className="vs-cell vs-cell-other">{row.other}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Who should choose each */}
          <div className="uc-section fade">
            <h2>Which tool fits your workflow?</h2>
            <div className="vs-two-col">
              <div className="vs-side" style={{ borderColor: "var(--accent)" }}>
                <h3>Choose DatIQ if you…</h3>
                <ul>
                  <li>Need to extract data from many different sites without per-site setup</li>
                  <li>Want AI enrichment built into the same workflow (contacts, summaries, custom fields)</li>
                  <li>Prefer plain-English prompts over visual recorders</li>
                  <li>Are a solo researcher, SDR, analyst, or small team on a budget</li>
                  <li>Need both CSV and PDF export options</li>
                </ul>
              </div>
              <div className="vs-side">
                <h3>Choose Browse.ai if you…</h3>
                <ul>
                  <li>Need recurring, scheduled robots that run against specific sites automatically</li>
                  <li>Prefer a visual point-and-click interface over text prompts</li>
                  <li>Need a browser extension as part of your workflow</li>
                  <li>Already have team access requirements from day one</li>
                </ul>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Try DatIQ free — no credit card required</h2>
            <p>
              Start with 10 extractions per month, free forever. No credit card, no setup, no recording sessions.
              Paste a URL and get structured data in under 30 seconds.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Try DatIQ free
            </Button>
          </div>

          {/* Related comparisons */}
          <div className="uc-section" style={{ marginTop: "32px", marginBottom: "0" }}>
            <h2 style={{ fontSize: "1em", fontWeight: 700, marginBottom: "12px", color: "var(--text-2)" }}>
              More comparisons
            </h2>
            <div className="uc-related">
              <button className="uc-related-link" onClick={() => navigate("/vs/clay")}>
                DatIQ vs Clay
              </button>
              <button className="uc-related-link" onClick={() => navigate("/pricing")}>
                See DatIQ pricing
              </button>
            </div>
          </div>

      </div>
    </div>
  );
}
