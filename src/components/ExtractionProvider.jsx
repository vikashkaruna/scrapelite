// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractStructure } from "../lib/firecrawlService.js";
import { summarize, categorizeLinks, generateContent, CONTENT_FORMATS } from "../lib/aiService.js";
import { saveExtraction, updateEnrichments } from "../lib/extractionsRepo.js";
import {
  readEnrichments,
  saveEnrichment,
  saveCurrent,
  readCurrent,
} from "../lib/enrichmentStore.js";
import { enrichMeta } from "../lib/extractionPresets.js";
import { lifecycle as analytics } from "../lib/analyticsService.js";
import { attachProvenance } from "../lib/provenanceService.js";
import { useErrorModal } from "./ErrorModal.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import { uid } from "../lib/utils.js";

const ExtractionContext = createContext(null);

export function useExtraction() {
  return useContext(ExtractionContext);
}

export function ExtractionProvider({ children }) {
  const navigate = useNavigate();
  const showError = useErrorModal();
  const showToast = useToast();
  const billing = useBilling();
  const { user } = useAuth();
  const guestTrial = useGuestTrial();
  // Restore the last-viewed extraction so /preview survives a browser reload.
  const [current, setCurrent] = useState(readCurrent);
  const [loading, setLoading] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState("");
  // Non-blocking background-extraction job that drives the global progress dock.
  // Shape: { status: "running" | "done", url, phase: 0-3, path, resultId }.
  // A null job means the dock is hidden. This REPLACES the old full-screen
  // LoadingScreen that blanked the whole app while a single extraction ran.
  const [job, setJob] = useState(null);
  const reqId = useRef(0);
  const lastUrl = useRef("");
  const lastOpts = useRef({});

  // Advance the dock's stepped progress (Fetching → Parsing → Links → AI) while
  // the job is running. Purely cosmetic pacing — the real work is async below.
  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(() => {
      setJob((j) => (j && j.status === "running" ? { ...j, phase: Math.min(j.phase + 1, 3) } : j));
    }, 700);
    return () => clearInterval(t);
  }, [job?.status]);

  // Set `current` and mirror it to localStorage (so a reload restores the page).
  const commitCurrent = (next) => {
    setCurrent(next);
    saveCurrent(next);
  };

  // Run Firecrawl + AI, then route to the preview screen.
  const extract = useCallbackSafe(async (url, options = {}) => {
    // Enforce plan limits before starting
    const limitCheck = billing?.checkCanExtract?.();
    if (limitCheck && !limitCheck.allowed) {
      showToast?.(limitCheck.reason + " Upgrade your plan to continue.");
      navigate("/pricing");
      return;
    }

    // Enforce guest hard limit before starting (single-URL extraction)
    if (!user) {
      const guestCheck = guestTrial?.checkCanExtractSingle?.();
      if (guestCheck && !guestCheck.allowed) {
        guestTrial.setHardBlockReason?.("single");
        guestTrial.setShowHardBlock?.(true);
        return;
      }
    }

    const id = ++reqId.current;
    lastUrl.current = url;
    lastOpts.current = options;
    setLoadingUrl(url);
    setLoading(true);
    // Remember where the extraction was launched from. On completion we only
    // auto-navigate to /preview if the user is STILL on this page; if they've
    // moved on, we leave them be and surface a "View" button in the dock.
    const startedPath = typeof window !== "undefined" ? window.location.pathname : "/";
    setJob({ status: "running", url, phase: 0, path: startedPath });
    const startedAt = Date.now();
    try {
      const structure = await extractStructure(url, options);

      let result;
      if (structure.domain_map) {
        // Domain-mapping mode: no page to summarize or links to categorize —
        // just carry the discovered URL list straight to the preview.
        if (reqId.current !== id) return;
        result = {
          ...structure,
          ai_summary:
            `Mapped ${structure.domain_map.length} indexed URL` +
            `${structure.domain_map.length === 1 ? "" : "s"} on ${url}.`,
          id: uid(),
          created_at: new Date().toISOString(),
        };
      } else {
        // Standard (and custom-extraction) mode: summarize and AI-tag concurrently.
        const [ai_summary, links] = await Promise.all([
          summarize(structure),
          categorizeLinks(structure.links, structure.url),
        ]);
        if (reqId.current !== id) return; // superseded by a newer extraction
        result = {
          ...structure,
          links,
          ai_summary,
          id: uid(),
          created_at: new Date().toISOString(),
        };
        // Reload any enrichments previously saved for this URL (persisted tabs).
        const enrichments = readEnrichments(url);
        // A custom/contacts extraction run from Home is itself a capability —
        // record it as an enrichment so it persists and shows as a tab.
        if (result.custom_extraction != null && options.enrichMeta) {
          const meta = options.enrichMeta;
          const entry = {
            key: meta.key,
            label: meta.label,
            icon: meta.icon,
            prompt: options.customPrompt || "",
            data: result.custom_extraction,
            created_at: result.created_at,
          };
          enrichments[meta.key] = entry;
          saveEnrichment(url, entry);
        }
        result.enrichments = enrichments;
      }
      // Q9 — wrap with provenance (per-record + per-field metadata)
      const withProv = attachProvenance(result, { now: result.created_at });
      commitCurrent(withProv);
      setLoading(false);
      billing?.trackExtraction?.();
      // Track guest trial for non-logged-in users (1 credit per single-URL extraction).
      if (!user) guestTrial?.trackGuestExtraction?.(1);
      // Q11 — analytics: success + first-insight + activation
      const props = {
        url, intent: options.intent || "summary",
        duration_ms: Date.now() - startedAt,
        has_custom: Boolean(result.custom_extraction),
        domain_map: Boolean(result.domain_map),
      };
      analytics.extractionSucceeded(props);
      analytics.firstInsight(props);
      // Auto-save to database (fire-and-forget); marks the extraction as saved
      // so Preview shows "View Dashboard" instead of "Save to Dashboard".
      saveExtraction(result)
        .then(() => {
          commitCurrent({ ...result, _saved: true });
          analytics.saved({ url, intent: props.intent });
        })
        .catch((err) => console.warn("[DatIQ] Auto-save failed:", err));
      // Completion handling: if the user is still on the page they launched
      // from, take them straight to the result (the expected flow). If they've
      // navigated elsewhere, DON'T yank them — leave a "done" dock with a
      // "View extraction" button and a toast so they can jump over when ready.
      const stillOnStartPage =
        typeof window !== "undefined" && window.location.pathname === startedPath;
      if (stillOnStartPage) {
        setJob(null);
        navigate("/preview");
      } else {
        setJob({ status: "done", url, phase: 3, path: startedPath, resultId: result.id });
        showToast?.("Extraction ready — open it from the panel.", "check-circle");
      }
    } catch (err) {
      if (reqId.current !== id) return;
      console.error("[DatIQ] Extraction failed:", err);
      setLoading(false);
      setJob(null);
      // Q11 — analytics: failure
      analytics.extractionFailed({ url, intent: options.intent || "summary", error: String(err?.message || err) });
      navigate("/");
      // Show modal with a "Try again" button that re-submits the same URL + options.
      showError(err, {}, () => extract(lastUrl.current, lastOpts.current));
    }
  });

  // Background enrichment (Quick Actions on the Preview screen). Runs a focused
  // extraction for ONE capability and stores the result as a named entry on
  // current.enrichments[preset.key] (a new tab) — it does NOT toggle the
  // full-screen loader, navigate, or replace the page, so everything stays
  // visible. Re-running the same preset overwrites its entry (a refresh). The
  // entry is persisted per-URL so it reloads next time the page is viewed.
  const enrich = useCallbackSafe(async (url, preset) => {
    // Enforce enrichment limits (only on first run for a preset, not refresh)
    const limitCheck = billing?.checkCanEnrich?.(url);
    if (limitCheck && !limitCheck.allowed) {
      showToast?.(limitCheck.reason);
      return null;
    }

    const id = ++reqId.current;
    const structure = await extractStructure(url, { customPrompt: preset.prompt });
    if (reqId.current !== id) return null; // superseded by a newer run
    const entry = {
      key: preset.key,
      label: preset.label,
      icon: preset.icon,
      prompt: preset.prompt,
      data: structure.custom_extraction ?? null,
      created_at: new Date().toISOString(),
    };
    saveEnrichment(url, entry); // local cache (keyed by URL)
    billing?.trackEnrichment?.(url);
    const base = current && current.url === url ? current : { url };
    const nextEnrichments = { ...(base.enrichments || {}), [preset.key]: entry };
    commitCurrent({ ...base, enrichments: nextEnrichments });
    // If this extraction is already saved, sync the full map to the backend so
    // the tabs persist in Supabase (and across devices). Fire-and-forget.
    if (base._saved && base.id) {
      updateEnrichments(base.id, nextEnrichments).catch((err) =>
        console.warn("[DatIQ] Enrichment sync failed:", err),
      );
    }
    return entry;
  });

  // Generate content enrichment (one of CONTENT_FORMATS — SEO outline, competitor
  // summary, social posts, compare, explain). Generates a markdown blob via
  // aiService.generateContent, then stores it as a "content" kind enrichment
  // entry so it shows up as a stacked tab like the structured enrichments.
  // The content is wrapped in { text } so the same persistence path (local
  // cache + Supabase) works unchanged; the renderer in Preview.jsx switches
  // on entry.kind === "content" and shows the markdown + a Copy button
  // instead of StructuredData.
  const enrichWithContent = useCallbackSafe(async (url, format) => {
    // Use the current extraction if the URL matches; otherwise synthesize a
    // minimal one from the saved row (the caller is responsible for
    // ensuring `current` is loaded for the URL — Preview.jsx does this).
    const base = current && current.url === url ? current : { url };
    const extraction = {
      url: base.url,
      page_title: base.page_title || "",
      ai_summary: base.ai_summary || "",
      headings: Array.isArray(base.headings) ? base.headings : [],
    };
    if (!extraction.url) {
      throw new Error("enrichWithContent called without a current extraction for the URL");
    }
    const id = ++reqId.current;
    const text = await generateContent(extraction, format);
    if (reqId.current !== id) return null; // superseded
    const entry = {
      key: format.key,
      label: format.label,
      icon: format.icon,
      prompt: format.instruction,
      // Wrap in { text } so the persistence layer (localStorage + Supabase)
      // can store it the same way as structured data; the renderer keys on
      // the shape rather than a separate field.
      data: { text: text || "" },
      kind: "content",
      created_at: new Date().toISOString(),
    };
    saveEnrichment(url, entry);
    // Content generations also count against the AI enrichment quota so a
    // single user can't loop "SEO outline" 1000× to exhaust the budget.
    billing?.trackEnrichment?.(url);
    const nextEnrichments = { ...(base.enrichments || {}), [format.key]: entry };
    commitCurrent({ ...base, enrichments: nextEnrichments });
    if (base._saved && base.id) {
      updateEnrichments(base.id, nextEnrichments).catch((err) =>
        console.warn("[DatIQ] Content enrichment sync failed:", err),
      );
    }
    return entry;
  });

  // Persist the current (or given) extraction.
  const save = async (data) => {
    const saved = await saveExtraction(data || current);
    return saved;
  };

  const view = (item) => {
    // Reload enrichments for this row: merge what's stored in Supabase (item.enrichments)
    // with the local cache, keeping the newest entry per capability. This is what makes
    // saved tabs reappear on another device/browser.
    const enrichments = mergeEnrichments(item.enrichments, readEnrichments(item.url));
    // Seed from a saved custom_extraction if neither source has anything.
    if (Object.keys(enrichments).length === 0 && item.custom_extraction != null) {
      const meta = enrichMeta("custom");
      enrichments[meta.key] = {
        ...meta,
        prompt: "",
        data: item.custom_extraction,
        created_at: item.created_at,
      };
    }
    // Mirror the merged result back into the local cache so it stays consistent.
    Object.values(enrichments).forEach((e) => saveEnrichment(item.url, e));
    commitCurrent({ ...item, enrichments });
    navigate("/preview");
  };

  // Dock controls: dismiss the completed/running job, or jump to its result.
  const dismissJob = () => setJob(null);
  const viewJob = () => {
    setJob(null);
    navigate("/preview");
  };

  const value = {
    current,
    setCurrent: commitCurrent,
    loading,
    loadingUrl,
    job,
    dismissJob,
    viewJob,
    extract,
    enrich,
    enrichWithContent,
    save,
    view,
  };
  return <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>;
}

// Merge two enrichment maps, keeping the newer entry (by created_at) per key.
function mergeEnrichments(a = {}, b = {}) {
  const out = { ...(a || {}) };
  for (const [key, entry] of Object.entries(b || {})) {
    const prev = out[key];
    if (!prev || new Date(entry.created_at || 0) >= new Date(prev.created_at || 0)) {
      out[key] = entry;
    }
  }
  return out;
}

// Stable callback ref — keeps the handler identity stable without useCallback.
function useCallbackSafe(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useRef((...args) => ref.current(...args)).current;
}
