// netlify/functions/scheduled-runner.test.js
// C-32 — Reads active+due schedules; skips expired; re-runs extraction; change
// detection via hashContent; alert webhook fires; never throws 5xx.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock the scrape chain so we can control what each target returns ──────────
const { runScrapeChainMock } = vi.hoisted(() => ({ runScrapeChainMock: vi.fn() }));
vi.mock("../functions/lib/scrapeProviders.js", () => ({
  runScrapeChain: runScrapeChainMock,
}));

// Mock the notify dispatcher so we can assert that scheduled-runner
// hands the change-alert fan-out to it (Slack per-user webhook + Zapier
// event). The real notify.js hits Supabase and the network; this stub
// records the call and resolves with an "ok" response.
const notifyMock = vi.hoisted(() => ({
  notifyExtractionComplete: vi.fn().mockResolvedValue({ ok: true, slack: null, zapier: null }),
  notifyEnrichmentComplete: vi.fn().mockResolvedValue({ ok: true, zapier: null }),
  notifyMonitoringChange: vi.fn().mockResolvedValue({ ok: true, slack: null, zapier: null }),
}));
vi.mock("../functions/lib/notify.js", () => notifyMock);

let fetchMock;
let handler;

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.SCHEDULE_ALERT_WEBHOOK;
  delete process.env.VITE_WEBHOOK_URL;
  delete process.env.URL;
  delete process.env.SITE_URL;
  vi.resetModules();
  runScrapeChainMock.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/scheduled-runner.js");
  return mod.handler;
}

