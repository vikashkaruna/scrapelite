// IntegrationConnectModal.jsx
//
// Generic modal for connecting a 3rd-party integration. Takes a `provider`
// config that declares the title, icon, help text, and the list of fields
// to render. Renders a form with the right fields per provider, calls
// POST /api/integrations/{provider}/connect, and on success emits a
// `connected` event so the parent can refresh status.
//
// Usage:
//   <IntegrationConnectModal
//     open={open}
//     provider={PROVIDERS.hubspot}
//     onClose={() => setOpen(false)}
//     onConnected={() => refreshStatus()}
//   />
//
// Each provider has its own field shape — see PROVIDERS below for the 5
// supported integrations: hubspot, notion, airtable, slack, zapier.

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

const PROVIDERS = {
  hubspot: {
    slug: "hubspot",
    title: "Connect HubSpot",
    icon: "trending-up",
    desc: "Push contacts and companies from your extractions directly to your HubSpot CRM.",
    fields: [
      {
        key: "accessToken",
        label: "HubSpot Private App token",
        type: "password",
        placeholder: "pat-na1-...",
        required: true,
        help: "Create one in HubSpot → Settings → Integrations → Private Apps. Required scopes: crm.objects.contacts.{read,write} + crm.objects.companies.{read,write}.",
      },
      {
        key: "accountLabel",
        label: "Account label (optional)",
        type: "text",
        placeholder: "e.g. ACME Hub",
        required: false,
      },
    ],
  },
  notion: {
    slug: "notion",
    title: "Connect Notion",
    icon: "bookmark",
    desc: "Push extraction pages to a Notion database. We'll fetch the schema and auto-map fields.",
    fields: [
      {
        key: "apiKey",
        label: "Notion Internal Integration secret",
        type: "password",
        placeholder: "secret_... or ntn_...",
        required: true,
        help: "Get one at notion.so/my-integrations. Capabilities: Read + Update + Insert content. Share the target database with the integration.",
      },
      {
        key: "databaseId",
        label: "Database ID",
        type: "text",
        placeholder: "32-char UUID (with or without dashes)",
        required: true,
        help: "Open the database in Notion — the ID is the UUID in the URL.",
      },
    ],
  },
  airtable: {
    slug: "airtable",
    title: "Connect Airtable",
    icon: "layers",
    desc: "Push extraction rows to an Airtable base. Field mapping handles contacts, links, and headings.",
    fields: [
      {
        key: "apiKey",
        label: "Airtable Personal Access Token",
        type: "password",
        placeholder: "pat...",
        required: true,
        help: "Create one at airtable.com/create/tokens. Scopes: data.records.{read,write} + schema.bases:read. Grant access to your target base.",
      },
      {
        key: "baseId",
        label: "Base ID",
        type: "text",
        placeholder: "app...",
        required: true,
        help: "Open the base in Airtable — the ID starts with 'app' and is in the URL.",
      },
      {
        key: "tableId",
        label: "Table ID",
        type: "text",
        placeholder: "tbl...",
        required: true,
        help: "Open a specific table — the ID starts with 'tbl' and is in the URL.",
      },
    ],
  },
  slack: {
    slug: "slack",
    title: "Connect Slack",
    icon: "message-square",
    desc: "Get Slack notifications when a tracked URL changes or a new extraction completes.",
    fields: [
      {
        key: "webhookUrl",
        label: "Slack Incoming Webhook URL",
        type: "password",
        placeholder: "https://hooks.slack.com/services/...",
        required: true,
        help: "Create one in Slack → Apps → Incoming Webhooks. Pick the channel you want notifications in.",
      },
    ],
  },
  zapier: {
    slug: "zapier",
    title: "Connect Zapier",
    icon: "share",
    desc: "Generate a DatIQ Zapier token. Paste it into Zapier when installing the DatIQ private app.",
    fields: [
      {
        key: "_regenerate",
        label: "Action",
        type: "select",
        options: [
          { value: "generate", label: "Generate a new token" },
          { value: "regenerate", label: "Replace the existing token" },
        ],
        required: true,
        help: "The plaintext token is shown ONCE. Copy it into Zapier immediately. DatIQ stores only the SHA-256 hash.",
      },
    ],
  },
};

