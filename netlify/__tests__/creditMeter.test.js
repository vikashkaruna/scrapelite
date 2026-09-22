import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: (...a) => rpc(...a) }),
}));

const meter = await import("../functions/lib/creditMeter.js");
const ENV = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_KEY: "k" };

beforeEach(() => {
  vi.clearAllMocks();
  meter.resetMeterStats();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("record — what is charged and what is not", () => {
  it("buffers a charge without doing any I/O", () => {
    const ctx = meter.meterContext({ caller: "test" });
    meter.record(ctx, { kind: "page_fetch", quantity: 3 });
    expect(rpc).not.toHaveBeenCalled();
    expect(meter.pending(ctx)).toBe(3);
  });

  // 0037's header and creditModel.chargeableEvents() both state this rule; the
  // choke points inherit it. An all-zero ledger is noise that hides real spend.
  it.each(["failed", "cached", "skipped"])("charges nothing for a %s call", (flag) => {
    const ctx = meter.meterContext({ caller: "test" });
    meter.record(ctx, { kind: "ai_deep", [flag]: true });
    expect(meter.pending(ctx)).toBe(0);
  });

  it("does not warn about attribution for a failed call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    meter.record(null, { kind: "ai_fast", failed: true });
    expect(warn).not.toHaveBeenCalled();
    expect(meter.meterStats().unattributed).toBe(0);
    warn.mockRestore();
  });

  // 🔴 A call nobody can attribute bills nobody. The parity test fails the
  // build over it; this is the runtime backstop that makes a slip countable
  // if one ever gets past it.
  it("counts and warns about an unattributed chargeable call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    meter.record({ buffer: [] }, { kind: "ai_fast" });
    expect(meter.meterStats().unattributed).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("UNATTRIBUTED"));
    warn.mockRestore();
  });

  it("charges 0 for an unpriced kind rather than guessing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = meter.meterContext({ caller: "test" });
    expect(meter.record(ctx, { kind: "wishful_thinking" }).charged).toBe(0);
    expect(meter.pending(ctx)).toBe(0);
    warn.mockRestore();
  });

  // The surface renames what the choke point charges without the choke point
  // knowing the surface exists.
  it("applies the context's kindMap", () => {
    const ctx = meter.meterContext({ caller: "watchlist", kindMap: { page_fetch: "monitor_page" } });
    expect(meter.record(ctx, { kind: "page_fetch" }).kind).toBe("monitor_page");
  });
});

describe("flush — one row per (reason, unit), not one per call", () => {
  it("collapses many calls into few rows", async () => {
    const ctx = meter.meterContext({ caller: "audit", userId: "u1" });
    for (let i = 0; i < 40; i++) meter.record(ctx, { kind: "page_fetch" });
    for (let i = 0; i < 5; i++) meter.record(ctx, { kind: "ai_fast" });

    const res = await meter.flush(ctx, ENV);
    expect(res.rows).toBe(2);          // 40 + 5 calls → 2 ledger rows
    expect(res.charged).toBe(50);      // 40×1 + 5×2
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("carries the caller and the collapsed quantity", async () => {
    const ctx = meter.meterContext({ caller: "audit", userId: "u1", runId: "r1" });
    meter.record(ctx, { kind: "page_fetch", quantity: 3 });
    await meter.flush(ctx, ENV);
    const [, args] = rpc.mock.calls[0];
    expect(args.p_reason).toBe("page_fetch");
    expect(args.p_credits).toBe(3);
    expect(args.p_quantity).toBe(3);
    expect(args.p_user_id).toBe("u1");
    expect(args.p_run_id).toBe("r1");
    expect(args.p_meta.caller).toBe("audit");
  });

  // 🔴 A second flush must not re-charge. The buffer is drained BEFORE the
  // write, so a retry or a double-call cannot double-bill.
  it("is safe to call twice", async () => {
    const ctx = meter.meterContext({ caller: "audit", userId: "u1" });
    meter.record(ctx, { kind: "ai_deep" });
    await meter.flush(ctx, ENV);
    const second = await meter.flush(ctx, ENV);
    expect(second.charged).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  // Metering is bookkeeping. A ledger that takes extraction down with it is an
  // outage — the same rule withJobRun holds over job_runs.
  it("never throws when the ledger is unreachable", async () => {
    rpc.mockRejectedValue(new Error("ledger down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = meter.meterContext({ caller: "audit", userId: "u1" });
    meter.record(ctx, { kind: "page_fetch" });
    await expect(meter.flush(ctx, ENV)).resolves.toMatchObject({ ok: true, charged: 0 });
    expect(meter.meterStats().failed).toBe(1);
    warn.mockRestore();
  });

  it("reports degraded rather than throwing when Supabase is unconfigured", async () => {
    const ctx = meter.meterContext({ caller: "audit", userId: "u1" });
    meter.record(ctx, { kind: "page_fetch" });
    await expect(meter.flush(ctx, {})).resolves.toMatchObject({ degraded: true });
  });
});

// ── THE RULE THAT STOPS 0078 TAKING THE PRODUCT DOWN ────────────────────────
describe("affords — three ways to say yes, one of them about credits", () => {
  it("says yes when the balance cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await meter.affords("u1", 19, ENV);
    expect(r).toMatchObject({ ok: true, degraded: true, reason: "migration_missing" });
    warn.mockRestore();
  });

  // 🔴 Gates ship BEFORE the step that starts granting allowances. Without
  // this, applying 0078 would pause every schedule, monitor and bulk job on
  // the same afternoon, because every balance correctly reads zero.
  it("says yes for an account that has never been granted credits", async () => {
    rpc.mockResolvedValue({ data: { enforced: false, available: 0, grants: 0 }, error: null });
    const r = await meter.affords("u1", 19, ENV);
    expect(r).toMatchObject({ ok: true, inactive: true });
  });

  it("says no once the account IS on the credit system and is short", async () => {
    rpc.mockResolvedValue({ data: { enforced: true, available: 4, grants: 1 }, error: null });
    const r = await meter.affords("u1", 19, ENV);
    expect(r).toMatchObject({ ok: false, available: 4, shortfall: 15 });
  });

  it("says yes when the account is on the system and has enough", async () => {
    rpc.mockResolvedValue({ data: { enforced: true, available: 100, grants: 1 }, error: null });
    await expect(meter.affords("u1", 19, ENV)).resolves.toMatchObject({ ok: true, available: 100 });
  });

  // Break-glass, read from the environment so it cannot itself fail open.
  it("honours CREDITS_ENFORCEMENT_DISABLED without reading the balance", async () => {
    const r = await meter.affords("u1", 19, { ...ENV, CREDITS_ENFORCEMENT_DISABLED: "1" });
    expect(r).toMatchObject({ ok: true, disabled: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("grant", () => {
  it("passes a positive number and the period key through", async () => {
    rpc.mockResolvedValue({ data: { ok: true, credits: 100 }, error: null });
    await meter.grant("u1", 100, { period: "signup" }, ENV);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("credit_grant");
    expect(args).toMatchObject({ p_user_id: "u1", p_credits: 100, p_period: "signup" });
  });

  it("refuses a non-positive grant before touching the database", async () => {
    await expect(meter.grant("u1", 0, {}, ENV)).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});
