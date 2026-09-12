// Preview.jsx — review & save interface (route "/preview").
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import StructuredData from "../components/StructuredData.jsx";
import StructuredFacts from "../components/StructuredFacts.jsx";
import { userFacingMessage, isOperatorFault } from "../lib/aiFailureCopy.js";
import { CAPABILITY_SCHEMAS } from "../lib/extractionSchemas.js";
import ContentView from "../components/ContentView.jsx";
import ExtractionCharts from "../components/ExtractionCharts.jsx";
import ExtractSimilarCard from "../components/ExtractSimilarCard.jsx";
import TagChips from "../components/TagChips.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { isComplianceError } from "../lib/errorMessages.js";
import { isAccountBlocked } from "../lib/entitlementModel.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { resolveTemplateUserId, readBrandKit } from "../lib/whiteLabelTemplate.js";
import { deleteExtraction } from "../lib/extractionsRepo.js";
import { shareExtraction, unshareExtraction, getSharedSlugForId, buildPublicUrl, recordPublicShare, recordPublicUnshare } from "../lib/shareService.js";
import { lifecycle as analytics } from "../lib/analyticsService.js";
import { summariseProvenance } from "../lib/provenanceService.js";
import ProvenanceBadge, { ProvenanceSummary } from "../components/ProvenanceBadge.jsx";
import FeedbackWidget from "../components/FeedbackWidget.jsx";
import { hostOf, pathOf, isExternal, timeAgo, csvDownload, excelDownload, openInGoogleSheets, markdownDownload, jsonDownload, copyToClipboard } from "../lib/utils.js";
import { categoryOf, isCategory, CATEGORY_META, categoryCounts } from "../lib/linkCategorizer.js";
import { QUICK_ACTIONS, QUICK_ACTION_BY_KEY } from "../lib/extractionPresets.js";
import { CONTENT_FORMATS } from "../lib/aiService.js";
import ExportMenu from "../components/ExportMenu.jsx";
import EmailModal from "../components/EmailModal.jsx";
import { apiClient } from "../lib/apiClient.js";
import { useSeo } from "../hooks/useSeo.js";

function HeadingRow({ h }) {
  const level = Math.max(1, parseInt(String(h.tag).replace(/\D/g, ""), 10) || 1);
  return (
    <div className="hd-row" style={{ paddingLeft: (level - 1) * 22 }}>
      {level > 1 && <span className="hd-guide" />}
      <span className="tag-pill">{h.tag}</span>
      <span
        className="hd-text"
        style={{
          fontWeight: level <= 2 ? 650 : 500,
          fontSize: level === 1 ? "1.05em" : level >= 5 ? ".9em" : "1em",
          color: level >= 5 ? "var(--text-2)" : "var(--text)",
        }}
      >
        {h.text}
      </span>
    </div>
  );
}

function LinkRow({ link, base }) {
  const cat = isCategory(link.category) ? link.category : categoryOf(link.href, base);
  const meta = CATEGORY_META[cat];
  return (
    <a className="lnk-row" href={link.href} target="_blank" rel="noopener noreferrer">
      <FaviconDot url={link.href} />
      <span className="lnk-text" title={link.text}>{link.text}</span>
      <span className="lnk-href" title={link.href}>
        <span className="lnk-host">{hostOf(link.href)}</span>
        <span className="lnk-path">{pathOf(link.href)}</span>
      </span>
      <span className={"lnk-cat cat-" + cat} title={meta.label}>
        <Icon name={meta.icon} size={12} /> {meta.label}
      </span>
    </a>
  );
}

