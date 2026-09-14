// jobControl.test.js — the operator kill switch and the automation run log.
//
// The property most of these defend: monitoring must never be able to break the
// thing it monitors. A run log that cannot be written, a config row that cannot
// be read, a Supabase that times out — none of them may stop a cron.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let mod;

const URL_ENV = "https://example.supabase.co";

beforeEach(async () => {
  vi.resetModules();
  process.env.SUPABASE_URL = URL_ENV;
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  delete process.env.OPS_JOBS_DISABLED;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mod = await import("../functions/lib/jobControl.js");
  mod._resetOpsCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.OPS_JOBS_DISABLED;
});

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
const configRow = (jobs) => ok([{ value: { jobs } }]);
const calls = (pred) => fetchMock.mock.calls.filter(([u, o]) => pred(String(u), o || {}));

// ── Kill switch ──────────────────────────────────────────────────────────────

describe("isJobEnabled (J-01)", () => {
  it("defaults to enabled when nothing has been configured", async () => {
    fetchMock.mockResolvedValue(ok([]));
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(true);
  });

  it("respects an explicit stop", async () => {
    fetchMock.mockResolvedValue(configRow({ "billing-lifecycle": { enabled: false } }));
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(false);
  });

  it("leaves other jobs running when one is stopped", async () => {
    fetchMock.mockResolvedValue(configRow({ "billing-lifecycle": { enabled: false } }));
    expect(await mod.isJobEnabled("scheduled-runner")).toBe(true);
  });

  // THE central design decision. Failing closed would let a Supabase blip
  // silently stop billing and every user's monitoring, with no error anywhere.
  it("fails OPEN when Supabase errors", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(true);
  });

  it("fails OPEN when the fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(true);
  });

  it("fails OPEN when Supabase is not configured at all", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    mod._resetOpsCacheForTests();
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails OPEN when the stored value is not an object", async () => {
    fetchMock.mockResolvedValue(ok([{ value: "nonsense" }]));
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(true);
  });

  // The break-glass path: read from the process environment, so unlike the
  // database switch it cannot fail open.
  it("honours OPS_JOBS_DISABLED without touching the database", async () => {
    process.env.OPS_JOBS_DISABLED = "billing-purge, reengagement";
    expect(await mod.isJobEnabled("billing-purge")).toBe(false);
    expect(await mod.isJobEnabled("reengagement")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a failed read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await mod.isJobEnabled("billing-lifecycle");
    fetchMock.mockResolvedValueOnce(configRow({ "billing-lifecycle": { enabled: false } }));
    // A cached failure would keep the job "enabled" for the whole TTL and hide
    // a stop an operator had already applied.
    expect(await mod.isJobEnabled("billing-lifecycle")).toBe(false);
  });

  it("caches a successful read across calls", async () => {
    fetchMock.mockResolvedValue(configRow({}));
    await mod.isJobEnabled("billing-lifecycle");
    await mod.isJobEnabled("scheduled-runner");
    expect(calls((u) => u.includes("app_config"))).toHaveLength(1);
  });
});

describe("jobEnabledMap (J-02)", () => {
  it("reports every registered job with its provenance", async () => {
    fetchMock.mockResolvedValue(configRow({
      "billing-purge": { enabled: false, reason: "migration window", at: "2026-07-27T00:00:00Z", by: "admin" },
    }));
    const map = await mod.jobEnabledMap();
    expect(Object.keys(map).sort()).toEqual([
      "billing-lifecycle", "billing-purge", "bulk-runner",
      "discoverability-monitor", "health-monitor",
      // W6.5. Sorted here by the .sort() above, not by registry order.
      "prompt-monitor",
      "reengagement",
      "scheduled-runner", "signal-retry", "sxo-analytics-import-worker", "watchlist-monitor",
      // The v2 dispatch loop's cron half, registered 2026-09-06. Sorted last
      // by the .sort() above, not by registry order.
      "workflow-orchestrator-cron",
    ]);
    expect(map["billing-purge"]).toMatchObject({
      enabled: false, source: "config", reason: "migration window", changedBy: "admin",
    });
    expect(map["scheduled-runner"]).toMatchObject({ enabled: true, source: "default" });
  });

  it("marks env-stopped jobs with their own source", async () => {
    process.env.OPS_JOBS_DISABLED = "health-monitor";
    fetchMock.mockResolvedValue(ok([]));
    const map = await mod.jobEnabledMap();
    expect(map["health-monitor"]).toMatchObject({ enabled: false, source: "env" });
    expect(map["health-monitor"].reason).toMatch(/OPS_JOBS_DISABLED/);
  });
});

