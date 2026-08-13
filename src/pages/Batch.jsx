// Batch.jsx — multi-URL extraction mode (route "/batch").
// Supports: paste URLs textarea, CSV file import, progress tracking, and
// combined export (CSV / PDF / Markdown / JSON).
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { useGuestTrial } from "../components/GuestTrialProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import UrlReviewTable from "../components/UrlReviewTable.jsx";
import CreditEstimator from "../components/CreditEstimator.jsx";
import ExportIntegrations from "../components/ExportIntegrations.jsx";
import PushIntegrationMenu from "../components/PushIntegrationMenu.jsx";
import { estimateBatchCredits } from "../lib/creditEstimator.js";
import { runBatch, parseUrlsFromCsv, extractOne } from "../lib/batchService.js";
import { incrementBatchRuns } from "../lib/usageService.js";
import { saveExtraction } from "../lib/extractionsRepo.js";
import { saveEnrichment } from "../lib/enrichmentStore.js";
import { isValidUrl, csvDownload, markdownDownload, jsonDownload, copyToClipboard, uid } from "../lib/utils.js";
import { hostOf, snippet } from "../lib/utils.js";
import { CONTACTS_PROMPT, QUICK_ACTIONS } from "../lib/extractionPresets.js";
import { saveBatchRun, recordBatchItems, makeBatchLabel } from "../lib/batchRunsService.js";
import { CONTENT_FORMATS } from "../lib/aiService.js";
import { useSeo } from "../hooks/useSeo.js";

const ABSOLUTE_MAX_URLS = 500;
const MIN_URLS = 2;

const PRICING_PROMPT = QUICK_ACTIONS.find((a) => a.key === "pricing")?.prompt || "";

// Batch intent chips — full parity with Home (including "Map site").
const BATCH_INTENTS = [
  { key: "summary",  icon: "sparkles", label: "AI summary",    desc: "Page overview for every URL" },
  { key: "contacts", icon: "users",    label: "Find contacts",  desc: "Leadership & emails per page" },
  { key: "pricing",  icon: "hash",     label: "Scrape pricing", desc: "Pricing tiers per page" },
  { key: "map",      icon: "network",  label: "Map site",       desc: "Discover all indexed sub-pages per domain" },
  { key: "custom",   icon: "code",     label: "Custom…",        desc: "Same prompt applied to all URLs" },
];

// Derive enrichMeta (for persisting enrichment tabs) based on intent.
function getEnrichMetaForIntent(intent) {
  if (intent === "contacts") return { key: "contacts", label: "Find Contact Info", icon: "mail" };
  if (intent === "pricing")  return { key: "pricing",  label: "Pricing & Plans",   icon: "hash" };
  if (intent === "custom")   return { key: "custom",   label: "Custom extraction", icon: "code" };
  return null; // summary and map don't produce named enrichment tabs
}

function resolveIntentPrompt(intent, customPrompt) {
  if (intent === "contacts") return CONTACTS_PROMPT;
  if (intent === "pricing")  return PRICING_PROMPT;
  if (intent === "custom")   return customPrompt.trim();
  return ""; // summary and map use their own processing paths
}

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

