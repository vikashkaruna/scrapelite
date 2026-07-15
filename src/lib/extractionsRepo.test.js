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
