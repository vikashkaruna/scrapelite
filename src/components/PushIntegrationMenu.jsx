// src/components/PushIntegrationMenu.jsx — "Push" dropdown for pushing
// one or more extractions to a 3rd-party integration (HubSpot, Notion,
// Airtable) using the server-side credentials stored at connect time.
//
// Renders a button that opens a small menu listing the 3 push-style
// integrations. Each row shows connected / not-connected state and routes
// the user accordingly on click:
//   - Connected    → fires pushToIntegration(provider, items) and toasts the result
//   - Not connected → navigates to /account#integrations to set it up
//
// Props:
//   items:         Array<extraction>        — what to push (≥1 required)
//   buttonLabel?:  string                   — default "Push" or "Push N"
//   buttonVariant?:"primary" | "secondary" | "ghost"   — default "secondary"
//   compact?:      boolean                  — smaller button (used in row actions)
//   disabled?:     boolean                  — externally disable the button
//   onPushed?:     (slug, result) => void   — optional callback after push
//
// Statuses are fetched on mount and on a window-focus refresh, so coming
// back from /account#integrations reflects the new connect state.
//
// Plan gating: HubSpot/Notion/Airtable/Slack require the "integrations"
// capability (Select and up — see entitlementModel.js). Google Sheets is
// exempt: it needs no server-side connection, it is a client-side CSV
// download, and CSV export is already available on every plan including Free.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import {
  PUSH_PROVIDERS,
  getPushProviderStatuses,
  pushToIntegration,
} from "../lib/integrationsClient.js";
import { openInGoogleSheets } from "../lib/utils.js";

// Google Sheets sits in this menu but is NOT a PUSH_PROVIDER: there is no
// server-side connection and nothing to authorise. It downloads a CSV and
// opens a blank sheet for the user to upload it into. It used to live only in
// the Export ▾ → "Send to" modal, so the same menu offered five destinations
// in one place and four in another. One list, one affordance.
const SHEETS_ROW = {
  slug: "sheets",
  name: "Google Sheets",
  icon: "sheet",
  desc: "Download a CSV and open a new sheet",
  clientSide: true,
};

