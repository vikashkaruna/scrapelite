// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { extractStructure } from "../lib/firecrawlService.js";
import { summarize, categorizeLinks } from "../lib/aiService.js";
import { saveExtraction, updateEnrichments } from "../lib/extractionsRepo.js";
import {
  readEnrichments,
  saveEnrichment,
  saveCurrent,
  readCurrent,
} from "../lib/enrichmentStore.js";
import { enrichMeta } from "../lib/extractionPresets.js";
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
  const reqId = useRef(0);
  const lastUrl = useRef("");
  const lastOpts = useRef({});

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

    const id = ++reqId.current;
    lastUrl.current = url;
    lastOpts.current = options;
    setLoadingUrl(url);
    setLoading(true);
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
      commitCurrent(result);
      setLoading(false);
      billing?.trackExtraction?.();
      // Track guest trial for non-logged-in users (1 credit per single-URL extraction).
      if (!user) guestTrial?.trackGuestExtraction?.(1);
      // Auto-save to database (fire-and-forget); marks the extraction as saved
      // so Preview shows "View Dashboard" instead of "Save to Dashboard".
      saveExtraction(result)
        .then(() => commitCurrent({ ...result, _saved: true }))
        .catch((err) => console.warn("[DatIQ] Auto-save failed:", err));
      navigate("/preview");
    } catch (err) {
      if (reqId.current !== id) return;
      console.error("[DatIQ] Extraction failed:", err);
      setLoading(false);
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

  const value = {
    current,
    setCurrent: commitCurrent,
    loading,
    loadingUrl,
    extract,
    enrich,
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
