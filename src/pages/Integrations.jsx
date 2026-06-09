// Integrations.jsx — /integrations catalog page
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";

const INTEGRATIONS = [
  {
    icon: "download",
    title: "CSV Export",
    status: "available",
    desc: "Download any extraction or dashboard selection as a clean, structured CSV file. Works on all plans.",
    action: { label: "Use now", path: "/" },
  },
  {
    icon: "file",
    title: "PDF Export",
    status: "available",
    desc: "Generate a formatted PDF report from your extraction data. Ideal for sharing with clients or stakeholders.",
    action: { label: "Use now", path: "/" },
  },
  {
    icon: "zap",
    title: "Webhook / n8n",
    status: "available",
    desc: "Fire a webhook on extraction complete. Integrate DatIQ into any n8n, Make, or Zapier workflow.",
    action: { label: "Use now", path: "/" },
  },
  {
    icon: "mail",
    title: "Email Share",
    status: "available",
    desc: "Email a link or summary of any extraction directly from the Dashboard.",
    action: { label: "Use now", path: "/" },
  },
  {
    icon: "trending-up",
    title: "HubSpot",
    status: "coming-soon",
    desc: "Push contact and company enrichment data directly to HubSpot CRM. Auto-create contacts and enrich existing records.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "database",
    title: "Salesforce",
    status: "coming-soon",
    desc: "Sync extracted leads and company data to Salesforce. Map DatIQ fields to custom Salesforce objects.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "bookmark",
    title: "Notion",
    status: "coming-soon",
    desc: "Export structured extraction data to a Notion database with field mapping.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "table",
    title: "Google Sheets",
    status: "coming-soon",
    desc: "Send extraction results to a connected Google Sheet — auto-append rows on every new extraction.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "message-square",
    title: "Slack",
    status: "coming-soon",
    desc: "Get Slack notifications when monitored URLs change or new extractions complete.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "share",
    title: "Zapier",
    status: "coming-soon",
    desc: "Connect DatIQ to 5,000+ apps via Zapier. Trigger zaps on new extractions, enrichments, or monitoring alerts.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "code",
    title: "API Access",
    status: "agency-plan",
    desc: "Programmatic access to all extraction and enrichment capabilities. Full REST API with JSON responses.",
    action: { label: "See Agency plan", path: "/pricing" },
  },
  {
    icon: "globe",
    title: "Browser Extension",
    status: "roadmap",
    desc: "Right-click any page and extract with DatIQ — no URL copying needed.",
    action: null,
  },
];

const STATUS_META = {
  available:    { label: "Available",    cls: "int-status-available" },
  "coming-soon": { label: "Coming Soon", cls: "int-status-coming"   },
  "agency-plan": { label: "Agency Plan", cls: "int-status-agency"   },
  roadmap:       { label: "Roadmap",     cls: "int-status-roadmap"  },
};

export default function Integrations() {
  const navigate = useNavigate();

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <main id="main-content" className="page">
        <div className="int-page container">

          {/* Hero */}
          <div className="int-hero rise">
            <div className="eyebrow">Integrations</div>
            <h1>Connect DatIQ to your workflow</h1>
            <p>Export extracted data directly to your CRM, spreadsheet, or communication tools.</p>
          </div>

          {/* Integration cards */}
          <div className="int-grid fade">
            {INTEGRATIONS.map((item) => {
              const meta = STATUS_META[item.status];
              return (
                <div key={item.title} className="int-card">
                  <div className="int-card-head">
                    <div className="int-card-icon">
                      <Icon name={item.icon} size={22} />
                    </div>
                    <div className="int-card-title">{item.title}</div>
                  </div>
                  <p className="int-card-desc">{item.desc}</p>
                  <div className="int-card-foot">
                    <span className={`int-status ${meta.cls}`}>{meta.label}</span>
                    {item.action && item.status === "available" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(item.action.path)}
                      >
                        {item.action.label}
                      </Button>
                    )}
                    {item.action && item.status === "coming-soon" && (
                      <Button variant="ghost" size="sm" onClick={() => {}}>
                        {item.action.label}
                      </Button>
                    )}
                    {item.action && item.status === "agency-plan" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(item.action.path)}
                      >
                        {item.action.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom integration CTA */}
          <div className="int-custom rise">
            <h2>Need a custom integration?</h2>
            <p>
              Have a specific CRM, data warehouse, or internal tool you want to connect? We're happy to
              discuss custom integration options for Agency plan customers.
            </p>
            <a
              href="mailto:support@datiq.app"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                fontWeight: 700,
                color: "var(--accent)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                fontSize: ".95em",
              }}
            >
              <Icon name="mail" size={16} />
              Talk to us — support@datiq.app
            </a>
          </div>

        </div>
      </main>
    </>
  );
}
