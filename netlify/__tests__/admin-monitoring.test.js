// admin-monitoring.test.js — automation monitoring and control endpoint.
//
// Two properties dominate these tests:
//   1. No mutation without a written reason, and the reason reaches the audit log.
//   2. The destructive job cannot be triggered from here, by any request shape.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

let fetchMock;
let handler;

const TEST_SECRET = "test-secret";

function adminToken(expOffsetMs = 60_000) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + expOffsetMs })).toString("base64url");
  const sig = createHmac("sha256", TEST_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

const authed = (extra = {}) => ({
  httpMethod: "GET",
  headers: { authorization: `Bearer ${adminToken()}` },
  ...extra,
});

const post = (body, extra = {}) => authed({ httpMethod: "POST", body: JSON.stringify(body), ...extra });

beforeEach(async () => {
  vi.resetModules();
  process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  delete process.env.OPS_JOBS_DISABLED;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("../functions/admin-monitoring.js");
  handler = mod.handler;
  const jc = await import("../functions/lib/jobControl.js");
  jc._resetOpsCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ADMIN_TOKEN_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const body = (res) => JSON.parse(res.body);
const calls = (pred) => fetchMock.mock.calls.filter(([u, o]) => pred(String(u), o || {}));

/** Route every table read to a sensible default so GET works end to end. */
function wireReads({ runs = [], schedules = [], config = [], audit = [] } = {}) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    if (opts.method && opts.method !== "GET") return json({}, 201);
    if (u.includes("app_config")) return json(config);
    if (u.includes("job_runs")) return json(runs);
    if (u.includes("scheduled_tasks")) return json(schedules);
    if (u.includes("ops_audit_log")) return json(audit);
    return json([]);
  });
}