// ── Export Dropdown (matches Dashboard pattern) ───────────────────────────────
function ExportDropdown({ onCsv, onPdf, onMarkdown, onJson, onCopyCsv, onCopyMarkdown, onCopyJson, onSendTo, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="export-dropdown" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        icon="download"
        iconRight="chevron-down"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Export batch results"
      >
        Export
      </Button>
      {open && (
        <div className="export-dropdown-menu">
          <div className="export-dropdown-section">
            <div className="export-dropdown-section-label">Download</div>
            <button className="export-dropdown-item" onClick={() => { onCsv(); setOpen(false); }}>
              <Icon name="download" size={14} /> <span><b>CSV</b><span className="export-plan-hint">All plans</span></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onPdf(); setOpen(false); }}>
              <Icon name="file" size={14} /> <span><b>PDF</b><span className="export-plan-hint">Select+</span></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onMarkdown(); setOpen(false); }}>
              <Icon name="file-code" size={14} /> <span><b>Markdown</b><span className="export-plan-hint">Select+</span></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onJson(); setOpen(false); }}>
              <Icon name="file-json" size={14} /> <span><b>JSON</b><span className="export-plan-hint">Pro+</span></span>
            </button>
          </div>
          <div className="export-dropdown-section">
            <div className="export-dropdown-section-label">Copy to clipboard</div>
            <button className="export-dropdown-item" onClick={() => { onCopyCsv && onCopyCsv(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy CSV</b><span className="export-plan-hint">All plans</span></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onCopyMarkdown && onCopyMarkdown(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy Markdown</b><span className="export-plan-hint">Select+</span></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onCopyJson && onCopyJson(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy JSON</b><span className="export-plan-hint">Pro+</span></span>
            </button>
          </div>
          {onSendTo && (
            <div className="export-dropdown-section">
              <div className="export-dropdown-section-label">Send to</div>
              <button className="export-dropdown-item" onClick={() => { onSendTo(); setOpen(false); }}>
                <Icon name="share" size={14} /> <span><b>Integrations…</b><span className="export-plan-hint">Sheets · Airtable · Notion</span></span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Result row ──────────────────────────────────────────────────────────────
function ResultRow({ item, index, onView, onRetry, retrying }) {
  if (!item) return null;
  const isError = item._status === "error";
  const isMapResult = Boolean(item.domain_map);
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
            <div className="batch-td-title" title={isError ? item.url : (item.page_title || item.url)}>
              {isError ? item.url : (item.page_title || item.url)}
            </div>
            <div className="batch-td-url">{hostOf(item.url)}</div>
          </div>
        </div>
      </td>
      <td className="batch-td-meta">
        {isError ? (
          <span className="batch-err-msg" title={item._error}>{item._error}</span>
        ) : (
          <div>
            <div className="batch-td-summary">{snippet(item.ai_summary, 100)}</div>
            {isMapResult ? (
              <span className="batch-td-counts">
                <Icon name="network" size={12} /> {item.domain_map.length} URLs mapped
              </span>
            ) : (
              <span className="batch-td-counts">
                {item.headings?.length ?? 0} headings · {item.links?.length ?? 0} links
              </span>
            )}
            {item.generated_content && (
              <span className="batch-gen-tag">
                <Icon name="sparkles" size={11} /> Content generated
              </span>
            )}
          </div>
        )}
      </td>
      <td className="batch-td-status">
        {isError ? (
          <span className="batch-status-badge error"><Icon name="x" size={12} /> Failed</span>
        ) : (
          <span className="batch-status-badge success"><Icon name="check" size={12} /> Done</span>
        )}
      </td>
      <td className="batch-td-act">
        {!isError && (
          <Button variant="secondary" size="sm" icon="arrow-up-right" onClick={() => onView(item)}>
            View
          </Button>
        )}
        {isError && onRetry && (
          <Button
            variant="secondary"
            size="sm"
            icon={retrying ? "loader" : "rotate-cw"}
            disabled={retrying}
            onClick={() => onRetry(item, index)}
            title={`Re-run extraction for ${item.url}`}
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
      </td>
    </tr>
  );
}

// ── Gate banner shown when plan has hit its batch limit ──────────────────────
function BatchGateBanner({ onUpgrade, planId, planLimit }) {
  const isNotSupported = !planLimit;
  return (
    <div className="batch-gate-banner card">
      <div className="batch-gate-icon">
        <Icon name="layers-2" size={28} />
      </div>
      <div className="batch-gate-body">
        {isNotSupported ? (
          <>
            <h3>Batch mode not available on your plan</h3>
            <p>
              Extract multiple URLs simultaneously, import from CSV, and export combined results.
              All plans include batch mode — upgrade to process more URLs per batch (up to 500 on Agency).
            </p>
          </>
        ) : (
          <>
            <h3>You've reached your batch limit ({planLimit} URLs)</h3>
            <p>
              Your current plan supports up to <strong>{planLimit} URLs per batch</strong>.
              Upgrade to unlock more URLs per batch run.
            </p>
          </>
        )}
        <div className="batch-gate-actions">
          <Button variant="primary" icon="crown" onClick={onUpgrade}>
            Upgrade plan
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Batch() {
  useSeo({
    title: "DatIQ Batch — extract from many URLs at once | DatIQ.app",
    description:
      "DatIQ Batch — paste up to hundreds of URLs and extract structured data from every page in one run. DatIQ.app is the zero-code web data extraction platform for sales, SEO, and research teams.",
    canonical: "https://datiq.app/batch",
  });
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();
  const billing = useBilling();
  const subscription = billing?.subscription;
  const usage = billing?.usage;
  const { view } = useExtraction();
  const { user } = useAuth();
  const guestTrial = useGuestTrial();
  const { personaId } = usePersona();

  // Input tab: "paste" or "csv"
  const [inputTab, setInputTab] = useState("paste");

  // Paste mode state — priority: nav state > localStorage draft > empty
  const [pasteText, setPasteText] = useState(() => {
    const navUrls = location.state?.urls;
    if (Array.isArray(navUrls) && navUrls.length > 0) return navUrls.join("\n");
    try { return localStorage.getItem("datiq.batchDraft") || ""; } catch { return ""; }
  });

  // CSV mode state
  const [csvFile, setCsvFile] = useState(null);
  const [csvUrls, setCsvUrls] = useState([]);
  const [csvErrors, setCsvErrors] = useState([]);
  const [csvColumn, setCsvColumn] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Options — intent chip drives extraction type (same paradigm as Home)
  const [intent, setIntent] = useState(() => {
    const i = location.state?.intent;
    return BATCH_INTENTS.some((b) => b.key === i) ? i : "summary";
  });
  const [customPrompt, setCustomPrompt] = useState(() => {
    const i = location.state?.intent;
    if (i === "contacts") return CONTACTS_PROMPT;
    if (i === "pricing")  return PRICING_PROMPT;
    return "";
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [renderJs, setRenderJs] = useState(false);

  // Content generation per URL
  const [generateContentEnabled, setGenerateContentEnabled] = useState(false);
  const [selectedContentFormatKey, setSelectedContentFormatKey] = useState("seo-outline");
  const selectedContentFormat = CONTENT_FORMATS.find((f) => f.key === selectedContentFormatKey) || CONTENT_FORMATS[0];

  // Persist draft textarea to localStorage so it survives refresh / back-nav
  useEffect(() => {
    try { localStorage.setItem("datiq.batchDraft", pasteText); } catch { /* skip */ }
  }, [pasteText]);

  // Show a toast when arriving from Home with pre-populated URLs
  useEffect(() => {
    if (location.state?.urls?.length > 0) {
      showToast(`${location.state.urls.length} URLs loaded — review and run`);
      // Clear navigation state so back-nav doesn't re-trigger the toast
      window.history.replaceState({}, "");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run state
  const [running, setRunning] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  // F16 — results table filter + sort
  const [resultsFilter, setResultsFilter] = useState("all"); // all | success | error
  const [resultsSort, setResultsSort] = useState("original"); // original | url-asc | url-desc | status | title | headings
  const [progress, setProgress] = useState({ completed: 0, total: 0, current: "" });
  const [results, setResults] = useState(null);
  const [retryingIndex, setRetryingIndex] = useState(-1);

  // Groke QW#4 (ba-4) — per-URL retry on a failed batch row.
  // Re-runs extractOne for that URL with the same options, then patches the
  // result back into the results array. The auto-save / persistence happens
  // via the standard runBatch → success path, so retried items appear in the
  // Dashboard with the same shape as a first-time success.
  const handleRetry = async (item, index) => {
    setRetryingIndex(index);
    try {
      const fresh = await extractOne(item.url, {
        renderJs,
        customPrompt: intent === "custom" ? customPrompt : undefined,
        mapMode: intent === "map",
        ...(intent === "contacts" ? { customPrompt: CONTACTS_PROMPT } : {}),
        ...(intent === "pricing" ? { customPrompt: PRICING_PROMPT } : {}),
      });
      setResults((prev) => {
        if (!prev) return prev;
        const next = prev.slice();
        next[index] = fresh;
        return next;
      });
      if (fresh._status === "success") {
        billing?.trackExtraction?.(1);
        showToast(`Retried ${hostOf(fresh.url)} — success`, "check");
      } else {
        showToast(`Retry failed: ${fresh._error || "unknown error"}`, "alert-triangle");
      }
    } catch (err) {
      showToast("Retry failed. Please try again.");
    } finally {
      setRetryingIndex(-1);
    }
  };
  const abortRef = useRef(null);

  // Derived URL list
  const { valid: pastedUrls, invalid: invalidUrls } =
    inputTab === "paste" ? parseUrlsFromText(pasteText) : { valid: [], invalid: [] };
  const activeUrls = inputTab === "paste" ? pastedUrls : csvUrls;
  const urlCount = activeUrls.length;

  // Check plan access — get the effective max URLs for the current plan
  const batchCheck = billing?.checkCanBatch?.(Math.max(urlCount, 1)) ?? { allowed: false };
  const batchCheckOne = billing?.checkCanBatch?.(1) ?? { allowed: false };
  const planSupportsBatch = batchCheckOne.allowed ?? false;
  const planBatchLimit = batchCheckOne.allowed ? (batchCheckOne.remaining + 1) : 0;
  const MAX_URLS = planBatchLimit || ABSOLUTE_MAX_URLS;

  // Q2 — pre-flight credit estimator
  const estimate = useMemo(
    () => estimateBatchCredits({
      urlCount: Math.max(1, urlCount),
      planId: subscription?.planId || "free",
      bonusExtractions: subscription?.bonusExtractions || 0,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [urlCount, subscription?.planId, subscription?.bonusExtractions, usage?.extractions],
  );

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
    if (urlCount > ABSOLUTE_MAX_URLS) {
      showToast(`Maximum ${ABSOLUTE_MAX_URLS} URLs per batch. Remove ${urlCount - ABSOLUTE_MAX_URLS} URLs and try again.`);
      return;
    }

    const batchSizeCheck = billing?.checkCanBatch?.(urlCount);
    if (batchSizeCheck && !batchSizeCheck.allowed) {
      showToast(`${batchSizeCheck.reason} Upgrade your plan to process more URLs.`);
      navigate("/pricing");
      return;
    }

    const quotaCheck = billing?.checkCanExtractBatch?.(urlCount);
    if (quotaCheck && !quotaCheck.allowed) {
      showToast(`${quotaCheck.reason} Add an Extractions Bundle or upgrade your plan.`);
      navigate("/pricing");
      return;
    }

    // Enforce guest hard limit for batch runs
    if (!user) {
      const guestBatchCheck = guestTrial?.checkCanExtractBatch?.();
      if (guestBatchCheck && !guestBatchCheck.allowed) {
        guestTrial.setHardBlockReason?.("batch");
        guestTrial.setShowHardBlock?.(true);
        return;
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setResults(null);
    setProgress({ completed: 0, total: urlCount, current: activeUrls[0] || "" });

    // Resolve extraction options from intent chip
    const resolvedPrompt = resolveIntentPrompt(intent, customPrompt);
    const opts = { intent, personaId };
    if (renderJs) opts.renderJs = true;
    if (resolvedPrompt) opts.customPrompt = resolvedPrompt;
    if (intent === "map") opts.mapMode = true;
    if (generateContentEnabled && intent !== "map") opts.generateContent = selectedContentFormat;

    // Unique ID for this batch run — used to group results in Dashboard history.
    const batchRunId = uid();
    const batchStarted = new Date().toISOString();

    try {
      const batchResults = await runBatch(
        activeUrls,
        opts,
        (completed, total, latest) => {
          setProgress({ completed, total, current: activeUrls[completed] || "" });
          if (latest._status === "success") {
            billing?.trackExtraction?.(1);
          }
        },
        controller.signal,
      );

      if (!controller.signal.aborted) {
        setResults(batchResults);
        incrementBatchRuns(1);
        const successItems = batchResults.filter((r) => r?._status === "success");
        const failed = batchResults.filter((r) => r?._status === "error").length;
        showToast(
          `Batch complete — ${successItems.length} succeeded${failed ? `, ${failed} failed` : ""}`,
          "check-circle",
        );

        // Track guest trial (1 credit per batch run, separate from single-URL count)
        if (!user) guestTrial.trackGuestBatchRun?.(1);

        // Auto-save successful results to Dashboard + record batch run history.
        const enrichMetaObj = getEnrichMetaForIntent(intent);
        if (successItems.length > 0) {
          Promise.allSettled(
            successItems.map((r) => {
              const { _status, _error, ...cleanItem } = r;
              // Persist enrichment tab so Dashboard "View" shows the named extraction
              // type — even when empty, carrying `reason` so it's diagnosable instead
              // of silently missing (mirrors ExtractionProvider.extract()/enrich()).
              if (enrichMetaObj) {
                saveEnrichment(cleanItem.url, {
                  key: enrichMetaObj.key,
                  label: enrichMetaObj.label,
                  icon: enrichMetaObj.icon,
                  prompt: resolvedPrompt,
                  data: cleanItem.custom_extraction ?? null,
                  ...(cleanItem.custom_extraction_reason
                    ? { reason: cleanItem.custom_extraction_reason }
                    : {}),
                  created_at: cleanItem.created_at,
                });
              }
              return saveExtraction(cleanItem);
            }),
          ).then((settled) => {
            const savedRows = settled
              .filter((s) => s.status === "fulfilled")
              .map((s) => s.value);
            const savedCount = savedRows.length;

            if (savedCount > 0) {
              // Record which extraction IDs belong to this batch run
              const savedIds = savedRows.map((r) => r.id).filter(Boolean);
              recordBatchItems(batchRunId, savedIds);

              // Persist the batch run metadata for Dashboard history
              saveBatchRun({
                id: batchRunId,
                kind: "batch",
                label: makeBatchLabel(intent, urlCount, batchStarted),
                intent,
                createdAt: batchStarted,
                totalUrls: urlCount,
                successCount: savedCount,
                failedCount: failed,
              });

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

  // Auto-run once when arriving from the Home composer with autorun set.
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRanRef.current) return;
    if (location.state?.autorun && inputTab === "paste" && pastedUrls.length >= MIN_URLS && !running && !results) {
      autoRanRef.current = true;
      handleRun();
    }
  }, [pastedUrls.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Export helpers ───────────────────────────────────────────────────────────
  // Strip batch-only fields so they don't appear in exported CSV/JSON/MD columns.
  const successResults = (results || [])
    .filter((r) => r?._status === "success")
    .map(({ _status, _error, ...clean }) => clean);

  // F16 — derived view of the results table (filter + sort applied)
  const displayedResults = useMemo(() => {
    const list = Array.isArray(results) ? results : [];
    const filtered = resultsFilter === "all"
      ? list
      : list.filter((r) => (r?._status || "success") === resultsFilter);
    const sorted = [...filtered];
    switch (resultsSort) {
      case "url-asc":   sorted.sort((a, b) => (a?.url || "").localeCompare(b?.url || "")); break;
      case "url-desc":  sorted.sort((a, b) => (b?.url || "").localeCompare(a?.url || "")); break;
      case "status":    sorted.sort((a, b) => {
        const oa = a?._status === "error" ? 0 : 1;
        const ob = b?._status === "error" ? 0 : 1;
        return oa - ob;
      }); break;
      case "title":     sorted.sort((a, b) => (a?.page_title || a?.url || "").localeCompare(b?.page_title || b?.url || "")); break;
      case "headings":  sorted.sort((a, b) => (b?.headings?.length || 0) - (a?.headings?.length || 0)); break;
      case "original":
      default: break;
    }
    return sorted;
  }, [results, resultsFilter, resultsSort]);

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

  // F01 — Clipboard copy. Plan-gate the same way as the file download.
  const onCopyCsv = async () => {
    if (!billing?.checkCanExport?.("csv")) { showToast("CSV export unavailable on your plan."); return; }
    if (!successResults.length) return;
    const out = await copyToClipboard(successResults, "csv");
    if (out.ok) showToast(`Copied ${successResults.length} pages to clipboard (CSV)`, "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}). Use the CSV download instead.`, "alert-triangle");
  };
  const onCopyMarkdown = async () => {
    if (!billing?.checkCanExport?.("markdown")) { showToast("Markdown export requires Select+."); return; }
    if (!successResults.length) return;
    const out = await copyToClipboard(successResults, "markdown");
    if (out.ok) showToast(`Copied ${successResults.length} pages to clipboard (Markdown)`, "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}). Use the Markdown download instead.`, "alert-triangle");
  };
  const onCopyJson = async () => {
    if (!billing?.checkCanExport?.("json")) { showToast("JSON export requires Pro+."); return; }
    if (!successResults.length) return;
    const out = await copyToClipboard(successResults, "json");
    if (out.ok) showToast(`Copied ${successResults.length} pages to clipboard (JSON)`, "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}). Use the JSON download instead.`, "alert-triangle");
  };

  // ── Count badge colour ───────────────────────────────────────────────────────
  const countColor =
    urlCount === 0
      ? "var(--text-3)"
      : urlCount < MIN_URLS
        ? "var(--warning, #f59e0b)"
        : urlCount > ABSOLUTE_MAX_URLS
          ? "var(--danger, #e0556b)"
          : urlCount > MAX_URLS
            ? "var(--warning, #f59e0b)"
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
            Extract structured data from multiple URLs simultaneously. Import from CSV or paste a list.
            Each URL counts toward your monthly extraction quota.
            {planSupportsBatch && planBatchLimit < ABSOLUTE_MAX_URLS && (
              <span> Your plan allows up to <strong>{planBatchLimit} URLs per batch</strong>. <a href="/pricing" style={{ color: "var(--accent)" }}>Upgrade for more →</a></span>
            )}
          </p>
        </div>

        {/* Plan gate */}
        {!planSupportsBatch ? (
          <BatchGateBanner
            onUpgrade={() => navigate("/pricing")}
            planLimit={planBatchLimit}
          />
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
                        {urlCount > ABSOLUTE_MAX_URLS && ` (max ${ABSOLUTE_MAX_URLS})`}
                        {urlCount > MAX_URLS && urlCount <= ABSOLUTE_MAX_URLS && ` (plan limit: ${MAX_URLS})`}
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
                    {/* Q7 — comparable URL review grid (default table view) */}
                    <UrlReviewTable
                      urls={pastedUrls}
                      invalid={invalidUrls}
                      onRemove={(i) => {
                        // Remove by index from the original dedup'd list
                        setPasteText((prev) => {
                          const lines = prev.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                          // pastedUrls already deduped, so map index back through the original token list
                          const removed = pastedUrls[i];
                          if (!removed) return prev;
                          // Remove ALL lines that normalize to the removed URL (rare but possible via repeated lines)
                          const norm = (s) => s.replace(/^https?:\/\//i, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
                          return lines.filter((l) => norm(l) !== norm(removed)).join("\n");
                        });
                      }}
                      onClear={() => { setPasteText(""); try { localStorage.removeItem("datiq.batchDraft"); } catch { /* skip */ } }}
                    />
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

                {/* Intent chips — full parity with Home (including Map site) */}
                <div className="intent-chips batch-intent-chips">
                  <span className="intent-chips-label">What do you want to extract from each URL?</span>
                  <div className="intent-chips-row">
                    {BATCH_INTENTS.map((ic) => (
                      <button
                        key={ic.key}
                        type="button"
                        className={"intent-chip" + (intent === ic.key ? " intent-chip-active" : "")}
                        onClick={() => {
                          setIntent(ic.key);
                          if (ic.key !== "custom") setCustomPrompt("");
                          // Content generation isn't applicable for map mode
                          if (ic.key === "map") setGenerateContentEnabled(false);
                        }}
                        title={ic.desc}
                      >
                        <Icon name={ic.icon} size={14} />
                        {ic.label}
                      </button>
                    ))}
                  </div>
                  {intent === "map" && urlCount > 5 && (
                    <div className="batch-map-warning">
                      <Icon name="alert-triangle" size={13} />
                      Map mode discovers all sub-pages per domain. Running on {urlCount} URLs may take several minutes.
                    </div>
                  )}
                  {intent === "map" && (
                    <div className="batch-map-info">
                      <Icon name="info" size={13} />
                      Each URL's full domain will be crawled to discover all indexed sub-pages. Best used with root domains (e.g. company.com).
                    </div>
                  )}
                </div>

                {intent === "custom" && (
                  <div className="batch-custom-prompt">
                    <textarea
                      className="custom-extract-input"
                      rows={2}
                      placeholder='e.g. "Extract product name, price, and main CTA"'
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      aria-label="Custom extraction prompt for all URLs"
                    />
                    <div className="custom-extract-presets" style={{ marginTop: 8 }}>
                      <span className="preset-lead">Quick actions</span>
                      {QUICK_ACTIONS.map((a) => (
                        <button key={a.key} type="button" className="preset-chip" onClick={() => setCustomPrompt(a.prompt)} title={a.prompt}>
                          <Icon name={a.icon} size={12} /> {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advanced: Render JS */}
                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <button
                    type="button"
                    className="advanced-toggle"
                    onClick={() => setShowAdvanced((v) => !v)}
                  >
                    <Icon name={showAdvanced ? "chevron-up" : "chevron-down"} size={13} />
                    Advanced options
                  </button>
                </div>
                {showAdvanced && (
                  <div className="advanced-section">
                    <label className="advanced-row">
                      <input
                        type="checkbox"
                        checked={renderJs}
                        onChange={(e) => setRenderJs(e.target.checked)}
                        style={{ accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0 }}
                      />
                      <span className="advanced-row-label">
                        <Icon name="zap" size={14} />
                        Render JavaScript
                        <span className="advanced-row-hint">Waits 3 s for React/Vue/Angular SPAs — slower but accurate</span>
                      </span>
                    </label>
                    {intent !== "map" && (
                      <>
                        <label className="advanced-row">
                          <input
                            type="checkbox"
                            checked={generateContentEnabled}
                            onChange={(e) => setGenerateContentEnabled(e.target.checked)}
                            style={{ accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0 }}
                          />
                          <span className="advanced-row-label">
                            <Icon name="sparkles" size={14} />
                            Generate AI content for each URL
                            <span className="advanced-row-hint">Creates content per result (+1–2 s per URL)</span>
                          </span>
                        </label>
                        {generateContentEnabled && (
                          <div className="advanced-content-format">
                            <span className="advanced-content-format-label">Content type:</span>
                            <div className="advanced-content-format-chips">
                              {CONTENT_FORMATS.map((f) => (
                                <button
                                  key={f.key}
                                  type="button"
                                  className={"adv-format-chip" + (selectedContentFormatKey === f.key ? " adv-format-chip-active" : "")}
                                  onClick={() => setSelectedContentFormatKey(f.key)}
                                  title={f.desc}
                                >
                                  <Icon name={f.icon} size={12} />
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Quota note */}
                {urlCount >= MIN_URLS && (
                  <p className="batch-quota-note">
                    <Icon name="info" size={13} />
                    Running this batch will use <b>{urlCount}</b> of your monthly extraction quota.
                  </p>
                )}

                {/* Q2 — pre-flight credit estimator */}
                {urlCount > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <CreditEstimator estimate={estimate} />
                  </div>
                )}

                {/* Run button */}
                <div className="batch-run-row">
                  <Button
                    variant="primary"
                    icon="layers-2"
                    iconRight="arrow-right"
                    onClick={handleRun}
                    disabled={urlCount < MIN_URLS || urlCount > ABSOLUTE_MAX_URLS || (estimate && !estimate.allowed)}
                    style={{ minWidth: 200 }}
                  >
                    Extract {urlCount >= MIN_URLS ? urlCount : ""} URL{urlCount !== 1 ? "s" : ""}
                  </Button>
                  <span className="batch-run-hint">
                    {urlCount < MIN_URLS
                      ? `Add at least ${MIN_URLS} URLs to start`
                      : urlCount > ABSOLUTE_MAX_URLS
                        ? `Reduce to ${ABSOLUTE_MAX_URLS} URLs max`
                        : urlCount > MAX_URLS
                          ? `Your plan limit is ${MAX_URLS} URLs — upgrade for more`
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
                  <div className="batch-results-ctas">
                    <ExportDropdown
                      onCsv={onExportCsv}
                      onPdf={onExportPdf}
                      onMarkdown={onExportMarkdown}
                      onJson={onExportJson}
                      onCopyCsv={onCopyCsv}
                      onCopyMarkdown={onCopyMarkdown}
                      onCopyJson={onCopyJson}
                      onSendTo={() => setIntegrationsOpen(true)}
                      disabled={!successResults.length}
                    />
                    <PushIntegrationMenu items={successResults} buttonVariant="secondary" />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="refresh"
                      onClick={() => { setResults(null); setPasteText(""); setCsvFile(null); setCsvUrls([]); try { localStorage.removeItem("datiq.batchDraft"); } catch { /* skip */ } }}
                    >
                      New batch
                    </Button>
                    <Button
                      variant="primary"
                      icon="bookmark"
                      iconRight="arrow-right"
                      size="sm"
                      onClick={() => navigate("/dashboard")}
                    >
                      View in Dashboard
                    </Button>
                  </div>
                </div>

                <div className="card table-wrap batch-table-wrap">
                  <div className="batch-table-controls">
                    <div className="batch-table-control-group">
                      <span className="batch-table-control-label">Filter</span>
                      <div className="batch-filter-chips">
                        {[
                          { key: "all",     label: "All",      icon: "list-checks" },
                          { key: "success", label: "Success",  icon: "check" },
                          { key: "error",   label: "Failed",   icon: "x" },
                        ].map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            className={"batch-filter-chip" + (resultsFilter === f.key ? " batch-filter-chip-active" : "")}
                            onClick={() => setResultsFilter(f.key)}
                            title={`Show ${f.label.toLowerCase()} rows`}
                          >
                            <Icon name={f.icon} size={11} />
                            {f.label}
                            <span className="batch-filter-chip-count">
                              {f.key === "all" ? results.length :
                                f.key === "success" ? results.filter((r) => r?._status === "success").length :
                                results.filter((r) => r?._status === "error").length}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="batch-table-control-group">
                      <span className="batch-table-control-label">Sort</span>
                      <select
                        className="batch-sort-select"
                        value={resultsSort}
                        onChange={(e) => setResultsSort(e.target.value)}
                        aria-label="Sort batch results"
                      >
                        <option value="original">Original order</option>
                        <option value="url-asc">URL (A→Z)</option>
                        <option value="url-desc">URL (Z→A)</option>
                        <option value="status">Status (errors first)</option>
                        <option value="title">Title (A→Z)</option>
                        <option value="headings">Most headings</option>
                      </select>
                    </div>
                  </div>
                  <table className="batch-table">
                    <thead>
                      <tr>
                        <th className="batch-th-num">#</th>
                        <th>Page</th>
                        <th className="batch-th-meta">Summary &amp; details</th>
                        <th className="batch-th-status">Status</th>
                        <th className="batch-th-act"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedResults.map((item, i) => {
                        // Map filtered/sorted index back to the original results
                        // index so retry/view handlers still work correctly.
                        const originalIdx = results.indexOf(item);
                        return (
                          <ResultRow
                            key={item?.id || originalIdx}
                            item={item}
                            index={originalIdx}
                            onView={view}
                            onRetry={handleRetry}
                            retrying={retryingIndex === originalIdx}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {integrationsOpen && successResults.length > 0 && (
        <ExportIntegrations
          items={successResults}
          onClose={() => setIntegrationsOpen(false)}
        />
      )}
    </div>
  );
}
