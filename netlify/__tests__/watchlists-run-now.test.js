// POST /api/watchlists {action:"run_now"} — a REAL check, replacing the
// "Simulate Delta" button that POSTed a hardcoded "$49/mo → $79/mo" through
// record_change and wrote invented competitor movement into the user's real
// change feed, indistinguishable from observed movement once stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  assertWatchlistOwner: vi.fn(),
  getWatchlist: vi.fn(),
  listWatchlists: vi.fn(),
  createWatchlist: vi.fn(),
  recordFieldChange: vi.fn(),
  submitChangeFeedback: vi.fn(),
  serviceDb: vi.fn(),
  processTarget: vi.fn(),
  chargeLedger: vi.fn(),
}));

vi.mock("../functions/lib/supabaseServerClient.js", () => ({ authenticateBearer: mocks.authenticateBearer }));
vi.mock("../functions/lib/watchlistStore.js", () => ({
  assertWatchlistOwner: mocks.assertWatchlistOwner,
  getWatchlist: mocks.getWatchlist,
  listWatchlists: mocks.listWatchlists,
  createWatchlist: mocks.createWatchlist,
  recordFieldChange: mocks.recordFieldChange,
  submitChangeFeedback: mocks.submitChangeFeedback,
  serviceDb: mocks.serviceDb,
}));
vi.mock("../functions/watchlist-monitor.js", () => ({ _internal: { processTarget: mocks.processTarget } }));
vi.mock("../functions/lib/templateStore.js", () => ({ chargeLedger: mocks.chargeLedger }));
vi.mock("../functions/lib/requireEntitlement.js", () => ({
  resolveRequestEntitlement: vi.fn(async () => ({})),
  checkCapability: vi.fn(() => ({ allowed: true })),
  denyResponse: vi.fn(() => ({ statusCode: 402, body: "{}" })),
}));

let handler;
beforeEach(async () => {
  vi.resetModules();
  for (const m of Object.values(mocks)) m.mockReset?.();
  mocks.authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u-1" } });
  mocks.assertWatchlistOwner.mockResolvedValue(true);
  mocks.serviceDb.mockReturnValue({});
  mocks.chargeLedger.mockResolvedValue({});
  ({ handler } = await import("../functions/watchlists.js"));
});
afterEach(() => vi.restoreAllMocks());

const run = (body) => handler({
  httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "run_now", ...body }),
});

describe("watchlists run_now", () => {
  it("refuses a watchlist the caller does not own — 404, not 403", async () => {
    // 404 so ids cannot be enumerated by probing, same rule as record_change.
    mocks.assertWatchlistOwner.mockResolvedValue(false);
    const r = await run({ watchlistId: "w-other" });
    expect(r.statusCode).toBe(404);
    expect(mocks.processTarget).not.toHaveBeenCalled();
  });

  it("requires a watchlistId", async () => {
    const r = await run({});
    expect(r.statusCode).toBe(400);
  });

  it("runs the SAME differ the cron runs, once per target", async () => {
    // Not a second implementation: a preview that disagrees with the scheduled
    // run turns every diff into noise.
    mocks.getWatchlist.mockResolvedValue({
      id: "w1", user_id: "u-1", targets: [{ id: "t1", domain: "a.com" }, { id: "t2", domain: "b.com" }],
    });
    mocks.processTarget.mockResolvedValue({ domain: "x", pages: 2, changes: 1, alerts: 0, discovered: 0, errors: [] });
    const r = await run({ watchlistId: "w1" });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(mocks.processTarget).toHaveBeenCalledTimes(2);
    expect(body.checked).toBe(2);
    expect(body.changes).toBe(2);
  });

  it("charges for pages actually READ — an unfetchable target is free", async () => {
    mocks.getWatchlist.mockResolvedValue({ id: "w1", targets: [{ id: "t1", domain: "a.com" }] });
    mocks.processTarget.mockResolvedValue({ domain: "a.com", pages: 0, changes: 0, alerts: 0, errors: ["timeout"] });
    await run({ watchlistId: "w1" });
    expect(mocks.chargeLedger).not.toHaveBeenCalled();
  });

  it("charges the ledger when pages were read", async () => {
    mocks.getWatchlist.mockResolvedValue({ id: "w1", targets: [{ id: "t1", domain: "a.com" }] });
    mocks.processTarget.mockResolvedValue({ domain: "a.com", pages: 3, changes: 0, alerts: 0, errors: [] });
    await run({ watchlistId: "w1" });
    const entry = mocks.chargeLedger.mock.calls[0][0][0];
    expect(entry).toMatchObject({ user_id: "u-1", unit: "monitor_check", credits: 3 });
    expect(entry.metadata.on_demand).toBe(true);
  });

  it("an empty watchlist is reported, not treated as an error", async () => {
    mocks.getWatchlist.mockResolvedValue({ id: "w1", targets: [] });
    const r = await run({ watchlistId: "w1" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).checked).toBe(0);
    expect(mocks.processTarget).not.toHaveBeenCalled();
  });

  it("a ledger failure does not fail the check", async () => {
    // Bookkeeping never breaks the job — the same rule withJobRun applies.
    mocks.getWatchlist.mockResolvedValue({ id: "w1", targets: [{ id: "t1", domain: "a.com" }] });
    mocks.processTarget.mockResolvedValue({ domain: "a.com", pages: 1, changes: 1, alerts: 0, errors: [] });
    mocks.chargeLedger.mockRejectedValue(new Error("ledger down"));
    const r = await run({ watchlistId: "w1" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).changes).toBe(1);
  });

  it("one failing target does not abort the rest", async () => {
    mocks.getWatchlist.mockResolvedValue({ id: "w1", targets: [{ id: "t1", domain: "a.com" }, { id: "t2", domain: "b.com" }] });
    mocks.processTarget
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ domain: "b.com", pages: 1, changes: 1, alerts: 0, errors: [] });
    const r = await run({ watchlistId: "w1" });
    const body = JSON.parse(r.body);
    expect(body.checked).toBe(1);
    expect(body.errors.join(" ")).toContain("boom");
  });
});