const run = (job, status, minsAgo, extra = {}) => ({
  id: `${job}-${minsAgo}`, job, status,
  started_at: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  trigger: "schedule", ...extra,
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("admin-monitoring auth (AM-01)", () => {
  it("rejects a request with no token", async () => {
    const r = await handler({ httpMethod: "GET", headers: {} });
    expect(r.statusCode).toBe(401);
  });

  it("rejects a forged token", async () => {
    const r = await handler({ httpMethod: "GET", headers: { authorization: "Bearer aaa.bbb" } });
    expect(r.statusCode).toBe(401);
  });

  it("rejects an expired token", async () => {
    const r = await handler({ httpMethod: "GET", headers: { authorization: `Bearer ${adminToken(-1000)}` } });
    expect(r.statusCode).toBe(401);
  });

  // GET is gated too: the response lists every user's schedule targets.
  it("gates the read, not only the writes", async () => {
    wireReads();
    expect((await handler({ httpMethod: "GET", headers: {} })).statusCode).toBe(401);
    expect((await handler(authed())).statusCode).toBe(200);
  });

  it("answers CORS preflight without a token", async () => {
    expect((await handler({ httpMethod: "OPTIONS" })).statusCode).toBe(204);
  });

  it("rejects an unsupported method", async () => {
    expect((await handler(authed({ httpMethod: "DELETE" }))).statusCode).toBe(405);
  });
});

// ── Snapshot ─────────────────────────────────────────────────────────────────

describe("admin-monitoring GET (AM-02)", () => {
  it("returns every registered job with a derived status", async () => {
    wireReads({ runs: [run("billing-lifecycle", "success", 30)] });
    const b = body(await handler(authed()));
    expect(b.ok).toBe(true);
    expect(b.jobs.map((j) => j.id)).toEqual([
      "scheduled-runner", "discoverability-monitor",
      "watchlist-monitor", "bulk-runner", "signal-retry",
      "reengagement", "billing-lifecycle", "billing-purge", "health-monitor",
    ]);
    const lifecycle = b.jobs.find((j) => j.id === "billing-lifecycle");
    expect(lifecycle.state).toBe("healthy");
    expect(lifecycle.nextRunAt).toBeTruthy();
  });

  it("tags every job with its platform (Netlify vs DB & Identity)", async () => {
    wireReads({ runs: [run("billing-lifecycle", "success", 30)] });
    const b = body(await handler(authed()));
    const byId = Object.fromEntries(b.jobs.map((j) => [j.id, j.platform]));
    expect(byId["scheduled-runner"]).toBe("netlify");
    expect(byId["reengagement"]).toBe("netlify");
    expect(byId["billing-lifecycle"]).toBe("db");
    expect(byId["billing-purge"]).toBe("db");
    expect(byId["health-monitor"]).toBe("db");
  });

  it("emits a dataSource block describing the Netlify + Supabase context", async () => {
    process.env.CONTEXT = "branch-deploy";
    process.env.BRANCH  = "monitoring-services-in-admin-module";
    process.env.SITE_NAME = "datiqapp";
    process.env.SUPABASE_URL = "https://abcdefghijkl.supabase.co";
    wireReads({ runs: [] });
    const b = body(await handler(authed()));
    expect(b.dataSource).toBeTruthy();
    // Netlify label includes the branch so an operator can confirm which
    // deploy is answering them.
    expect(b.dataSource.netlify).toMatch(/monitoring-services-in-admin-module/);
    // Supabase label is a masked form of the project ref (first 4 + last 2),
    // not the full ref, so the response does not leak the project id.
    expect(b.dataSource.supabase).toMatch(/^project\s+·\s+abcd…kl$/);
  });

  it("reports a job with no history as never-run", async () => {
    wireReads({ runs: [] });
    const b = body(await handler(authed()));
    expect(b.jobs.every((j) => j.state === "never-run")).toBe(true);
    expect(b.jobSummary.neverRun).toBe(9);
  });

  it("reports a failing job and surfaces it as the worst state", async () => {
    wireReads({ runs: [run("reengagement", "error", 10, { error: "boom" })] });
    const b = body(await handler(authed()));
    expect(b.jobs.find((j) => j.id === "reengagement").state).toBe("failing");
    expect(b.jobSummary.worst).toBe("failing");
  });

  it("uses the last SUCCESS for staleness, not the last run", async () => {
    // Ran five minutes ago and skipped; last real success was eight days back.
    wireReads({ runs: [
      run("billing-lifecycle", "skipped", 5),
      run("billing-lifecycle", "success", 60 * 24 * 8),
    ] });
    const b = body(await handler(authed()));
    expect(b.jobs.find((j) => j.id === "billing-lifecycle").state).toBe("stale");
  });

  it("carries the destructive flag and the manual-run rule to the client", async () => {
    wireReads();
    const b = body(await handler(authed()));
    const purge = b.jobs.find((j) => j.id === "billing-purge");
    expect(purge.destructive).toBe(true);
    expect(purge.manualRunAllowed).toBe(false);
  });

  it("reengagement's success status is trustworthy again — no caveat attached", async () => {
    wireReads({ runs: [run("reengagement", "success", 60)] });
    const b = body(await handler(authed()));
    expect(b.jobs.find((j) => j.id === "reengagement").caveat).toBeFalsy();
  });

  it("reports a stopped job as stopped, with its provenance", async () => {
    wireReads({
      config: [{ value: { jobs: { "billing-purge": { enabled: false, reason: "migration", by: "admin" } } } }],
      runs: [run("billing-purge", "success", 60)],
    });
    const b = body(await handler(authed()));
    const purge = b.jobs.find((j) => j.id === "billing-purge");
    expect(purge.enabled).toBe(false);
    expect(purge.state).toBe("disabled");
    expect(purge.control).toMatchObject({ reason: "migration", changedBy: "admin" });
  });

  it("classifies user schedules across all four states", async () => {
    wireReads({ schedules: [
      { id: "s1", user_id: "u1", status: "active", system_paused: false, cron: "0 9 * * *", data: { label: "A" } },
      { id: "s2", user_id: "u1", status: "paused", system_paused: false, cron: "0 9 * * *", data: { label: "B" } },
      { id: "s3", user_id: "u2", status: "active", system_paused: true,
        system_pause_reason: "subscription_suspended", cron: "0 9 * * *", data: { label: "C" } },
      { id: "s4", user_id: "u2", status: "active", system_paused: false, cron: "0 9 * * *",
        data: { label: "D", endsAt: "2020-01-01T00:00:00Z" } },
    ] });
    const b = body(await handler(authed()));
    expect(b.scheduleSummary).toMatchObject({ total: 4, active: 1, paused: 1, systemPaused: 1, expired: 1 });
  });

  it("caps the inline run history per job", async () => {
    const runs = Array.from({ length: 30 }, (_, i) => run("scheduled-runner", "success", i + 1));
    wireReads({ runs });
    const b = body(await handler(authed()));
    expect(b.jobs.find((j) => j.id === "scheduled-runner").runs).toHaveLength(10);
  });

  // Without Supabase every job reads "never run", which is true but would look
  // like a five-alarm fire rather than an unconfigured environment.
  it("flags that history is unavailable when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    vi.resetModules();
    const mod = await import("../functions/admin-monitoring.js");
    const b = body(await mod.handler(authed()));
    expect(b.historyAvailable).toBe(false);
    expect(b.ok).toBe(true);
  });

  it("degrades to an empty list rather than failing when a table read errors", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const b = body(await handler(authed()));
    expect(b.ok).toBe(true);
    expect(b.schedules).toEqual([]);
  });
});

// ── Control: reason enforcement ──────────────────────────────────────────────

