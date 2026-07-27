// Integrations.jsx — /integrations catalog page
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import NotifyMeModal from "../components/NotifyMeModal.jsx";
import WebhookSetupModal from "../components/WebhookSetupModal.jsx";
import { isWaitlisted } from "../lib/integrationsNotify.js";

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
    action: { label: "Set up", modal: "webhook" },
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
    icon: "layers",
    title: "Airtable",
    slug: "airtable",
    status: "coming-soon",
    desc: "Push extraction rows straight into an Airtable base. Field mapping handles contacts, links, and headings automatically.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "bookmark",
    title: "Notion",
    slug: "notion",
    status: "coming-soon",
    desc: "Export structured extraction data to a Notion database with field mapping.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "table",
    title: "Google Sheets",
    slug: "google-sheets",
    status: "available",
    desc: "Download a CSV and upload to a new Google Sheet — or use 'Open in Google Sheets' from any export dropdown for the one-click path.",
    action: { label: "Open in Sheets", path: "/dashboard" },
  },
  {
    icon: "message-square",
    title: "Slack",
    slug: "slack",
    status: "coming-soon",
    desc: "Get Slack notifications when monitored URLs change or new extractions complete.",
    action: { label: "Notify me", path: null },
  },
  {
    icon: "share",
    title: "Zapier",
    slug: "zapier",
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
  const toast = useToast();
  const [notifyOpen, setNotifyOpen] = useState(null); // { slug, label } or null
  const [webhookOpen, setWebhookOpen] = useState(false);

  const handleNotifyClick = (item) => {
    if (!item.slug) {
      // Legacy: no slug → show a toast instead of a modal.
      toast(`We'll let you know when ${item.title} launches — subscribe on our Blog for updates.`, "info");
      return;
    }
    setNotifyOpen({ slug: item.slug, label: item.title });
  };

  // Dispatch an "available" action by its kind: navigate to a path,
  // or open a modal. Today only Webhook uses a modal; the rest still
  // route to a destination page (e.g. /dashboard for CSV/Sheets).
  const handleAvailableAction = (item) => {
    if (item.action?.modal === "webhook") {
      setWebhookOpen(true);
      return;
    }
    if (item.action?.path) {
      navigate(item.action.path);
    }
  };

  return (
    <div className="page">
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
                        onClick={() => handleAvailableAction(item)}
                      >
                        {item.action.label}
                      </Button>
                    )}
                    {item.action && item.status === "coming-soon" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleNotifyClick(item)}
                      >
                        {isWaitlisted(item.slug) ? "You're on the list" : item.action.label}
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
              href="mailto:admin@datiq.app"
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
              Talk to us — admin@datiq.app
            </a>
          </div>

      </div>

      <NotifyMeModal
        open={Boolean(notifyOpen)}
        slug={notifyOpen?.slug}
        label={notifyOpen?.label}
        onClose={() => setNotifyOpen(null)}
      />
      <WebhookSetupModal
        open={webhookOpen}
        onClose={() => setWebhookOpen(false)}
      />
    </div>
  );
}
