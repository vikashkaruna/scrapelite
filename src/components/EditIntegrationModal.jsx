// EditIntegrationModal.jsx
//
// Per-provider modal for editing an existing integration connection.
// Renders the editable fields for the given provider, calls PATCH
// /api/integrations/{slug}/connect (or POST /connect for Zapier/HubSpot
// token rotation), and on success emits a `saved` event so the parent
// can refresh its status map.
//
// Per-provider editable fields (all other connection state is server-
// managed and never editable from the client):
//
//   HubSpot   — accountLabel only. Token rotation is a destructive
//               action handled by a separate "Replace token" mini-form
//               (see below) — never an inline edit. PATCH refuses token
//               changes; the only way to rotate is a fresh POST /connect.
//
//   Notion    — accountLabel, databaseId. PATCH /connect accepts both
//               and re-fetches the schema on save.
//
//   Airtable  — accountLabel, baseId, tableId. PATCH /connect with
//               refreshSchema:true to re-fetch + auto-map the field
//               map for the new table.
//
//   Slack     — accountLabel, webhookUrl. PATCH /connect with both;
//               server probes the new webhook first (same as initial
//               connect) and surfaces Slack 4xx as a clear error.
//
//   Zapier    — accountLabel is fixed ("Zapier") and not editable. The
//               only action is "Generate new token" which POSTs
//               /connect with regenerate:true and shows the plaintext
//               once (the server only stores the SHA-256 hash).
//
// Usage:
//   <EditIntegrationModal
//     open={!!editSlug}
//     slug="airtable"
//     status={intStatus["airtable"]}
//     onClose={() => setEditSlug(null)}
//     onSaved={() => refreshIntegrations()}
//   />

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import {
  patchIntegrationConnection,
  fetchAirtableTablesClient,
  createAirtableTableClient,
} from "../lib/integrationsClient.js";

// Editable field shape per provider. Each entry says what to render in
// the modal body and how to serialize it into a PATCH body. `kind` is
// the input widget — text inputs use a plain <input>, password inputs
// mask the value. HubSpot's token input is "replace-only" so it's a
// separate mini-form, not a regular field.
const PROVIDER_FIELDS = {
  hubspot: [
    { key: "accountLabel", label: "Account label", kind: "text", placeholder: "e.g. ACME Hub" },
  ],
  notion: [
    { key: "accountLabel", label: "Account label", kind: "text", placeholder: "Notion" },
    { key: "databaseId",   label: "Database ID",   kind: "text", placeholder: "32-char UUID (with or without dashes)" },
  ],
  airtable: [
    { key: "accountLabel", label: "Account label", kind: "text", placeholder: "Airtable" },
    { key: "baseId",       label: "Base ID",       kind: "text", placeholder: "app..." },
    { key: "tableId",      label: "Table ID",      kind: "text", placeholder: "tbl..." },
  ],
  slack: [
    { key: "accountLabel", label: "Account label", kind: "text", placeholder: "Slack" },
    { key: "webhookUrl",   label: "Webhook URL",   kind: "text", placeholder: "https://hooks.slack.com/services/..." },
  ],
  zapier: [
    // Zapier has no editable fields — the "Generate new token" action
    // is the only thing the modal does. Listed here for completeness so
    // the field renderer doesn't crash; the component short-circuits
    // before reaching it (see render()).
  ],
};

const PROVIDER_META = {
  hubspot:  { title: "Edit HubSpot",  icon: "trending-up",   saveLabel: "Save changes" },
  notion:   { title: "Edit Notion",   icon: "bookmark",      saveLabel: "Save & refresh schema" },
  airtable: { title: "Edit Airtable", icon: "layers",        saveLabel: "Save & refresh schema" },
  slack:    { title: "Edit Slack",    icon: "message-square", saveLabel: "Save changes" },
  zapier:   { title: "Edit Zapier",   icon: "share",         saveLabel: "Generate new token" },
};

// Map our internal field keys → PATCH /connect body keys. Keeps the
// server's body contract localized to one place.
function buildPatchBody(slug, values) {
  const body = { action: "connect" };
  if (slug === "hubspot") {
    if (values.accountLabel) body.accountLabel = values.accountLabel;
  } else if (slug === "notion") {
    if (values.accountLabel) body.accountLabel = values.accountLabel;
    if (values.databaseId)   body.databaseId = values.databaseId;
    body.refreshSchema = true; // re-fetch on every save so the column count + title column stay fresh
  } else if (slug === "airtable") {
    if (values.accountLabel) body.accountLabel = values.accountLabel;
    if (values.baseId)       body.baseId = values.baseId;
    if (values.tableId)      body.tableId = values.tableId;
    body.refreshSchema = true; // critical: re-fetch + auto-map on every save
  } else if (slug === "slack") {
    if (values.accountLabel) body.accountLabel = values.accountLabel;
    if (values.webhookUrl)   body.webhookUrl = values.webhookUrl;
  }
  return body;
}