describe("admin-monitoring reason enforcement (AM-03)", () => {
  const cases = [
    ["set_job_enabled", { action: "set_job_enabled", job: "reengagement", enabled: false }],
    ["run_job", { action: "run_job", job: "reengagement" }],
    ["pause_schedule", { action: "pause_schedule", id: "s1" }],
    ["resume_schedule", { action: "resume_schedule", id: "s1" }],
  ];

  for (const [name, payload] of cases) {
    it(`rejects ${name} with no reason`, async () => {
      wireReads();
      const r = await handler(post(payload));
      expect(r.statusCode).toBe(400);
      expect(body(r).error).toMatch(/reason is required/i);
    });

    it(`rejects ${name} with a whitespace-only reason`, async () => {
      wireReads();
      const r = await handler(post({ ...payload, reason: "   " }));
      expect(r.statusCode).toBe(400);
    });
  }

  it("rejects a non-string reason", async () => {
    wireReads();
    const r = await handler(post({ action: "set_job_enabled", job: "reengagement", enabled: false, reason: 42 }));
    // Number(42) stringifies to "42", which IS a reason — but null is not.
    expect(r.statusCode).not.toBe(500);
    const r2 = await handler(post({ action: "set_job_enabled", job: "reengagement", enabled: false, reason: null }));
    expect(r2.statusCode).toBe(400);
  });

  // The reason must actually reach the log — rejecting a blank one is pointless
  // if the accepted one is dropped on the floor.
  it("writes the reason to the audit log", async () => {
    wireReads();
    await handler(post({
      action: "set_job_enabled", job: "billing-purge", enabled: false,
      reason: "paused during the data migration",
    }));
    const audit = calls((u, o) => u.includes("ops_audit_log") && o.method === "POST");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0][1].body)).toMatchObject({
      action: "job_disable", target: "billing-purge", reason: "paused during the data migration",
    });
  });

  it("rejects an unknown action", async () => {
    const r = await handler(post({ action: "drop_everything", reason: "why not" }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error).toMatch(/Unknown action/);
  });

  it("rejects a malformed body", async () => {
    const r = await handler(authed({ httpMethod: "POST", body: "{not json" }));
    expect(r.statusCode).toBe(400);
  });
});

// ── Control: start / stop ────────────────────────────────────────────────────

describe("set_job_enabled (AM-04)", () => {
  it("stops a job and persists the switch", async () => {
    wireReads();
    const r = await handler(post({
      action: "set_job_enabled", job: "reengagement", enabled: false, reason: "noisy",
    }));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ ok: true, job: "reengagement", enabled: false });
    const write = calls((u, o) => u.includes("app_config") && o.method === "POST");
    expect(JSON.parse(write[0][1].body).value.jobs.reengagement.enabled).toBe(false);
  });

  it("starts a job again", async () => {
    wireReads({ config: [{ value: { jobs: { reengagement: { enabled: false } } } }] });
    const r = await handler(post({
      action: "set_job_enabled", job: "reengagement", enabled: true, reason: "fixed",
    }));
    expect(body(r).enabled).toBe(true);
  });

  it("rejects an unknown job id", async () => {
    const r = await handler(post({ action: "set_job_enabled", job: "rm-rf", enabled: false, reason: "x" }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error).toMatch(/Unknown job/);
  });

  it("requires an explicit boolean rather than coercing", async () => {
    const r = await handler(post({ action: "set_job_enabled", job: "reengagement", enabled: "false", reason: "x" }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error).toMatch(/true or false/);
  });

  it("reports a persistence failure instead of claiming the job is stopped", async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if (String(url).includes("app_config") && opts.method === "POST") return json({}, 500);
      return json([]);
    });
    const r = await handler(post({ action: "set_job_enabled", job: "reengagement", enabled: false, reason: "x" }));
    expect(r.statusCode).toBe(502);
    expect(body(r).ok).toBe(false);
  });
});

// ── Control: manual run ──────────────────────────────────────────────────────

