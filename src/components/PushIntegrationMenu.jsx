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

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { useToast } from "./Toast.jsx";
import {
  PUSH_PROVIDERS,
  getPushProviderStatuses,
  pushToIntegration,
} from "../lib/integrationsClient.js";

export default function PushIntegrationMenu({
  items,
  buttonLabel,
  buttonVariant = "secondary",
  compact = false,
  disabled = false,
  onPushed,
}) {
  const navigate = useNavigate();
  const showToast = useToast();
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

  const handlePickProvider = async (slug) => {
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

  // Label: caller wins, else "Push" or "Push N".
  const label =
    buttonLabel !== undefined
      ? buttonLabel
      : isSingle
      ? "Push"
      : `Push ${cleanItems.length}`;

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
            {PUSH_PROVIDERS.map((p) => {
              const status = statuses[p.slug];
              const isConnected = !!status?.connected;
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
                      {isConnected ? (
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
