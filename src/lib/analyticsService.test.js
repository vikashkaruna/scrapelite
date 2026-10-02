// src/lib/analyticsService.test.js — Q11 (product analytics) pure logic tests.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./supabaseClient.js", () => ({
  supabase: null,
  isSupabaseEnabled: false,
  EXTRACTIONS_TABLE: "extractions",
  ANALYTICS_TABLE: "analytics_events",
}));

vi.mock("./usageRepo.js", () => ({
  getSessionId: () => "sess_1",
}));

const { track, flush, computeFunnel, lifecycle, FUNNEL, _resetForTests } =
  await import("./analyticsService.js");

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
});

describe("Q11 — analyticsService: track + flush", () => {
  it("track() never throws and returns ok=true with a queued flag", async () => {
    const r = await track("test_event", { foo: "bar" });
    expect(r.ok).toBe(true);
    expect(r.queued).toBe(true);
  });

  it("flush() with supabase=null writes to localStorage", async () => {
    await track("e1", { a: 1 });
    await track("e2", { a: 2 });
    const n = await flush();
    expect(n).toBe(2);
    const ls = JSON.parse(localStorage.getItem("datiq.analytics"));
    expect(ls).toHaveLength(2);
    expect(ls[0].name).toBe("e1");
    expect(ls[1].name).toBe("e2");
  });

  it("flush() with empty buffer returns 0 and does not touch localStorage", async () => {
    const n = await flush();
    expect(n).toBe(0);
    expect(localStorage.getItem("datiq.analytics")).toBeNull();
  });

  it("track() attaches a sessionId from getSessionId", async () => {
    await track("e1");
    await flush();
    const ls = JSON.parse(localStorage.getItem("datiq.analytics"));
    expect(ls[0].session_id).toBe("sess_1");
  });

  it("track() does not throw when called with bad inputs", async () => {
    // Bad input should not break the user flow.
    const r = await track();
    expect(r).toHaveProperty("ok");
  });

  it("track() completely suppresses events on /admin", async () => {
    const r1 = await track("admin_action", { path: "/admin/revenue" });
    expect(r1).toEqual({ ok: true, suppressed: true });
    expect(await flush()).toBe(0);

    const r2 = await track("page_view", { url: "https://datiq.app/admin/ai" });
    expect(r2).toEqual({ ok: true, suppressed: true });
    expect(await flush()).toBe(0);

    // Simulate window.location on /admin
    const origLoc = window.location;
    delete window.location;
    window.location = { pathname: "/admin/monitoring" };
    try {
      const r3 = await track("some_event", { foo: "bar" });
      expect(r3).toEqual({ ok: true, suppressed: true });
      expect(await flush()).toBe(0);
    } finally {
      window.location = origLoc;
    }
  });
});

describe("Q11 — analyticsService: lifecycle helpers", () => {
  it("lifecycle.extractionSucceeded records an extraction_success event", async () => {
    await lifecycle.extractionSucceeded({ url: "https://a.com", intent: "summary" });
    await flush();
    const ls = JSON.parse(localStorage.getItem("datiq.analytics"));
    expect(ls).toHaveLength(1);
    expect(ls[0].name).toBe("extraction_success");
    expect(ls[0].properties.url).toBe("https://a.com");
  });

  it("lifecycle.saved/exported/monitorCreated/firstInsight all use canonical names", async () => {
    await lifecycle.saved({});
    await lifecycle.exported({ format: "csv" });
    await lifecycle.monitorCreated({ url: "https://b.com" });
    await lifecycle.firstInsight({ url: "https://c.com" });
    await flush();
    const ls = JSON.parse(localStorage.getItem("datiq.analytics"));
    const names = ls.map((e) => e.name);
    expect(names).toContain(FUNNEL.SAVE);
    expect(names).toContain(FUNNEL.EXPORT);
    expect(names).toContain(FUNNEL.MONITOR);
    expect(names).toContain(FUNNEL.FIRST_INSIGHT);
  });
});

