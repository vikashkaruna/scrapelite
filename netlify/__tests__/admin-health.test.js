// admin-health.test.js — the service/host/database health endpoint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_SERVER_ENV_KEYS, clearServerEnv } from "./helpers/serverEnv.js";
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

// Shared list — see netlify/__tests__/helpers/serverEnv.js. The copy that used
// to live here omitted VITE_SUPABASE_URL and the anon keys, so on a machine
// with a real .env (Vitest loads it into process.env) probes this suite expects
// to be UNCONFIGURED found live credentials and ran for real.
const ENV_KEYS = ALL_SERVER_ENV_KEYS;

beforeEach(async () => {
  vi.resetModules();
  clearServerEnv(ENV_KEYS);
  process.env.ADMIN_TOKEN_SECRET = TEST_SECRET;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  handler = (await import("../functions/admin-health.js")).handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ADMIN_TOKEN_SECRET;
  clearServerEnv(ENV_KEYS);
});

const json = (b, status = 200) => new Response(JSON.stringify(b), { status });
const body = (res) => JSON.parse(res.body);
const calls = (pred) => fetchMock.mock.calls.filter(([u, o]) => pred(String(u), o || {}));

const statusPage = (indicator) => json({ status: { indicator, description: "" }, page: {} });

/** Every outbound call succeeds; Supabase reads return `samples`. */
function wireHealthy({ samples = [] } = {}) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("health_samples")) {
      if (opts.method === "POST") return json({}, 201);
      return json(samples);
    }
    if (u.includes("app_config") && opts.method === "HEAD") return new Response(null, { status: 200 });
    if (u.includes("app_config")) return json([]);
    if (u.includes("/auth/v1/health")) return json({ name: "GoTrue", version: "2.0" });
    if (u.includes("statuspage") || u.includes("status.json")) return statusPage("none");
    return json({});
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("admin-health auth (AH-01)", () => {
  it("rejects an unauthenticated request", async () => {
    expect((await handler({ httpMethod: "GET", headers: {} })).statusCode).toBe(401);
  });

  it("rejects a forged token", async () => {
    expect((await handler({ httpMethod: "GET", headers: { authorization: "Bearer x.y" } })).statusCode).toBe(401);
  });

  it("answers CORS preflight", async () => {
    expect((await handler({ httpMethod: "OPTIONS" })).statusCode).toBe(204);
  });

  it("rejects a write method", async () => {
    expect((await handler(authed({ httpMethod: "POST" }))).statusCode).toBe(405);
  });

  // Health that is 60 seconds old is not health.
  it("is never cached", async () => {
    wireHealthy();
    const r = await handler(authed());
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });
});

// ── Snapshot ─────────────────────────────────────────────────────────────────

describe("admin-health GET (AH-02)", () => {
  it("returns a classified reading for every component", async () => {
    wireHealthy();
    const b = body(await handler(authed()));
    expect(b.ok).toBe(true);
    expect(b.components).toHaveLength(10);
    for (const c of b.components) {
      expect(["ok", "degraded", "down", "unknown"]).toContain(c.status);
      expect(c.label).toBeTruthy();
      expect(["platform", "database", "services"]).toContain(c.group);
    }
  });

  it("reports unconfigured services as unknown rather than down", async () => {
    wireHealthy();
    const b = body(await handler(authed()));
    const db = b.components.find((c) => c.id === "supabase-db");
    expect(db.status).toBe("unknown");
    expect(b.overall).not.toBe("down");
  });

  it("reports a reachable database as operational", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy();
    const b = body(await handler(authed()));
    expect(b.components.find((c) => c.id === "supabase-db").status).toBe("ok");
  });

  it("goes down when a critical component is unreachable", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/rest/v1/app_config")) return new Response(null, { status: 503 });
      if (String(url).includes("status.json")) return statusPage("none");
      if (String(url).includes("health_samples")) return json([]);
      return json({});
    });
    const b = body(await handler(authed()));
    expect(b.components.find((c) => c.id === "supabase-db").status).toBe("down");
    expect(b.overall).toBe("down");
  });

  it("stays merely degraded when a non-critical service fails", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    process.env.RESEND_API_KEY = "re_bad";
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("api.resend.com")) return new Response("", { status: 401 });
      if (u.includes("app_config") && opts.method === "HEAD") return new Response(null, { status: 200 });
      if (u.includes("app_config")) return json([]);
      if (u.includes("/auth/v1/health")) return json({ name: "GoTrue" });
      if (u.includes("status.json")) return statusPage("none");
      if (u.includes("health_samples")) return json([]);
      return json({});
    });
    const b = body(await handler(authed()));
    expect(b.components.find((c) => c.id === "email-resend").status).toBe("down");
    expect(b.overall).toBe("degraded");
  });

  it("includes a summary and the group definitions the UI renders", async () => {
    wireHealthy();
    const b = body(await handler(authed()));
    expect(b.summary).toMatchObject({ total: 10 });
    expect(b.groups.map((g) => g.id)).toEqual(["platform", "database", "services"]);
  });

  it("times every reachable component", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy();
    const b = body(await handler(authed()));
    const db = b.components.find((c) => c.id === "supabase-db");
    expect(db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(["fast", "ok", "slow"]).toContain(db.latencyGrade);
  });
});

