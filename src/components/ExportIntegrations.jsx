// ExportIntegrations.jsx — F18 (export to Google Sheets / HubSpot / Airtable / Notion / Slack).
//
// Council intent: "Where extracted data actually lives for non-technical
// personas; cheapest 'integrations' checkbox."
//
// A single modal that lets the user pick one of five destinations and
// push their selected extractions. The five flows:
//
//   1. Google Sheets — deep link (open a new sheet + download CSV).
//      No credentials needed; the user uploads the CSV via Drive.
//   2. HubSpot      — server uses the stored Private App token; no
//                      client-side form (one-click push).
//   3. Airtable     — server uses the stored PAT + base/table IDs +
//                      per-table field map (one-click push). If the
//                      field_map hasn't been loaded yet, we show a
//                      "Load columns" button that calls PATCH /connect
//                      with refreshSchema:true to fetch + auto-map.
//   4. Notion       — server uses the stored integration secret +
//                      database ID + schema (one-click push).
//   5. Slack        — server posts one Block Kit summary message per
//                      item to the user's per-user webhook (no client
//                      credentials needed; Slack was set up at /account).
//
// 2026-08-11 refactor: the four server-stored tabs (HubSpot, Airtable,
// Notion, Slack) now share a single StatusGatedPushPane pattern. The
// old API-key + Base/Table ID forms for Airtable/Notion are gone — the
// user's credentials live server-side (set up once at /account#integrations)
// and the push uses them. The schema-fetch + auto-map flow moved to
// PATCH /connect on the server, so the modal just calls that endpoint
// when the field_map is empty.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { openInGoogleSheets, excelDownload } from "../lib/utils.js";
import {
  getIntegrationStatus,
  pushToIntegration,
  patchIntegrationConnection,
} from "../lib/integrationsClient.js";

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

  // Per-provider connection status. Lazy-loaded on tab open so we
  // don't pay the round-trip cost on first paint. Each entry has the
  // shape returned by GET /api/integrations/{slug}/status:
  //   { connected: boolean, connection: { account_label, … } }
  // `null` = not yet fetched.
  const [providerStatus, setProviderStatus] = useState({
    hubspot:  null,
    airtable: null,
    notion:   null,
    slack:    null,
  });
  const [providerLoading, setProviderLoading] = useState({
    hubspot:  false,
    airtable: false,
    notion:   false,
    slack:    false,
  });
  // Airtable-specific: "Load columns" button state.
  const [airtableSchemaLoading, setAirtableSchemaLoading] = useState(false);

  // Esc closes the modal
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Reset errors when switching tabs
  useEffect(() => { setErrors([]); }, [tab]);

  // Generic lazy-load for any server-stored provider. Fetches the
  // status on tab open and updates the per-provider entry in state.
  // Cancellable so a fast tab switch doesn't apply a stale result.
  useEffect(() => {
    if (tab === "sheets") return;
    let cancelled = false;
    setProviderLoading((s) => ({ ...s, [tab]: true }));
    getIntegrationStatus(tab)
      .then((s) => {
        if (cancelled) return;
        setProviderStatus((p) => ({ ...p, [tab]: s }));
      })
      .catch(() => { if (!cancelled) setProviderStatus((p) => ({ ...p, [tab]: { connected: false } })); })
      .finally(() => { if (!cancelled) setProviderLoading((s) => ({ ...s, [tab]: false })); });
    return () => { cancelled = true; };
  }, [tab]);

  const totalCount = list.length;
  const isEmpty = totalCount === 0;

  // ── Google Sheets / Spreadsheet flow ──────────────────────────────────────
  const onExportSheets = () => {
    if (isEmpty) return;
    openInGoogleSheets(list);
    showToast(`Copied table to clipboard & downloaded CSV for ${totalCount} row(s). Press Cmd+V (or Ctrl+V) in Google Sheets to paste.`, "sheet");
    onClose?.();
  };

  const onExportExcel = () => {
    if (isEmpty) return;
    excelDownload(list);
    showToast(`Exported ${totalCount} row(s) to Excel Worksheet.`, "sheet");
    onClose?.();
  };

  // ── Airtable flow ──────────────────────────────────────────────────────
  // One-click push using the server-stored PAT + base/table IDs +
  // field_map. If the field_map is empty, the server's push handler
  // falls back to a hard-coded default map (URL/Title/Host/Summary),
  // which 422s on tables with different columns — so we surface a
  // "Load columns" button when the field_map is missing.
  const onAirtablePush = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    setBusy(true);
    try {
      const result = await pushToIntegration("airtable", list);
      if (result.ok) {
        showToast(`Pushed ${result.pushed} record${result.pushed !== 1 ? "s" : ""} to Airtable.`, "check-circle");
        onClose?.();
      } else if (result.not_connected) {
        setProviderStatus((p) => ({ ...p, airtable: { connected: false } }));
        setErrors([result.message || "Airtable is not connected."]);
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url || "(row)"}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "Airtable push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // "Load columns" — call PATCH /connect with refreshSchema:true so
  // the server fetches the table schema and persists a per-table
  // field_map. We re-fetch /status afterwards so the modal shows the
  // new field_map_summary + matched count.
  const onAirtableLoadSchema = async () => {
    setErrors([]);
    setAirtableSchemaLoading(true);
    try {
      const r = await patchIntegrationConnection("airtable", { refreshSchema: true });
      if (!r?.ok) {
        setErrors([r?.error || "Failed to load Airtable columns"]);
        return;
      }
      const matched = r.matched ?? 0;
      const total = r.fieldCount ?? r.fields?.length ?? 0;
      const tableName = r.tableName || "table";
      if (matched === 0) {
        showToast(`Loaded ${total} column(s) from "${tableName}". None auto-matched — rename columns to URL/Title/Host/Summary, or pick a different table.`, "info");
      } else if (matched < total) {
        showToast(`Loaded ${total} column(s) from "${tableName}"; auto-mapped ${matched}.`, "info");
      } else {
        showToast(`Loaded ${total} column(s) from "${tableName}" — all auto-mapped.`, "check-circle");
      }
      // Re-fetch /status so the modal shows the new field_map_summary.
      const s = await getIntegrationStatus("airtable");
      setProviderStatus((p) => ({ ...p, airtable: s }));
    } catch (err) {
      setErrors([err?.message || "Airtable schema fetch failed"]);
    } finally {
      setAirtableSchemaLoading(false);
    }
  };

  // ── Notion flow ────────────────────────────────────────────────────────
  // One-click push using the stored integration secret + database ID +
  // schema. The server's push handler reads the schema from the
  // stored connection and maps extraction fields to Notion columns.
  const onNotionPush = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    setBusy(true);
    try {
      const result = await pushToIntegration("notion", list);
      if (result.ok) {
        showToast(`Pushed ${result.pushed} page${result.pushed !== 1 ? "s" : ""} to Notion.`, "check-circle");
        onClose?.();
      } else if (result.not_connected) {
        setProviderStatus((p) => ({ ...p, notion: { connected: false } }));
        setErrors([result.message || "Notion is not connected."]);
      } else {
        setErrors([...(result.errors || []), ...(result.failedRecords?.slice(0, 3).map((r) => `${r.url || "(row)"}: ${r.error}`) || [])]);
      }
    } catch (err) {
      setErrors([err?.message || "Notion push failed"]);
    } finally {
      setBusy(false);
    }
  };

  // ── HubSpot flow (unchanged) ───────────────────────────────────────────
  const onHubSpotPush = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    if (providerStatus.hubspot?.connected === false) {
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
        setProviderStatus((p) => ({ ...p, hubspot: { connected: false } }));
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

  // ── Slack flow (unchanged) ─────────────────────────────────────────────
  const onSlackSend = async () => {
    setErrors([]);
    if (isEmpty) { setErrors(["No rows to push."]); return; }
    if (providerStatus.slack?.connected === false) {
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
        setProviderStatus((p) => ({ ...p, slack: { connected: false } }));
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

  // Close on backdrop click (not while busy).
  const onBackdrop = (e) => { if (e.target === e.currentTarget && !busy) onClose?.(); };

  // Build a "set up" link for the not-connected case. Closes the
  // modal and navigates to the integrations section of /account.
  const goToSetup = (providerName) => {
    onClose?.();
    navigate("/account#integrations");
    // We don't show a toast here — the user is navigating with intent,
    // and a toast would be redundant with the back-forward jump.
    void providerName;
  };

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
                Your extracted data is automatically copied to your clipboard (and downloaded as a CSV backup).
                Simply switch to the newly opened Google Sheet tab and press <strong>Cmd+V</strong> (or <strong>Ctrl+V</strong>) in cell A1 to paste your table instantly!
              </p>
              <ol className="export-int-steps">
                <li>Table data is automatically copied to your clipboard.</li>
                <li>Google Sheets opens in a new tab with cell A1 focused.</li>
                <li>Press <strong>Cmd+V / Ctrl+V</strong> to paste all rows & columns instantly (or use <em>File → Import → Upload</em> with the downloaded CSV).</li>
              </ol>
              <div className="export-int-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button variant="primary" icon="sheet" onClick={onExportSheets} disabled={busy || isEmpty}>
                  Open Google Sheets (Auto-Copy Table)
                </Button>
                <Button variant="secondary" icon="download" onClick={onExportExcel} disabled={busy || isEmpty}>
                  Download Excel Worksheet (.xls)
                </Button>
              </div>
            </div>
          )}

          {tab === "airtable" && (
            <StatusGatedPushPane
              name="Airtable"
              ctaNoun={{ singular: "record", plural: "records" }}
              ctaVerb="Push"
              loading={providerLoading.airtable}
              status={providerStatus.airtable}
              onGoToSetup={() => goToSetup("Airtable")}
              totalCount={totalCount}
              onPush={onAirtablePush}
              busy={busy}
              isEmpty={isEmpty}
              // Airtable-specific: when the field_map is empty (a
              // legacy connection that connected before the
              // refreshSchema code shipped) the push will 422. We
              // surface a "Load columns" button in that case.
              renderExtra={(conn) => {
                if (conn?.field_map && Object.keys(conn.field_map).length > 0) {
                  return (
                    <div className="export-int-status export-int-status-ok" style={{ marginTop: 0 }}>
                      <Icon name="check-circle" size={14} />
                      <span>
                        Field map: {conn.field_map_summary || `${Object.keys(conn.field_map).length} column${Object.keys(conn.field_map).length !== 1 ? "s" : ""} mapped`}
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="export-int-status export-int-status-warn" style={{ marginTop: 0 }}>
                    <Icon name="alert-triangle" size={14} />
                    <span>
                      No field map loaded yet.{" "}
                      <button
                        type="button"
                        className="export-int-link"
                        onClick={onAirtableLoadSchema}
                        disabled={airtableSchemaLoading}
                      >
                        {airtableSchemaLoading ? "Loading…" : "Load columns"}
                      </button>
                      {" "}to fetch and auto-map your table&apos;s columns. Required before the first push.
                    </span>
                  </div>
                );
              }}
            />
          )}

          {tab === "notion" && (
            <StatusGatedPushPane
              name="Notion"
              ctaNoun={{ singular: "page", plural: "pages" }}
              ctaVerb="Push"
              loading={providerLoading.notion}
              status={providerStatus.notion}
              onGoToSetup={() => goToSetup("Notion")}
              totalCount={totalCount}
              onPush={onNotionPush}
              busy={busy}
              isEmpty={isEmpty}
              renderExtra={(conn) => {
                if (!conn) return null;
                return (
                  <div className="export-int-detail">
                    {conn.database_id && (
                      <div className="export-int-detail-line">
                        <span className="export-int-detail-key">Database</span>
                        <code className="export-int-detail-val">
                          {conn.database_id.length > 14
                            ? `${conn.database_id.slice(0, 8)}…${conn.database_id.slice(-4)}`
                            : conn.database_id}
                        </code>
                      </div>
                    )}
                    {conn.title_column && (
                      <div className="export-int-detail-line">
                        <span className="export-int-detail-key">Title column</span>
                        <span className="export-int-detail-val">{conn.title_column}</span>
                      </div>
                    )}
                    {conn.column_count != null && (
                      <div className="export-int-detail-line">
                        <span className="export-int-detail-key">Columns</span>
                        <span className="export-int-detail-val">{conn.column_count}</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
          )}

          {tab === "hubspot" && (
            <StatusGatedPushPane
              name="HubSpot"
              ctaNoun={{ singular: "record", plural: "records" }}
              ctaVerb="Push"
              loading={providerLoading.hubspot}
              status={providerStatus.hubspot}
              onGoToSetup={() => goToSetup("HubSpot")}
              totalCount={totalCount}
              onPush={onHubSpotPush}
              busy={busy}
              isEmpty={isEmpty}
              setupHint="Paste a Private App token in Account → Integrations"
            />
          )}

          {tab === "slack" && (
            <StatusGatedPushPane
              name="Slack"
              ctaNoun={{ singular: "message", plural: "messages" }}
              ctaVerb="Post"
              loading={providerLoading.slack}
              status={providerStatus.slack}
              onGoToSetup={() => goToSetup("Slack")}
              totalCount={totalCount}
              onPush={onSlackSend}
              busy={busy}
              isEmpty={isEmpty}
              setupHint="Set up a webhook in Account → Integrations"
            />
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

// ── StatusGatedPushPane ──────────────────────────────────────────────────
// The four server-stored tabs (HubSpot, Airtable, Notion, Slack) all
// share the same shape: check status, show "connected" / "not
// connected", and provide a one-click push. This component encapsulates
// the pattern so each tab can stay tiny and the copy is consistent.
//
// Props:
//   name:        provider display name (for the banner + CTA)
//   ctaNoun:     { singular, plural } — what one row produces on the
//                destination (record/records, page/pages, message/messages)
//   ctaVerb:     "Push" | "Post" — the action verb in the CTA
//   loading:     boolean — true while status is being fetched
//   status:      { connected, connection: { account_label, ... } } | null
//   onGoToSetup: () => void — navigate to /account#integrations
//   totalCount:  number of rows to push
//   onPush:      () => void — handler for the push button
//   busy:        boolean — push in flight
//   isEmpty:     boolean — no rows selected
//   setupHint:   string — "Set up a webhook in Account → Integrations"
//   renderExtra: (conn) => ReactNode — provider-specific detail block
//                 (e.g. Airtable's field-map, Notion's database ID)
function StatusGatedPushPane({
  name, ctaNoun, ctaVerb = "Push", loading, status, onGoToSetup, totalCount,
  onPush, busy, isEmpty, setupHint, renderExtra,
}) {
  const isConnected = status?.connected === true;
  const accountLabel = status?.connection?.account_label;
  const isLoadingStatus = loading && !status; // initial load only; refetches don't show the spinner
  const noun = ctaNoun || { singular: "record", plural: "records" };
  const ctaLabel = `${ctaVerb} ${totalCount > 0 ? totalCount : ""} ${totalCount === 1 ? noun.singular : noun.plural} to ${name}`;

  if (isLoadingStatus) {
    return (
      <div className="export-int-pane">
        <div className="export-int-status">
          <Icon name="loader" size={14} className="push-int-spin" />
          <span> Checking {name} connection…</span>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="export-int-pane">
        <p className="export-int-help">
          No API key to enter — your {name} connection lives in{" "}
          <strong>Account → Integrations</strong>. Set it up once and every
          future push just works.
        </p>
        <div className="export-int-status export-int-status-warn">
          <Icon name="alert-triangle" size={14} />
          <span>
            {name} isn&apos;t connected yet.{" "}
            <button type="button" className="export-int-link" onClick={onGoToSetup}>
              {setupHint || `Set up ${name} in Account → Integrations`}
            </button>
            , then come back here.
          </span>
        </div>
        <div className="export-int-actions">
          <Button variant="primary" icon="trending-up" disabled>
            {ctaLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="export-int-pane">
      <p className="export-int-help">
        Connected{accountLabel ? ` as ${accountLabel}` : ""}. We&apos;ll {ctaVerb.toLowerCase()} {totalCount} {totalCount === 1 ? noun.singular : noun.plural} using the credentials you set up in Account → Integrations.
      </p>
      <div className="export-int-status export-int-status-ok">
        <Icon name="check-circle" size={14} />
        <span>Connected{accountLabel ? ` as ${accountLabel}` : ""}.</span>
      </div>
      {renderExtra && renderExtra(status.connection)}
      <div className="export-int-actions">
        <Button
          variant="primary"
          icon="trending-up"
          onClick={onPush}
          disabled={busy || isEmpty}
          loading={busy}
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
