import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteExtraction,
  listExtractions,
  saveExtraction,
  saveScheduledExtraction,
  updateEnrichments,
} from "./extractionsRepo.js";

/**
 * U-56..58 — extractionsRepo is the persistence boundary for saved
 * extractions. The contract is "API when reachable, localStorage
 * otherwise; no exceptions on transient failures".
 */

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn(),
  createExtraction: vi.fn(),
  patchExtraction: vi.fn(),
  deleteExtraction: vi.fn(),
}));

vi.mock("./apiClient.js", () => ({
  apiClient: apiMocks,
}));

const SAMPLE = {
  id: "ext_1",
  url: "https://example.com/a",
  page_title: "A",
  ai_summary: "Sum",
  created_at: "2026-07-15T10:00:00.000Z",
  headings: [],
  links: [],
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listExtractions (U-56)", () => {
  it("API success → returns server rows marked _saved", async () => {
    apiMocks.listExtractions.mockResolvedValue([SAMPLE]);
    const rows = await listExtractions();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("ext_1");
    expect(rows[0]._saved).toBe(true);
  });

  it("API 401 → localStorage fallback", async () => {
    localStorage.setItem("datiq.saved", JSON.stringify([SAMPLE]));
    apiMocks.listExtractions.mockRejectedValue({ status: 401 });
    const rows = await listExtractions();
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe("ext_1");
  });

  it("API 404 (no Supabase / no function) → localStorage fallback", async () => {
    localStorage.setItem("datiq.saved", JSON.stringify([SAMPLE]));
    apiMocks.listExtractions.mockRejectedValue({ status: 404 });
    const rows = await listExtractions();
    expect(rows.length).toBe(1);
  });
});

describe("saveExtraction strips _status / _error (U-57)", () => {
  it("removes batch-internal fields before persisting", async () => {
    apiMocks.createExtraction.mockImplementation(async (row) => ({
      ...row,
      _saved: true,
    }));
    const dirty = {
      ...SAMPLE,
      _status: "success",
      _error: undefined,
    };
    const saved = await saveExtraction(dirty);
    // The call to the API must NOT contain _status or _error
    const sentToApi = apiMocks.createExtraction.mock.calls[0][0];
    expect(sentToApi._status).toBeUndefined();
    expect(sentToApi._error).toBeUndefined();
    expect(saved._saved).toBe(true);
  });
});

describe("500 + network failure → localStorage fallback (U-58)", () => {
  it("500 → falls back to localStorage, returns saved row, no throw", async () => {
    apiMocks.createExtraction.mockRejectedValue({ status: 500 });
    const row = await saveExtraction({ ...SAMPLE, id: undefined });
    expect(row._saved).toBe(true);
    expect(row.id).toBeTruthy();
    const local = JSON.parse(localStorage.getItem("datiq.saved"));
    expect(local.length).toBe(1);
  });

  it("network error (no .status) → localStorage fallback, no throw", async () => {
    apiMocks.createExtraction.mockRejectedValue(new Error("Failed to fetch"));
    const row = await saveExtraction({ ...SAMPLE, id: undefined });
    expect(row._saved).toBe(true);
  });
});

describe("saveScheduledExtraction", () => {
  it("strips paste-only + batch-status fields", async () => {
    apiMocks.createExtraction.mockImplementation(async (row) => ({ ...row, _saved: true }));
    await saveScheduledExtraction(
      {
        url: "https://example.com",
        page_title: "X",
        is_pasted: true,
        raw_text: "secret pasted text",
        _status: "success",
        _error: "old error",
      },
      { id: "sched_1", label: "Daily monitor" },
    );
    const sent = apiMocks.createExtraction.mock.calls[0][0];
    expect(sent.is_pasted).toBeUndefined();
    expect(sent.raw_text).toBeUndefined();
    expect(sent._status).toBeUndefined();
    expect(sent._error).toBeUndefined();
    expect(sent.ai_summary).toMatch(/Scheduled run/);
  });
});

describe("updateEnrichments + deleteExtraction", () => {
  it("updateEnrichments falls back to localStorage on API failure", async () => {
    localStorage.setItem("datiq.saved", JSON.stringify([SAMPLE]));
    apiMocks.patchExtraction.mockRejectedValue({ status: 503 });
    await updateEnrichments("ext_1", { summary: { text: "x" } });
    const local = JSON.parse(localStorage.getItem("datiq.saved"));
    expect(local[0].enrichments).toEqual({ summary: { text: "x" } });
  });

  it("deleteExtraction removes locally when API fails", async () => {
    localStorage.setItem("datiq.saved", JSON.stringify([SAMPLE]));
    apiMocks.deleteExtraction.mockRejectedValue({ status: 500 });
    await deleteExtraction("ext_1");
    expect(JSON.parse(localStorage.getItem("datiq.saved"))).toEqual([]);
  });
});

