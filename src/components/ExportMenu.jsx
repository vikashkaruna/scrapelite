// src/components/ExportMenu.jsx — the one export surface.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Dashboard, Batch and Preview each grew their own Download/Copy dropdown.
// Three copies of the same menu is three places for the format list, the plan
// gating and the toast wording to drift — and they had: the Templates surface
// shipped with no export at all, and nothing flagged it, because there was no
// single component whose absence would be obvious.
//
// Everything here delegates to the builders in lib/utils.js and the existing
// PushIntegrationMenu / EmailModal / share flow. This component owns the MENU,
// not the exporting.
//
// ── PLAN GATING IS NOT COSMETIC ─────────────────────────────────────────────
// Every action re-checks `checkCanExport(format)` at click time rather than
// only hiding the row. A hidden row is a UI convenience; the check is the
// actual gate, and it lives next to the action it guards.
import { useState, useRef, useEffect } from "react";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import EmailModal from "./EmailModal.jsx";
import PushIntegrationMenu from "./PushIntegrationMenu.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import {
  csvDownload, excelDownload, markdownDownload, jsonDownload, copyToClipboard,
} from "../lib/utils.js";
import { readBrandKit } from "../lib/whiteLabelTemplate.js";
import { apiClient } from "../lib/apiClient.js";

export default function ExportMenu({
  items = [],
  label = "Export",
  buttonVariant = "secondary",
  buttonSize = "sm",
  showPush = true,
  showEmail = true,
  // Forwarded to PushIntegrationMenu. Dashboard uses it for the Airtable
  // "Load columns" pane — the only recovery path for an empty field_map, so
  // dropping it in the consolidation would have quietly removed a fix.
  onPushAdvanced = null,
  onShare = null,          // optional: a share handler the host page owns
  shareLabel = "Create public link",
  disabled = false,
}) {
  const showToast = useToast();
  // Rendered outside BillingProvider only in tests — but the fallback still
  // DENIES rather than permits. This is a paywall: "the provider was missing"
  // must never become a way to reach a gated format, which is precisely how
  // the integrations capability shipped ungated for every plan once already.
  const billing = (() => { try { return useBilling(); } catch { return null; } })();
  const checkCanExport = billing?.checkCanExport ?? (() => false);
  const checkCanEmail = billing?.checkCanEmail ?? (() => false);
  const [open, setOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const list = Array.isArray(items) ? items : [items];
  const empty = list.length === 0;

  // One gate, one message. `csv` covers the spreadsheet formats because Excel
  // is the same tabular export in a different wrapper — gating them apart
  // would let a plan offer one and refuse the other for no stated reason.
  const gate = (format, human) => {
    if (checkCanExport(format)) return true;
    showToast(`${human} export is not available on your current plan.`);
    return false;
  };

  const run = (fn) => { fn(); setOpen(false); };

  const copy = async (format, human) => {
    const out = await copyToClipboard(list, format);
    if (out.ok) showToast(`${human} copied to clipboard`, "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}).`, "alert-triangle");
    setOpen(false);
  };

  const onPdf = async () => {
    if (!gate("pdf", "PDF")) return;
    setOpen(false);
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      extractionsToPdf(list, { brandKit: readBrandKit() });
    } catch (err) {
      // A stale chunk after a deploy is not a broken export — see errorMessages.js.
      if (/dynamically imported module|Failed to fetch/i.test(err?.message || "")) {
        showToast("App updated — please refresh the page and try again.", "info");
      } else {
        showToast("PDF export failed. Please try again.");
      }
    }
  };

  const onSendEmail = async (emails, format) => {
    if (!checkCanEmail()) { showToast("Email export requires the Go plan or higher."); setEmailOpen(false); return; }
    if (!gate(format, format.toUpperCase())) return;
    const res = await apiClient.sendExportEmail({
      to: emails, items: list, format, brandKit: readBrandKit(),
    });
    setEmailOpen(false);
    showToast(res?.ok ? "Export emailed." : (res?.error || "Could not send that email."));
  };

  const Item = ({ icon, title, hint, onClick }) => (
    <button className="export-dropdown-item" onClick={onClick} type="button">
      <Icon name={icon} size={14} />
      <span>
        <b>{title}</b>
        {hint ? <span className="export-plan-hint">{hint}</span> : null}
      </span>
    </button>
  );

  return (
    <>
      {/* `billing &&` is load-bearing: PushIntegrationMenu destructures the
          billing context directly, so rendering it without a provider throws.
          No billing context also means no entitlement to check — so not
          offering push at all is both the safe and the honest answer. */}
      {showPush && !empty && billing && (
        <PushIntegrationMenu
          items={list}
          buttonVariant={buttonVariant}
          disabled={disabled}
          {...(onPushAdvanced ? { onAdvanced: onPushAdvanced } : {})}
        />
      )}

      <div className="export-dropdown" ref={ref}>
        <Button
          variant={buttonVariant}
          size={buttonSize}
          icon="download"
          iconRight="chevron-down"
          disabled={disabled || empty}
          onClick={() => setOpen((v) => !v)}
        >
          {label}
        </Button>

        {open && (
          <div className="export-dropdown-menu">
            <div className="export-dropdown-section">
              <div className="export-dropdown-section-label">Download</div>
              <Item icon="file-text"  title="CSV"                    onClick={() => gate("csv", "CSV") && run(() => csvDownload(list, { brandKit: readBrandKit() }))} />
              <Item icon="layers"     title="Excel Worksheet (.xls)" onClick={() => gate("csv", "Spreadsheet") && run(() => excelDownload(list))} />
              <Item icon="file"       title="PDF"                    onClick={onPdf} />
              <Item icon="bookmark"   title="Markdown"               onClick={() => gate("markdown", "Markdown") && run(() => markdownDownload(list, { brandKit: readBrandKit() }))} />
              <Item icon="share"      title="JSON"                   onClick={() => gate("json", "JSON") && run(() => jsonDownload(list, { brandKit: readBrandKit() }))} />
            </div>

            <div className="export-dropdown-section">
              <div className="export-dropdown-section-label">Copy to clipboard</div>
              {/* Ungated on purpose: the summary is prose the user is already
                  looking at, and charging a plan for selecting it would be
                  gating the clipboard, not a feature. */}
              <Item icon="clipboard-copy" title="Copy summary"  onClick={() => copy("summary", "Summary")} />
              <Item icon="clipboard-copy" title="Copy CSV"      onClick={() => gate("csv", "CSV") && copy("csv", "CSV")} />
              <Item icon="clipboard-copy" title="Copy Markdown" onClick={() => gate("markdown", "Markdown") && copy("markdown", "Markdown")} />
              <Item icon="clipboard-copy" title="Copy JSON"     onClick={() => gate("json", "JSON") && copy("json", "JSON")} />
            </div>

            {(showEmail || onShare) && (
              <div className="export-dropdown-section">
                <div className="export-dropdown-section-label">Send</div>
                {showEmail && (
                  <Item icon="mail" title="Email a copy"
                        hint="Sent to the addresses you choose, as a real attachment"
                        onClick={() => { setOpen(false); setEmailOpen(true); }} />
                )}
                {onShare && (
                  <Item icon="share" title={shareLabel}
                        hint="A read-only URL anyone can view"
                        onClick={() => { setOpen(false); onShare(); }} />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {emailOpen && (
        <EmailModal
          items={list}
          onSend={onSendEmail}
          onClose={() => setEmailOpen(false)}
          formats={["csv", "pdf", "markdown", "json"].filter(checkCanExport)}
        />
      )}
    </>
  );
}
