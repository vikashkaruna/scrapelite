// BatchRunProvider.jsx — owns an in-flight batch run, above the router.
//
// Why this exists: runBatch() used to be called inside Batch.jsx's component
// body, holding its AbortController and progress in that component's state. So
// navigating away unmounted the page and abandoned the run — the user had to
// sit and watch a progress bar to get their data. Lifting the run here means it
// survives route changes, which is what "run in background" needs.
//
// It also owns the post-run persistence that used to live in the page, for the
// same reason: a run that finishes after the user has navigated away must still
// save its results and record its history entry.
//
// Progress is reported through the same global dock as single extractions
// (ExtractionProgressDock), so there is one progress surface rather than an
// in-page bar on /batch and a floating dock everywhere else.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { useGuestTrial } from "./GuestTrialProvider.jsx";
import { runBatch } from "../lib/batchService.js";
import { incrementBatchRuns } from "../lib/usageService.js";
import { saveExtraction } from "../lib/extractionsRepo.js";
import { saveEnrichment } from "../lib/enrichmentStore.js";
import { saveBatchRun, recordBatchItems, makeBatchLabel } from "../lib/batchRunsService.js";
import { uid } from "../lib/utils.js";
import { apiClient } from "../lib/apiClient.js";
import { useAuth } from "./AuthProvider.jsx";

const BatchRunContext = createContext({
  job: null,
  results: null,
  runId: null,
  startBatchRun: async () => null,
  cancelBatchRun: () => {},
  clearBatchRun: () => {},
  setResults: () => {},
});

export function useBatchRun() {
  return useContext(BatchRunContext);
}

