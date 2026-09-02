// monitoringService.test.js — the client wrapper for the ops endpoints.
//
// The behaviour worth guarding: the server's own refusal message must reach the
// UI intact. These endpoints explain *why* they refused ("a reason is
// required", "that job is destructive"), and replacing that with "Action failed
// (400)" throws away the only useful part of the response.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getMonitoringSnapshot, setJobEnabled, runJobNow,
  pauseSchedule, resumeSchedule, getHealthSnapshot,
} from "./monitoringService.js";

let fetchMock;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("scrapelite.adminAuth", "tok-123");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) });
const fail = (status, b) => Promise.resolve({ ok: false, status, json: () => Promise.resolve(b) });
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
const sentBody = () => JSON.parse(lastCall()[1].body);

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("monitoringService auth (S-01)", () => {
  it("sends the stored admin token", async () => {
    fetchMock.mockReturnValue(ok({ ok: true }));
    await getMonitoringSnapshot();
    expect(lastCall()[1].headers.Authorization).toBe("Bearer tok-123");
  });

  it("sends an empty bearer rather than throwing when no token is stored", async () => {
    localStorage.clear();
    fetchMock.mockReturnValue(ok({ ok: true }));
    await getMonitoringSnapshot();
    expect(lastCall()[1].headers.Authorization).toBe("Bearer ");
  });

  it("survives localStorage being unavailable", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    fetchMock.mockReturnValue(ok({ ok: true }));
    await expect(getMonitoringSnapshot()).resolves.toEqual({ ok: true });
    spy.mockRestore();
  });
});

// ── Errors ───────────────────────────────────────────────────────────────────

describe("monitoringService errors (S-02)", () => {
  it("surfaces the server's own refusal message", async () => {
    fetchMock.mockReturnValue(fail(400, { error: "A reason is required." }));
    await expect(setJobEnabled("reengagement", false, "")).rejects.toThrow("A reason is required.");
  });

  it("surfaces the destructive-job refusal verbatim", async () => {
    fetchMock.mockReturnValue(fail(403, {
      error: '"billing-purge" cannot be triggered by hand. It is destructive, so its schedule is its only trigger path.',
    }));
    await expect(runJobNow("billing-purge", "why")).rejects.toThrow(/destructive/);
  });

  it("attaches the status code for the caller to branch on", async () => {
    fetchMock.mockReturnValue(fail(403, { error: "nope" }));
    await expect(runJobNow("billing-purge", "x")).rejects.toMatchObject({ status: 403 });
  });

  it("falls back to a generic message only when the server sends none", async () => {
    fetchMock.mockReturnValue(fail(500, {}));
    await expect(getMonitoringSnapshot()).rejects.toThrow("Failed to load monitoring data (500)");
  });

  it("does not choke on a non-JSON error body", async () => {
    fetchMock.mockReturnValue(Promise.resolve({
      ok: false, status: 502, json: () => Promise.reject(new Error("not json")),
    }));
    await expect(getHealthSnapshot()).rejects.toThrow("Failed to load health data (502)");
  });
});

// ── Control actions ──────────────────────────────────────────────────────────

describe("monitoringService control actions (S-03)", () => {
  // Block body: a value RETURNED from beforeEach is treated as a teardown
  // callback, and mockReturnValue returns the mock — so the concise-arrow form
  // hands Vitest the mock as teardown and invokes it after every test. Harmless
  // here (the mock just returns a value) but the same shape fails loudly the
  // moment an implementation throws.
  beforeEach(() => { fetchMock.mockReturnValue(ok({ ok: true })); });

  it("posts set_job_enabled with the reason", async () => {
    await setJobEnabled("billing-purge", false, "migration window");
    expect(lastCall()[0]).toBe("/api/admin-monitoring");
    expect(lastCall()[1].method).toBe("POST");
    expect(sentBody()).toEqual({
      action: "set_job_enabled", job: "billing-purge", enabled: false, reason: "migration window",
    });
  });

  it("posts run_job", async () => {
    await runJobNow("health-monitor", "verifying");
    expect(sentBody()).toEqual({ action: "run_job", job: "health-monitor", reason: "verifying" });
  });

  it("posts pause_schedule and resume_schedule with the schedule id", async () => {
    await pauseSchedule("sch_1", "abusive target");
    expect(sentBody()).toEqual({ action: "pause_schedule", id: "sch_1", reason: "abusive target" });
    await resumeSchedule("sch_1", "resolved");
    expect(sentBody()).toEqual({ action: "resume_schedule", id: "sch_1", reason: "resolved" });
  });

  // The client does not pre-validate the reason — the server and the database
  // both enforce it, and duplicating the rule here would let the three drift.
  it("lets the server reject a blank reason rather than guessing locally", async () => {
    await setJobEnabled("reengagement", false, "");
    expect(sentBody().reason).toBe("");
  });
});

// ── Health query ─────────────────────────────────────────────────────────────

describe("getHealthSnapshot (S-04)", () => {
  // Block body: a value RETURNED from beforeEach is treated as a teardown
  // callback, and mockReturnValue returns the mock — so the concise-arrow form
  // hands Vitest the mock as teardown and invokes it after every test. Harmless
  // here (the mock just returns a value) but the same shape fails loudly the
  // moment an implementation throws.
  beforeEach(() => { fetchMock.mockReturnValue(ok({ ok: true })); });

  it("omits query params for the default request", async () => {
    await getHealthSnapshot();
    expect(lastCall()[0]).toBe("/api/admin-health");
  });

  it("sends a non-default window", async () => {
    await getHealthSnapshot({ windowHours: 168 });
    expect(lastCall()[0]).toBe("/api/admin-health?window=168");
  });

  it("asks for a recorded sample when told to", async () => {
    await getHealthSnapshot({ record: true });
    expect(lastCall()[0]).toBe("/api/admin-health?record=1");
  });

  it("combines both", async () => {
    await getHealthSnapshot({ windowHours: 1, record: true });
    expect(lastCall()[0]).toBe("/api/admin-health?window=1&record=1");
  });

  // A cached monitoring dashboard is worse than a slow one.
  it("never sends a cacheable request", async () => {
    await getHealthSnapshot();
    expect(lastCall()[1].headers["Content-Type"]).toBe("application/json");
    expect(lastCall()[1].method).toBeUndefined(); // plain GET
  });
});
