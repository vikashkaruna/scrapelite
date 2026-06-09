// VsClay.jsx — /vs/clay comparison page
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const TABLE_ROWS = [
  { criteria: "Pricing", datiq: "$0–$199/mo", other: "$149–$800/mo", datiqWins: true },
  { criteria: "Free tier", datiq: "Yes — 10 extractions/month", other: "No free tier", datiqWins: true },
  { criteria: "Setup", datiq: "Paste a URL — no config", other: "Table setup, integrations config", datiqWins: true },
  { criteria: "Custom extraction", datiq: "Plain English prompts", other: "Column-based waterfall credits", datiqWins: true },
  { criteria: "AI enrichment", datiq: "Built-in (contacts, summary, pricing)", other: "Via Clay AI columns", datiqWins: false },
  { criteria: "CRM push", datiq: "Via webhook / CSV", other: "Native HubSpot, Salesforce", datiqWins: false },
  { criteria: "Team features", datiq: "Business plan ($79/mo)", other: "All plans", datiqWins: false },
  { criteria: "API access", datiq: "Agency plan ($199/mo)", other: "All plans", datiqWins: false },
  { criteria: "Minimum commitment", datiq: "None — monthly, cancel anytime", other: "Annual recommended", datiqWins: true },
];

export default function VsClay() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="vs-page container">

          {/* Hero */}
          <div className="vs-hero rise">
            <div className="eyebrow">Comparison</div>
            <h1>DatIQ vs Clay — AI enrichment at 10% of the price</h1>
            <p className="vs-answer">
              Clay is a powerful CRM enrichment platform starting at $149/month. DatIQ provides similar
              web extraction and AI enrichment capabilities starting free — making it the practical choice
              for solo researchers, small sales teams, and startups who need enrichment data without an
              enterprise contract or waterfall credit system.
            </p>
          </div>

          {/* Comparison table */}
          <div className="uc-section fade">
            <h2>Feature comparison</h2>
            <div className="vs-table">
              <div className="vs-table-head">
                <div className="vs-cell-head">Criteria</div>
                <div className="vs-cell-head">DatIQ</div>
                <div className="vs-cell-head">Clay</div>
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
            <h2>Which tool fits your team?</h2>
            <div className="vs-two-col">
              <div className="vs-side" style={{ borderColor: "var(--accent)" }}>
                <h3>DatIQ is best for…</h3>
                <ul>
                  <li>Solo researchers and freelancers who need fast, ad-hoc web data</li>
                  <li>SDRs under quota who need contacts without a $150/month commitment</li>
                  <li>Startups doing early-stage competitive and market research</li>
                  <li>Agencies running one-off research projects for clients</li>
                  <li>Anyone who finds Clay's credit waterfall system confusing or wasteful</li>
                </ul>
              </div>
              <div className="vs-side">
                <h3>Clay is best for…</h3>
                <ul>
                  <li>Enterprise RevOps teams managing large CRM systems at scale</li>
                  <li>Teams that need native, two-way CRM sync with HubSpot or Salesforce</li>
                  <li>Organisations that want multi-source data waterfall enrichment in one platform</li>
                  <li>Sales teams running high-volume, automated outbound sequences</li>
                </ul>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="uc-cta rise">
            <h2>Try DatIQ free — 10 extractions, no credit card</h2>
            <p>
              Start enriching your prospects and research today with zero commitment. Upgrade when you
              need more — from $9/month, not $149.
            </p>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Try DatIQ free
            </Button>
          </div>

          {/* Related */}
          <div className="uc-section" style={{ marginTop: "32px", marginBottom: "0" }}>
            <h2 style={{ fontSize: "1em", fontWeight: 700, marginBottom: "12px", color: "var(--text-2)" }}>
              More comparisons
            </h2>
            <div className="uc-related">
              <button className="uc-related-link" onClick={() => navigate("/vs/browse-ai")}>
                DatIQ vs Browse.ai
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