describe("writeJobEnabled (J-03)", () => {
  it("merges into the existing document instead of replacing it", async () => {
    fetchMock
      .mockResolvedValueOnce(configRow({ "reengagement": { enabled: false, reason: "old" } }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));

    const res = await mod.writeJobEnabled("billing-purge", false, { reason: "why", actor: "admin" });
    expect(res.ok).toBe(true);

    const [, opts] = calls((u, o) => u.includes("app_config") && o.method === "POST")[0];
    const sent = JSON.parse(opts.body);
    expect(sent.key).toBe("ops");
    // The other job's stop must survive this write.
    expect(sent.value.jobs.reengagement).toMatchObject({ enabled: false, reason: "old" });
    expect(sent.value.jobs["billing-purge"]).toMatchObject({ enabled: false, reason: "why", by: "admin" });
  });

  it("reports a persistence failure rather than claiming success", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    const res = await mod.writeJobEnabled("reengagement", false, { reason: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/500/);
  });

  it("refuses when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    const res = await mod.writeJobEnabled("reengagement", false, { reason: "x" });
    expect(res).toMatchObject({ ok: false, persisted: false });
  });
});

// ── Run log ──────────────────────────────────────────────────────────────────

describe("run log (J-04)", () => {
  it("opens a running row and closes it with the outcome", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([{ id: 42 }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const handle = await mod.startJobRun("reengagement", "manual");
    expect(handle).toMatchObject({ id: 42, job: "reengagement" });

    const insert = JSON.parse(calls((u, o) => u.includes("job_runs") && o.method === "POST")[0][1].body);
    expect(insert).toMatchObject({ job: "reengagement", status: "running", trigger: "manual" });

    await mod.finishJobRun(handle, { status: "success", detail: { sent: 3 } });
    const patch = JSON.parse(calls((u, o) => o.method === "PATCH")[0][1].body);
    expect(patch).toMatchObject({ status: "success", detail: { sent: 3 } });
    expect(patch.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("normalises an unexpected trigger to 'schedule'", async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 1 }]));
    await mod.startJobRun("reengagement", "hackers");
    const insert = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(insert.trigger).toBe("schedule");
  });

  it("truncates an enormous error rather than writing a log dump", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await mod.finishJobRun({ id: 1, startedAt: Date.now() }, { status: "error", error: "x".repeat(5000) });
    const patch = JSON.parse(calls((u, o) => o.method === "PATCH")[0][1].body);
    expect(patch.error).toHaveLength(1000);
  });

  it("returns null instead of throwing when the log cannot be written", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(mod.startJobRun("reengagement")).resolves.toBeNull();
  });

  it("no-ops without a handle", async () => {
    await expect(mod.finishJobRun(null, { status: "success" })).resolves.toBe(false);
  });

  it("records a skipped run", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 201 }));
    await mod.recordSkippedRun("billing-purge", "disabled_by_operator");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ job: "billing-purge", status: "skipped", detail: { reason: "disabled_by_operator" } });
    expect(body.finished_at).toBeTruthy();
  });

  it("returns an empty history rather than throwing", async () => {
    fetchMock.mockRejectedValue(new Error("nope"));
    await expect(mod.listJobRuns("reengagement")).resolves.toEqual([]);
    await expect(mod.listRecentRuns()).resolves.toEqual([]);
  });

  it("clamps the history limit", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await mod.listJobRuns("reengagement", 99999);
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=100");
  });
});

// ── withJobRun ───────────────────────────────────────────────────────────────