describe("run_job (AM-05)", () => {
  // THE safety test for this endpoint.
  it("refuses to run the destructive job", async () => {
    wireReads();
    const r = await handler(post({ action: "run_job", job: "billing-purge", reason: "just checking" }));
    expect(r.statusCode).toBe(403);
    expect(body(r).error).toMatch(/destructive/i);
  });

  it("writes no audit entry for a refused destructive run", async () => {
    wireReads();
    await handler(post({ action: "run_job", job: "billing-purge", reason: "just checking" }));
    // The request never mutated anything, so it must not look like it did.
    expect(calls((u, o) => u.includes("ops_audit_log") && o.method === "POST")).toHaveLength(0);
  });

  it("does not even import the destructive job's module", async () => {
    const mod = await import("../functions/admin-monitoring.js");
    expect(Object.keys(mod._internal.RUNNABLE)).not.toContain("billing-purge");
  });

  it("runs a permitted job and returns its output", async () => {
    wireReads();
    const r = await handler(post({ action: "run_job", job: "health-monitor", reason: "verifying the fix" }));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ ok: true, job: "health-monitor", ran: true });
  });

  it("marks the resulting run as manual", async () => {
    wireReads();
    await handler(post({ action: "run_job", job: "health-monitor", reason: "verifying" }));
    const inserts = calls((u, o) => u.includes("job_runs") && o.method === "POST");
    expect(inserts.length).toBeGreaterThan(0);
    expect(JSON.parse(inserts[0][1].body).trigger).toBe("manual");
  });

  it("audits the manual run before executing it", async () => {
    wireReads();
    await handler(post({ action: "run_job", job: "health-monitor", reason: "verifying the fix" }));
    const audit = calls((u, o) => u.includes("ops_audit_log") && o.method === "POST");
    expect(JSON.parse(audit[0][1].body)).toMatchObject({ action: "job_run", target: "health-monitor" });
  });

  it("rejects an unknown job id", async () => {
    const r = await handler(post({ action: "run_job", job: "nope", reason: "x" }));
    expect(r.statusCode).toBe(400);
  });
});

// ── Control: schedules ───────────────────────────────────────────────────────

describe("pause_schedule / resume_schedule (AM-06)", () => {
  const patched = (over = {}) => ({
    id: "s1", user_id: "u1", status: "active", system_paused: true,
    system_pause_reason: "admin_paused", cron: "0 9 * * *", data: { label: "A" }, ...over,
  });

  function wirePatch(rows) {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("scheduled_tasks") && opts.method === "PATCH") return json(rows);
      if (opts.method && opts.method !== "GET") return json({}, 201);
      return json([]);
    });
  }

  it("system-pauses a schedule", async () => {
    wirePatch([patched()]);
    const r = await handler(post({ action: "pause_schedule", id: "s1", reason: "abusive target" }));
    expect(r.statusCode).toBe(200);
    expect(body(r)).toMatchObject({ ok: true, paused: true });
    const patch = calls((u, o) => u.includes("scheduled_tasks") && o.method === "PATCH");
    expect(JSON.parse(patch[0][1].body)).toEqual({ system_paused: true, system_pause_reason: "admin_paused" });
  });

  // Using a distinct reason means a subscription reactivation cannot silently
  // un-pause something an operator stopped on purpose.
  it("tags the pause so the billing lifecycle will not undo it", async () => {
    wirePatch([patched()]);
    await handler(post({ action: "pause_schedule", id: "s1", reason: "x" }));
    const patch = calls((u, o) => u.includes("scheduled_tasks") && o.method === "PATCH");
    expect(JSON.parse(patch[0][1].body).system_pause_reason).toBe("admin_paused");
    expect(JSON.parse(patch[0][1].body).system_pause_reason).not.toBe("subscription_suspended");
  });

  it("resumes a schedule by clearing both columns", async () => {
    wirePatch([patched({ system_paused: false, system_pause_reason: null })]);
    const r = await handler(post({ action: "resume_schedule", id: "s1", reason: "resolved" }));
    expect(body(r)).toMatchObject({ ok: true, paused: false });
    const patch = calls((u, o) => u.includes("scheduled_tasks") && o.method === "PATCH");
    expect(JSON.parse(patch[0][1].body)).toEqual({ system_paused: false, system_pause_reason: null });
  });

  // The two axes are independent, and the message must not imply otherwise.
  it("says so when a resumed schedule stays paused by the user's own choice", async () => {
    wirePatch([patched({ status: "paused", system_paused: false, system_pause_reason: null })]);
    const r = await handler(post({ action: "resume_schedule", id: "s1", reason: "resolved" }));
    expect(body(r).message).toMatch(/user paused it themselves/i);
    expect(body(r).schedule.userPaused).toBe(true);
  });

  it("404s for a schedule that does not exist", async () => {
    wirePatch([]);
    const r = await handler(post({ action: "pause_schedule", id: "nope", reason: "x" }));
    expect(r.statusCode).toBe(404);
  });

  it("requires an id", async () => {
    const r = await handler(post({ action: "pause_schedule", reason: "x" }));
    expect(r.statusCode).toBe(400);
    expect(body(r).error).toMatch(/id/);
  });

  it("reports a Supabase failure rather than claiming success", async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      if (String(url).includes("scheduled_tasks") && opts.method === "PATCH") return json({}, 500);
      return json([]);
    });
    const r = await handler(post({ action: "pause_schedule", id: "s1", reason: "x" }));
    expect(r.statusCode).toBe(502);
  });
});