describe("Q11 — analyticsService: computeFunnel", () => {
  it("returns zeros for an empty event list", () => {
    const f = computeFunnel([]);
    expect(f.stages).toHaveLength(4);
    expect(f.activationRate).toBe(0);
    expect(f.saveConversion).toBe(0);
    expect(f.exportConversion).toBe(0);
    expect(f.monitorConversion).toBe(0);
    expect(f.avgTimeToFirstInsightMs).toBeNull();
  });

  it("counts unique sessions per stage", () => {
    const events = [
      { name: "extraction_success", session_id: "s1", ts: "2026-07-17T00:00:00Z" },
      { name: "extraction_success", session_id: "s2", ts: "2026-07-17T00:01:00Z" },
      { name: "save",                session_id: "s1", ts: "2026-07-17T00:02:00Z" },
      { name: "save",                session_id: "s2", ts: "2026-07-17T00:03:00Z" },
      { name: "export",              session_id: "s1", ts: "2026-07-17T00:04:00Z" },
    ];
    const f = computeFunnel(events);
    const activation = f.stages.find((s) => s.name === FUNNEL.ACTIVATION);
    const save       = f.stages.find((s) => s.name === FUNNEL.SAVE);
    const exp        = f.stages.find((s) => s.name === FUNNEL.EXPORT);
    expect(activation.count).toBe(2);
    expect(save.count).toBe(2);
    expect(exp.count).toBe(1);
  });

  it("computes conversion rates from the first stage", () => {
    const events = [
      { name: "extraction_success", session_id: "s1" },
      { name: "extraction_success", session_id: "s2" },
      { name: "extraction_success", session_id: "s3" },
      { name: "extraction_success", session_id: "s4" },
      { name: "save",               session_id: "s1" },
      { name: "save",               session_id: "s2" },
      { name: "export",             session_id: "s1" },
    ];
    const f = computeFunnel(events);
    expect(f.activationRate).toBe(1);   // 4/4 sessions activated
    expect(f.saveConversion).toBe(0.5); // 2/4 saved
    expect(f.exportConversion).toBe(0.25);
    expect(f.monitorConversion).toBe(0);
  });

  it("computes average time-to-first-insight per session", () => {
    const events = [
      { name: "page_view",          session_id: "s1", ts: "2026-07-17T00:00:00Z" },
      { name: "first_insight",      session_id: "s1", ts: "2026-07-17T00:00:30Z" }, // 30s
      { name: "page_view",          session_id: "s2", ts: "2026-07-17T00:00:00Z" },
      { name: "extraction_success", session_id: "s2", ts: "2026-07-17T00:01:00Z" }, // 60s
    ];
    const f = computeFunnel(events);
    expect(f.avgTimeToFirstInsightMs).toBe(45_000);
  });

  it("groups events by the FUNNEL.ACTIVATION prefix family (extraction_success etc.)", () => {
    const events = [
      { name: "extraction_success", session_id: "s1" },
      { name: "extraction_failed",  session_id: "s2" },
      { name: "save",               session_id: "s1" },
    ];
    const f = computeFunnel(events);
    // The ACTIVATION stage catches both success and failure events.
    const act = f.stages.find((s) => s.name === FUNNEL.ACTIVATION);
    expect(act.count).toBe(2);
  });

  it("handles a null events argument without throwing", () => {
    expect(() => computeFunnel(null)).not.toThrow();
    expect(() => computeFunnel(undefined)).not.toThrow();
  });

  it("ignores events with invalid timestamps when computing time-to-first-insight", () => {
    const events = [
      { name: "page_view",          session_id: "s1", ts: "not-a-date" },
      { name: "first_insight",      session_id: "s1", ts: "2026-07-17T00:00:30Z" },
    ];
    const f = computeFunnel(events);
    // Without a valid session start, we can't compute — null.
    expect(f.avgTimeToFirstInsightMs).toBeNull();
  });
});
