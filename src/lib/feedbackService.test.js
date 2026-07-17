// src/lib/feedbackService.test.js — Q5 (thumbs up/down feedback) unit tests.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const supabaseMock = {
  enabled: false,
  from: vi.fn(),
  auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
};

vi.mock("./supabaseClient.js", () => ({
  get supabase() { return supabaseMock.enabled ? supabaseMock : null; },
  get isSupabaseEnabled() { return supabaseMock.enabled; },
}));

vi.mock("./usageRepo.js", () => ({
  getSessionId: () => "sess_test",
}));

const { submitFeedback, getFeedbackForExtraction, getLocalFeedback,
        summariseRatings, _resetFeedbackForTests } = await import("./feedbackService.js");

function makeSupabaseClient() {
  const chain = {
    select: vi.fn(() => chain),
    eq:    vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit:  vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    upsert: vi.fn(async (row) => ({ data: row, error: null })),
  };
  return { from: vi.fn(() => chain), auth: { getUser: vi.fn() } };
}

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetFeedbackForTests();
  supabaseMock.enabled = false;
  supabaseMock.from.mockReset();
});

afterEach(() => {
  supabaseMock.enabled = false;
});

describe("Q5 — feedbackService: validation", () => {
  it("throws when extractionId is missing", async () => {
    await expect(submitFeedback({})).rejects.toThrow(/extractionId is required/);
    await expect(submitFeedback(null)).rejects.toThrow();
  });

  it("normalises a valid +1 rating", async () => {
    const { feedback } = await submitFeedback({ extractionId: "ext_1", rating: 1 });
    expect(feedback.rating).toBe(1);
    expect(feedback.extractionId).toBe("ext_1");
    expect(feedback.updatedAt).toBeTruthy();
  });

  it("normalises a valid -1 rating", async () => {
    const { feedback } = await submitFeedback({ extractionId: "ext_2", rating: -1 });
    expect(feedback.rating).toBe(-1);
  });

  it("clamps an invalid rating to 0 (neutral)", async () => {
    const { feedback } = await submitFeedback({ extractionId: "ext_3", rating: 99 });
    expect(feedback.rating).toBe(0);
  });

  it("truncates comments over 2000 chars", async () => {
    const long = "x".repeat(5000);
    const { feedback } = await submitFeedback({ extractionId: "ext_4", rating: 1, comment: long });
    expect(feedback.comment.length).toBe(2000);
  });
});

describe("Q5 — feedbackService: persistence (offline)", () => {
  it("writes to localStorage when Supabase is disabled", async () => {
    const { persistedTo } = await submitFeedback({ extractionId: "ext_1", rating: 1 });
    expect(persistedTo).toBe("local");
    const stored = JSON.parse(localStorage.getItem("datiq.summaryFeedback"));
    expect(stored.ext_1.rating).toBe(1);
  });

  it("getLocalFeedback returns the local record synchronously", async () => {
    await submitFeedback({ extractionId: "ext_1", rating: 1 });
    const fb = getLocalFeedback("ext_1");
    expect(fb).toBeTruthy();
    expect(fb.rating).toBe(1);
  });

  it("getLocalFeedback returns null for unknown id", () => {
    expect(getLocalFeedback("nope")).toBeNull();
    expect(getLocalFeedback("")).toBeNull();
    expect(getLocalFeedback(null)).toBeNull();
  });

  it("re-submitting the same id overwrites (idempotent)", async () => {
    await submitFeedback({ extractionId: "ext_1", rating: 1 });
    await submitFeedback({ extractionId: "ext_1", rating: -1 });
    const fb = getLocalFeedback("ext_1");
    expect(fb.rating).toBe(-1);
  });
});

describe("Q5 — feedbackService: persistence (Supabase)", () => {
  it("writes to Supabase and reports persistedTo='supabase'", async () => {
    supabaseMock.enabled = true;
    let upsertedRow = null;
    const fakeClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => fakeClient.from()),
        eq:    vi.fn(() => fakeClient.from()),
        order: vi.fn(() => fakeClient.from()),
        limit:  vi.fn(() => fakeClient.from()),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        upsert: vi.fn(async (row) => { upsertedRow = row; return { data: row, error: null }; }),
      })),
    };
    supabaseMock.from.mockImplementation(fakeClient.from);
    const { persistedTo } = await submitFeedback({ extractionId: "ext_1", rating: 1 }, { userId: "u_1" });
    expect(persistedTo).toBe("supabase");
    expect(upsertedRow.rating).toBe(1);
    expect(upsertedRow.user_id).toBe("u_1");
  });

  it("falls back to local when Supabase errors", async () => {
    supabaseMock.enabled = true;
    const fakeClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => fakeClient.from()),
        eq:    vi.fn(() => fakeClient.from()),
        order: vi.fn(() => fakeClient.from()),
        limit:  vi.fn(() => fakeClient.from()),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        upsert: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
      })),
    };
    supabaseMock.from.mockImplementation(fakeClient.from);
    const { persistedTo } = await submitFeedback({ extractionId: "ext_1", rating: 1 });
    expect(persistedTo).toBe("local");
    expect(getLocalFeedback("ext_1").rating).toBe(1);
  });
});

describe("Q5 — feedbackService: getFeedbackForExtraction (cross-device)", () => {
  it("returns the local record synchronously when present", async () => {
    await submitFeedback({ extractionId: "ext_local", rating: 1 });
    const fb = await getFeedbackForExtraction("ext_local");
    expect(fb.rating).toBe(1);
  });

  it("falls through to Supabase when local is empty", async () => {
    supabaseMock.enabled = true;
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit:  vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({
        data: { rating: -1, comment: "meh", created_at: "2026-07-17T00:00:00Z" },
        error: null,
      })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    const fb = await getFeedbackForExtraction("ext_remote");
    expect(fb).toBeTruthy();
    expect(fb.rating).toBe(-1);
    expect(fb.comment).toBe("meh");
  });

  it("returns null when neither local nor Supabase has the record", async () => {
    supabaseMock.enabled = true;
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit:  vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    expect(await getFeedbackForExtraction("ext_unknown")).toBeNull();
  });
});

describe("Q5 — summariseRatings: aggregate", () => {
  it("counts up, down, neutral, total", () => {
    const out = summariseRatings([
      { rating: 1 }, { rating: 1 }, { rating: 1 },
      { rating: -1 }, { rating: -1 },
      { rating: 0 },
    ]);
    expect(out).toEqual({ up: 3, down: 2, neutral: 1, total: 6 });
  });

  it("handles an empty list", () => {
    expect(summariseRatings([])).toEqual({ up: 0, down: 0, neutral: 0, total: 0 });
    expect(summariseRatings(null)).toEqual({ up: 0, down: 0, neutral: 0, total: 0 });
  });
});
