// health-monitor.test.js — the hourly sampler and its alerting rule.
//
// The alerting rule is where monitoring systems normally go wrong, so most of
// this file is about what must NOT send an email.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let mod;

const ENV_KEYS = [
  "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "RESEND_API_KEY", "OPS_ALERT_EMAIL",
  "ALERT_EMAIL_FROM", "NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID", "URL", "SITE_URL",
  "OPS_JOBS_DISABLED",
];

beforeEach(async () => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mod = await import("../functions/health-monitor.js");
  (await import("../functions/lib/jobControl.js"))._resetOpsCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const calls = (pred) => fetchMock.mock.calls.filter(([u, o]) => pred(String(u), o || {}));
const emails = () => calls((u) => u.includes("api.resend.com/emails"));

// The supabase-db probe deliberately queries app_config (a question only
// Postgres can answer), and jobControl reads its kill switch from the same
// table. They are told apart by METHOD: the probe uses HEAD, the config read
// uses GET. Matching on the table name alone made every "database down" case
// silently pass as healthy.
function wire({ samples = [], dbOk = true } = {}) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("app_config") && opts.method === "HEAD") {
      return new Response(null, { status: dbOk ? 200 : 503 });
    }
    if (u.includes("health_samples")) {
      if (opts.method === "POST") return json({}, 201);
      return json(samples);
    }
    if (u.includes("job_runs")) return json([{ id: 1 }], opts.method === "POST" ? 201 : 200);
    if (u.includes("app_config")) return json([]);
    if (u.includes("/auth/v1/health")) return json({ name: "GoTrue" });
    if (u.includes("status.json")) return json({ status: { indicator: "none" }, page: {} });
    if (u.includes("api.resend.com")) return json({ id: "mail_1" }, 200);
    return json({});
  });
}

// ── detectTransitions ────────────────────────────────────────────────────────

const c = (id, status, label = id) => ({ id, status, label, note: "", latencyMs: 10 });

describe("detectTransitions (HM-01)", () => {
  it("detects a critical component going down", () => {
    const t = mod.detectTransitions([c("supabase-db", "down")], { "supabase-db": "ok" });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: "supabase-db", from: "ok", to: "down", recovered: false });
  });

  it("detects a recovery", () => {
    const t = mod.detectTransitions([c("supabase-db", "ok")], { "supabase-db": "down" });
    expect(t[0].recovered).toBe(true);
  });

  // This is what makes the alert idempotent without a dedup table: a component
  // that stays down produces one email, not one an hour.
  it("does not fire while a component stays in the same state", () => {
    expect(mod.detectTransitions([c("supabase-db", "down")], { "supabase-db": "down" })).toEqual([]);
  });

  // Otherwise the first run after a deploy pages someone about every service at
  // once, which is how alerting gets muted permanently.
  it("does not fire on the very first sample", () => {
    expect(mod.detectTransitions([c("supabase-db", "down")], {})).toEqual([]);
  });

  // A change in what we could measure is not a change in the service.
  it("ignores movement into unknown", () => {
    expect(mod.detectTransitions([c("supabase-db", "unknown")], { "supabase-db": "ok" })).toEqual([]);
  });

  it("ignores movement out of unknown", () => {
    expect(mod.detectTransitions([c("supabase-db", "down")], { "supabase-db": "unknown" })).toEqual([]);
  });

  // Resend being down stops alert mail, which matters — but it is not a reason
  // to wake someone at 3am, and it is not what this alert is for.
  it("ignores non-critical components", () => {
    expect(mod.detectTransitions([c("email-resend", "down")], { "email-resend": "ok" })).toEqual([]);
    expect(mod.detectTransitions([c("netlify-platform", "down")], { "netlify-platform": "ok" })).toEqual([]);
  });

  it("reports several transitions at once", () => {
    const t = mod.detectTransitions(
      [c("supabase-db", "down"), c("supabase-auth", "degraded"), c("functions-runtime", "ok")],
      { "supabase-db": "ok", "supabase-auth": "ok", "functions-runtime": "ok" },
    );
    expect(t.map((x) => x.id).sort()).toEqual(["supabase-auth", "supabase-db"]);
  });

  it("ignores a component that is not in the registry", () => {
    expect(mod.detectTransitions([c("mystery", "down")], { mystery: "ok" })).toEqual([]);
  });
});

// ── Alert email ──────────────────────────────────────────────────────────────

