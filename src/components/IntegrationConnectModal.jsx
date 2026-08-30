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
    fields: [],
    help: "Click Generate to mint a fresh token. The plaintext is shown ONCE — copy it into Zapier immediately. DatIQ stores only the SHA-256 hash, and any previous token you minted is invalidated the moment a new one is issued.",
  },
};

/**
 * Return the first non-empty string-valued field in `obj` (one level deep).
 * Used as a last-resort error message when the server returns a JSON body
 * with no `error` / `errorMessage` / `message` field — we still want to
 * show the user SOMETHING from the body, even if it's an unexpected
 * shape, so they (or we) can debug it.
 */
function pickFirstNonEmptyString(obj) {
  if (!obj || typeof obj !== "object") return null;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function rawBodySnippet(raw) {
  if (!raw || typeof raw !== "string") return null;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 240) return flat;
  return flat.slice(0, 237) + "…";
}

export default function IntegrationConnectModal({
  open,
  provider,
  onClose,
  onConnected,
  onTokenMinted,
}) {
  const config = PROVIDERS[provider] || null;
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [copied, setCopied] = useState(false);

  // Reset state on provider change / modal re-open
  useEffect(() => {
    if (open) {
      setValues({});
      setError(null);
      setSuccess(null);
      setCopied(false);
      setSubmitting(false);
    }
  }, [open, provider]);

  if (!open || !config) return null;

  const setField = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      let body;
      if (provider === "zapier") {
        body = { regenerate: true, webhookUrl: values.webhookUrl || undefined };
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
        // Same-origin by default, but explicit so the Edge Access
        // basic-auth cookie is guaranteed to travel with the request
        // (and so a future bundler change can't strip the default).
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      // Edge Access (Netlify's site-wide basic auth, used on branch
      // deploys) returns 401 with an HTML body that JS-redirects to
      // app.netlify.com/edge-access. The old code's `res.json().catch(() => ({}))`
      // swallowed the HTML, surfaced the bare status as "HTTP 401",
      // and left the user thinking their token was bad. Detect the
      // HTML shape and surface a clear, actionable message — same
      // pattern as apiClient.request() (§20).
      // res.headers.get may be missing in some test mocks; treat that
      // as "no content-type known" and let the JSON path run.
      const getHeader = (h) =>
        typeof res.headers?.get === "function" ? res.headers.get(h) : "";
      const contentType = getHeader("content-type") || "";
      const isHtml = contentType.includes("text/html");
      // Read the body as text first so we always have the raw payload to
      // fall back on. The pre-fix code only did res.json() and discarded
      // anything that wasn't JSON, which is exactly what the 502 modal
      // hit: the function crashed mid-dispatch and Netlify returned an
      // HTML error page or a JSON body with no `error` field (e.g. the
      // unhandled-throw case `{"error":"Internal error: ..."}` was the
      // ONLY JSON shape that had anything usable — the older Airtable
      // and the HubSpot handler both already wrapped that case; Slack /
      // Zapier / Notion did NOT, so the modal ended up with a bare
      // `HTTP 502` and nothing else). Now we parse if we can, and
      // always keep the raw text for the fallback.
      //
      // Fall back to res.json() if res.text() isn't implemented (some
      // test mocks only stub json()). The success path reads data.token
      // for Zapier, so we mustn't drop the parsed body just because
      // text() returned undefined.
      let data = {};
      let rawBody = "";
      if (!isHtml) {
        try {
          rawBody = await res.text();
        } catch { /* nothing to show */ }
        if (rawBody) {
          try { data = JSON.parse(rawBody); } catch { /* not JSON, leave data as {} */ }
        } else {
          // text() wasn't implemented (e.g. a test mock) or returned
          // an empty string. Try json() so the success path can still
          // read its fields.
          try { data = await res.json(); } catch { /* not JSON */ }
        }
      }
      if (!res.ok || data.error) {
        if (isHtml) {
          setError("Site authentication required. Refresh the page and sign in again (the branch deploy uses Netlify Edge Access).");
        } else {
          // Prefer the structured `error` field the server functions all
          // emit. If it's missing (e.g. a Netlify-injected crash body
          // with only `errorMessage` / `message`, or a non-JSON
          // response), pick the most useful available alternative. The
          // user previously saw only `HTTP 502` in this case, which
          // gave them no information. Now the most useful field of the
          // raw body surfaces in the toast, so a future "why is this
          // 502" bug is debuggable from the UI alone.
          const fallback =
            data.error ||
            data.errorMessage ||
            data.message ||
            pickFirstNonEmptyString(data) ||
            rawBodySnippet(rawBody) ||
            `HTTP ${res.status}`;
          // `reason` (added alongside the generic "Invalid or expired
          // session" message) carries the real Supabase getUser() error —
          // e.g. "invalid JWT: unable to parse or verify signature" (a
          // project/key mismatch) vs "JWT expired" (genuine staleness).
          // Both render identically without it, which is why this exact
          // message survived multiple "fixed" sessions — show it inline
          // so the next report is diagnosable from the toast alone.
          setError(data.reason && data.reason !== fallback ? `${fallback} (${data.reason})` : fallback);
        }
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

            {/* Provider-level help (used by providers with no fields, e.g.
                Zapier, where the "form" is just a single confirm button
                and the explanation belongs at the form level, not next to
                a missing input). */}
            {config.fields.length === 0 && config.help && (
              <p className="icm-help icm-help-standalone">{config.help}</p>
            )}

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
