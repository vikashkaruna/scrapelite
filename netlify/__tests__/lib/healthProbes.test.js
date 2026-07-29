// healthProbes.test.js — the reachability checks behind /admin/health.
//
// The recurring assertion: a probe that could not run reports `configured:
// false`, never `reachable: false`. "We did not ask" and "it is down" must stay
// distinguishable all the way to the screen.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
let probes;

const ENV_KEYS = [
  "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY",
  "NETLIFY_AUTH_TOKEN", "NETLIFY_SITE_ID", "SITE_ID", "RESEND_API_KEY",
  "GEMINI_API_KEY", "AI_API_KEY", "OPENAI_API_KEY",
  "FIRECRAWL_API_KEY", "VITE_FIRECRAWL_API_KEY", "SPIDER_API_KEY", "JINA_API_KEY",
  "CONTEXT", "SITE_NAME", "BRANCH", "DEPLOY_ID", "DEPLOY_PRIME_URL", "AWS_REGION",
  "PURGE_ENABLED", "PURGE_DRY_RUN", "OPS_JOBS_DISABLED",
  "SUPABASE_PROJECT_NAME",
];

beforeEach(async () => {
  vi.resetModules();
  for (const k of ENV_KEYS) delete process.env[k];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  probes = await import("../../functions/lib/healthProbes.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const statusPage = (indicator, description = "") =>
  json({ status: { indicator, description }, page: { name: "Netlify", updated_at: "2026-07-27T00:00:00Z" } });

// ── Statuspage-backed probes ─────────────────────────────────────────────────

describe("status page probes (P-01)", () => {
  it("maps a clean status page to ok", async () => {
    fetchMock.mockResolvedValue(statusPage("none", "All Systems Operational"));
    const r = await probes.probeNetlifyPlatform();
    expect(r).toMatchObject({ id: "netlify-platform", configured: true, status: "ok" });
    expect(r.detail.indicator).toBe("none");
  });

  it("maps a major incident to down", async () => {
    fetchMock.mockResolvedValue(statusPage("major", "Partial outage"));
    expect((await probes.probeSupabasePlatform()).status).toBe("down");
  });

  it("maps a minor incident to degraded", async () => {
    fetchMock.mockResolvedValue(statusPage("minor"));
    expect((await probes.probeRazorpay()).status).toBe("degraded");
  });

  // A vendor's status site having a blip says nothing about the vendor's
  // health. Reporting "down" here is the false alarm that teaches operators to
  // ignore the dashboard.
  it("reports unknown — not down — when the status page itself is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ENOTFOUND"));
    const r = await probes.probeNetlifyPlatform();
    expect(r.status).toBe("unknown");
    expect(r.note).toMatch(/ENOTFOUND/);
  });

  it("reports unknown when the status page returns a non-200", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    expect((await probes.probeNetlifyPlatform()).status).toBe("unknown");
  });

  it("reports unknown when the payload is not in the expected shape", async () => {
    fetchMock.mockResolvedValue(json({ hello: "world" }));
    expect((await probes.probeNetlifyPlatform()).status).toBe("unknown");
  });

  it("reports unknown when the body is not JSON at all", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    expect((await probes.probeNetlifyPlatform()).status).toBe("unknown");
  });

  it("hits the documented status endpoints", async () => {
    fetchMock.mockResolvedValue(statusPage("none"));
    await probes.probeNetlifyPlatform();
    await probes.probeSupabasePlatform();
    await probes.probeRazorpay();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toBe("https://www.netlifystatus.com/api/v2/status.json");
    expect(urls[1]).toBe("https://status.supabase.com/api/v2/status.json");
    expect(urls[2]).toBe("https://status.razorpay.com/api/v2/status.json");
  });
});

// ── Supabase ─────────────────────────────────────────────────────────────────

describe("probeSupabaseDb (P-02)", () => {
  it("is unconfigured without credentials", async () => {
    const r = await probes.probeSupabaseDb();
    expect(r).toEqual({ id: "supabase-db", configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is unconfigured with a URL but no service key", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    expect((await probes.probeSupabaseDb()).configured).toBe(false);
  });

  it("measures a real PostgREST round trip", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const r = await probes.probeSupabaseDb();
    expect(r).toMatchObject({ configured: true, reachable: true });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  // Deliberately queries a table, not the API root: the root answers from the
  // gateway and stays green while Postgres behind it is unreachable.
  it("asks a question only Postgres can answer", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await probes.probeSupabaseDb();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/app_config");
    expect(opts.method).toBe("HEAD");
  });

  it("is down when the connection fails", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await probes.probeSupabaseDb();
    expect(r).toMatchObject({ configured: true, reachable: false });
    expect(r.note).toMatch(/ECONNREFUSED/);
  });

  it("is down on a PostgREST error status", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await probes.probeSupabaseDb()).status).toBe("down");
  });
});