export default function EditIntegrationModal({ open, slug, status, onClose, onSaved }) {
  const [values, setValues]         = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [success, setSuccess]       = useState(null);

  // Token rotation sub-state (HubSpot only). A separate input so the
  // user can paste a new token without it being clobbered by the
  // accountLabel form state.
  const [newToken, setNewToken]         = useState("");
  const [replacingToken, setReplacingToken] = useState(false);

  // Zapier token mint sub-state. The server returns the plaintext
  // token exactly once — we show it in a copy box like the connect
  // flow.
  const [mintedToken, setMintedToken]   = useState(null);
  const [mintingToken, setMintingToken] = useState(false);

  // Airtable dynamic table discovery & creation state
  const [airtableTables, setAirtableTables]   = useState([]);
  const [loadingTables, setLoadingTables]     = useState(false);
  const [creatingTable, setCreatingTable]     = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [newTableName, setNewTableName]       = useState("DatIQ Extractions");

  // Reset state on open/close.
  useEffect(() => {
    if (open && status?.connection) {
      setValues({
        accountLabel: status.connection.account_label || "",
        databaseId:   status.connection.database_id   || "",
        baseId:       status.connection.base_id       || "",
        tableId:      status.connection.table_id      || "",
        webhookUrl:   status.connection.webhook_hint  || "", // hint, not the full URL — user can re-paste
      });
      setError(null);
      setSuccess(null);
      setNewToken("");
      setReplacingToken(false);
      setMintedToken(null);
      setMintingToken(false);
      setShowCreateTable(false);
      setNewTableName("DatIQ Extractions");
    }
  }, [open, status]);

  // Load Airtable tables dynamically when modal opens for Airtable or when baseId changes
  useEffect(() => {
    if (open && slug === "airtable" && values.baseId && /^app[A-Za-z0-9]{8,}$/i.test(values.baseId.trim())) {
      let alive = true;
      setLoadingTables(true);
      fetchAirtableTablesClient(values.baseId.trim())
        .then((res) => {
          if (alive && res.ok && Array.isArray(res.tables)) {
            setAirtableTables(res.tables);
          }
        })
        .finally(() => {
          if (alive) setLoadingTables(false);
        });
      return () => { alive = false; };
    }
  }, [open, slug, values.baseId]);

  const handleCreateAirtableTable = async (e) => {
    if (e) e.preventDefault();
    if (!values.baseId) {
      setError("Base ID is required to create a table.");
      return;
    }
    const nameToCreate = newTableName.trim() || "DatIQ Extractions";
    setCreatingTable(true);
    setError(null);
    try {
      const res = await createAirtableTableClient({
        baseId: values.baseId.trim(),
        tableName: nameToCreate,
      });
      if (!res.ok) {
        setError(res.error || "Failed to create table in Airtable.");
        return;
      }
      setAirtableTables((prev) => [
        ...prev.filter((t) => t.id !== res.tableId),
        { id: res.tableId, name: res.tableName, fields: res.fields },
      ]);
      setField("tableId", res.tableId);
      setShowCreateTable(false);
      setSuccess({ kind: "table_created", tableName: res.tableName });
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err?.message || "Network error while creating table.");
    } finally {
      setCreatingTable(false);
    }
  };

  if (!open || !slug) return null;
  const config = PROVIDER_META[slug];
  if (!config) return null;
  const fields = PROVIDER_FIELDS[slug] || [];
  const connection = status?.connection || {};

  const setField = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const body = buildPatchBody(slug, values);
      const result = await patchIntegrationConnection(slug, body);
      if (!result?.ok) {
        setError(result?.error || "Save failed");
        setSubmitting(false);
        return;
      }
      setSuccess({ kind: "saved" });
      if (onSaved) await onSaved();
      // Auto-close on success after a short pause so the user sees
      // the "Saved" confirmation.
      setTimeout(() => {
        if (onClose) onClose();
      }, 600);
    } catch (err) {
      setError(err?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  // HubSpot token rotation — POST /connect with a new accessToken.
  // The server REPLACES the existing connection (overwrites the token
  // hash + token_hint) on success, so we refresh status and close.
  const handleReplaceToken = async (e) => {
    if (e) e.preventDefault();
    if (!newToken || newToken.length < 20) {
      setError("Paste the new Private App token first (minimum 20 characters).");
      return;
    }
    setError(null);
    setReplacingToken(true);
    try {
      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      if (!session?.access_token) {
        setError("You must be signed in to replace the token.");
        setReplacingToken(false);
        return;
      }
      const r = await fetch(`/api/integrations/${slug}/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: "same-origin",
        body: JSON.stringify({
          accessToken: newToken,
          accountLabel: values.accountLabel || connection.account_label || "HubSpot",
          action: "connect",
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) {
        setError(data.error || `HTTP ${r.status}`);
        setReplacingToken(false);
        return;
      }
      setNewToken("");
      setReplacingToken(false);
      if (onSaved) await onSaved();
      setSuccess({ kind: "saved" });
      setTimeout(() => { if (onClose) onClose(); }, 600);
    } catch (err) {
      setError(err?.message || "Network error");
      setReplacingToken(false);
    }
  };

  // Zapier — mint a new token. The server returns it once in plaintext
  // and stores only the SHA-256 hash. We show it in a copy box; the
  // modal stays open until the user clicks "Done" so they don't lose
  // the token if the toast times out.
  const handleGenerateToken = async () => {
    setError(null);
    setMintingToken(true);
    try {
      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      if (!session?.access_token) {
        setError("You must be signed in to generate a token.");
        setMintingToken(false);
        return;
      }
      const r = await fetch(`/api/integrations/zapier/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        credentials: "same-origin",
        body: JSON.stringify({ regenerate: true, action: "connect" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) {
        setError(data.error || `HTTP ${r.status}`);
        setMintingToken(false);
        return;
      }
      setMintedToken(data.token || null);
      if (onSaved) await onSaved();
    } catch (err) {
      setError(err?.message || "Network error");
    } finally {
      setMintingToken(false);
    }
  };

  // Zapier has its own body shape — only the "Generate new token"
  // action, no editable fields. Render a focused variant.
  if (slug === "zapier") {
    return (
      <div className="icm-backdrop" onClick={onClose}>
        <div className="icm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="icm-head">
            <div className="icm-head-icon"><Icon name={config.icon} size={20} /></div>
            <div>
              <h3>{config.title}</h3>
              <p className="icm-desc">
                Generate a fresh Zapier token. Your previous token is invalidated the moment a new one is issued.
                The plaintext is shown ONCE — copy it into Zapier immediately.
              </p>
            </div>
            <button className="icm-close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
          </div>
          <div className="icm-body">
            {error && (
              <div className="icm-error">
                <Icon name="alert-circle" size={15} /><span>{error}</span>
              </div>
            )}
            {mintedToken ? (
              <>
                <div className="icm-success">
                  <Icon name="check-circle" size={18} /><strong>Token generated.</strong> Copy it now — it won't be shown again.
                </div>
                <div className="icm-token-box">
                  <code>{mintedToken}</code>
                  <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(mintedToken)}>Copy</Button>
                </div>
                <div className="icm-foot">
                  <Button onClick={onClose}>Done</Button>
                </div>
              </>
            ) : (
              <>
                <div className="icm-help" style={{ marginBottom: 12 }}>
                  Current token: {connection.token_hint ? <code>{connection.token_hint}</code> : <em>none</em>}
                  {connection.created_at && (
                    <> · issued {new Date(connection.created_at).toLocaleDateString()}</>
                  )}
                </div>
                <div className="icm-foot">
                  <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
                  <Button onClick={handleGenerateToken} disabled={mintingToken} loading={mintingToken}>
                    {mintingToken ? "Generating…" : "Generate new token"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="icm-backdrop" onClick={onClose}>
      <div className="icm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="icm-head">
          <div className="icm-head-icon"><Icon name={config.icon} size={20} /></div>
          <div>
            <h3>{config.title}</h3>
            <p className="icm-desc">Update the editable parts of this connection. Token / signing secret is not displayed — re-paste it to replace.</p>
          </div>
          <button className="icm-close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        {success?.kind === "saved" ? (
          <div className="icm-body">
            <div className="icm-success">
              <Icon name="check-circle" size={18} /><strong>Saved.</strong> Closing…
            </div>
          </div>
        ) : (
          <form className="icm-body" onSubmit={handleSave}>
            {error && (
              <div className="icm-error">
                <Icon name="alert-circle" size={15} /><span>{error}</span>
              </div>
            )}

            {fields.map((f) => {
              if (slug === "airtable" && f.key === "tableId") {
                return (
                  <div key={f.key} className="icm-field">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <label htmlFor={`eim-${slug}-${f.key}`}>{f.label}</label>
                      <button
                        type="button"
                        style={{ fontSize: "0.82em", background: "none", border: "none", color: "var(--accent, #6366f1)", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                        onClick={() => setShowCreateTable((v) => !v)}
                      >
                        {showCreateTable ? "Cancel new table" : "+ Create new table in Airtable"}
                      </button>
                    </div>

                    {showCreateTable && (
                      <div className="eim-token-rotate" style={{ marginBottom: 10, padding: "8px 10px" }}>
                        <label style={{ fontSize: "0.82em", marginBottom: 4, display: "block" }}>New Table Name</label>
                        <div className="eim-token-rotate-row">
                          <input
                            type="text"
                            value={newTableName}
                            onChange={(e) => setNewTableName(e.target.value)}
                            placeholder="DatIQ Extractions"
                            disabled={creatingTable}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleCreateAirtableTable}
                            loading={creatingTable}
                            disabled={creatingTable || !values.baseId}
                          >
                            Create &amp; select
                          </Button>
                        </div>
                        <p className="icm-help" style={{ margin: "4px 0 0 0", fontSize: "0.78em" }}>
                          Provisions standard columns (URL, Title, Host, Summary, Created at, Headings, Links) directly in your Airtable base.
                        </p>
                      </div>
                    )}

                    {airtableTables.length > 0 ? (
                      <div>
                        <select
                          id={`eim-${slug}-${f.key}`}
                          value={values[f.key] || ""}
                          onChange={(e) => setField(f.key, e.target.value)}
                          className="icm-select"
                        >
                          <option value="">-- Select a table from this base --</option>
                          {airtableTables.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name ? `${t.name} (${t.id})` : t.id}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const selected = airtableTables.find((t) => t.id === values.tableId);
                          if (selected) {
                            return (
                              <p className="icm-help" style={{ margin: "4px 0 0 0", color: "var(--accent, #6366f1)" }}>
                                <Icon name="check" size={11} /> Table "{selected.name}" · {selected.fields?.length || 0} fields detected
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    ) : (
                      <div>
                        <input
                          id={`eim-${slug}-${f.key}`}
                          type={f.kind}
                          value={values[f.key] || ""}
                          onChange={(e) => setField(f.key, e.target.value)}
                          placeholder={loadingTables ? "Loading tables from base…" : f.placeholder}
                          autoComplete="off"
                        />
                        {loadingTables && (
                          <p className="icm-help" style={{ margin: "4px 0 0 0" }}>
                            <Icon name="loader" size={12} className="spin" /> Fetching tables in this base…
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={f.key} className="icm-field">
                  <label htmlFor={`eim-${slug}-${f.key}`}>{f.label}</label>
                  <input
                    id={`eim-${slug}-${f.key}`}
                    type={f.kind}
                    value={values[f.key] || ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    autoComplete="off"
                  />
                </div>
              );
            })}

            {/* Provider-specific extras ─────────────────────────────────── */}

            {/* HubSpot: separate "Replace token" sub-form because the
                existing access token is NEVER displayed (server refuses
                to return it). PATCH /connect also refuses to change the
                token; the only way to rotate is a fresh POST /connect
                with the new accessToken in the body. Inline below the
                regular form so the layout reads top-to-bottom. */}
            {slug === "hubspot" && (
              <div className="eim-token-rotate">
                <div className="eim-token-rotate-head">
                  <Icon name="key" size={13} />
                  <span>Private App token</span>
                  <span className="eim-token-hint">{connection.token_hint || "stored"}</span>
                </div>
                <p className="icm-help" style={{ marginTop: 0, marginBottom: 8 }}>
                  For security, the existing token is never shown. Paste a new token to replace it — the old one is invalidated immediately.
                </p>
                <div className="eim-token-rotate-row">
                  <input
                    type="password"
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="pat-na1-..."
                    autoComplete="off"
                    disabled={replacingToken}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleReplaceToken}
                    loading={replacingToken}
                    disabled={replacingToken || !newToken}
                  >
                    Replace token
                  </Button>
                </div>
              </div>
            )}

            {/* Notion + Airtable: "Save" already passes refreshSchema:true
                so the column count / title column / field map are re-fetched
                server-side. No extra UI needed. */}

            {/* Slack: when the user replaces the webhook, the server
                probes the new URL first (same as initial connect) and
                returns 400 if the URL doesn't look like a Slack
                incoming-webhook. The error above is the surface. */}

            <div className="icm-foot">
              <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
              <Button type="submit" disabled={submitting} loading={submitting}>
                {submitting ? "Saving…" : config.saveLabel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
