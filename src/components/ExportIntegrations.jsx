// src/components/ExportIntegrations.jsx — F18 (export to Google Sheets / Airtable / Notion / Slack).
//
// Council intent: "Where extracted data actually lives for non-technical
// personas; cheapest 'integrations' checkbox."
//
// A single modal that lets the user pick one of four destinations and
// push their selected extractions. The four flows:
//
//   1. Google Sheets — deep link (open a new sheet + download CSV).
//      No credentials needed; the user uploads the CSV via Drive.
//   2. Airtable      — API key + base + table, then POST records.
//   3. Notion        — API key + database ID, then POST pages.
//   4. Slack         — server posts one Block Kit summary message per
//                      item to the user's per-user webhook (no client
//                      credentials needed; Slack was set up at /account).
//
// Credentials are NOT persisted (they're sensitive PATs). Only the
// non-secret parts of the config (Base ID, Table ID, Database ID,
// schema map) survive across sessions. Slack doesn't take client-side
// credentials at all — the server uses the stored per-user webhook.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { openInGoogleSheets } from "../lib/utils.js";
import {
  pushToAirtable,
  readAirtableConfig,
  writeAirtableConfig,
  validateAirtableConfig,
  _internal as airtableInternals,
} from "../lib/airtable.js";
import {
  pushToNotion,
  fetchNotionSchema,
  readNotionConfig,
  writeNotionConfig,
  validateNotionConfig,
  defaultNotionSchema,
  _internal as notionInternals,
} from "../lib/notion.js";
import { getIntegrationStatus, pushToIntegration } from "../lib/integrationsClient.js";

const TABS = [
  { key: "sheets",   label: "Google Sheets", icon: "sheet",          desc: "Open a new sheet, upload the downloaded CSV" },
  { key: "hubspot",  label: "HubSpot",       icon: "trending-up",    desc: "Push contacts + companies to your CRM" },
  { key: "airtable", label: "Airtable",      icon: "table",          desc: "Push records to a base you own" },
  { key: "notion",   label: "Notion",        icon: "book-open",      desc: "Create pages in a database" },
  { key: "slack",    label: "Slack",         icon: "message-square", desc: "Post a summary message per row" },
];