export default function PushIntegrationMenu({
  items,
  buttonLabel,
  buttonVariant = "secondary",
  compact = false,
  disabled = false,
  onPushed,
  // Opens the full ExportIntegrations modal. Optional: pages that don't mount
  // it just omit this and the link isn't rendered. It exists because that
  // modal carries per-provider recovery the menu rows don't — notably
  // Airtable's "Load columns", the only way to repair an empty field_map.
  onAdvanced,
}) {
  const navigate = useNavigate();
  const showToast = useToast();
  const billing = (() => { try { return useBilling(); } catch { return null; } })();
  const checkCanIntegrations = billing?.checkCanIntegrations ?? (() => false);
  const canIntegrate = checkCanIntegrations();
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState({}); // slug → { connected, ... }
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [pushingSlug, setPushingSlug] = useState(null); // slug currently being pushed
  const wrapRef = useRef(null);

  const cleanItems = useMemo(
    () => (Array.isArray(items) ? items.filter((x) => x && typeof x === "object") : []),
    [items]
  );
  const hasItems = cleanItems.length > 0;
  const isSingle = cleanItems.length === 1;

  // Fetch connection statuses on mount, when opening, and on focus.
  const refreshStatuses = async () => {
    setLoadingStatus(true);
    try {
      const s = await getPushProviderStatuses();
      setStatuses(s);
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    refreshStatuses();
    const onFocus = () => refreshStatuses();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Google Sheets needs no connection and no server round-trip — it copies the table
  // to the clipboard, downloads the CSV, and opens a blank sheet to paste into.
  const handleSheets = () => {
    setOpen(false);
    openInGoogleSheets(cleanItems);
    showToast(
      `Copied ${cleanItems.length} row${cleanItems.length !== 1 ? "s" : ""} to clipboard & downloaded CSV! Press Cmd+V (or Ctrl+V) in Google Sheets to paste.`,
      "sheet",
    );
    onPushed?.("sheets", { ok: true, pushed: cleanItems.length, total: cleanItems.length });
  };

  const handlePickProvider = async (slug) => {
    if (slug === SHEETS_ROW.slug) return handleSheets();
    if (!canIntegrate) {
      setOpen(false);
      showToast("Push integrations are available from the Select plan upward.", "lock");
      navigate("/pricing");
      return;
    }
    const status = statuses[slug];
    if (!status?.connected) {
      setOpen(false);
      navigate("/account#integrations");
      return;
    }
    setPushingSlug(slug);
    setOpen(false);
    try {
      const result = await pushToIntegration(slug, cleanItems);
      const name = PUSH_PROVIDERS.find((p) => p.slug === slug)?.name || slug;
      if (result.ok) {
        showToast(
          `Pushed ${result.pushed} of ${result.total} ${isSingle ? "extraction" : "extractions"} to ${name}.`,
          "check-circle"
        );
      } else {
        const detail = result.errors?.[0] || result.message || "Push failed";
        showToast(`${name} push failed: ${detail}`, "alert-triangle");
      }
      onPushed?.(slug, result);
    } catch (err) {
      showToast(err?.message || "Push failed", "alert-triangle");
    } finally {
      setPushingSlug(null);
    }
  };

  // Always "Push" — the count belongs in the menu header, not the button.
  // "Push 2" made the same control read differently on Batch, Dashboard and
  // Preview depending on the selection.
  const label = buttonLabel !== undefined ? buttonLabel : "Push";

  return (
    <div className={"export-dropdown push-integration-menu" + (compact ? " push-compact" : "")} ref={wrapRef}>
      <Button
        variant={buttonVariant}
        size={compact ? "sm" : "sm"}
        icon="send"
        iconRight={open ? "chevron-up" : "chevron-down"}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || !hasItems || !!pushingSlug}
        loading={!!pushingSlug}
        title={!hasItems ? "No extractions to push" : "Push to a 3rd-party integration"}
      >
        {pushingSlug ? "Pushing…" : label}
      </Button>
      {open && (
        <div className="export-dropdown-menu push-int-menu" role="menu">
          <div className="export-dropdown-section">
            <div className="export-dropdown-section-label">
              Push to{isSingle ? "" : ` (${cleanItems.length})`}
            </div>
            {[...PUSH_PROVIDERS, SHEETS_ROW].map((p) => {
              const status = statuses[p.slug];
              // Sheets needs no connection, so it never shows a connect badge.
              const isConnected = p.clientSide || !!status?.connected;
              const isPushingThis = pushingSlug === p.slug;
              const accLabel = status?.connection?.account_label;
              return (
                <button
                  key={p.slug}
                  type="button"
                  role="menuitem"
                  className="export-dropdown-item push-int-option"
                  onClick={() => handlePickProvider(p.slug)}
                  disabled={isPushingThis}
                >
                  <Icon name={p.icon} size={14} />
                  <span className="push-int-option-body">
                    <span className="push-int-option-head">
                      <b>{p.name}</b>
                      {p.clientSide ? (
                        <span className="push-int-badge push-int-badge-ok" title="No setup needed">
                          <Icon name="check" size={10} strokeWidth={3} /> No setup needed
                        </span>
                      ) : !canIntegrate ? (
                        <span className="push-int-badge push-int-badge-off" title="Available from the Select plan upward">
                          <Icon name="lock" size={10} />
                          Select plan+
                        </span>
                      ) : isConnected ? (
                        <span className="push-int-badge push-int-badge-ok" title={accLabel ? `Connected as ${accLabel}` : "Connected"}>
                          <Icon name="check" size={10} strokeWidth={3} />
                          {accLabel ? ` ${accLabel}` : " Connected"}
                        </span>
                      ) : (
                        <span className="push-int-badge push-int-badge-off">
                          <Icon name="link" size={10} />
                          Not connected — set up →
                        </span>
                      )}
                    </span>
                    <span className="export-plan-hint">{p.desc}</span>
                  </span>
                  {isPushingThis && <Icon name="loader" size={14} className="push-int-spin" />}
                </button>
              );
            })}
          </div>
          <div className="export-dropdown-section">
            {onAdvanced && (
              <button
                type="button"
                role="menuitem"
                className="export-dropdown-item"
                onClick={() => { setOpen(false); onAdvanced(); }}
              >
                <Icon name="settings" size={14} />
                <span><b>More destination options…</b><span className="export-plan-hint">Field mapping &amp; per-provider setup</span></span>
              </button>
            )}
            <p className="push-int-foot">
              <Icon name="info" size={11} />
              {loadingStatus
                ? " Checking connection status…"
                : " First time? Set up each integration in Account → Integrations."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
