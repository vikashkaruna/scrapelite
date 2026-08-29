// ExtractionProvider.jsx — orchestrates the extract → preview → save flow and
// shares the "current" extraction across routes.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
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
import { usePersona } from "./PersonaProvider.jsx";
import { uid } from "../lib/utils.js";
import { isComplianceError, COMPLIANCE_ERROR, COMPLIANCE_GUEST_ERROR } from "../lib/errorMessages.js";
import { consentHostOf } from "../lib/scrapeConsentService.js";
import { isAccountBlocked } from "../lib/entitlementModel.js";
import ScrapeConsentModal from "./ScrapeConsentModal.jsx";

const ExtractionContext = createContext(null);

export function useExtraction() {
  return useContext(ExtractionContext);
}

export function ExtractionProvider({ children }) {
  const navigate = useNavigate();
  const showError = useErrorModal();
  const showToast = useToast();
  const billing = useBilling();
  const { user, openAuth } = useAuth();
  const guestTrial = useGuestTrial();
  const { personaId } = usePersona();
  // Restore the last-viewed extraction so /preview survives a browser reload.
  const [current, setCurrent] = useState(readCurrent);
  // A mirror of `current` that async work can read AFTER its await. The value
  // captured in a closure is a SNAPSHOT: anything that resolves later and
  // commits that snapshot silently reverts every commit made while it was in
  // flight. That is not hypothetical — it is what deleted a Quick enrichment
  // tab a second after the "ready" toast (see the auto-save below).
  const currentRef = useRef(current);
  // Set when a robots.txt refusal is overridable by this signed-in user, so the
  // attestation dialog can be offered instead of a dead-end error modal.
  // Shape: { url, host, options }.
  const [consentPrompt, setConsentPrompt] = useState(null);
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
    currentRef.current = next;
    setCurrent(next);
    saveCurrent(next);
  };

  // The extraction `current` holds right now — for async callers that have
  // awaited since they last looked. Falls back to a bare { url } so a
  // capability run against a URL we are not currently showing still has
  // somewhere to attach.
  const latestCurrentFor = (url) => {
    const latest = currentRef.current;
    return latest && latest.url === url ? latest : { url };
  };

  // ── Enrichment sync queue ───────────────────────────────────────────────────
  //
  // A capability run while the extraction's own auto-save is still in flight
  // has an id but no server row yet, so `updateEnrichments` would PATCH a row
  // that does not exist. The old code just skipped the sync: the tab was
  // written to localStorage, rendered correctly in this browser for ever, and
  // was simply ABSENT on the user's other devices — with nothing on screen to
  // say so, for a tab they had spent a credit on.
  //
  // Park it instead, keyed by extraction id, and flush when the save lands.
  // Bounded by design: each save's settle handler removes its own key, and the
  // value is the COMPLETE enrichments map (not a delta), so re-parking is a
  // last-write-wins overwrite rather than a growing list.
  const pendingEnrichSync = useRef(new Map());

  const sendEnrichments = (id, enrichments) => {
    if (!id || !enrichments || Object.keys(enrichments).length === 0) return;
    // Signed-out users 401 here and degrade to localStorage inside the repo.
    // That is the correct end state, not a failure to retry: a guest row has
    // no `user_id`, so there is no account for the server to attach it to.
    updateEnrichments(id, enrichments).catch((err) =>
      console.warn("[DatIQ] Enrichment sync failed:", err),
    );
  };

  // Sync now if the row exists; otherwise hold it for the save's settle.
  const syncOrQueueEnrichments = (target, enrichments) => {
    if (!target?.id) return; // nothing to attach to at all
    if (target._saved) sendEnrichments(target.id, enrichments);
    else pendingEnrichSync.current.set(target.id, enrichments);
  };

  // Called once per auto-save, whichever way it went. `persisted` false means
  // no row was written (rejected, or refused by the saved-searches cap), so
  // the parked map is dropped rather than PATCHed at nothing — it survives in
  // localStorage, which is the honest outcome for a row that does not exist.
  const settlePendingEnrichSync = (id, persisted) => {
    const parked = pendingEnrichSync.current.get(id);
    if (parked === undefined) return;
    pendingEnrichSync.current.delete(id);
    if (persisted) sendEnrichments(id, parked);
  };

  // Run Firecrawl + AI, then route to the preview screen.
  const extract = useCallbackSafe(async (url, options = {}) => {
    // Enforce plan limits before starting
    const limitCheck = billing?.checkCanExtract?.();
    if (limitCheck && !limitCheck.allowed) {
      // A frozen / deletion-pending / suspended account isn't a plan-limit
      // problem — "Upgrade your plan to continue" is nonsensical advice for
      // someone who needs to unfreeze or cancel a deletion, and the fix lives
      // in Account, not Pricing.
      if (isAccountBlocked(limitCheck.code)) {
        showToast?.(limitCheck.reason);
        navigate("/account");
      } else {
        showToast?.(limitCheck.reason + " Upgrade your plan to continue.");
        navigate("/pricing");
      }
      return;
    }

    // Enforce guest hard limit before starting (single-URL extraction)
    if (guestTrial?.requireGuestCredit?.("single") === false) return;

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
        // Standard (and custom-extraction) mode: summarize, AI-tag, and optional content generation concurrently.
        const summarizePromise = summarize(structure, { personaId, intent: options.intent });
        const categorizePromise = categorizeLinks(structure.links, structure.url);
        const contentPromise = options.generateContent
          ? generateContent(structure, options.generateContent).catch((err) => {
              console.warn("[DatIQ] generateContent in extract failed:", err);
              return null;
            })
          : null;

        const [ai_summary, links, genContentText] = await Promise.all([
          summarizePromise,
          categorizePromise,
          contentPromise,
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
        // record it as an enrichment so it persists and shows as a tab, even
        // when the extraction came back empty. This mirrors enrich() below so
        // a Home run surfaces the SAME "why is this empty" reason instead of
        // silently omitting the tab (previously gated on `!= null`, which made
        // a missing AI key on the server look identical to "nothing works").
        if (options.enrichMeta) {
          const meta = options.enrichMeta;
          const entry = {
            key: meta.key,
            label: meta.label,
            icon: meta.icon,
            prompt: options.customPrompt || "",
            data: result.custom_extraction ?? null,
            ...(result.custom_extraction_reason
              ? { reason: result.custom_extraction_reason }
              : {}),
            created_at: result.created_at,
          };
          enrichments[meta.key] = entry;
          saveEnrichment(url, entry);
        }
        if (options.generateContent && genContentText) {
          const f = options.generateContent;
          const entry = {
            key: f.key,
            label: f.label,
            icon: f.icon,
            prompt: f.instruction || f.desc || "",
            data: { text: genContentText },
            kind: "content",
            created_at: result.created_at,
          };
          enrichments[f.key] = entry;
          saveEnrichment(url, entry);
        }
        result.enrichments = enrichments;

        if (options.enrichMeta) {
          result.activeTab = options.enrichMeta.key;
        } else if (options.generateContent) {
          result.activeTab = options.generateContent.key;
        }
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
        .then((saved) => {
          const persisted = saved?._saved !== false;
          // Flush BEFORE the `current` guard below: an enrichment parked
          // against this id belongs to this row whether or not the user is
          // still looking at it.
          settlePendingEnrichSync(result.id, persisted);
          // Merge onto whatever `current` is NOW — never re-commit the
          // `result` snapshot taken above. This is a real network round trip
          // (owner lookup, then POST /api/extractions, then a Supabase
          // insert), and the user is already on /preview while it runs. Any
          // Quick enrichment they start inside that window commits its tab
          // first; re-committing the snapshot deleted that tab a second after
          // its own "ready" toast, which is exactly the "run says success but
          // nothing is displayed" report.
          const latest = currentRef.current;
          // A save that lands after the user has opened a DIFFERENT extraction
          // must not stamp this one's flag onto that one.
          if (!latest || latest.id !== result.id) return;
          // Honour the repo's own verdict rather than assuming success: a save
          // refused by the free saved-searches cap comes back `_saved: false`,
          // and claiming otherwise offers "View Dashboard" for a row that was
          // never written, then syncs enrichments against a missing id.
          commitCurrent({ ...latest, _saved: persisted });
          analytics.saved({ url, intent: props.intent });
        })
        .catch((err) => {
          // No row was written, so nothing parked against it can be synced.
          settlePendingEnrichSync(result.id, false);
          console.warn("[DatIQ] Auto-save failed:", err);
        });
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

      // A compliance refusal is not a failed attempt — the server declined
      // before contacting any provider, so nothing was spent and nothing is
      // owed. It gets no guest charge and no "Try again": retrying a policy
      // decision cannot change it, and the button only teaches people to
      // hammer a wall. (The server stopped charging for this too; both halves
      // were double-billing the same refusal.)
      const compliance = isComplianceError(err);
      if (!compliance && !user) guestTrial?.trackGuestExtraction?.(1);

      analytics.extractionFailed({
        url,
        intent: options.intent || "summary",
        error: String(err?.message || err),
        ...(compliance ? { compliance_blocked: true } : {}),
      });
      navigate("/");

      if (compliance) {
        // Signed in and overridable → offer the attestation. Otherwise explain
        // the refusal; a guest is told to sign in, because an anonymous cookie
        // is nobody to attribute a permission claim to.
        if (user && err?.consentAvailable) {
          setConsentPrompt({
            url,
            host: err.host || consentHostOf(url),
            options,
          });
        } else if (user) {
          showError(err, COMPLIANCE_ERROR);
        } else {
          // The guest copy says "sign in and DatIQ can record that and
          // continue". Without an action that was a dead end — the only
          // control on this modal was Close — so it told the user what to do
          // and then gave them no way to do it.
          showError(err, {
            ...COMPLIANCE_GUEST_ERROR,
            action: { label: "Sign in", icon: "log-in", onClick: () => openAuth("signin") },
          });
        }
        return;
      }

      // A server-side account block (frozen / deletion-pending / suspended /
      // paused seat) reaching this catch means the client-side pre-flight
      // above was stale or bypassed — the account changed state since the
      // entitlement cache was last read. It is the same "not a fault" shape
      // as a compliance refusal: retrying cannot succeed until the user acts
      // in Account, so no "Try again" button, and classifyError renders the
      // server's own precise message instead of falling to a generic default.
      if (isAccountBlocked(err?.code)) {
        showError(err);
        return;
      }

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

    // A quick action is a real scrape + AI call, so it consumes a guest credit
    // like any other extraction. This path had no gate at all.
    if (guestTrial?.requireGuestCredit?.("single") === false) return null;

    const id = ++reqId.current;
    const structure = await extractStructure(url, { customPrompt: preset.prompt });
    if (reqId.current !== id) return null; // superseded by a newer run
    const entry = {
      key: preset.key,
      label: preset.label,
      icon: preset.icon,
      prompt: preset.prompt,
      data: structure.custom_extraction ?? null,
      // Why the extraction was empty, when it was. Rendered by Preview so an
      // empty tab explains itself instead of just being blank.
      ...(structure.custom_extraction_reason
        ? { reason: structure.custom_extraction_reason }
        : {}),
      created_at: new Date().toISOString(),
    };
    saveEnrichment(url, entry); // local cache (keyed by URL)
    billing?.trackEnrichment?.(url);
    if (!user) guestTrial?.trackGuestExtraction?.(1);
    // Read `current` AFTER the await, not the closure's copy from before it:
    // the extraction's own auto-save resolves in this same window, and
    // committing the pre-await copy threw away the `_saved` flag it had just
    // set — after which no later tab ever syncs to Supabase, with nothing
    // visible to explain why.
    const base = latestCurrentFor(url);
    const nextEnrichments = { ...(base.enrichments || {}), [preset.key]: entry };
    commitCurrent({ ...base, enrichments: nextEnrichments });
    // Sync the full map to the backend so the tabs persist in Supabase (and
    // across devices). Fire-and-forget, and queued when the row's own save has
    // not landed yet.
    syncOrQueueEnrichments(base, nextEnrichments);
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
    // Same rule as enrich(): commit onto the post-await `current`, since the
    // auto-save (or another capability) can have landed while the model was
    // generating.
    const target = latestCurrentFor(url);
    const nextEnrichments = { ...(target.enrichments || {}), [format.key]: entry };
    commitCurrent({ ...target, enrichments: nextEnrichments });
    syncOrQueueEnrichments(target, nextEnrichments);
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
    const enrichKeys = Object.keys(enrichments);
    const activeTab = item.activeTab || (enrichKeys.length > 0 ? enrichKeys[0] : "overview");
    commitCurrent({ ...item, enrichments, activeTab });
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
  return (
    <ExtractionContext.Provider value={value}>
      {children}
      {consentPrompt && (
        <ScrapeConsentModal
          host={consentPrompt.host}
          url={consentPrompt.url}
          onCancel={() => setConsentPrompt(null)}
          onGranted={() => {
            const { url, options } = consentPrompt;
            setConsentPrompt(null);
            // Re-run the extraction now that the record exists. The server
            // re-reads it and decides again — this is a retry, not a bypass.
            extract(url, options);
          }}
        />
      )}
    </ExtractionContext.Provider>
  );
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
