import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateBearer = vi.fn();
const available = vi.fn();
vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => authenticateBearer(...a),
}));
vi.mock("../functions/lib/creditMeter.js", () => ({ available: (...a) => available(...a) }));

const { handler } = await import("../functions/credits.js");
const GET = { httpMethod: "GET", headers: {} };

beforeEach(() => vi.clearAllMocks());

const body = (res) => JSON.parse(res.body);

describe("GET /api/credits", () => {
  it("answers a guest with the signed-out state rather than a 401", async () => {
    authenticateBearer.mockResolvedValue({ ok: false });
    const res = await handler(GET);
    // A guest has no ledger to read. Refusing would make the UI render an
    // error banner where it should render nothing at all.
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({ enforced: false, guest: true });
  });

  it("returns the balance for an account on the credit system", async () => {
    authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u1" } });
    available.mockResolvedValue({ ok: true, enforced: true, available: 750, grants: 1, granted: 750, spent: 0 });
    expect(body(await handler(GET))).toMatchObject({ enforced: true, available: 750 });
  });

  // 🔴 Never a confident zero for something we could not read.
  it("reports a degraded read as degraded, with a null balance", async () => {
    authenticateBearer.mockResolvedValue({ ok: true, user: { id: "u1" } });
    available.mockResolvedValue({ degraded: true, reason: "migration_missing", available: null });
    const out = body(await handler(GET));
    expect(out).toMatchObject({ degraded: true, available: null, enforced: false });
  });

  it("is read-only", async () => {
    expect((await handler({ ...GET, httpMethod: "POST" })).statusCode).toBe(405);
    expect(available).not.toHaveBeenCalled();
  });

  it("is never cached — a balance is not a static asset", async () => {
    authenticateBearer.mockResolvedValue({ ok: false });
    expect((await handler(GET)).headers["Cache-Control"]).toBe("no-store");
  });
});
