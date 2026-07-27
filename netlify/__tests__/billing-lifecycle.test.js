// billing-lifecycle.test.js — the daily sweep.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString();

const ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "RESEND_API_KEY", "BILLING_EMAIL_FROM", "CONTACT_EMAIL_FROM", "ALERT_EMAIL_FROM", "FORM_EMAIL_FROM"];

beforeEach(() => {
  vi.resetModules();
  for (const k of ENV) delete process.env[k];
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.RESEND_API_KEY = "re_test";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });

const paidPro = (over = {}) => ({
  user_id: "u1",
  plan_id: "pro",
  status: "active",
  source: "payment",
  period_end: daysAgo(1),   // inside lapsed_d0 grace, so a notice IS due
  version: 1,
  ...over,
});

/** claimed=false simulates another container already owning the notice. */
function wire({ rows = [paidPro()], claimed = true } = {}) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/entitlements?") && (!opts.method || opts.method === "GET")) return ok(rows);
    if (u.includes("/billing_notice_log")) return ok(claimed ? [{ id: 1 }] : []);
    if (u.includes("/auth/v1/admin/users")) return ok({ users: [{ id: "u1", email: "u1@example.com" }] });
    if (u.includes("api.resend.com")) return ok({ id: "email_1" });
    return ok(null);
  });
}

const calls = (pred) => fetchMock.mock.calls.filter(([u, o]) => pred(String(u), o || {}));
const resendCalls = () => calls((u) => u.includes("api.resend.com"));
const patches = (frag) => calls((u, o) => o.method === "PATCH" && u.includes(frag));

async function run() {
  const mod = await import("../functions/billing-lifecycle.js");
  return mod.handler();
}

describe("configuration", () => {
  it("skips cleanly when Supabase is unconfigured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    const r = await run();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/skipped/);
  });

  it("is registered as a daily scheduled function", async () => {
    const mod = await import("../functions/billing-lifecycle.js");
    expect(mod.config.schedule).toBe("@daily");
  });
});

describe("planTransition", () => {
  it("suspends an account whose period has ended", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(paidPro({ period_end: daysAgo(1) }));
    expect(t.patch.status).toBe("suspended");
    expect(t.patch.suspended_at).toBeTruthy();
    expect(t.pauseSchedules).toBe(true);
  });

  it("deactivates at day 30 and records the purge date", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(paidPro({ period_end: daysAgo(31), status: "suspended" }));
    expect(t.patch.status).toBe("deactivated");
    expect(t.patch.purge_after).toBeTruthy();
  });

  it("leaves an account with time remaining alone", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(paidPro({ period_end: daysAhead(20) }));
    expect(t.patch).toBeNull();
    expect(t.pauseSchedules).toBe(false);
  });

  it("never touches a free or migrated account", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    expect(planTransition({ plan_id: "free", source: null, period_end: null }).patch).toBeNull();
    expect(planTransition({ plan_id: "pro", source: "migration", period_end: null }).patch).toBeNull();
  });

  it("applies a scheduled downgrade once its date passes", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(
      paidPro({ scheduled_plan_id: "select", scheduled_at: daysAgo(1) }),
    );
    expect(t.patch.plan_id).toBe("select");
    expect(t.patch.scheduled_plan_id).toBeNull();
    expect(t.patch.scheduled_at).toBeNull();
  });

  it("leaves a downgrade that is not yet due", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(
      paidPro({ period_end: daysAhead(10), scheduled_plan_id: "select", scheduled_at: daysAhead(10) }),
    );
    expect(t.patch).toBeNull();
  });

  it("keeps a comped account active and silent", async () => {
    const { planTransition } = await import("../functions/billing-lifecycle.js");
    const t = planTransition(paidPro({ comp_until: daysAhead(10) }));
    expect(t.pauseSchedules).toBe(false);
    expect(t.notice).toBeNull();
  });
});

