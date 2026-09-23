import { describe, it, expect, vi, beforeEach } from "vitest";

// ── THE REGRESSION THIS FILE EXISTS TO PREVENT ──────────────────────────────
// Closing L0b by CONSUMING a guest credit on /api/ai would have halved the
// guest trial without anyone noticing: one extraction from the browser is
// /api/extract (which charges) plus one or two /api/ai calls for the summary
// and link tagging. Ten advertised extractions would have become three or
// four, while GuestTrialBanner carried on saying ten.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = fetchMock;
});

const guest = await import("../functions/lib/guestUsage.js");
const ENV = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_KEY: "k" };
const withCookie = (v = "abc") => ({ headers: { cookie: `datiq_guest_id=${v}` } });

const rows = (body) => ({ ok: true, json: async () => body });

describe("peekGuestCredit — reads the bucket, never spends from it", () => {
  it("makes no write of any kind", async () => {
    fetchMock.mockResolvedValue(rows([{ single_count: 3 }]));
    await guest.peekGuestCredit(withCookie(), "single", { env: ENV });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("guest_identities");
    expect(init?.method ?? "GET").toBe("GET");
    // A POST here would be consume_guest_credit — the bug this test pins.
    expect(String(url)).not.toContain("rpc/consume_guest_credit");
  });

  it("allows a guest inside their bucket", async () => {
    fetchMock.mockResolvedValue(rows([{ single_count: 3 }]));
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: true, remaining: 7 });
  });

  it("refuses a guest who has spent their bucket — which is the leak closed", async () => {
    fetchMock.mockResolvedValue(rows([{ single_count: 10 }]));
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: false, remaining: 0, reason: "single_limit_reached" });
  });

  it("skips the lookup entirely for a signed-in caller", async () => {
    await expect(guest.peekGuestCredit(withCookie(), "single", { verifiedUserId: "u1", env: ENV }))
      .resolves.toMatchObject({ allowed: true, authenticated: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ⚠️ Fail OPEN on anything undeterminable. Closed only on a known count.
  it("allows a visitor with no identity cookie", async () => {
    await expect(guest.peekGuestCredit({ headers: {} }, "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: true, fresh: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows when Supabase is unconfigured", async () => {
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: {} }))
      .resolves.toMatchObject({ allowed: true, degraded: true });
  });

  it("allows when the lookup errors or the row is missing", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: true, degraded: true });

    fetchMock.mockResolvedValue(rows([]));
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: true });

    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(guest.peekGuestCredit(withCookie(), "single", { env: ENV }))
      .resolves.toMatchObject({ allowed: true, degraded: true });
  });
});