describe("RC-03 — concurrent saveExtraction calls", () => {
  it("two saveExtraction calls in the same tick → two unique ids, both stored (localStorage fallback)", async () => {
    // Force localStorage fallback (the API path is mocked to 500).
    apiMocks.createExtraction.mockRejectedValue({ status: 500 });
    const a = { id: "ext_a", url: "https://a.example.com", page_title: "A", created_at: "2026-07-15T10:00:00.000Z", headings: [], links: [] };
    const b = { id: "ext_b", url: "https://b.example.com", page_title: "B", created_at: "2026-07-15T10:01:00.000Z", headings: [], links: [] };
    // Fire both saves in the same tick (Promise.all awaits both).
    const [ra, rb] = await Promise.all([saveExtraction(a), saveExtraction(b)]);
    expect(ra.id).toBe("ext_a");
    expect(rb.id).toBe("ext_b");
    // Both are persisted in datiq.saved.
    const stored = JSON.parse(localStorage.getItem("datiq.saved"));
    expect(stored.length).toBe(2);
    expect(stored.map((r) => r.id).sort()).toEqual(["ext_a", "ext_b"]);
  });

  it("saveExtraction without an id → assigns a unique id from uid()", async () => {
    apiMocks.createExtraction.mockRejectedValue({ status: 500 });
    const r1 = await saveExtraction({ url: "https://x1.example.com", page_title: "X1", created_at: "2026-07-15T11:00:00.000Z", headings: [], links: [] });
    const r2 = await saveExtraction({ url: "https://x2.example.com", page_title: "X2", created_at: "2026-07-15T11:01:00.000Z", headings: [], links: [] });
    // Both rows have a non-empty id.
    expect(r1.id).toBeTruthy();
    expect(r2.id).toBeTruthy();
    // The ids are distinct (uid() includes Math.random() + Date.now()).
    expect(r1.id).not.toBe(r2.id);
  });
});

// ── Q3 — saved-searches cap (free plan) ──────────────────────────────────────
import { readSubscription } from "./usageService.js";

describe("Q3 — extractionsRepo: free-plan saved-searches cap", () => {
  beforeEach(() => {
    apiMocks.createExtraction.mockReset();
    try { localStorage.clear(); } catch {}
  });

  it("refuses to save the 11th extraction on the free plan (returns _capHit)", async () => {
    apiMocks.createExtraction.mockRejectedValue({ status: 500 });
    // Seed 10 existing extractions.
    const seed = Array.from({ length: 10 }, (_, i) => ({
      id: `seed_${i}`,
      url: `https://a${i}.example.com`,
      page_title: `A${i}`,
      created_at: "2026-07-15T10:00:00.000Z",
      headings: [], links: [],
    }));
    localStorage.setItem("datiq.saved", JSON.stringify(seed));
    // Force the subscription to be the free plan.
    localStorage.setItem("datiq.subscription", JSON.stringify({ planId: "free" }));

    const r = await saveExtraction({
      id: "ext_overflow",
      url: "https://overflow.example.com",
      page_title: "Overflow",
      created_at: "2026-07-15T12:00:00.000Z",
      headings: [], links: [],
    });
    expect(r._capHit).toBe(true);
    expect(r._cap).toBe(10);
    expect(r._saved).toBe(false);
    // The list should still be 10 (not 11) — the overflow is NOT persisted.
    const stored = JSON.parse(localStorage.getItem("datiq.saved"));
    expect(stored.length).toBe(10);
    expect(stored.find((x) => x.id === "ext_overflow")).toBeUndefined();
  });

  it("allows saving on a paid plan (no cap)", async () => {
    apiMocks.createExtraction.mockRejectedValue({ status: 500 });
    const seed = Array.from({ length: 50 }, (_, i) => ({
      id: `seed_${i}`,
      url: `https://a${i}.example.com`,
      page_title: `A${i}`,
      created_at: "2026-07-15T10:00:00.000Z",
      headings: [], links: [],
    }));
    localStorage.setItem("datiq.saved", JSON.stringify(seed));
    localStorage.setItem("datiq.subscription", JSON.stringify({ planId: "pro" }));

    const r = await saveExtraction({
      id: "ext_pro",
      url: "https://pro.example.com",
      page_title: "Pro",
      created_at: "2026-07-15T12:00:00.000Z",
      headings: [], links: [],
    });
    expect(r._capHit).toBeFalsy();
    expect(r._saved).toBe(true);
  });
});