describe("notices", () => {
  it("claims the log row BEFORE sending", async () => {
    wire();
    await run();
    const claimIdx = fetchMock.mock.calls.findIndex(([u]) => String(u).includes("billing_notice_log"));
    const sendIdx = fetchMock.mock.calls.findIndex(([u]) => String(u).includes("api.resend.com"));
    expect(claimIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(claimIdx);
  });

  it("uses ignore-duplicates so a concurrent run cannot double-send", async () => {
    wire();
    await run();
    const [, opts] = calls((u) => u.includes("billing_notice_log"))[0];
    expect(opts.headers.Prefer).toContain("resolution=ignore-duplicates");
    expect(opts.headers.Prefer).toContain("return=representation");
  });

  it("sends nothing when another container already owns the notice", async () => {
    wire({ claimed: false });
    await run();
    expect(resendCalls()).toHaveLength(0);
  });

  it("records last_notice_kind, which is the purge interlock", async () => {
    wire();
    await run();
    const bodies = patches("/entitlements").map(([, o]) => JSON.parse(o.body));
    expect(bodies.some((b) => b.last_notice_kind === "lapsed_d0")).toBe(true);
  });

  it("sends from BILLING_EMAIL_FROM, not from any other sender", async () => {
    process.env.CONTACT_EMAIL_FROM = "DatIQ <hello@datiq.app>";
    process.env.ALERT_EMAIL_FROM = "DatIQ Alerts <alerts@datiq.app>";
    process.env.FORM_EMAIL_FROM = "DatIQ Contact <noreply@datiq.app>";
    process.env.BILLING_EMAIL_FROM = "DatIQ Billing <billing@datiq.app>";
    wire();
    await run();
    const body = JSON.parse(resendCalls()[0][1].body);
    expect(body.from).toBe("DatIQ Billing <billing@datiq.app>");
    expect(body.reply_to).toBe("hello@datiq.app");
  });

  it("is not affected by the other sender vars when unset", async () => {
    process.env.CONTACT_EMAIL_FROM = "DatIQ <hello@datiq.app>";
    wire();
    await run();
    const body = JSON.parse(resendCalls()[0][1].body);
    expect(body.from).toMatch(/billing@datiq\.app/);
  });

  it("never leaks the Resend key into a log or response", async () => {
    wire();
    const r = await run();
    expect(r.body).not.toContain("re_test");
  });

  it("skips sending when Resend is unconfigured, without failing the run", async () => {
    delete process.env.RESEND_API_KEY;
    wire();
    const r = await run();
    expect(r.statusCode).toBe(200);
    expect(resendCalls()).toHaveLength(0);
  });
});

describe("automation pausing (requirement 9)", () => {
  it("system-pauses a lapsed account's schedules", async () => {
    wire();
    await run();
    const p = patches("scheduled_tasks");
    expect(p.length).toBeGreaterThan(0);
    const body = JSON.parse(p[0][1].body);
    expect(body.system_paused).toBe(true);
    expect(body.system_pause_reason).toBe("subscription_suspended");
  });

  it("only touches schedules that are not already system-paused", async () => {
    wire();
    await run();
    expect(String(patches("scheduled_tasks")[0][0])).toContain("system_paused=is.false");
  });

  it("resumes automation for an account that is active again", async () => {
    // The primary reactivation path is invoiceService.activateFromInvoice (so a
    // paying customer is not left waiting for tomorrow's sweep); this is the
    // idempotent safety net that catches anything it missed.
    wire({ rows: [paidPro({ status: "active", period_end: daysAhead(20) })] });
    await run();
    const resume = patches("scheduled_tasks").find(([, o]) => JSON.parse(o.body).system_paused === false);
    expect(resume).toBeTruthy();
  });

  it("scopes the resume by reason, so a user-paused schedule stays paused", async () => {
    wire({ rows: [paidPro({ status: "active", period_end: daysAhead(20) })] });
    await run();
    const resume = patches("scheduled_tasks").find(([, o]) => JSON.parse(o.body).system_paused === false);
    expect(String(resume[0])).toContain("system_pause_reason=eq.subscription_suspended");
  });
});

describe("resilience", () => {
  it("records a heartbeat for the purge interlock", async () => {
    wire();
    await run();
    const hb = calls((u, o) => u.includes("billing_cron_runs") && o.method === "POST");
    expect(hb).toHaveLength(1);
    expect(JSON.parse(hb[0][1].body).job).toBe("billing-lifecycle");
  });

  it("continues the sweep when one account fails", async () => {
    let first = true;
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/entitlements?") && (!opts.method || opts.method === "GET")) {
        return ok([paidPro({ user_id: "bad" }), paidPro({ user_id: "good" })]);
      }
      if (u.includes("user_id=eq.bad") && first) {
        first = false;
        throw new Error("boom");
      }
      if (u.includes("/billing_notice_log")) return ok([{ id: 1 }]);
      if (u.includes("/auth/v1/admin/users")) return ok({ users: [] });
      return ok(null);
    });
    const r = await run();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/scanned 2/);
  });

  it("reports a read failure rather than silently doing nothing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), headers: { get: () => null } });
    const r = await run();
    expect(r.statusCode).toBe(500);
  });
});