export default function IntegrationConnectModal({ open, provider, onClose, onConnected, onTokenMinted }) {
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      setValues({});
      setError(null);
      setSuccess(null);
    }
  }, [open]);

  if (!open || !provider) return null;

  const config = PROVIDERS[provider];
  if (!config) {
    return (
      <div className="icm-backdrop" onClick={onClose}>
        <div className="icm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="icm-head">
            <h3>Unknown provider: {provider}</h3>
            <button className="icm-close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
        </div>
      </div>
    );
  }

  const setField = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      // For Zapier, "generate" vs "regenerate" maps to { regenerate: true } or { regenerate: false }
      let body;
      if (provider === "zapier") {
        const regen = values._regenerate === "regenerate";
        body = { regenerate: regen };
      } else {
        body = {};
        for (const f of config.fields) {
          if (values[f.key] != null) body[f.key] = values[f.key];
        }
      }
      // Always include the action in the body so the server-side function
      // can dispatch even when the URL sub-path is dropped by Netlify's
      // redirect engine (2026-08-10 production bug — see handoff §15).
      body.action = "connect";

      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      if (!session?.access_token) {
        setError("You must be signed in to connect an integration.");
        setSubmitting(false);
        return;
      }

      const res = await fetch(`/api/integrations/${provider}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }

      // For Zapier, the response includes the plaintext token — show it once
      if (provider === "zapier" && data.token) {
        setSuccess({
          kind: "zapier-token",
          token: data.token,
        });
        if (onTokenMinted) onTokenMinted(data.token);
        if (onConnected) onConnected();
        setSubmitting(false);
        return;
      }

      setSuccess({ kind: "connected" });
      if (onConnected) onConnected();
      setSubmitting(false);
    } catch (err) {
      setError(err?.message || "Network error");
      setSubmitting(false);
    }
  };

  return (
    <div className="icm-backdrop" onClick={onClose}>
      <div className="icm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="icm-head">
          <div className="icm-head-icon">
            <Icon name={config.icon} size={20} />
          </div>
          <div>
            <h3>{config.title}</h3>
            <p className="icm-desc">{config.desc}</p>
          </div>
          <button className="icm-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        {success?.kind === "zapier-token" ? (
          <div className="icm-body">
            <div className="icm-success">
              <Icon name="check-circle" size={18} />
              <strong>Token generated.</strong> Copy it now — it won't be shown again.
            </div>
            <div className="icm-token-box">
              <code>{success.token}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard?.writeText(success.token);
                }}
              >
                Copy
              </Button>
            </div>
            <p className="icm-help">
              In Zapier, install the DatIQ private app, then paste this token
              when prompted. DatIQ stores only the SHA-256 hash; if you lose
              it, click "Replace" to generate a new one.
            </p>
            <div className="icm-foot">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : success?.kind === "connected" ? (
          <div className="icm-body">
            <div className="icm-success">
              <Icon name="check-circle" size={18} />
              <strong>Connected.</strong> {config.title.replace("Connect ", "")} is now wired up.
            </div>
            <div className="icm-foot">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form className="icm-body" onSubmit={handleSubmit}>
            {error && (
              <div className="icm-error">
                <Icon name="alert-circle" size={15} />
                <span>{error}</span>
              </div>
            )}

            {config.fields.map((f) => (
              <div key={f.key} className="icm-field">
                <label htmlFor={`icm-${f.key}`}>
                  {f.label}
                  {f.required && <span className="icm-required">*</span>}
                </label>
                {f.type === "select" ? (
                  <select
                    id={`icm-${f.key}`}
                    value={values[f.key] || f.options[0].value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    required={f.required}
                  >
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`icm-${f.key}`}
                    type={f.type}
                    value={values[f.key] || ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    required={f.required}
                    autoComplete="off"
                  />
                )}
                {f.help && <p className="icm-help">{f.help}</p>}
              </div>
            ))}

            <div className="icm-foot">
              <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Connecting…" : `Connect ${config.title.replace("Connect ", "")}`}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