describe("probeSupabaseAuth (P-03)", () => {
  it("is unconfigured without a URL", async () => {
    expect((await probes.probeSupabaseAuth()).configured).toBe(false);
  });

  it("reports the GoTrue version", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    fetchMock.mockResolvedValue(json({ name: "GoTrue", version: "2.1.0" }));
    const r = await probes.probeSupabaseAuth();
    expect(r.reachable).toBe(true);
    expect(r.detail).toMatchObject({ name: "GoTrue", version: "2.1.0" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/auth/v1/health");
  });

  it("is down when GoTrue errors", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect((await probes.probeSupabaseAuth()).status).toBe("down");
  });

  it("still reports reachable when the health body is not JSON", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    expect((await probes.probeSupabaseAuth()).reachable).toBe(true);
  });
});

// ── Netlify site ─────────────────────────────────────────────────────────────

// The probe no longer hits the Netlify API: every function gets CONTEXT,
// BRANCH, DEPLOY_ID, SITE_NAME, DEPLOY_PRIME_URL from the runtime, which is
// exactly the operator-facing "where am I" info /admin/health used to need a
// PAT to read. So configured is true whenever the probe is reached, and the
// detail is purely a reflection of the runtime env.
describe("probeNetlifySite (P-04) — runtime-env probe", () => {
  it("is configured and reports the runtime env when CONTEXT is production", async () => {
    process.env.CONTEXT   = "production";
    process.env.BRANCH    = "main";
    process.env.SITE_NAME = "datiqapp";
    process.env.DEPLOY_ID = "dep_abc";
    const r = await probes.probeNetlifySite();
    expect(r.configured).toBe(true);
    expect(r.status).toBeUndefined();
    expect(r.detail).toMatchObject({
      site: "datiqapp", branch: "main", context: "production", deployId: "dep_abc",
    });
    expect(r.detail.envLabel).toBe("production");
  });

  it("is configured and reports the runtime env when CONTEXT is branch-deploy", async () => {
    process.env.CONTEXT   = "branch-deploy";
    process.env.BRANCH    = "monitoring-services-in-admin-module";
    process.env.SITE_NAME = "datiqapp";
    const r = await probes.probeNetlifySite();
    expect(r.configured).toBe(true);
    expect(r.status).toBeUndefined();
    expect(r.detail.context).toBe("branch-deploy");
    expect(r.detail.branch).toBe("monitoring-services-in-admin-module");
    expect(r.detail.envLabel).toBe("branch · monitoring-services-in-admin-module");
  });

  it("is degraded when CONTEXT is something Netlify does not normally publish", async () => {
    process.env.CONTEXT = "weird-thing";
    const r = await probes.probeNetlifySite();
    expect(r.status).toBe("degraded");
    expect(r.note).toMatch(/weird-thing/);
  });

  it("does NOT call the Netlify API", async () => {
    process.env.CONTEXT = "production";
    await probes.probeNetlifySite();
    // No outbound HTTP — the probe is purely env-driven. fetchMock is set up
    // per-test and would record any call made.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Runtime ──────────────────────────────────────────────────────────────────

describe("probeFunctionsRuntime (P-05)", () => {
  it("is always reachable — it is the code that is running", () => {
    const r = probes.probeFunctionsRuntime();
    expect(r).toMatchObject({ id: "functions-runtime", configured: true, reachable: true, latencyMs: 0 });
  });

  // A dashboard showing production numbers while served from a deploy preview
  // is a trap; CONTEXT is what reveals it.
  it("reports which deploy context it is running in", () => {
    process.env.CONTEXT = "deploy-preview";
    process.env.BRANCH = "feat/x";
    process.env.DEPLOY_ID = "dep_9";
    const r = probes.probeFunctionsRuntime();
    expect(r.detail).toMatchObject({ context: "deploy-preview", branch: "feat/x", deployId: "dep_9" });
  });

  it("says unknown rather than guessing when CONTEXT is absent", () => {
    expect(probes.probeFunctionsRuntime().detail.context).toBe("unknown");
  });
});

// ── Resend ───────────────────────────────────────────────────────────────────

describe("probeResend (P-06)", () => {
  it("is unconfigured without a key", async () => {
    expect((await probes.probeResend()).configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is ok with a verified sending domain", async () => {
    process.env.RESEND_API_KEY = "re_x";
    fetchMock.mockResolvedValue(json({ data: [{ name: "datiq.app", status: "verified" }] }));
    const r = await probes.probeResend();
    expect(r.status).toBeUndefined();
    expect(r.detail).toMatchObject({ domains: 1, verified: "datiq.app" });
  });

  // Mail from an unverified domain is silently dropped by inbox providers —
  // an outage nothing else in the system would notice.
  it("is degraded when no sending domain is verified", async () => {
    process.env.RESEND_API_KEY = "re_x";
    fetchMock.mockResolvedValue(json({ data: [{ name: "datiq.app", status: "pending" }] }));
    const r = await probes.probeResend();
    expect(r.status).toBe("degraded");
    expect(r.note).toMatch(/verified/i);
  });

  it("is down when the key is rejected", async () => {
    process.env.RESEND_API_KEY = "re_bad";
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const r = await probes.probeResend();
    expect(r.status).toBe("down");
    expect(r.note).toMatch(/RESEND_API_KEY/);
  });

  it("is down when unreachable", async () => {
    process.env.RESEND_API_KEY = "re_x";
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect((await probes.probeResend()).reachable).toBe(false);
  });
});

// ── Fallback chains ──────────────────────────────────────────────────────────

describe("provider chain probes (P-07)", () => {
  it("reports the AI chain as unconfigured when no key is set", () => {
    const r = probes.probeAiProviders();
    expect(r.configured).toBe(false);
    expect(r.note).toMatch(/Gemini → Claude → OpenAI/);
  });

  it("names the provider that answers first", () => {
    process.env.AI_API_KEY = "sk-ant";
    process.env.OPENAI_API_KEY = "sk";
    const r = probes.probeAiProviders();
    expect(r.detail.primary).toBe("Claude");
    expect(r.detail.configured).toBe("Claude, OpenAI");
    expect(r.status).toBe("ok");
  });

  // One provider is not a fallback chain — the next outage has nowhere to go.
  it("is degraded when only one AI provider is configured", () => {
    process.env.GEMINI_API_KEY = "AIza";
    const r = probes.probeAiProviders();
    expect(r.status).toBe("degraded");
    expect(r.note).toMatch(/no fallback/i);
  });

  // Direct fetch needs no key, so extraction degrades but never stops.
  it("never reports the scrape chain as unconfigured, because direct fetch is keyless", () => {
    const r = probes.probeScrapeProviders();
    expect(r.configured).toBe(true);
    expect(r.status).toBe("ok");
    expect(r.detail.configured).toBe("Direct fetch");
  });

  it("lists paid scrape providers ahead of direct fetch", () => {
    process.env.SPIDER_API_KEY = "sp";
    const r = probes.probeScrapeProviders();
    expect(r.detail.primary).toBe("Spider");
    expect(r.detail.configured).toBe("Spider, Direct fetch");
  });

  it("spends nothing — no network call for either chain", () => {
    process.env.GEMINI_API_KEY = "AIza";
    process.env.SPIDER_API_KEY = "sp";
    probes.probeAiProviders();
    probes.probeScrapeProviders();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Runner ───────────────────────────────────────────────────────────────────

describe("runAllProbes (P-08)", () => {
  it("returns one observation per registered component", async () => {
    fetchMock.mockResolvedValue(statusPage("none"));
    const out = await probes.runAllProbes();
    expect(out.map((o) => o.id).sort()).toEqual([
      "ai-providers", "email-resend", "functions-runtime", "netlify-platform", "netlify-site",
      "payments-razorpay", "scrape-providers", "supabase-auth", "supabase-db", "supabase-platform",
    ]);
  });

  it("stamps every observation with the same checkedAt", async () => {
    fetchMock.mockResolvedValue(statusPage("none"));
    const out = await probes.runAllProbes();
    expect(new Set(out.map((o) => o.checkedAt)).size).toBe(1);
  });

  // allSettled, not all: one bad probe must not blank the whole dashboard.
  it("survives a probe that throws, and attributes the failure correctly", async () => {
    const boom = vi.spyOn(probes._internal.PROBES.find((p) => p.id === "supabase-db"), "fn")
      .mockRejectedValue(new Error("probe exploded"));
    fetchMock.mockResolvedValue(statusPage("none"));

    const out = await probes.runAllProbes();
    const db = out.find((o) => o.id === "supabase-db");
    expect(db.status).toBe("unknown");
    expect(db.note).toMatch(/probe exploded/);
    // Everything else still reported.
    expect(out).toHaveLength(10);
    boom.mockRestore();
  });

  it("runs the probes concurrently rather than one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return statusPage("none");
    });
    await probes.runAllProbes();
    expect(peak).toBeGreaterThan(1);
  });
});

// ── Timeouts ─────────────────────────────────────────────────────────────────

describe("timedFetch (P-09)", () => {
  it("aborts a hung request rather than holding the dashboard open", async () => {
    // A vendor that accepts the connection and never answers must not be able
    // to keep the function alive until Netlify kills it.
    fetchMock.mockImplementation((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    }));
    const r = await probes._internal.timedFetch("https://example.com", {}, 20);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Timed out after 20ms/);
  });

  it("passes an abort signal to every outbound call", async () => {
    fetchMock.mockResolvedValue(statusPage("none"));
    await probes.probeNetlifyPlatform();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
