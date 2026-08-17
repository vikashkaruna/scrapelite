import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteBatchRun,
  getBatchRun,
  listBatchRuns,
  makeBatchLabel,
  readBatchMap,
  recordBatchItems,
  recordScheduledItem,
  saveBatchRun,
} from "./batchRunsService.js";

/**
 * U-30..32 — batchRunsService is the local-only history of batch runs
 * that powers the Dashboard's "filter by run" affordance. The map
 * (extractionId → runId) is what lets a row render the "Batch" tag.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("saveBatchRun + listBatchRuns (U-30)", () => {
  it("persists and returns runs in reverse-chronological order", () => {
    saveBatchRun({
      id: "run_1",
      label: "First",
      intent: "summary",
      createdAt: "2026-07-15T10:00:00.000Z",
      totalUrls: 5,
      successCount: 5,
      failedCount: 0,
    });
    saveBatchRun({
      id: "run_2",
      label: "Second",
      intent: "pricing",
      createdAt: "2026-07-15T11:00:00.000Z",
      totalUrls: 3,
      successCount: 3,
      failedCount: 0,
    });
    const runs = listBatchRuns();
    expect(runs.length).toBe(2);
    expect(runs[0].id).toBe("run_2");
    expect(runs[1].id).toBe("run_1");
  });

  it("saveBatchRun with the same id overwrites (no duplicate)", () => {
    saveBatchRun({ id: "run_1", label: "First", createdAt: "2026-07-15T10:00:00.000Z" });
    saveBatchRun({ id: "run_1", label: "First (updated)", createdAt: "2026-07-15T10:00:00.000Z" });
    expect(listBatchRuns().length).toBe(1);
    expect(listBatchRuns()[0].label).toBe("First (updated)");
  });
});

describe("Cap at 50 (U-31)", () => {
  it("the 51st run evicts the oldest", () => {
    for (let i = 1; i <= 51; i += 1) {
      saveBatchRun({
        id: `run_${i}`,
        label: `Run ${i}`,
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, i)).toISOString(),
      });
    }
    const runs = listBatchRuns();
    expect(runs.length).toBe(50);
    expect(runs[0].id).toBe("run_51");
    // The first run pushed in is the 1st one (i=1). After 51 inserts,
    // run_1 should be evicted.
    expect(runs.find((r) => r.id === "run_1")).toBeUndefined();
    expect(runs.find((r) => r.id === "run_51")).toBeDefined();
  });
});

describe("recordBatchItems (U-32)", () => {
  it("populates datiq.batchMap keyed by extraction id", () => {
    recordBatchItems("run_1", ["ext_a", "ext_b"]);
    const map = readBatchMap();
    expect(map.ext_a).toBe("run_1");
    expect(map.ext_b).toBe("run_1");
  });

  it("empty extractionIds is a no-op (does not clear the map)", () => {
    recordBatchItems("run_1", ["ext_a"]);
    recordBatchItems("run_2", []);
    const map = readBatchMap();
    expect(map.ext_a).toBe("run_1");
  });
});

describe("recordScheduledItem", () => {
  it("uses a stable group id (schrun_<scheduleId>) so the dashboard collates history", () => {
    const schedule = { id: "sched_1", label: "Daily monitor", intent: "summary" };
    recordScheduledItem(schedule, "ext_a");
    recordScheduledItem(schedule, "ext_b");
    const map = readBatchMap();
    expect(map.ext_a).toBe("schrun_sched_1");
    expect(map.ext_b).toBe("schrun_sched_1");
    const runs = listBatchRuns();
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe("schrun_sched_1");
    expect(runs[0].kind).toBe("schedule");
    expect(runs[0].successCount).toBe(2);
  });
});

describe("deleteBatchRun", () => {
  it("removes the run and any map entries pointing at it", () => {
    saveBatchRun({ id: "run_1", label: "x", createdAt: "2026-07-15T10:00:00.000Z" });
    recordBatchItems("run_1", ["ext_a", "ext_b"]);
    deleteBatchRun("run_1");
    expect(listBatchRuns().find((r) => r.id === "run_1")).toBeUndefined();
    expect(readBatchMap().ext_a).toBeUndefined();
    expect(readBatchMap().ext_b).toBeUndefined();
  });
});

describe("makeBatchLabel", () => {
  it("formats intent + count + date", () => {
    const label = makeBatchLabel("summary", 5, "2026-07-15T10:00:00.000Z");
    expect(label).toMatch(/AI summary/);
    expect(label).toMatch(/5 URLs/);
    expect(label).toMatch(/Jul.*15/);
  });

  it("singular count when urlCount = 1", () => {
    const label = makeBatchLabel("summary", 1, "2026-07-15T10:00:00.000Z");
    expect(label).toMatch(/1 URL\b/);
    expect(label).not.toMatch(/1 URLs/);
  });
});

// ── Runs carry every row, including failures ────────────────────────────────
//
// Failures were only ever in the page's React state: leaving /batch lost the
// failure list AND the per-row Retry that goes with it. Dashboard can't stand
// in, because only successes are saved as extractions — a failed URL has no
// row there at all. Storing `rows` on the run is what makes /batch?run=<id>
// able to rebuild the table.

describe("batch run rows + lookup", () => {
  beforeEach(() => localStorage.clear());

  const run = (over = {}) => ({
    id: "run_1",
    kind: "batch",
    label: "AI summary · 3 URLs · Aug 18",
    intent: "summary",
    createdAt: "2026-08-18T10:00:00.000Z",
    totalUrls: 3,
    successCount: 2,
    failedCount: 1,
    rows: [
      { url: "https://a.com", status: "success", error: null, title: "A" },
      { url: "https://b.com", status: "success", error: null, title: "B" },
      { url: "https://c.com", status: "error", error: "timed out", title: null },
    ],
    ...over,
  });

  it("round-trips the rows, failures included", () => {
    saveBatchRun(run());
    const stored = getBatchRun("run_1");
    expect(stored.rows).toHaveLength(3);
    expect(stored.rows.find((r) => r.status === "error")).toMatchObject({
      url: "https://c.com",
      error: "timed out",
    });
  });

  it("getBatchRun returns null for an unknown or missing id", () => {
    saveBatchRun(run());
    expect(getBatchRun("nope")).toBeNull();
    expect(getBatchRun(null)).toBeNull();
    expect(getBatchRun(undefined)).toBeNull();
  });

  it("keeps counts independent of what was savable to the Dashboard", () => {
    // successCount is the count of rows that SUCCEEDED, not the count that
    // saved. It used to be the saved count, computed inside a .then() — so if
    // every save rejected, the run was never recorded at all and vanished from
    // history while the on-screen table still showed successes.
    saveBatchRun(run());
    const stored = getBatchRun("run_1");
    expect(stored.successCount).toBe(2);
    expect(stored.failedCount).toBe(1);
    expect(stored.totalUrls).toBe(3);
  });

  it("labels a map batch as 'Map site' rather than the generic fallback", () => {
    expect(makeBatchLabel("map", 4, "2026-08-18T10:00:00.000Z")).toMatch(/^Map site · 4 URLs/);
  });

  it("still labels a genuinely unknown intent with the fallback", () => {
    expect(makeBatchLabel("wat", 1, "2026-08-18T10:00:00.000Z")).toMatch(/^Extraction · 1 URL/);
  });
});
