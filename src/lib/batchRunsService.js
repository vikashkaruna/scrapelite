// batchRunsService.js — localStorage-backed batch run history.
//
// Batch runs are recorded locally so users can find past batch results in
// Dashboard. The map (extractionId → batchRunId) lets Dashboard tag items
// that came from a batch run without a Supabase schema change.
//
// Keys:
//   datiq.batchRuns  — array of run metadata objects (newest first, max 50)
//   datiq.batchMap   — object { [extractionId]: batchRunId }

const RUNS_KEY = "datiq.batchRuns";
const MAP_KEY  = "datiq.batchMap";
const MAX_RUNS = 50;

// ── Runs list ─────────────────────────────────────────────────────────────────

export function listBatchRuns() {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save a batch run record.
 * @param {{ id, label, intent, createdAt, totalUrls, successCount, failedCount }} run
 */
export function saveBatchRun(run) {
  try {
    const runs = [run, ...listBatchRuns().filter((r) => r.id !== run.id)].slice(0, MAX_RUNS);
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch { /* ignore quota errors */ }
}

export function deleteBatchRun(id) {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(listBatchRuns().filter((r) => r.id !== id)));
  } catch {}
  // Remove associated map entries
  try {
    const map = readBatchMap();
    for (const [eid, rid] of Object.entries(map)) {
      if (rid === id) delete map[eid];
    }
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {}
}

// ── Extraction → Batch association map ───────────────────────────────────────

export function readBatchMap() {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Record which extraction IDs belong to a given batch run.
 * @param {string} batchRunId
 * @param {string[]} extractionIds
 */
export function recordBatchItems(batchRunId, extractionIds) {
  if (!extractionIds.length) return;
  try {
    const map = readBatchMap();
    for (const id of extractionIds) {
      map[id] = batchRunId;
    }
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INTENT_LABELS = {
  summary:  "AI summary",
  contacts: "Find contacts",
  pricing:  "Scrape pricing",
  custom:   "Custom extraction",
};

/**
 * Build a human-readable label for a batch run.
 * @param {string} intent
 * @param {number} urlCount
 * @param {string} createdAt ISO date string
 */
export function makeBatchLabel(intent, urlCount, createdAt) {
  const intentName = INTENT_LABELS[intent] || "Extraction";
  const date = new Date(createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
  return `${intentName} · ${urlCount} URL${urlCount !== 1 ? "s" : ""} · ${date}`;
}