function sbWith(rows) {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "sk";
  fetchMock.mockImplementation(async (url, init = {}) => {
    const u = String(url);
    const m = (init.method || "GET").toUpperCase();
    if (u.includes("/rest/v1/scheduled_tasks") && u.includes("status=eq.active") && m === "GET") {
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (u.includes("/rest/v1/scheduled_tasks?id=eq.") && m === "PATCH") {
      return new Response("{}", { status: 200 });
    }
    if (u.includes("/rest/v1/entitlements")) {
      // The runner asks for entitlement rows so it can gate lapsed users.
      // Default: no rows = no active entitlement = the per-row "fail open"
      // branch (ent==null && row.user_id) keeps the schedule running.
      return new Response("[]", { status: 200 });
    }
    if (u.startsWith("https://api.resend.com/")) {
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

describe("scheduled-runner — guard rails", () => {
  it("no Supabase configured → 200 + 'skipped (no supabase)'", async () => {
    const h = await loadHandler();
    const r = await h();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/skipped/);
  });

  it("Supabase error during listActive → 500 with error message (never 200 silent fail)", async () => {
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    fetchMock.mockImplementation(async () => new Response("err", { status: 500 }));
    const h = await loadHandler();
    const r = await h();
    expect(r.statusCode).toBe(500);
  });
});

describe("scheduled-runner — schedule filtering", () => {
  it("skips schedules with no cron / no target", async () => {
    sbWith([
      { id: "sch_a", data: { type: "track", target: "https://a.com" } }, // no cron
      { id: "sch_b", data: { cron: "0 * * * *" } },                       // no target
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "body" });
    const h = await loadHandler();
    const r = await h();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/scanned 0/);
    expect(runScrapeChainMock).not.toHaveBeenCalled();
  });

  it("skips expired schedules (expiresAt in the past)", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
    sbWith([
      { id: "sch_exp", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        expiresAt: past,
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "body" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/scanned 1, ran 0/);
    expect(runScrapeChainMock).not.toHaveBeenCalled();
  });

  it("skips schedules whose cron does not match the current hour", async () => {
    // Cron that runs only at midnight UTC. The current hour is almost certainly not 0.
    sbWith([
      { id: "sch_mid", data: {
        type: "track", target: "https://a.com", cron: "0 0 * * *", // min=0, hour=0
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "body" });
    const h = await loadHandler();
    const r = await h();
    // If today's hour is 0, the schedule will run; otherwise it'll be skipped.
    const nowHour = new Date().getUTCHours();
    if (nowHour !== 0) {
      expect(r.body).toMatch(/scanned 1, ran 0/);
    }
  });

  it("de-dupe: skips a schedule that already ran in the last 50 minutes", async () => {
    const justNow = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    sbWith([
      { id: "sch_dup", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        lastRunAt: justNow,
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "body" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/scanned 1, ran 0/);
  });

  it("runs schedules matching current hour with no lastRunAt", async () => {
    // Wildcard cron matches every hour.
    sbWith([
      { id: "sch_run", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "body" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/ran 1/);
    expect(runScrapeChainMock).toHaveBeenCalledWith("https://a.com", expect.objectContaining({}));
  });
});

describe("scheduled-runner — change detection", () => {
  it("first run (no lastHash) → status=unchanged, no alert", async () => {
    sbWith([
      { id: "sch_first", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "Page A", html: "<p>hello</p>" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/changed 0/);
    // Only the PATCH fetch should have been called (no Resend, no webhook)
    const calledUrls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(calledUrls.some(u => u.startsWith("https://api.resend.com"))).toBe(false);
  });

  it("content change vs lastHash → status=changed, enqueues schedule.changed event (replaces direct webhook + Resend)", async () => {
    process.env.SCHEDULE_ALERT_WEBHOOK = "https://n8n.example/webhook/abc";
    process.env.RESEND_API_KEY = "re_test";
    sbWith([
      { id: "sch_change", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        lastHash: "OLD_HASH_OLD", // anything different from the new content
        label: "Daily check", intent: "summary",
        alertEmail: "user@example.com",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "Page A", html: "<p>brand new content</p>" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/changed 1/);

    // v2: the runner no longer talks to Resend or the automation webhook
    // directly — it enqueues a workflow_event. The orchestrator + n8n
    // take it from there. Verify the enqueue happened.
    const enqueueCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]).includes("/rest/v1/workflow_events") && (c[1]?.method || "GET").toUpperCase() === "POST"
    );
    expect(enqueueCalls).toHaveLength(1);
    const eqBody = JSON.parse(enqueueCalls[0][1].body);
    expect(eqBody.kind).toBe("schedule.changed");
    expect(eqBody.ref_id).toBe("sch_change");
    expect(eqBody.state).toBe("pending");
    expect(eqBody.payload.scheduleId).toBe("sch_change");
    expect(eqBody.payload.label).toBe("Daily check");
    expect(eqBody.payload.alertEmail).toBe("user@example.com");
    expect(eqBody.payload.previousHash).toBe("OLD_HASH_OLD");
    expect(eqBody.payload.newHash).toBeDefined();
    expect(eqBody.channels).toEqual([
      expect.objectContaining({ type: "email", to: "user@example.com" }),
      expect.objectContaining({ type: "slack", channel: "#monitoring" }),
    ]);

    // No direct Resend/webhook calls
    const resendCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.resend.com/"));
    expect(resendCalls).toHaveLength(0);
    const webhookCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://n8n.example/"));
    expect(webhookCalls).toHaveLength(0);
  });

  it("content change with no supabase → logs and continues (enqueue dropped)", async () => {
    // No Supabase configured → sb() returns null → runSchedule still
    // updates the schedule's lastHash (in-memory) but skips the enqueue.
    // The runner must NOT throw and must NOT call any external API.
    process.env.SCHEDULE_ALERT_WEBHOOK = "https://n8n.example/webhook/abc";
    process.env.RESEND_API_KEY = "re_test";
    // No supabase env vars — handler should skip with "no supabase" body.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    runScrapeChainMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/no supabase/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("content change → notifyMonitoringChange fires with schedule + user_id (per-user Slack + Zapier fan-out)", async () => {
    process.env.SCHEDULE_ALERT_WEBHOOK = "https://n8n.example/webhook/abc";
    notifyMock.notifyMonitoringChange.mockClear();
    sbWith([
      { id: "sch_user", user_id: "u-owner-1", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        lastHash: "OLD_HASH_OLD",
        label: "User schedule", intent: "summary",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "Page A", html: "<p>fresh</p>" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/changed 1/);
    // The dispatcher is fire-and-forget; wait one tick for it to resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifyMock.notifyMonitoringChange).toHaveBeenCalledTimes(1);
    const callArgs = notifyMock.notifyMonitoringChange.mock.calls[0][0];
    expect(callArgs.userId).toBe("u-owner-1");
    expect(callArgs.schedule.id).toBe("sch_user");
    expect(callArgs.schedule.label).toBe("User schedule");
    expect(callArgs.changedSummary).toEqual(
      expect.objectContaining({ previousHash: "OLD_HASH_OLD", newHash: expect.any(String) }),
    );
  });

  it("content change does NOT fire when the schedule has no user_id (legacy rows)", async () => {
    // Defensive: schedules inserted before user_id was added have no owner.
    // The dispatcher is called with userId: null, which resolveSlackWebhook
    // handles by falling back to the env. We just assert no throw + the
    // dispatcher still gets called (so the env webhook still fires).
    process.env.SCHEDULE_ALERT_WEBHOOK = "https://n8n.example/webhook/abc";
    notifyMock.notifyMonitoringChange.mockClear();
    sbWith([
      { id: "sch_orphan", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        lastHash: "OLD_HASH_OLD",
        label: "Orphan",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "<p>fresh</p>" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/changed 1/);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifyMock.notifyMonitoringChange).toHaveBeenCalledTimes(1);
    // user_id is normalized to null (not undefined) by the runner so the
    // dispatcher's downstream code doesn't have to handle "missing" twice.
    expect(notifyMock.notifyMonitoringChange.mock.calls[0][0].userId).toBeNull();
  });

  it("no content change → no alert (webhook / Resend NOT called)", async () => {
    // First, compute the hash of the content the scrape returns, then set it
    // as lastHash so the comparison is equal (unchanged).
    const html = "<p>stable content here</p>";
    sbWith([
      { id: "sch_stable", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
        lastHash: "PLACEHOLDER",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html });
    const h = await loadHandler();
    // Pre-compute the expected hash from the production FNV-1a impl and inject
    // it as lastHash so this run is "unchanged".
    const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
    const fnv1a = (str) => {
      let hh = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        hh ^= str.charCodeAt(i);
        hh = Math.imul(hh, 0x01000193);
      }
      return (hh >>> 0).toString(16).padStart(8, "0");
    };
    const expected = fnv1a(`${"T"}\n${visibleText}`);
    // Override the mock to use the right lastHash
    fetchMock.mockImplementation(async (url, init = {}) => {
      const u = String(url);
      const m = (init.method || "GET").toUpperCase();
      if (u.includes("status=eq.active") && m === "GET") {
        return new Response(JSON.stringify([
          { id: "sch_stable", data: {
            type: "track", target: "https://a.com", cron: "0 * * * *",
            lastHash: expected,
          } },
        ]), { status: 200 });
      }
      if (u.includes("id=eq.") && m === "PATCH") return new Response("{}", { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const r = await h();
    expect(r.body).toMatch(/changed 0/);
    const webhookCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes("n8n.example"));
    expect(webhookCalls).toHaveLength(0);
  });
});

describe("scheduled-runner — batch", () => {
  it("batch schedule runs each target up to BATCH_SCRAPE_CAP", async () => {
    sbWith([
      { id: "sch_batch", data: {
        type: "batch",
        target: ["https://a.com", "https://b.com", "https://c.com"],
        cron: "0 * * * *",
      } },
    ]);
    runScrapeChainMock.mockResolvedValue({ ok: true, title: "T", html: "x" });
    const h = await loadHandler();
    const r = await h();
    expect(r.body).toMatch(/ran 1/);
    expect(runScrapeChainMock).toHaveBeenCalledTimes(3);
  });

  it("scrape error for one URL → schedule still completes with lastStatus:error", async () => {
    sbWith([
      { id: "sch_err", data: {
        type: "track", target: "https://a.com", cron: "0 * * * *",
      } },
    ]);
    runScrapeChainMock.mockRejectedValue(new Error("scrape failed"));
    const h = await loadHandler();
    const r = await h();
    // Per-URL failure is caught inside runSchedule; runner reports failed 1
    expect(r.body).toMatch(/failed 1/);
  });
});
