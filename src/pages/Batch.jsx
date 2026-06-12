// Batch.jsx — multi-URL extraction mode (route "/batch").
// Supports: paste URLs textarea, CSV file import, progress tracking, and
// combined export (CSV / PDF / Markdown / JSON).
import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import Toggle from "../components/Toggle.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { runBatch, parseUrlsFromCsv } from "../lib/batchService.js";
import { saveExtraction } from "../lib/extractionsRepo.js";
import { isValidUrl, normalizeUrl, csvDownload, markdownDownload, jsonDownload } from "../lib/utils.js";
import { hostOf } from "../lib/utils.js";

const MAX_URLS = 500;
const MIN_URLS = 2;

// ── URL parsing from textarea ──────────────────────────────────────────────────
function parseUrlsFromText(text) {
  const raw = text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const r of raw) {
    const normalized = /^https?:\/\//i.test(r) ? r : "https://" + r;
    if (seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    if (isValidUrl(r)) valid.push(normalized);
    else invalid.push(r);
  }
  return { valid, invalid };
}

// ── Result row ──────────────────────────────────────────────────────────────
function ResultRow({ item, index }) {
  if (!item) return null;
  const isError = item._status === "error";
  return (
    <tr className={isError ? "batch-row-error" : ""}>
      <td className="batch-td-num">{index + 1}</td>
      <td>
        <div className="batch-td-page">
          {!isError && <FaviconDot url={item.url} size={28} />}
          {isError && (
            <div className="batch-err-icon">
              <Icon name="x-square" size={16} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="batch-td-title">{isError ? item.url : (item.page_title || item.url)}</div>
            <div className="batch-td-url">{hostOf(item.url)}</div>
          </div>
        </div>
      </td>
      <td className="batch-td-meta">
        {isError ? (
          <span className="batch-err-msg">{item._error}</span>
        ) : (
          <span>{item.headings?.length ?? 0} headings · {item.links?.length ?? 0} links</span>
        )}
      </td>
      <td className="batch-td-status">
        {isError ? (
          <span className="batch-status-badge error"><Icon name="x" size={12} /> Failed</span>
        ) : (
          <span className="batch-status-badge success"><Icon name="check" size={12} /> Done</span>
        )}
      </td>
    </tr>
  );
}

// ── Gate banner shown when plan doesn't support batch ─────────────────────────
function BatchGateBanner({ onUpgrade }) {
  return (
    <div className="batch-gate-banner card">
      <div className="batch-gate-icon">
        <Icon name="layers-2" size={28} />
      </div>
      <div className="batch-gate-body">
        <h3>Batch mode — Business &amp; Agency plans</h3>
        <p>
          Extract 10–500 URLs simultaneously, import from CSV, and export combined
          results as CSV, PDF, Markdown or JSON. Upgrade to Business or Agency to
          unlock, or purchase a <strong>Batch Pack</strong> top-up (50 URL slots
          for $9 / ₹749).
        </p>
        <div className="batch-gate-actions">
          <Button variant="primary" icon="crown" onClick={onUpgrade}>
            Upgrade plan
          </Button>
          <Button variant="secondary" icon="zap" onClick={onUpgrade}>
            Buy Batch Pack
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Batch() {
  const navigate = useNavigate();
  const showToast = useToast();
  const billing = useBilling();

  // Input tab: "paste" or "csv"
  const [inputTab, setInputTab] = useState("paste");

  // Paste mode state
  const [pasteText, setPasteText] = useState("");

  // CSV mode state
  const [csvFile, setCsvFile] = useState(null);
  const [csvUrls, setCsvUrls] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvColumn, setCsvColumn] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Options
  const [renderJs, setRenderJs] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: "" });
  const [results, setResults] = useState(null);
  const abortRef = useRef(null);

  // Derived URL list
  const { valid: pastedUrls, invalid: invalidUrls } =
    inputTab === "paste" ? parseUrlsFromText(pasteText) : { valid: [], invalid: [] };
  const activeUrls = inputTab === "paste" ? pastedUrls : csvUrls;
  const urlCount = activeUrls.length;

  // Check plan access
  const batchCheck = billing?.checkCanBatch?.(Math.max(urlCount, 1)) ?? { allowed: false };
  const planSupportsBatch = billing?.checkCanBatch?.(1)?.allowed ?? false;

  // ── CSV file handling ────────────────────────────────────────────────────────
  const processCsvFile = useCallback((file) => {
    if (!file) return;
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { urls, column, errors } = parseUrlsFromCsv(e.target.result);
      setCsvUrls(urls);
      setCsvErrors(errors);
      setCsvColumn(column);
    };
    reader.readAsText(file);
  }, []);

  const onFileChange = (e) => {
    processCsvFile(e.target.files?.[0] ?? null);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processCsvFile(file);
  };

  // ── Run batch ────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!planSupportsBatch) { navigate("/pricing"); return; }
    if (urlCount < MIN_URLS) {
      showToast(`Enter at least ${MIN_URLS} URLs to run batch mode.`);
      return;
    }
    if (urlCount > MAX_URLS) {
      showToast(`Maximum ${MAX_URLS} URLs per batch. Remove ${urlCount - MAX_URLS} URLs and try again.`);
      return;
    }

    const batchSizeCheck = billing?.checkCanBatch?.(urlCount);
    if (batchSizeCheck && !batchSizeCheck.allowed) {
      showToast(batchSizeCheck.reason + " Upgrade your plan.");
      navigate("/pricing");
      return;
    }

    const quotaCheck = billing?.checkCanExtractBatch?.(urlCount);
    if (quotaCheck && !quotaCheck.allowed) {
      showToast(quotaCheck.reason);
      navigate("/pricing");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setResults(null);
    setProgress({ completed: 0, total: urlCount, current: activeUrls[0] || "" });

    const opts = {};
    if (renderJs) opts.renderJs = true;
    if (customMode && customPrompt.trim()) opts.customPrompt = customPrompt.trim();

    try {
      const partial = [];
      const batchResults = await runBatch(
        activeUrls,
        opts,
        (completed, total, latest) => {
          partial.push(latest);
          setProgress({ completed, total, current: activeUrls[completed] || "" });
          // Track each successful URL as an extraction
          if (latest._status === "success") {
            billing?.trackExtraction?.(1);
          }
        },
        controller.signal,
      );

      if (!controller.signal.aborted) {
        setResults(batchResults);
        const successItems = batchResults.filter((r) => r?._status === "success");
        const failed = batchResults.filter((r) => r?._status === "error").length;
        showToast(
          `Batch complete — ${successItems.length} succeeded${failed ? `, ${failed} failed` : ""}`,
          "check-circle",
        );
        // Auto-save successful results to Dashboard (fire and forget)
        if (successItems.length > 0) {
          Promise.allSettled(successItems.map((r) => saveExtraction(r)))
            .then((settled) => {
              const savedCount = settled.filter((s) => s.status === "fulfilled").length;
              if (savedCount > 0) {
                showToast(
                  `${savedCount} page${savedCount !== 1 ? "s" : ""} saved to Dashboard`,
                  "bookmark",
                );
              }
            });
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("[DatIQ] Batch failed:", err);
        showToast("Batch extraction failed. Please try again.");
      }
    } finally {
      setRunning(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setRunning(false);
    showToast("Batch cancelled.");
  };

  // ── Export helpers ───────────────────────────────────────────────────────────
  const successResults = (results || []).filter((r) => r?._status === "success");

  const onExportCsv = () => {
    if (!billing?.checkCanExport?.("csv")) { showToast("CSV export unavailable on your plan."); return; }
    if (!successResults.length) return;
    csvDownload(successResults);
    showToast(`Exported ${successResults.length} pages to CSV`, "download");
  };

  const onExportMarkdown = async () => {
    if (!billing?.checkCanExport?.("markdown")) {
      showToast("Markdown export requires the Select plan or higher. Upgrade to unlock.");
      return;
    }
    if (!successResults.length) return;
    markdownDownload(successResults);
    showToast(`Exported ${successResults.length} pages to Markdown`, "file-code");
  };

  const onExportJson = async () => {
    if (!billing?.checkCanExport?.("json")) {
      showToast("JSON export requires the Pro plan or higher. Upgrade to unlock.");
      return;
    }
    if (!successResults.length) return;
    jsonDownload(successResults);
    showToast(`Exported ${successResults.length} pages to JSON`, "file-json");
  };

  const onExportPdf = async () => {
    if (!billing?.checkCanExport?.("pdf")) {
      showToast("PDF export requires the Select plan or higher. Upgrade to unlock.");
      return;
    }
    if (!successResults.length) return;
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      extractionsToPdf(successResults);
      showToast(`Exported ${successResults.length} pages to PDF`, "file");
    } catch (err) {
      console.error("[DatIQ] PDF export failed:", err);
      if (/dynamically imported/i.test(err?.message || "")) {
        showToast("App updated — please refresh the page and try again.", "info");
      } else {
        showToast("PDF export failed. Please try again.");
      }
    }
  };

  // ── Count badge colour ───────────────────────────────────────────────────────
  const countColor =
    urlCount === 0
      ? "var(--text-3)"
      : urlCount < MIN_URLS
        ? "var(--warning, #f59e0b)"
        : urlCount > MAX_URLS
          ? "var(--danger, #e0556b)"
          : "var(--success, #22c55e)";

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  return (
    <div className="page fade">
      <div className="container batch-page" style={{ paddingTop: 40, paddingBottom: 72 }}>
        {/* Header */}
        <div className="batch-hero">
          <div className="eyebrow">
            <Icon name="layers-2" size={13} /> Batch mode
          </div>
          <h1 className="batch-h1">Multi-URL extraction</h1>
          <p className="batch-sub">
            Extract structured data from 10–500 URLs simultaneously. Import from CSV
            or paste a list. Each URL counts toward your monthly extraction quota.
          </p>
        </div>

        {/* Plan gate */}
        {!planSupportsBatch ? (
          <BatchGateBanner onUpgrade={() => navigate("/pricing")} />
        ) : (
          <>
            {/* Input section */}
            {!running && !results && (
              <div className="batch-input-card card rise">
                {/* Tab switcher */}
                <div className="batch-tabs">
                  <button
                    className={"batch-tab" + (inputTab === "paste" ? " on" : "")}
                    onClick={() => setInputTab("paste")}
                  >
                    <Icon name="list-checks" size={14} />
                    Paste URLs
                  </button>
                  <button
                    className={"batch-tab" + (inputTab === "csv" ? " on" : "")}
                    onClick={() => setInputTab("csv")}
                  >
                    <Icon name="file-up" size={14} />
                    Import CSV
                  </button>
                </div>

                {inputTab === "paste" && (
                  <div className="batch-paste-area">
                    <textarea
                      className="batch-textarea"
                      placeholder={
                        "Paste one URL per line or comma-separated:\n\nhttps://example.com\nhttps://stripe.com/pricing\nhttps://notion.so/about"
                      }
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={10}
                      aria-label="URLs to batch-extract"
                    />
                    <div className="batch-url-meta">
                      <span className="batch-url-count" style={{ color: countColor }}>
                        <Icon name="globe" size={13} />
                        {urlCount} URL{urlCount !== 1 ? "s" : ""} detected
                        {urlCount > 0 && urlCount < MIN_URLS && ` (minimum ${MIN_URLS})`}
                        {urlCount > MAX_URLS && ` (max ${MAX_URLS})`}
                      </span>
                      {invalidUrls.length > 0 && (
                        <span className="batch-invalid-hint">
                          <Icon name="alert-triangle" size={12} />
                          {invalidUrls.length} invalid skipped
                        </span>
                      )}
                    </div>
                    {invalidUrls.length > 0 && (
                      <div className="batch-invalid-list">
                        {invalidUrls.slice(0, 5).map((u) => (
                          <span key={u} className="batch-invalid-item">{u}</span>
                        ))}
                        {invalidUrls.length > 5 && (
                          <span className="batch-invalid-item muted">+{invalidUrls.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {inputTab === "csv" && (
                  <div className="batch-csv-area">
                    <div
                      className={"batch-drop-zone" + (dragOver ? " drag-over" : "")}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                      aria-label="Drop CSV file or click to upload"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="batch-file-input"
                        onChange={onFileChange}
                        aria-hidden="true"
                      />
                      {csvFile ? (
                        <div className="batch-file-info">
                          <Icon name="file-up" size={22} />
                          <span className="batch-file-name">{csvFile.name}</span>
                          <span className="batch-file-meta">
                            URL column: <b>{csvColumn}</b>
                          </span>
                        </div>
                      ) : (
                        <div className="batch-drop-prompt">
                          <Icon name="upload" size={28} />
                          <span>Drop a CSV file here or click to upload</span>
                          <span className="batch-drop-hint">
                            Needs a <code>url</code> column (or first column used)
                          </span>
                        </div>
                      )}
                    </div>

                    {csvFile && (
                      <div className="batch-url-meta">
                        <span className="batch-url-count" style={{ color: countColor }}>
                          <Icon name="globe" size={13} />
                          {urlCount} valid URL{urlCount !== 1 ? "s" : ""} found
                        </span>
                        {csvErrors.length > 0 && (
                          <span className="batch-invalid-hint">
                            <Icon name="alert-triangle" size={12} />
                            {csvErrors.length} row{csvErrors.length !== 1 ? "s" : ""} skipped
                          </span>
                        )}
                      </div>
                    )}

                    {csvErrors.length > 0 && (
                      <div className="batch-invalid-list">
                        {csvErrors.slice(0, 4).map((e) => (
                          <span key={e} className="batch-invalid-item">{e}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Options */}
                <div className="batch-opts">
                  <Toggle
                    icon="zap"
                    label="Render JavaScript"
                    hint="dynamic / SPA pages"
                    checked={renderJs}
                    onChange={setRenderJs}
                    tooltip="Wait for JS to render before capturing. Slower but accurate for React/Vue/Angular pages."
                  />
                  <Toggle
                    icon="code"
                    label="Custom extraction"
                    hint="ask in plain English"
                    checked={customMode}
                    onChange={setCustomMode}
                    tooltip="Apply a custom extraction prompt to every URL in the batch."
                  />
                </div>

                {customMode && (
                  <div className="batch-custom-prompt">
                    <textarea
                      className="custom-extract-input"
                      rows={2}
                      placeholder='e.g. "Extract product name, price, and main CTA"'
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      aria-label="Custom extraction prompt for all URLs"
                    />
                  </div>
                )}

                {/* Quota note */}
                {urlCount >= MIN_URLS && (
                  <p className="batch-quota-note">
                    <Icon name="info" size={13} />
                    Running this batch will use <b>{urlCount}</b> of your monthly extraction quota.
                  </p>
                )}

                {/* Run button */}
                <div className="batch-run-row">
                  <Button
                    variant="primary"
                    icon="layers-2"
                    iconRight="arrow-right"
                    onClick={handleRun}
                    disabled={urlCount < MIN_URLS || urlCount > MAX_URLS}
                    style={{ minWidth: 200 }}
                  >
                    Extract {urlCount >= MIN_URLS ? urlCount : ""} URL{urlCount !== 1 ? "s" : ""}
                  </Button>
                  <span className="batch-run-hint">
                    {urlCount < MIN_URLS
                      ? `Add at least ${MIN_URLS} URLs to start`
                      : urlCount > MAX_URLS
                        ? `Reduce to ${MAX_URLS} URLs max`
                        : `~${Math.ceil(urlCount / 3 * 3)}s estimated`}
                  </span>
                </div>
              </div>
            )}

            {/* Progress */}
            {running && (
              <div className="batch-progress-card card rise">
                <div className="batch-progress-header">
                  <Icon name="loader" size={18} className="spin" />
                  <span>
                    Extracting {progress.completed} / {progress.total} URLs…
                  </span>
                </div>
                <div className="batch-progress-bar-wrap">
                  <div
                    className="batch-progress-bar"
                    style={{ width: `${progressPct}%` }}
                    role="progressbar"
                    aria-valuenow={progress.completed}
                    aria-valuemax={progress.total}
                  />
                </div>
                {progress.current && (
                  <p className="batch-progress-current">
                    <Icon name="globe" size={12} />
                    {progress.current}
                  </p>
                )}
                <Button variant="ghost" size="sm" icon="x" onClick={handleCancel} style={{ marginTop: 12 }}>
                  Cancel
                </Button>
              </div>
            )}

            {/* Results */}
            {results && !running && (
              <div className="batch-results rise">
                <div className="batch-results-header">
                  <div>
                    <h2 className="batch-results-title">
                      <Icon name="check-circle" size={20} />
                      Batch complete
                    </h2>
                    <p className="batch-results-sub">
                      {successResults.length} succeeded ·{" "}
                      {results.filter((r) => r?._status === "error").length} failed ·{" "}
                      {results.length} total
                    </p>
                  </div>
                  <div className="batch-export-toolbar">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="download"
                      onClick={onExportCsv}
                      disabled={!successResults.length}
                      title="Export all as CSV"
                    >
                      CSV
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="file"
                      onClick={onExportPdf}
                      disabled={!successResults.length}
                      title="Export all as PDF (Select+ plan)"
                    >
                      PDF
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="file-code"
                      onClick={onExportMarkdown}
                      disabled={!successResults.length}
                      title="Export all as Markdown (Select+ plan)"
                    >
                      Markdown
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="file-json"
                      onClick={onExportJson}
                      disabled={!successResults.length}
                      title="Export all as JSON (Pro+ plan)"
                    >
                      JSON
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="refresh"
                      onClick={() => { setResults(null); setPasteText(""); setCsvFile(null); setCsvUrls([]); }}
                    >
                      New batch
                    </Button>
                  </div>
                </div>

                <div className="card table-wrap batch-table-wrap">
                  <table className="batch-table">
                    <thead>
                      <tr>
                        <th className="batch-th-num">#</th>
                        <th>Page</th>
                        <th className="batch-th-meta">Details</th>
                        <th className="batch-th-status">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((item, i) => (
                        <ResultRow key={item?.id || i} item={item} index={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