// Searchable list of URLs discovered by the "Map entire domain" feature.
function DomainMapCard({ urls, base }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shown = term ? urls.filter((u) => u.toLowerCase().includes(term)) : urls;
  return (
    <div className="card rise" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card-head">
        <span className="ch-icon">
          <Icon name="map" size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>Domain map</h3>
          <p className="ch-sub">All indexed URLs discovered on {hostOf(base)}</p>
        </div>
        <span className="count-pill ch-meta">{urls.length}</span>
      </div>
      <div className="field-shell dash-search" style={{ margin: "0 16px 12px" }}>
        <span className="field-lead">
          <Icon name="search" size={16} />
        </span>
        <input
          className="field-input"
          type="text"
          placeholder="Filter URLs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter mapped URLs"
        />
        {q && (
          <button className="dash-search-clear" onClick={() => setQ("")} aria-label="Clear filter">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      <div className="scroll-y lnk-list">
        {shown.length === 0 ? (
          <div className="empty-mini">No URLs match "{q}".</div>
        ) : (
          shown.map((u, i) => (
            <a key={i} className="lnk-row" href={u} target="_blank" rel="noopener noreferrer">
              <FaviconDot url={u} />
              <span className="lnk-text">{pathOf(u) === "/" ? hostOf(u) : pathOf(u)}</span>
              <span className="lnk-href">
                <span className="lnk-host">{hostOf(u)}</span>
                <span className="lnk-path">{pathOf(u)}</span>
              </span>
              <Icon name="external" size={13} style={{ color: "var(--text-3)" }} />
            </a>
          ))
        )}
      </div>
    </div>
  );
}

// A saved enrichment entry counts as "nothing found" when its data is
// null/undefined, an empty object, or an empty array — not just null.
// Content-kind entries (a {text} blob) are exempt: an empty string is a
// legitimate (if unlikely) generation result, not a missing extraction.
function isEmptyEnrichmentData(data) {
  if (data == null) return true;
  if (typeof data === "string") return data.trim() === "";
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object" && typeof data.text !== "string") {
    return Object.keys(data).length === 0;
  }
  return false;
}

// An empty enrichment tab has to say WHICH kind of empty it is. "No data
// returned" was previously shown for a server with no AI key, a failing AI
// provider, and a page that genuinely has no pricing on it — so the one
// actionable case (an unset env var) looked exactly like the two where the
// user should just move on. `reason` is set by /api/extract; older saved
// entries have none and keep the original wording.
/**
 * What an EMPTY enrichment tab says to a CUSTOMER.
 *
 * ⚠️ Two wrong versions preceded this one, in opposite directions:
 *   1. "No data returned for this capability" — identical for a dead provider
 *      account and a page that genuinely has no pricing. It made a total
 *      outage indistinguishable from a normal result, for weeks.
 *   2. "The AI provider account is out of credit. An administrator needs to
 *      top up billing." — true, actionable, and none of a customer's business.
 *      It leaked our billing state, our vendors and our env var names to
 *      people who could do nothing with any of it.
 *
 * The split is now explicit and lives in src/lib/aiFailureCopy.js: customers
 * get one honest generic sentence, operators get the full diagnosis on
 * /admin/ai and /admin/health. Do not reintroduce a per-code customer message.
 */
export function emptyEnrichmentMessage(reason, opts = {}) {
  return userFacingMessage(reason, { what: opts.what || "this capability" });
}

/**
 * Is this empty tab OUR fault or the page's? Drives whether the UI frames it
 * as a temporary problem worth retrying, or as a finding about the page.
 */
export function isEnrichmentOurFault(reason) {
  return isOperatorFault(reason);
}

export default function Preview() {
  useSeo({
    title: "DatIQ Preview — review your extraction | DatIQ.app",
    description:
      "DatIQ Preview — review your extracted data, run Quick Enrichment, save to Dashboard, and export to CSV or PDF. DatIQ.app is the zero-code web data extraction platform for marketers and researchers.",
    canonical: "https://datiq.app/preview",
  });
  const navigate = useNavigate();
  const showToast = useToast();
  const { current, enrich, enrichWithContent } = useExtraction();
  const { checkCanExport, checkCanEmail } = useBilling();
  const [filter, setFilter] = useState("all");
  const [runningKey, setRunningKey] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (current?.activeTab && current?.enrichments?.[current.activeTab]) {
      return current.activeTab;
    }
    const enrichKeys = Object.keys(current?.enrichments || {});
    if (current?.intent && current.intent !== "summary" && current.intent !== "map") {
      const match = enrichKeys.find(
        (k) => k === current.intent || (current.intent === "contacts" && (k === "contacts" || k === "leadership"))
      );
      if (match) return match;
    }
    if (enrichKeys.length > 0 && current?.custom_extraction != null) {
      return enrichKeys[0];
    }
    return "overview";
  });
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharedSlug, setSharedSlug] = useState(() => current?.id ? getSharedSlugForId(current.id) : null);
  const downloadRef = useRef(null);
  const shareRef = useRef(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (current?.activeTab && current?.enrichments?.[current.activeTab]) {
      setActiveTab(current.activeTab);
    } else if (current?.intent && current.intent !== "summary" && current.intent !== "map") {
      const enrichKeys = Object.keys(current?.enrichments || {});
      const match = enrichKeys.find(
        (k) => k === current.intent || (current.intent === "contacts" && (k === "contacts" || k === "leadership"))
      );
      if (match) setActiveTab(match);
    }
  }, [current?.id, current?.activeTab]);

  useEffect(() => {
    if (!downloadOpen) return;
    const handler = (e) => { if (downloadRef.current && !downloadRef.current.contains(e.target)) setDownloadOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [downloadOpen]);

  useEffect(() => {
    if (!shareOpen) return;
    const handler = (e) => { if (shareRef.current && !shareRef.current.contains(e.target)) setShareOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [shareOpen]);

  // Q6 — when the current extraction changes (e.g. user opens a different one
  // from Dashboard), refresh the share state to match.
  useEffect(() => {
    setSharedSlug(current?.id ? getSharedSlugForId(current.id) : null);
  }, [current?.id]);


  // Q6 — share handlers
  const handleShare = async () => {
    if (!current?.id) { showToast("Save the extraction before sharing."); return; }
    setShareOpen(false);
    try {
      const alreadyHadLocalLink = Boolean(getSharedSlugForId(current.id));
      const { slug, persistedTo, refreshed } = await shareExtraction(current);
      setSharedSlug(slug);
      // FA1 — count this as a public report (free-tier quota mechanic)
      if (!alreadyHadLocalLink) recordPublicShare(current.id);
      analytics.exported({ format: "share", source: "preview", persistedTo });

      // Four outcomes, and they are genuinely different things to say. The
      // verb changes on whether a link already existed, because "created" is
      // wrong for the Sync action the user reached this from.
      const verb = alreadyHadLocalLink ? "Public link is live" : "Public link created";
      let msg;
      if (persistedTo === "supabase" && refreshed === false) {
        // Live, but this browser could not overwrite the published copy — see
        // the RLS note in shareService. Not a failure; the link works.
        msg = `${verb} — already published. Sign in to update its contents.`;
      } else if (persistedTo === "supabase" || persistedTo === "both") {
        msg = `${verb} — works in any browser.`;
      } else {
        msg = `${verb} in this browser only. Sign in to make it work everywhere.`;
      }
      showToast(msg, "check");
    } catch (err) {
      // Never name Supabase here, and never claim data was lost: the
      // extraction itself is untouched — only the public link failed. The old
      // copy ("nothing was saved locally. Check Supabase configuration") told
      // an end user to debug a vendor they have no relationship with, about a
      // loss that had not happened.
      showToast(err?.code === "PUBLIC_PUBLISH_FAILED"
        ? "Couldn't create the public link just now. Your extraction is safe — please try again."
        : "Share failed. Please try again.", "alert-triangle");
      console.warn("[DatIQ] Share failed:", err);
    }
  };

  const handleCopyShareLink = async () => {
    if (!sharedSlug) return;
    const url = buildPublicUrl(sharedSlug);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard.", "clipboard-copy");
    } catch {
      // Fallback: open prompt
      window.prompt("Copy this link:", url);
    }
  };

  const handleUnshare = async () => {
    if (!current?.id) return;
    setShareOpen(false);
    try {
      const ok = await unshareExtraction(current.id);
      if (ok) {
        setSharedSlug(null);
        // FA1 — counter-sync on unshare
        recordPublicUnshare();
        showToast("Public link removed.", "x");
      } else {
        showToast("Nothing to remove.", "info");
      }
    } catch (err) {
      showToast("Unshare failed. Please try again.", "alert-triangle");
    }
  };

  // Persisted enrichments for this extraction become tabs. Fall back to a saved
  // custom_extraction (older shape) so it still shows as a tab.
  const enrichments = useMemo(() => {
    const map = { ...((current && current.enrichments) || {}) };
    if (Object.keys(map).length === 0 && current?.custom_extraction != null) {
      map.custom = {
        key: "custom",
        label: "Custom extraction",
        icon: "code",
        prompt: "",
        data: current.custom_extraction,
        created_at: current.created_at,
      };
    }
    return map;
  }, [current]);

  // Direct navigation with nothing to preview → send home.
  if (!current) return <Navigate to="/" replace />;

  const data = current;
  const isMap = Array.isArray(data.domain_map);
  const links = (data.links || []).filter((l) => {
    if (filter === "all") return true;
    const ext = isExternal(l.href, data.url);
    return filter === "external" ? ext : !ext;
  });
  const catCounts = categoryCounts(data.links || [], data.url);

  const enrichList = Object.values(enrichments);
  const activeEntry = enrichments[activeTab];
  const showOverview = activeTab === "overview" || !activeEntry;

  // Run (or refresh) ONE capability in the background. The page stays visible;
  // only the clicked control spins. The result is saved as a tab keyed by URL.
  const runQuickAction = async (preset) => {
    if (runningKey) return; // one at a time
    setRunningKey(preset.key);
    try {
      const entry = await enrich(data.url, preset);
      if (entry) {
        setActiveTab(preset.key);
        showToast(`${preset.label} ready`, "sparkles");
      }
    } catch (err) {
      console.error("[DatIQ] Quick enrichment failed:", err);
      // Don't blame the connection for a policy refusal. A robots.txt block is
      // the server declining deliberately, and "check your connection" sends
      // the user to debug something that is working fine. Same reasoning for
      // an account block (frozen / deletion-pending / suspended / paused
      // seat) reaching here — the pre-flight check in ExtractionProvider was
      // stale or bypassed, and the server's own message already says exactly
      // what to do (unfreeze, cancel the deletion, ask an owner to resume).
      showToast(
        isComplianceError(err)
          ? "This site doesn't allow automated access"
          : isAccountBlocked(err?.code)
            ? err.message
            : "Enrichment failed — check your connection",
        "alert-triangle",
      );
    } finally {
      setRunningKey(null);
    }
  };

  // Re-run a saved enrichment tab (uses its stored prompt, or the preset's).
  // Content tabs (kind === "content") use enrichWithContent instead of the
  // structured extractStructure path — the prompt + handler are different
  // (markdown generation vs JSON extraction), so a single switch keeps each
  // path clean.
  const refreshEntry = (entry) => {
    if (entry.kind === "content") {
      const format = CONTENT_FORMATS.find((f) => f.key === entry.key);
      if (format) runQuickContent(format);
      return;
    }
    const prompt = entry.prompt || QUICK_ACTION_BY_KEY[entry.key]?.prompt;
    if (!prompt) return;
    runQuickAction({ key: entry.key, label: entry.label, icon: entry.icon, prompt });
  };

  // Generate content (one of the 5 CONTENT_FORMATS — SEO outline, competitor
  // summary, social posts, compare, explain). Mirrors runQuickAction so the
  // user experience is identical: button spins, result lands as a stacked
  // tab, refresh button re-runs. The result is markdown text (not JSON),
  // rendered by ContentView.
  const runQuickContent = async (format) => {
    if (runningKey) return; // one at a time, same gate as structured runs
    setRunningKey(format.key);
    try {
      const entry = await enrichWithContent(data.url, format);
      if (entry) {
        setActiveTab(format.key);
        showToast(`${format.label} ready`, "sparkles");
      }
    } catch (err) {
      console.error("[DatIQ] Content generation failed:", err);
      showToast("Content generation failed — check your connection", "alert-triangle");
    } finally {
      setRunningKey(null);
    }
  };

  // Custom enrichment and custom content both need a reader-defined prompt.
  // The Home composer is the one place that captures that safely, so keep the
  // page URL and hand the reader there with its Custom option already open.
  const openCustomExtraction = () => {
    navigate("/", {
      state: {
        openCustomExtraction: true,
        url: data.url,
      },
    });
  };

  // Groke QW#2 — tags + the global tag catalogue for auto-suggest.
  const [knownTags, setKnownTags] = useState(() => new Set());
  useEffect(() => {
    let cancelled = false;
    import("../lib/tagsService.js").then(({ getAllTags }) => {
      if (cancelled) return;
      getAllTags().then((set) => { if (!cancelled) setKnownTags(set); }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [data?.id]);

  // Groke QW#2 — persist a tag change. Local-only writes (no Supabase sync
  // in v1.0 — Supabase column migration is v2.0 work).
  const onTagsChange = async (nextTags) => {
    const next = { ...data, tags: nextTags };
    try {
      // Add to local known-tags immediately so the suggestion list updates.
      setKnownTags((prev) => {
        const merged = new Set(prev);
        for (const t of nextTags) merged.add(t);
        return merged;
      });
      const { saveExtraction } = await import("../lib/extractionsRepo.js");
      await saveExtraction(next);
    } catch (e) {
      console.warn("[DatIQ] Tag save failed:", e);
    }
  };

  const onViewDashboard = () => navigate("/dashboard");

  const onDownloadCsv = () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    csvDownload([data], { brandKit: readBrandKit() });
    showToast("Exported to CSV", "download");
  };
  const onDownloadExcel = () => {
    if (!checkCanExport("csv")) { showToast("Spreadsheet export is not available on your current plan."); return; }
    excelDownload([data]);
    showToast("Exported Excel Worksheet", "sheet");
  };
  const onOpenInSheets = () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    openInGoogleSheets([data]);
    showToast("Copied table to clipboard & opened Google Sheets! Press Cmd+V (or Ctrl+V) in cell A1 to paste.", "sheet");
  };
  const onDownloadMarkdown = () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export requires the Go plan or higher."); return; }
    markdownDownload([data], { brandKit: readBrandKit() });
    showToast("Exported to Markdown", "file-code");
  };
  const onDownloadJson = () => {
    if (!checkCanExport("json")) { showToast("JSON export requires the Go plan or higher."); return; }
    jsonDownload([data], { brandKit: readBrandKit() });
    showToast("Exported to JSON", "file-json");
  };
  const onDownloadPdf = async () => {
    if (!checkCanExport("pdf")) { showToast("PDF export requires the Go plan or higher."); return; }
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      // White-label PDF: Business & Agency users can upload a branded template
      // in /account. If one is set, paint it as the background of every page
      // of the generated PDF. Falls back to a plain PDF if the template
      // read fails for any reason — we never want a bad template to break a
      // routine export.
      let template = null;
      try {
        const { readTemplate } = await import("../lib/whiteLabelTemplate.js");
        const tplRes = await readTemplate({ userId: resolveTemplateUserId() });
        if (tplRes?.ok && tplRes.value?.bytes) template = tplRes.value.bytes;
      } catch { /* swallow — plain PDF is fine */ }
      extractionsToPdf([data], { template, brandKit: readBrandKit() });
      showToast("Exported to PDF", "file");
    } catch (err) {
      if (/dynamically imported/i.test(err?.message || "")) {
        showToast("App updated — please refresh the page and try again.", "info");
      } else {
        showToast("PDF export failed. Please try again.");
      }
    }
  };

  // F01 — Clipboard copy (single extraction). Plan-gated the same as the
  // matching file download.
  const onCopySummary = async () => {
    const out = await copyToClipboard([data], "summary");
    if (out.ok) showToast("Summary copied to clipboard", "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}).`, "alert-triangle");
  };
  const onCopyCsv = async () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    const out = await copyToClipboard([data], "csv");
    if (out.ok) showToast("CSV copied to clipboard", "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}).`, "alert-triangle");
  };
  const onCopyMarkdown = async () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export requires the Go plan or higher."); return; }
    const out = await copyToClipboard([data], "markdown");
    if (out.ok) showToast("Markdown copied to clipboard", "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}).`, "alert-triangle");
  };
  const onCopyJson = async () => {
    if (!checkCanExport("json")) { showToast("JSON export requires the Go plan or higher."); return; }
    const out = await copyToClipboard([data], "json");
    if (out.ok) showToast("JSON copied to clipboard", "clipboard-copy");
    else showToast(`Copy failed (${out.reason || "unknown"}).`, "alert-triangle");
  };

  const onDelete = async () => {
    if (data.id) {
      deleteExtraction(data.id).catch((err) => console.warn("[DatIQ] Delete failed:", err));
    }
    showToast("Extraction deleted", "trash");
    navigate("/");
  };

  const handleSendEmail = async (emails, format) => {
    if (!checkCanEmail()) { showToast("Email export requires the Go plan or higher."); setEmailOpen(false); return; }
    if (!checkCanExport(format)) { showToast(`${format.toUpperCase()} export is not available on your current plan.`); return; }
    const res = await apiClient.sendExportEmail({ to: emails, items: [data], format, brandKit: readBrandKit() });
    setEmailOpen(false);
    showToast(`Email sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""}`, "mail");
    return res;
  };

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 28, paddingBottom: 64 }}>
        {/* action bar */}
        <div className="preview-bar">
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate("/")} className="back-btn">
            Back
          </Button>
          <div className="preview-bar-actions">
            <Button variant="ghost" size="sm" icon="trash" onClick={onDelete} title="Delete this extraction">
              Delete
            </Button>
            <div className="share-dropdown" ref={shareRef}>
              <Button
                variant={sharedSlug ? "secondary" : "ghost"}
                size="sm"
                icon="share"
                onClick={() => setShareOpen((v) => !v)}
                title={sharedSlug ? "Manage public link" : "Share as public link"}
              >
                {sharedSlug ? "Shared" : "Share"}
              </Button>
              {shareOpen && (
                <div className="export-dropdown-menu share-menu">
                  {sharedSlug ? (
                    <>
                      <button
                        className="export-dropdown-item"
                        onClick={handleShare}
                      >
                        <Icon name="refresh" size={14} />
                        <span>
                          <b>Sync public link</b>
                          <span className="export-plan-hint">Ensure this link is published to the cloud</span>
                        </span>
                      </button>
                      <button
                        className="export-dropdown-item"
                        onClick={() => { handleCopyShareLink(); setShareOpen(false); }}
                      >
                        <Icon name="clipboard-copy" size={14} />
                        <span>
                          <b>Copy public link</b>
                          <span className="export-plan-hint">Anyone with the URL can view this report</span>
                        </span>
                      </button>
                      <button
                        className="export-dropdown-item"
                        onClick={() => { handleUnshare(); setShareOpen(false); }}
                      >
                        <Icon name="x" size={14} />
                        <span>
                          <b>Remove public link</b>
                          <span className="export-plan-hint">Hide from the gallery</span>
                        </span>
                      </button>
                    </>
                  ) : (
                    <button
                      className="export-dropdown-item"
                      onClick={handleShare}
                    >
                      <Icon name="share" size={14} />
                      <span>
                        <b>Create public link</b>
                        <span className="export-plan-hint">A read-only URL anyone can view</span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* One shared menu — was a hand-rolled copy of the same Download/
                Copy/Email dropdown that Dashboard and Batch also carried. */}
            <ExportMenu
              items={current ? [current] : []}
              label="Download"
              buttonVariant="secondary"
            />
            <Button variant="primary" icon="bookmark" onClick={onViewDashboard}>
              View Dashboard
            </Button>
          </div>
        </div>

        {/* page identity */}
        <div className="preview-head rise">
          <FaviconDot url={data.url} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 className="preview-title" title={data.page_title}>{data.page_title}</h1>
            <a className="preview-url" href={data.url} target="_blank" rel="noopener noreferrer">
              <Icon name="globe" size={15} /> {data.url} <Icon name="external" size={13} />
            </a>
            {/* Groke QW#2 — inline tag editor (uses data so it auto-updates on change) */}
            <TagChips
              tags={data.tags || []}
              url={data.url}
              knownTags={knownTags}
              onChange={(next) => onTagsChange(next)}
            />
            {/* Q9 — per-record provenance strip */}
            {data._provenance && (
              <ProvenanceSummary extraction={data} />
            )}
          </div>
          <div className="preview-stats">
            {isMap ? (
              <div className="pstat">
                <b>{data.domain_map.length}</b>
                <span>URLs</span>
              </div>
            ) : (
              <>
                <div className="pstat">
                  <b>{data.headings.length}</b>
                  <span>headings</span>
                </div>
                <div className="pstat">
                  <b>{data.links.length}</b>
                  <span>links</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="section-gap" style={{ marginTop: "var(--gap)" }}>
          {/* AI summary */}
          <div className="card rise summary-card" style={{ animationDelay: ".05s" }}>
            <div className="card-head">
              <span className="ch-icon">
                <Icon name="sparkles" size={18} />
              </span>
              <div>
                <h3>AI summary</h3>
                <p className="ch-sub">Generated overview of the page's intent &amp; structure</p>
              </div>
              <span className="ai-badge ch-meta">
                <Icon name="zap" size={12} /> AI
              </span>
            </div>
            <div className="card-pad">
              {/* An AI summary that could not be written says so. It used to
                  be silently replaced with locally-generated placeholder prose
                  badged ai_generated — so a dead provider account produced
                  pages of confident-sounding text nothing had read. A blank
                  card naming the cause is the honest version of that. */}
              {!data.ai_summary && data.ai_summary_error ? (
                <div className="empty-mini empty-mini-fault">
                  <Icon name="alert-circle" size={15} />
                  <span>
                    {/* Generic by construction — this used to render the
                        server's operator hint, which named our billing state. */}
                    {userFacingMessage(data.ai_summary_error.code, { what: "this page" })}
                    {" "}The extracted data below is unaffected.
                  </span>
                </div>
              ) : (
                <p className="summary-text">{data.ai_summary}</p>
              )}
              {/* Q9 — provenance badge for the AI summary field */}
              {data.ai_summary && data._provenance?.fields?.ai_summary && (
                <div className="prov-row">
                  <ProvenanceBadge prov={data._provenance.fields.ai_summary[0]} compact />
                </div>
              )}
              {/* Q5 — thumbs up/down feedback widget on the AI summary */}
              {data.id && (
                <FeedbackWidget
                  extractionId={data.id}
                  url={data.url}
                  intent={data.intent || "summary"}
                />
              )}
            </div>
          </div>

          {/* At-a-glance charts (QW#3) — auto-generated from extracted structure */}
          {!isMap && <ExtractionCharts extraction={data} />}

          {/* Extract Similar (DeepSeq QW#1) — suggest 2-3 same-domain siblings */}
          {!isMap && <ExtractSimilarCard extraction={data} />}

          {/* Quick enrichment + Generate content (hidden in map mode). */}
          {!isMap && (
            <div className="card rise quick-actions" style={{ animationDelay: ".07s" }}>
              <div className="qa-head">
                <span className="ch-icon">
                  <Icon name="wand" size={18} />
                </span>
                <div style={{ flex: 1 }}>
                  <h3>Quick enrichment &amp; content</h3>
                  <p className="ch-sub">
                    Run a focused AI extraction — each result is saved as a tab below
                  </p>
                </div>
              </div>

              {/* Structured enrichments (Find Contact Info, Leadership & Board, …).
                  Returns JSON; rendered via StructuredData in the tab body. */}
              <div className="qa-row">
                {QUICK_ACTIONS.map((a) => {
                  const running = runningKey === a.key;
                  const done = !!enrichments[a.key];
                  return (
                    <button
                      key={a.key}
                      className={"qa-btn" + (running ? " running" : "") + (done ? " done" : "")}
                      onClick={() => runQuickAction(a)}
                      disabled={!!runningKey}
                      title={done ? `Re-run "${a.label}" (refresh)` : a.prompt}
                    >
                      <span className="qa-ico">
                        <Icon name={a.icon} size={14} />
                        {running && <span className="qa-spin" />}
                        {!running && done && (
                          <span className="qa-done">
                            <Icon name="check" size={9} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      {a.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="qa-btn qa-btn-custom"
                  onClick={openCustomExtraction}
                  title="Describe the enrichment you want to run"
                >
                  <span className="qa-ico"><Icon name="code" size={14} /></span>
                  Custom enrichment
                </button>
              </div>

              {/* Generated content (SEO outline, competitor summary, …).
                  Returns markdown; rendered via ContentView in the tab body.
                  Lives in its own sub-section so the user can tell at a
                  glance that the two button rows produce different output
                  shapes. Each click creates a stacked tab like the
                  structured ones and persists to localStorage + Supabase. */}
              <div className="qa-subsection">
                <div className="qa-subsection-head">
                  <Icon name="sparkles" size={12} />
                  <span>Generate content</span>
                </div>
                <div className="qa-row">
                  {CONTENT_FORMATS.map((f) => {
                    const running = runningKey === f.key;
                    const done = !!enrichments[f.key];
                    return (
                      <button
                        key={f.key}
                        className={"qa-btn" + (running ? " running" : "") + (done ? " done" : "")}
                        onClick={() => runQuickContent(f)}
                        disabled={!!runningKey}
                        title={done ? `Re-run "${f.label}" (refresh)` : f.desc}
                      >
                        <span className="qa-ico">
                          <Icon name={f.icon} size={14} />
                          {running && <span className="qa-spin" />}
                          {!running && done && (
                            <span className="qa-done">
                              <Icon name="check" size={9} strokeWidth={3} />
                            </span>
                            )}
                        </span>
                        {f.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="qa-btn qa-btn-custom"
                    onClick={openCustomExtraction}
                    title="Describe the content you want DatIQ to create"
                  >
                    <span className="qa-ico"><Icon name="code" size={14} /></span>
                    Custom content
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tabs: Overview + one per saved enrichment capability */}
          {enrichList.length > 0 && (
            <div className="pv-tabs rise" role="tablist">
              <button
                className={"pv-tab" + (showOverview ? " on" : "")}
                onClick={() => setActiveTab("overview")}
                role="tab"
                aria-selected={showOverview}
              >
                <Icon name={isMap ? "map" : "layers"} size={14} /> Overview
              </button>
              {enrichList.map((e) => (
                <button
                  key={e.key}
                  className={"pv-tab" + (activeTab === e.key ? " on" : "")}
                  onClick={() => setActiveTab(e.key)}
                  role="tab"
                  aria-selected={activeTab === e.key}
                >
                  <span className="qa-ico">
                    <Icon name={e.icon} size={14} />
                    {runningKey === e.key && <span className="qa-spin" />}
                  </span>
                  {e.label}
                </button>
              ))}
            </div>
          )}

          {/* Enrichment tab content */}
          {!showOverview && (
            <div className="card rise" style={{ animationDelay: ".04s" }}>
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name={activeEntry.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{activeEntry.label}</h3>
                  <p className="ch-sub">
                    Saved {timeAgo(activeEntry.created_at)} ·{" "}
                    {activeEntry.kind === "content" ? "generated content for this page" : "structured data for this capability"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={runningKey === activeEntry.key ? null : "refresh"}
                  onClick={() => refreshEntry(activeEntry)}
                  // Content tabs refresh via the format catalogue, structured
                  // tabs via QUICK_ACTION_BY_KEY. Either path needs the
                  // matching preset to be present, so the button is disabled
                  // when neither lookup resolves.
                  disabled={
                    !!runningKey ||
                    !(activeEntry.prompt ||
                      QUICK_ACTION_BY_KEY[activeEntry.key]?.prompt ||
                      (activeEntry.kind === "content" && CONTENT_FORMATS.some((f) => f.key === activeEntry.key)))
                  }
                >
                  {runningKey === activeEntry.key ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              <div className="card-pad">
                {isEmptyEnrichmentData(activeEntry.data) ? (
                  <div className={`empty-mini${isEnrichmentOurFault(activeEntry.reason) ? " empty-mini-fault" : ""}`}>
                    {isEnrichmentOurFault(activeEntry.reason) ? <Icon name="alert-circle" size={15} /> : null}
                    {/* Name the capability, so "we found nothing matching
                        Pricing & Plans" is a claim the reader can check
                        against the pages listed below it. */}
                    <span>{emptyEnrichmentMessage(activeEntry.reason, { what: activeEntry.label })}</span>
                    {!isEnrichmentOurFault(activeEntry.reason) && activeEntry.pages?.length > 1 ? (
                      <span className="empty-mini-pages">
                        {" "}Pages read: {activeEntry.pages.map((u) => u.replace(/^https?:\/\//, "")).join(", ")}.
                      </span>
                    ) : null}
                  </div>
                ) : activeEntry.kind === "content" || typeof activeEntry.data?.text === "string" ? (
                  // Content-kind (or any entry whose data is a {text} blob)
                  // renders via ContentView — markdown + Copy button. The
                  // dual check covers both explicitly-tagged content entries
                  // and older entries that only have the {text} shape.
                  <ContentView text={activeEntry.data.text || ""} />
                ) : (
                  // Grouped sections, tables for repeated records, and the
                  // evidence quotes behind each fact — not a JSON dump. The
                  // groups come from the capability's own schema, so a pricing
                  // tab renders as plans and a leadership tab as people.
                  <StructuredFacts
                    data={activeEntry.data}
                    groups={CAPABILITY_SCHEMAS[activeEntry.key]?.groups}
                    meta={activeEntry.meta}
                    title={activeEntry.label}
                  />
                )}
              </div>
            </div>
          )}

          {/* Overview tab content — domain map OR the headings/links grid */}
          {showOverview &&
            (isMap ? (
              <DomainMapCard urls={data.domain_map} base={data.url} />
            ) : (
              <div className="preview-grid">
            <div
              className="card rise"
              style={{ animationDelay: ".1s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="list-tree" size={18} />
                </span>
                <div>
                  <h3>Headings</h3>
                  <p className="ch-sub">H1–H6 outline</p>
                </div>
                <span className="count-pill ch-meta">{data.headings.length}</span>
              </div>
              <div className="scroll-y hd-list">
                {data.headings.map((h, i) => (
                  <HeadingRow key={i} h={h} />
                ))}
              </div>
            </div>

            <div
              className="card rise"
              style={{ animationDelay: ".15s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="link" size={18} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ch-title-row">
                    <h3>Links</h3>
                    <span className="ai-badge">
                      <Icon name="sparkles" size={12} /> AI tagged
                    </span>
                  </div>
                  <p className="ch-sub lnk-cat-counts">
                    {catCounts.map((c, i) => (
                      <span key={c.key} className="lnk-cat-count">
                        {i > 0 && <span className="dot-sep">·</span>}
                        <span className={"cat-dot cat-" + c.key} /> {c.count} {c.label.toLowerCase()}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="seg-filter ch-meta">
                  {["all", "internal", "external"].map((f) => (
                    <button
                      key={f}
                      className={"seg-opt" + (filter === f ? " on" : "")}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="scroll-y lnk-list">
                {links.length === 0 ? (
                  <div className="empty-mini">No {filter} links found.</div>
                ) : (
                  links.map((l, i) => <LinkRow key={i} link={l} base={data.url} />)
                )}
              </div>
            </div>
          </div>
            ))}
        </div>
      </div>
      {emailOpen && (
        <EmailModal
          items={[data]}
          hint="Sent as a real attached file — pick a format below."
          formats={["csv", "pdf", "markdown", "json"].filter(checkCanExport)}
          onSend={handleSendEmail}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  );
}