export default function ExportIntegrations({ items, onClose }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const list = Array.isArray(items) ? items.filter((x) => x && x._status !== "error") : [];

  const [tab, setTab] = useState("sheets");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  // Airtable
  const [airtable, setAirtable] = useState(() => ({ ...readAirtableConfig(), apiKey: "" }));
  // Notion
  const [notion, setNotion] = useState(() => ({ ...readNotionConfig(), apiKey: "" }));
  const [notionSchema, setNotionSchema] = useState(null); // fetched from the API
  const [notionSchemaLoading, setNotionSchemaLoading] = useState(false);
  // Slack — connection status only (no client-side creds; the server uses
  // the stored per-user webhook). `null` = not yet fetched, `false` =
  // not connected, `true` = connected.
  const [slackConnected, setSlackConnected] = useState(null);
  const [slackAccountLabel, setSlackAccountLabel] = useState(null);
  const [slackStatusLoading, setSlackStatusLoading] = useState(false);
  // HubSpot — same shape as Slack: connection status only, server uses
  // the stored Private App access token. Mirrors the Slack tab so the
  // two "auth lives on the server" providers feel consistent.
  const [hubspotConnected, setHubspotConnected] = useState(null);
  const [hubspotAccountLabel, setHubspotAccountLabel] = useState(null);
  const [hubspotStatusLoading, setHubspotStatusLoading] = useState(false);

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Reset errors when switching tabs
  useEffect(() => { setErrors([]); }, [tab]);

  // Fetch Slack connection status when the user opens the Slack tab.
  // Lazy because the modal can stay open across many tab switches and
  // the user doesn't pay the round-trip cost until they actually consider
  // pushing to Slack. Re-fetches on tab open so a recent connect shows up
  // without a hard reload.
  useEffect(() => {
    if (tab !== "slack") return;
    let cancelled = false;
    setSlackStatusLoading(true);
    getIntegrationStatus("slack")
      .then((s) => {
        if (cancelled) return;
        setSlackConnected(!!s?.connected);
        setSlackAccountLabel(s?.connection?.account_label || null);
      })
      .catch(() => { if (!cancelled) setSlackConnected(false); })
      .finally(() => { if (!cancelled) setSlackStatusLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  // HubSpot — same lazy pattern as Slack. Kept in a separate effect so
  // a HubSpot status failure doesn't surface as a Slack status failure
  // (and so the per-tab loading spinners are independent).
  useEffect(() => {
    if (tab !== "hubspot") return;
    let cancelled = false;
    setHubspotStatusLoading(true);
    getIntegrationStatus("hubspot")
      .then((s) => {
        if (cancelled) return;
        setHubspotConnected(!!s?.connected);
        setHubspotAccountLabel(s?.connection?.account_label || null);
      })
      .catch(() => { if (!cancelled) setHubspotConnected(false); })
      .finally(() => { if (!cancelled) setHubspotStatusLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const totalCount = list.length;
  const isEmpty = totalCount === 0;

  // ── Google Sheets flow ─────────────────────────────────────────────────────
  const onExportSheets = () => {
    if (isEmpty) return;
    openInGoogleSheets(list);
    showToast(`Downloaded CSV for ${totalCount} row(s). Upload it in the Google Sheets tab that just opened.`, "sheet");
    onClose?.();
  };

  // ── Airtable flow ─────────────────────────────────────────────────────────
  const onAirtablePush = async () => {
    setErrors([]);
    const validationErrors = validateAirtableConfig(airtable);
    if (validationErrors.length) { setErrors(validationErrors); return; }
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    setBusy(true);
    try {
      // Persist the non-secret parts (Base + Table IDs) for next time.
      writeAirtableConfig({ baseId: airtable.baseId, tableId: airtable.tableId });
      const result = await pushToAirtable(list, {
        apiKey: airtable.apiKey,
        baseId: airtable.baseId,
        tableId: airtable.tableId,
      });
      if (result.ok) {
        showToast(`Pushed ${result.pushed} record(s) to Airtable.`, "check-circle");
        onClose?.();
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "Airtable push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // ── Notion flow ──────────────────────────────────────────────────────────
  const onNotionFetchSchema = async () => {
    setErrors([]);
    const validationErrors = validateNotionConfig(notion);
    if (validationErrors.length) { setErrors(validationErrors); return; }
    setNotionSchemaLoading(true);
    try {
      const r = await fetchNotionSchema({ apiKey: notion.apiKey, databaseId: notion.databaseId });
      if (!r.ok) { setErrors([r.error || "Failed to load database schema"]); return; }
      // Build a schema map: every Notion column → rich_text by default,
      // title column gets type "title", url columns get "url".
      const schema = {};
      for (const [name, type] of Object.entries(r.properties || {})) {
        schema[name] = { type, key: name === r.titleColumn ? "page_title" : mapColumnToKey(name) };
      }
      setNotionSchema(schema);
      writeNotionConfig({ databaseId: notion.databaseId, schema });
      showToast(`Loaded schema for "${r.rawTitle || r.titleColumn}" (${Object.keys(schema).length} columns).`, "info");
    } catch (err) {
      setErrors([err?.message || "Notion schema fetch failed"]);
    } finally {
      setNotionSchemaLoading(false);
    }
  };

  const onNotionPush = async () => {
    setErrors([]);
    const validationErrors = validateNotionConfig(notion);
    if (validationErrors.length) { setErrors(validationErrors); return; }
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    setBusy(true);
    try {
      const schema = notionSchema || notion.schema || defaultNotionSchema();
      writeNotionConfig({ databaseId: notion.databaseId, schema });
      const result = await pushToNotion(list, {
        apiKey: notion.apiKey,
        databaseId: notion.databaseId,
        schema,
      });
      if (result.ok) {
        showToast(`Pushed ${result.pushed} page(s) to Notion.`, "check-circle");
        onClose?.();
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "Notion push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // ── Slack flow ──────────────────────────────────────────────────────────
  // One Block Kit message per row, posted to the user's per-user webhook.
  // We don't take any client-side credentials here — Slack was set up at
  // /account#integrations and the server reuses the stored webhook.
  const onSlackSend = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    if (slackConnected === false) {
      setErrors(["Slack is not connected. Open Account → Integrations to set up a webhook first."]);
      return;
    }
    setBusy(true);
    try {
      const result = await pushToIntegration("slack", list);
      if (result.ok) {
        showToast(`Posted ${result.pushed} message${result.pushed !== 1 ? "s" : ""} to Slack.`, "check-circle");
        onClose?.();
      } else if (result.not_connected) {
        // The server's 412 surfaced as a structured not_connected result.
        // Refresh the local status so the UI reflects the truth, then
        // route the user to the setup page on click of the inline link.
        setSlackConnected(false);
        setErrors([result.message || "Slack is not connected."]);
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url || "(row)"}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "Slack push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // HubSpot — same shape as Slack: no client-side creds, server uses the
  // stored Private App access token. The pushToIntegration wrapper
  // already loops per-item (HubSpot's /push endpoint takes a single
  // extraction, not a list) and aggregates failedRecords, so the
  // result shape matches Slack and the error path is identical.
  const onHubSpotPush = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    if (hubspotConnected === false) {
      setErrors(["HubSpot is not connected. Open Account → Integrations to paste a Private App token first."]);
      return;
    }
    setBusy(true);
    try {
      const result = await pushToIntegration("hubspot", list);
      if (result.ok) {
        showToast(`Pushed ${result.pushed} record${result.pushed !== 1 ? "s" : ""} to HubSpot.`, "check-circle");
        onClose?.();
      } else if (result.not_connected) {
        setHubspotConnected(false);
        setErrors([result.message || "HubSpot is not connected."]);
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url || "(row)"}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "HubSpot push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // Close on backdrop click (not while busy).
  const onBackdrop = (e) => { if (e.target === e.currentTarget && !busy) onClose?.(); };

  return (
    <div className="export-int-overlay" onClick={onBackdrop} role="dialog" aria-modal="true" aria-labelledby="export-int-title">
      <div className="export-int-card">
        <header className="export-int-head">
          <div>
            <span className="eyebrow">
              <Icon name="share" size={12} /> Export
            </span>
            <h2 id="export-int-title" className="export-int-title">Send to a destination</h2>
            <p className="export-int-sub">
              {totalCount > 0
                ? `Push ${totalCount} selected row${totalCount !== 1 ? "s" : ""} to Google Sheets, HubSpot, Airtable, Notion, or Slack.`
                : "Select rows on the previous screen first, then choose a destination."}
            </p>
          </div>
          <button
            type="button"
            className="export-int-close"
            onClick={() => onClose?.()}
            disabled={busy}
            aria-label="Close"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="export-int-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={"export-int-tab" + (tab === t.key ? " export-int-tab-active" : "")}
              onClick={() => setTab(t.key)}
              disabled={busy}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="export-int-body">
          {isEmpty && (
            <div className="export-int-empty">
              <Icon name="info" size={18} />
              <span>No rows selected. Select extractions on the previous screen, then come back here.</span>
            </div>
          )}

          {tab === "sheets" && (
            <div className="export-int-pane">
              <p className="export-int-help">
                We&apos;ll download a CSV of your {totalCount} row{totalCount !== 1 ? "s" : ""} and open a new Google Sheet in another tab. From there:
                <strong> File → Import → Upload → select the downloaded CSV.</strong>
              </p>
              <ol className="export-int-steps">
                <li>CSV downloads automatically to your computer.</li>
                <li>Google Sheets opens in a new tab (blank workbook).</li>
                <li>File → Import → Upload the CSV → &quot;Replace current sheet&quot;.</li>
              </ol>
              <div className="export-int-actions">
                <Button variant="primary" icon="sheet" onClick={onExportSheets} disabled={busy || isEmpty}>
                  Open Google Sheets + download CSV
                </Button>
              </div>
            </div>
          )}

          {tab === "airtable" && (
            <div className="export-int-pane">
              <p className="export-int-help">
                Push rows as records in your Airtable base. You&apos;ll need a{" "}
                <a href="https://airtable.com/create/tokens" target="_blank" rel="noopener noreferrer">Personal Access Token</a>
                {" "}with <code>data.records:write</code> scope on the target base.
              </p>
              <div className="export-int-field">
                <label htmlFor="airtable-key">API key</label>
                <input
                  id="airtable-key"
                  type="password"
                  autoComplete="off"
                  placeholder="patXXXXXXXXXXXXXX..."
                  value={airtable.apiKey}
                  onChange={(e) => setAirtable((v) => ({ ...v, apiKey: e.target.value }))}
                  disabled={busy}
                />
                <span className="export-int-hint">Never stored on our servers. Lost when you close this tab.</span>
              </div>
              <div className="export-int-row">
                <div className="export-int-field">
                  <label htmlFor="airtable-base">Base ID</label>
                  <input
                    id="airtable-base"
                    type="text"
                    placeholder="appXXXXXXXXXXXXXX"
                    value={airtable.baseId}
                    onChange={(e) => setAirtable((v) => ({ ...v, baseId: e.target.value }))}
                    disabled={busy}
                  />
                </div>
                <div className="export-int-field">
                  <label htmlFor="airtable-table">Table ID</label>
                  <input
                    id="airtable-table"
                    type="text"
                    placeholder="tblXXXXXXXXXXXXXX"
                    value={airtable.tableId}
                    onChange={(e) => setAirtable((v) => ({ ...v, tableId: e.target.value }))}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="export-int-actions">
                <Button
                  variant="primary"
                  icon="table"
                  onClick={onAirtablePush}
                  disabled={busy || isEmpty}
                  loading={busy}
                >
                  Push {totalCount > 0 ? totalCount : ""} record{totalCount !== 1 ? "s" : ""} to Airtable
                </Button>
              </div>
              <p className="export-int-meta">
                Airtable caps at {airtableInternals.MAX_RECORDS_PER_REQUEST} records per request. We batch automatically (up to {airtableInternals.MAX_REQUESTS_PER_PUSH * airtableInternals.MAX_RECORDS_PER_REQUEST} records per push).
              </p>
            </div>
          )}

          {tab === "notion" && (
            <div className="export-int-pane">
              <p className="export-int-help">
                Create pages in a Notion database. You&apos;ll need an{" "}
                <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer">Internal Integration Secret</a>
                {" "}(<code>secret_…</code>) shared with the target database.
              </p>
              <div className="export-int-field">
                <label htmlFor="notion-key">API key</label>
                <input
                  id="notion-key"
                  type="password"
                  autoComplete="off"
                  placeholder="secret_XXXXXXXXXXXXXX..."
                  value={notion.apiKey}
                  onChange={(e) => setNotion((v) => ({ ...v, apiKey: e.target.value }))}
                  disabled={busy}
                />
                <span className="export-int-hint">Never stored on our servers. Lost when you close this tab.</span>
              </div>
              <div className="export-int-field">
                <label htmlFor="notion-db">Database ID</label>
                <div className="export-int-row">
                  <input
                    id="notion-db"
                    type="text"
                    placeholder="32-char UUID (with or without dashes)"
                    value={notion.databaseId}
                    onChange={(e) => setNotion((v) => ({ ...v, databaseId: e.target.value }))}
                    disabled={busy}
                  />
                  <Button
                    variant="secondary"
                    icon="refresh"
                    onClick={onNotionFetchSchema}
                    loading={notionSchemaLoading}
                    disabled={busy || notionSchemaLoading}
                    title="Fetch the database columns from Notion so we map fields correctly"
                  >
                    Load columns
                  </Button>
                </div>
              </div>
              {notionSchema && (
                <div className="export-int-schema">
                  <div className="export-int-schema-head">
                    <Icon name="check-circle" size={13} />
                    Schema loaded — {Object.keys(notionSchema).length} column{Object.keys(notionSchema).length !== 1 ? "s" : ""}
                  </div>
                  <ul className="export-int-schema-list">
                    {Object.entries(notionSchema).map(([name, def]) => (
                      <li key={name}>
                        <strong>{name}</strong> <span className="export-int-schema-type">{def.type}</span>
                        <span className="export-int-schema-key">← {def.key}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="export-int-actions">
                <Button
                  variant="primary"
                  icon="book-open"
                  onClick={onNotionPush}
                  disabled={busy || isEmpty}
                  loading={busy}
                >
                  Push {totalCount > 0 ? totalCount : ""} page{totalCount !== 1 ? "s" : ""} to Notion
                </Button>
              </div>
              <p className="export-int-meta">
                Notion API version {notionInternals.NOTION_VERSION}. Up to {notionInternals.MAX_REQUESTS_PER_PUSH} pages per push (Notion rate-limits aggressively).
              </p>
            </div>
          )}

          {tab === "hubspot" && (
            <div className="export-int-pane">
              <p className="export-int-help">
                Push contacts and companies from your extractions to your
                HubSpot CRM — one company + contact per row. No API key to
                enter; the server uses the Private App token you set up in
                Account → Integrations.
              </p>

              {hubspotStatusLoading && (
                <div className="export-int-status">
                  <Icon name="loader" size={14} className="push-int-spin" />
                  <span> Checking HubSpot connection…</span>
                </div>
              )}

              {!hubspotStatusLoading && hubspotConnected === true && (
                <div className="export-int-status export-int-status-ok">
                  <Icon name="check-circle" size={14} />
                  <span>
                    Connected{hubspotAccountLabel ? ` as ${hubspotAccountLabel}` : ""}.
                    {" "}We&apos;ll create {totalCount} company + contact pair{totalCount !== 1 ? "s" : ""} in your CRM.
                  </span>
                </div>
              )}

              {!hubspotStatusLoading && hubspotConnected === false && (
                <div className="export-int-status export-int-status-warn">
                  <Icon name="alert-triangle" size={14} />
                  <span>
                    HubSpot isn&apos;t connected yet.{" "}
                    <button
                      type="button"
                      className="export-int-link"
                      onClick={() => { onClose?.(); navigate("/account#integrations"); }}
                    >
                      Paste a Private App token in Account → Integrations
                    </button>
                    , then come back here.
                  </span>
                </div>
              )}

              <div className="export-int-actions">
                <Button
                  variant="primary"
                  icon="trending-up"
                  onClick={onHubSpotPush}
                  disabled={busy || isEmpty || hubspotConnected !== true}
                  loading={busy}
                >
                  Push {totalCount > 0 ? totalCount : ""} record{totalCount !== 1 ? "s" : ""} to HubSpot
                </Button>
              </div>
              <p className="export-int-meta">
                Each row creates one company and one contact in HubSpot,
                linked by the company name. Required scopes on your Private
                App: <code>crm.objects.contacts.write</code> +{" "}
                <code>crm.objects.companies.write</code>.
              </p>
            </div>
          )}

          {tab === "slack" && (
            <div className="export-int-pane">
              <p className="export-int-help">
                Post a Block Kit summary message to your Slack channel — one
                message per selected row. No API key to enter; the server uses
                the webhook you set up in Account → Integrations.
              </p>

              {slackStatusLoading && (
                <div className="export-int-status">
                  <Icon name="loader" size={14} className="push-int-spin" />
                  <span> Checking Slack connection…</span>
                </div>
              )}

              {!slackStatusLoading && slackConnected === true && (
                <div className="export-int-status export-int-status-ok">
                  <Icon name="check-circle" size={14} />
                  <span>
                    Connected{slackAccountLabel ? ` as ${slackAccountLabel}` : ""}.
                    {" "}We&apos;ll post {totalCount} message{totalCount !== 1 ? "s" : ""} to your channel.
                  </span>
                </div>
              )}

              {!slackStatusLoading && slackConnected === false && (
                <div className="export-int-status export-int-status-warn">
                  <Icon name="alert-triangle" size={14} />
                  <span>
                    Slack isn&apos;t connected yet.{" "}
                    <button
                      type="button"
                      className="export-int-link"
                      onClick={() => { onClose?.(); navigate("/account#integrations"); }}
                    >
                      Set up a webhook in Account → Integrations
                    </button>
                    , then come back here.
                  </span>
                </div>
              )}

              <div className="export-int-actions">
                <Button
                  variant="primary"
                  icon="message-square"
                  onClick={onSlackSend}
                  disabled={busy || isEmpty || slackConnected !== true}
                  loading={busy}
                >
                  Post {totalCount > 0 ? totalCount : ""} message{totalCount !== 1 ? "s" : ""} to Slack
                </Button>
              </div>
              <p className="export-int-meta">
                Each message includes the page title, URL, host, and (when
                available) the AI summary, plus a &quot;View in DatIQ&quot;
                deep link.
              </p>
            </div>
          )}

          {errors.length > 0 && (
            <div className="export-int-errors" role="alert">
              <Icon name="alert-triangle" size={14} />
              <ul>
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Map a Notion column name to the extraction key it should pull from.
// Best-effort heuristic — the user can re-map by editing the saved
// schema (UI for that is out of scope for v1).
function mapColumnToKey(name) {
  const n = String(name).toLowerCase();
  if (n === "url" || n === "link" || n === "source url" || n === "source") return "url";
  if (n === "title" || n === "name" || n === "page title") return "page_title";
  if (n === "host" || n === "domain") return "host";
  if (n === "summary" || n === "ai summary" || n === "description") return "ai_summary";
  if (n === "headings" || n === "h1/h2/h3") return "headings";
  if (n === "links" || n === "all links") return "links";
  if (n === "created" || n === "created at" || n === "date" || n === "added on") return "created_at";
  return name; // fallback: use the column name as the extraction key
}