export function BatchRunProvider({ children }) {
  const navigate = useNavigate();
  const showToast = useToast();
  const billing = useBilling();
  const guestTrial = useGuestTrial();
  const { user } = useAuth();

  // { status: "running" | "done", completed, total, current, runId, background }
  const [job, setJob] = useState(null);
  const [results, setResults] = useState(null);
  const [runId, setRunId] = useState(null);
  const abortRef = useRef(null);

  const cancelBatchRun = useCallback(() => {
    abortRef.current?.abort();
    setJob(null);
    showToast("Batch cancelled.");
  }, [showToast]);

  const clearBatchRun = useCallback(() => {
    setJob(null);
    setResults(null);
    setRunId(null);
  }, []);

  /**
   * Start a batch. Returns the run id immediately-ish; the caller does not need
   * to stay mounted. `opts.background` only changes navigation, never the work.
   */
  const startBatchRun = useCallback(async ({ urls, intent, personaId, renderJs, customPrompt, generateContent, background }) => {
    // Guest gate — same single guard every extraction entry point uses.
    if (guestTrial?.requireGuestCredit?.("batch") === false) return null;
    if (!user) {
      try {
        await apiClient.consumeGuestCredit("batch");
      } catch (err) {
        if (err?.status === 429) {
          showToast("Guest batch limit reached. Sign in to continue.");
          return null;
        }
        // The server deliberately fails open when its usage store is
        // unavailable; preserve that behavior in the client.
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const id = uid();
    const startedAt = new Date().toISOString();
    const total = urls.length;

    setRunId(id);
    setResults(null);
    setJob({ status: "running", completed: 0, total, current: urls[0] || "", runId: id, background });

    const extractOpts = { intent, personaId };
    if (renderJs) extractOpts.renderJs = true;
    if (customPrompt) extractOpts.customPrompt = customPrompt;
    if (intent === "map") extractOpts.mapMode = true;
    if (generateContent && intent !== "map") extractOpts.generateContent = generateContent;

    try {
      const batchResults = await runBatch(
        urls,
        extractOpts,
        (completed, t, latest) => {
          setJob((j) => (j && j.runId === id
            ? { ...j, completed, total: t, current: urls[completed] || "" }
            : j));
          if (latest._status === "success") billing?.trackExtraction?.(1);
        },
        controller.signal,
      );

      if (controller.signal.aborted) return id;

      setResults(batchResults);
      incrementBatchRuns(1);

      const successItems = batchResults.filter((r) => r?._status === "success");
      const failed = batchResults.filter((r) => r?._status === "error").length;

      setJob({ status: "done", completed: total, total, current: "", runId: id, background,
               successCount: successItems.length, failedCount: failed });

      showToast(
        `Batch complete — ${successItems.length} succeeded${failed ? `, ${failed} failed` : ""}`,
        "check-circle",
      );

      // ── Persist ────────────────────────────────────────────────────────────
      // The run record is written FIRST, from the in-memory results, rather
      // than only after saveExtraction resolves. Previously successCount was
      // the SAVED count and saveBatchRun ran inside the .then() — so if every
      // save rejected, no run was recorded at all and the run vanished from
      // history while the on-screen table still showed successes.
      saveBatchRun({
        id,
        kind: "batch",
        label: makeBatchLabel(intent, total, startedAt),
        intent,
        createdAt: startedAt,
        totalUrls: total,
        successCount: successItems.length,
        failedCount: failed,
        // Failed rows live here too, so leaving the page no longer loses them
        // (and /batch?run=<id> can rehydrate the table with Retry intact).
        rows: batchResults.map((r) => ({
          url: r.url,
          status: r._status,
          error: r._error || null,
          title: r.page_title || null,
        })),
      });

      if (successItems.length > 0) {
        const settled = await Promise.allSettled(
          successItems.map((r) => {
            // `generated_content` is a raw scratch field batchService uses to
            // build the enrichments map below — it is not a real column on
            // `extractions`. Sending it to the server made the insert fail
            // with a "could not find column" error on EVERY item that had
            // content generation enabled, which the retry-without-v2-columns
            // path (extractions.js) never fixes, since generated_content
            // isn't part of v2 either — the row degraded to a localStorage-
            // only save (or failed outright), so the batch's "N pages saved"
            // count silently excluded exactly the rows this feature targets.
            const { _status, _error, generated_content, ...cleanItem } = r;
            // batchService already built the { [capabilityKey]: entry } tab
            // map (custom extraction — contacts/pricing/custom — AND any
            // generated-content selection, e.g. "Competitor Summary"). Mirror
            // each entry into the local per-URL cache the same way
            // ExtractionProvider.extract() does, then save the row WITH its
            // enrichments so it renders correctly on this device and syncs
            // to Supabase for every other one. Previously only the
            // customPrompt half was reconstructed here (mislabeled, always
            // "custom") and generated content was dropped entirely — it
            // never became a tab anywhere, on any device.
            if (cleanItem.enrichments) {
              for (const entry of Object.values(cleanItem.enrichments)) {
                saveEnrichment(cleanItem.url, entry);
              }
            }
            return saveExtraction(cleanItem);
          }),
        );
        const savedIds = settled
          .filter((s) => s.status === "fulfilled")
          .map((s) => s.value?.id)
          .filter(Boolean);
        if (savedIds.length > 0) {
          recordBatchItems(id, savedIds);
          showToast(`${savedIds.length} page${savedIds.length !== 1 ? "s" : ""} saved to Dashboard`, "bookmark");
        }
      }

      return id;
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error("[DatIQ] Batch failed:", err);
        showToast("Batch extraction failed. Please try again.");
      }
      setJob(null);
      return id;
    } finally {
      // Counted once a run starts, whatever the outcome — it used to sit in the
      // success branch, so starting a run and cancelling was free and endlessly
      // repeatable.
      guestTrial?.trackGuestBatchRun?.(1);
      abortRef.current = null;
    }
  }, [billing, guestTrial, showToast, user]);

  const viewBatchRun = useCallback(() => {
    if (!job?.runId) return;
    setJob(null);
    navigate(`/batch?run=${job.runId}`);
  }, [job, navigate]);

  return (
    <BatchRunContext.Provider
      value={{ job, results, runId, startBatchRun, cancelBatchRun, clearBatchRun, viewBatchRun, setResults }}
    >
      {children}
    </BatchRunContext.Provider>
  );
}