describe("withJobRun (J-05)", () => {
  it("runs the body and records success", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([]))                                // kill switch
      .mockResolvedValueOnce(ok([{ id: 7 }]))                       // start
      .mockResolvedValueOnce(new Response(null, { status: 204 }));    // finish

    const body = vi.fn().mockResolvedValue({ statusCode: 200, body: "did the thing" });
    const handler = mod.withJobRun("reengagement", body);
    const res = await handler({});

    expect(body).toHaveBeenCalled();
    expect(res.body).toBe("did the thing");
    const patch = JSON.parse(calls((u, o) => o.method === "PATCH")[0][1].body);
    expect(patch.status).toBe("success");
  });

  it("does not run the body when the job is stopped", async () => {
    fetchMock
      .mockResolvedValueOnce(configRow({ reengagement: { enabled: false } }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));

    const body = vi.fn();
    const res = await mod.withJobRun("reengagement", body)({});

    expect(body).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ skipped: true, reason: "disabled_by_operator" });
  });

  it("logs the skip so a stopped job is still visible as having been due", async () => {
    fetchMock
      .mockResolvedValueOnce(configRow({ reengagement: { enabled: false } }))
      .mockResolvedValueOnce(new Response("", { status: 201 }));
    await mod.withJobRun("reengagement", vi.fn())({});
    const skip = calls((u, o) => u.includes("job_runs") && o.method === "POST");
    expect(JSON.parse(skip[0][1].body).status).toBe("skipped");
  });

  // Swallowing here would hide the failure from Netlify's own logs and retries.
  it("records the error and RE-THROWS it", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([{ id: 9 }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const handler = mod.withJobRun("reengagement", async () => { throw new Error("kaboom"); });
    await expect(handler({})).rejects.toThrow("kaboom");

    const patch = JSON.parse(calls((u, o) => o.method === "PATCH")[0][1].body);
    expect(patch).toMatchObject({ status: "error", error: "kaboom" });
  });

  // The monitoring layer must never be able to break the job.
  it("still runs the body when the run log is completely unwritable", async () => {
    fetchMock.mockRejectedValue(new Error("supabase gone"));
    const body = vi.fn().mockResolvedValue({ statusCode: 200, body: "ok" });
    await expect(mod.withJobRun("reengagement", body)({})).resolves.toMatchObject({ statusCode: 200 });
    expect(body).toHaveBeenCalled();
  });

  it("marks a hand-triggered run as manual", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([{ id: 11 }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mod.withJobRun("reengagement", async () => ({ statusCode: 200, body: "x" }))({ opsTrigger: "manual" });
    const insert = JSON.parse(calls((u, o) => u.includes("job_runs") && o.method === "POST")[0][1].body);
    expect(insert.trigger).toBe("manual");
  });

  it("passes the event and context through to the body", async () => {
    fetchMock.mockResolvedValue(ok([]));
    const body = vi.fn().mockResolvedValue({ statusCode: 200 });
    await mod.withJobRun("reengagement", body)({ a: 1 }, { b: 2 });
    expect(body).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
  });
});

describe("detailFromResult (J-06)", () => {
  // `mod` is re-imported per test by the outer beforeEach (vi.resetModules), so
  // the helper is read from it rather than captured once at describe time.
  const detail = (...args) => mod._internal.detailFromResult(...args);

  it("keeps scalar fields from a JSON body", () => {
    expect(detail({ statusCode: 200, body: JSON.stringify({ sent: 3, ok: true, who: "u1" }) }))
      .toEqual({ statusCode: 200, sent: 3, ok: true, who: "u1" });
  });

  // One busy run must not be able to write a megabyte of JSON into every row.
  it("drops arrays and nested objects", () => {
    expect(detail({ statusCode: 200, body: JSON.stringify({ n: 1, rows: [1, 2, 3], deep: { a: 1 } }) }))
      .toEqual({ statusCode: 200, n: 1 });
  });

  it("truncates long strings", () => {
    expect(detail({ statusCode: 200, body: JSON.stringify({ msg: "y".repeat(1000) }) }).msg)
      .toHaveLength(300);
  });

  it("keeps a plain-text body as a truncated string", () => {
    expect(detail({ statusCode: 200, body: "scanned 4, ran 2" }))
      .toEqual({ statusCode: 200, body: "scanned 4, ran 2" });
  });

  it("survives a result that is not a response at all", () => {
    expect(detail(null)).toEqual({});
    expect(detail("nope")).toEqual({});
    expect(detail(undefined)).toEqual({});
  });
});