// ── Uptime history ───────────────────────────────────────────────────────────

describe("admin-health uptime (AH-03)", () => {
  const sample = (component, status, minsAgo, latency = 100) => ({
    component, status, latency_ms: latency,
    observed_at: new Date(Date.now() - minsAgo * 60_000).toISOString(),
  });

  it("computes uptime per component from stored samples", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy({ samples: [
      sample("supabase-db", "ok", 10), sample("supabase-db", "ok", 70),
      sample("supabase-db", "down", 130, null), sample("supabase-db", "ok", 190),
    ] });
    const b = body(await handler(authed()));
    expect(b.uptime["supabase-db"]).toMatchObject({ samples: 4, uptimePct: 75 });
    expect(b.samplesInWindow).toBe(4);
  });

  it("honours a custom window", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy();
    await handler(authed({ queryStringParameters: { window: "6" } }));
    const read = calls((u, o) => u.includes("health_samples") && (!o.method || o.method === "GET"));
    expect(read.length).toBeGreaterThan(0);
    expect(body(await handler(authed({ queryStringParameters: { window: "6" } }))).uptimeWindowHours).toBe(6);
  });

  // The effective window is always echoed back as uptimeWindowHours, so a
  // clamped value can never be mistaken for the one that was asked for.
  it("clamps an absurd window rather than trusting it", async () => {
    wireHealthy();
    const win = async (v) =>
      body(await handler(authed({ queryStringParameters: { window: v } }))).uptimeWindowHours;
    expect(await win("999999")).toBe(720); // 30 days is the ceiling
    expect(await win("-5")).toBe(1);       // clamped to the floor, not the default
    expect(await win("abc")).toBe(24);     // unparseable → the default
    expect(await win(undefined)).toBe(24);
  });

  // "No samples yet" and "history is switched off" need different UI copy.
  it("distinguishes no-history-configured from no-samples-yet", async () => {
    wireHealthy();
    expect(body(await handler(authed())).historyAvailable).toBe(false);

    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    vi.resetModules();
    const h2 = (await import("../functions/admin-health.js")).handler;
    wireHealthy({ samples: [] });
    const b = body(await h2(authed()));
    expect(b.historyAvailable).toBe(true);
    expect(b.samplesInWindow).toBe(0);
  });

  it("does not record samples unless asked", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy();
    await handler(authed());
    expect(calls((u, o) => u.includes("health_samples") && o.method === "POST")).toHaveLength(0);
  });

  it("records one sample per component when ?record=1", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    wireHealthy();
    const r = await handler(authed({ queryStringParameters: { record: "1" } }));
    const writes = calls((u, o) => u.includes("health_samples") && o.method === "POST");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toHaveLength(10);
    expect(body(r).recorded).toBe(true);
  });

  // Recording is a nice-to-have; failing to record must not fail the read.
  it("still returns a reading when the sample write fails", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("health_samples") && opts.method === "POST") throw new Error("write failed");
      if (u.includes("health_samples")) return json([]);
      if (u.includes("app_config") && opts.method === "HEAD") return new Response(null, { status: 200 });
      if (u.includes("app_config")) return json([]);
      if (u.includes("status.json")) return statusPage("none");
      return json({});
    });
    const r = await handler(authed({ queryStringParameters: { record: "1" } }));
    expect(r.statusCode).toBe(200);
    expect(body(r).recorded).toBe(false);
    expect(body(r).ok).toBe(true);
  });

  it("returns an empty uptime map when the sample read fails", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("health_samples")) return new Response("", { status: 500 });
      if (String(url).includes("/rest/v1/app_config")) return new Response(null, { status: 200 });
      if (String(url).includes("status.json")) return statusPage("none");
      return json({});
    });
    const b = body(await handler(authed()));
    expect(b.uptime).toEqual({});
    expect(b.ok).toBe(true);
  });
});