describe("alerting (HM-02)", () => {
  // Ships disarmed: the sampling half is safe to enable immediately, the half
  // that reaches a human is opt-in.
  it("sends nothing without OPS_ALERT_EMAIL, even on a real transition", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_x";
    wire({ samples: [{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }], dbOk: false });
    await mod.handler({});
    expect(emails()).toHaveLength(0);
  });

  it("sends nothing without a Resend key", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.OPS_ALERT_EMAIL = "ops@datiq.app";
    wire({ samples: [{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }], dbOk: false });
    await mod.handler({});
    expect(emails()).toHaveLength(0);
  });

  it("emails on a critical transition when armed", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_x";
    process.env.OPS_ALERT_EMAIL = "ops@datiq.app";
    wire({ samples: [{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }], dbOk: false });

    const res = await mod.handler({});
    expect(emails()).toHaveLength(1);
    const sent = JSON.parse(emails()[0][1].body);
    expect(sent.to).toEqual(["ops@datiq.app"]);
    expect(sent.subject).toMatch(/degraded/i);
    expect(res.body).toMatch(/alert sent/);
  });

  it("supports several recipients", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_x";
    process.env.OPS_ALERT_EMAIL = "a@x.com, b@x.com";
    wire({ samples: [{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }], dbOk: false });
    await mod.handler({});
    expect(JSON.parse(emails()[0][1].body).to).toEqual(["a@x.com", "b@x.com"]);
  });

  it("uses the machine-alert sender, not a human inbox", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_x";
    process.env.OPS_ALERT_EMAIL = "ops@datiq.app";
    wire({ samples: [{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }], dbOk: false });
    await mod.handler({});
    // Per the "one env var per sender" rule in CLAUDE.md.
    expect(JSON.parse(emails()[0][1].body).from).toContain("alerts@datiq.app");
  });

  it("builds a recovery email with different framing", () => {
    const html = mod._internal.buildAlertEmail(
      [{ id: "supabase-db", label: "Supabase database", from: "down", to: "ok", recovered: true, note: "" }],
      { ok: 9, degraded: 0, down: 0, unknown: 1 },
      "https://datiq.app",
    );
    expect(html).toContain("Services recovered");
    expect(html).toContain("/admin/health");
  });

  it("escapes component text in the email", () => {
    const html = mod._internal.buildAlertEmail(
      [{ id: "x", label: "<script>alert(1)</script>", from: "ok", to: "down", recovered: false, note: "" }],
      { ok: 0, degraded: 0, down: 1, unknown: 0 }, "https://datiq.app",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not fail the run when the alert email errors", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_x";
    process.env.OPS_ALERT_EMAIL = "ops@datiq.app";
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("api.resend.com")) throw new Error("mail down");
      if (u.includes("health_samples")) {
        return opts.method === "POST" ? json({}, 201)
          : json([{ component: "supabase-db", status: "ok", observed_at: new Date().toISOString() }]);
      }
      if (u.includes("job_runs")) return json([{ id: 1 }], opts.method === "POST" ? 201 : 200);
      if (u.includes("app_config")) return json([]);
      if (u.includes("/rest/v1/")) return new Response(null, { status: 503 });
      if (u.includes("status.json")) return json({ status: { indicator: "none" }, page: {} });
      return json({});
    });
    const res = await mod.handler({});
    expect(res.statusCode).toBe(200);
  });
});

// ── Sampling ─────────────────────────────────────────────────────────────────

describe("sampling (HM-03)", () => {
  it("stores one row per component", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wire();
    await mod.handler({});
    const writes = calls((u, o) => u.includes("health_samples") && o.method === "POST");
    expect(writes).toHaveLength(1);
    const rows = JSON.parse(writes[0][1].body);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveProperty("component");
    expect(rows[0]).toHaveProperty("status");
  });

  it("still probes and reports when Supabase is not configured", async () => {
    wire();
    const res = await mod.handler({});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/not stored/);
    expect(calls((u, o) => u.includes("health_samples") && o.method === "POST")).toHaveLength(0);
  });

  it("summarises the outcome in the run body", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wire();
    const res = await mod.handler({});
    expect(res.body).toMatch(/overall (ok|degraded|down|unknown)/);
    expect(res.body).toMatch(/stored 10/);
  });

  it("does not throw when the sample write fails", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("health_samples") && opts.method === "POST") throw new Error("write failed");
      if (u.includes("health_samples")) return json([]);
      if (u.includes("job_runs")) return json([{ id: 1 }], opts.method === "POST" ? 201 : 200);
      if (u.includes("app_config")) return json([]);
      if (u.includes("/rest/v1/")) return new Response(null, { status: 200 });
      if (u.includes("status.json")) return json({ status: { indicator: "none" }, page: {} });
      return json({});
    });
    await expect(mod.handler({})).resolves.toMatchObject({ statusCode: 200 });
  });
});

// ── Kill switch integration ──────────────────────────────────────────────────

describe("health-monitor kill switch (HM-04)", () => {
  it("is stoppable like every other job", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("app_config")) return json([{ value: { jobs: { "health-monitor": { enabled: false } } } }]);
      if (u.includes("job_runs")) return json({}, 201);
      return json({});
    });
    const res = await mod.handler({});
    expect(JSON.parse(res.body)).toMatchObject({ skipped: true, reason: "disabled_by_operator" });
    // Nothing was probed.
    expect(calls((u) => u.includes("status.json"))).toHaveLength(0);
  });
});
