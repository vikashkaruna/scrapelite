// BillingProvider.suspension.integration.test.jsx
//
// Proves the suspended-account contract end to end through the real provider:
// a lapsed subscriber keeps FULL export of their own data and loses everything
// else. The gates are unit-tested in entitlementModel.test.js; this file proves
// BillingProvider actually decides against the server entitlement row rather
// than against localStorage.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { BillingProvider, useBilling } from "./BillingProvider.jsx";
import { AuthProvider } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
const entMocks = vi.hoisted(() => ({
  loadEntitlement: vi.fn(),
  getCachedEntitlement: vi.fn(() => null),
  clearEntitlementCache: vi.fn(),
}));
const repoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

vi.mock("../lib/authService.js", async () => ({
  ...(await vi.importActual("../lib/authService.js")),
  getSession: authMocks.getSession,
  onAuthStateChange: authMocks.onAuthStateChange,
}));
vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));
vi.mock("../lib/usageRepo.js", () => repoMocks);
vi.mock("../lib/paymentRepo.js", () => repoMocks);
vi.mock("../lib/billingRepo.js", () => ({
  claimBillingSession: vi.fn(() => Promise.resolve({ claimed: true })),
  getAuthUserId: vi.fn(() => Promise.resolve("u1")),
  fetchEntitlement: vi.fn(() => Promise.resolve(null)),
  fetchAdminGrantCoupon: vi.fn(() => Promise.resolve(null)),
  redeemAdminGrantCoupon: vi.fn(),
}));
vi.mock("../lib/entitlementClient.js", () => entMocks);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

let seen;

function Probe() {
  const b = useBilling();
  seen = b;
  return (
    <div>
      <span data-testid="status">{b.lifecycle.status}</span>
      <span data-testid="planId">{b.planId}</span>
      <span data-testid="extract">{String(b.checkCanExtract().allowed)}</span>
      <span data-testid="csv">{String(b.checkCanExport("csv"))}</span>
      <span data-testid="pdf">{String(b.checkCanExport("pdf"))}</span>
      <span data-testid="json">{String(b.checkCanExport("json"))}</span>
      <span data-testid="email">{String(b.checkCanEmail())}</span>
      <span data-testid="batch">{String(b.checkCanBatch(5).allowed)}</span>
    </div>
  );
}

function Tree() {
  return (
    <MemoryRouter>
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <Probe />
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seen = null;
  authMocks.getSession.mockResolvedValue({ user: { id: "u1" }, access_token: "t" });
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  entMocks.getCachedEntitlement.mockReturnValue(null);
  entMocks.loadEntitlement.mockResolvedValue(null);
});

describe("suspended subscriber", () => {
  const suspendedPro = {
    user_id: "u1",
    plan_id: "pro",
    status: "suspended",
    source: "payment",
    period_end: daysAgo(5),
  };

  it("keeps every export format and loses everything else", async () => {
    entMocks.loadEntitlement.mockResolvedValue(suspendedPro);
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("suspended"));

    // Data portability: all export paths stay open, including JSON, which the
    // Pro plan happens to include anyway — and which a suspended Select user
    // would also get. See EXPORT_CAPS in entitlementModel.js.
    expect(screen.getByTestId("csv").textContent).toBe("true");
    expect(screen.getByTestId("pdf").textContent).toBe("true");
    expect(screen.getByTestId("json").textContent).toBe("true");
    expect(screen.getByTestId("email").textContent).toBe("true");

    // Everything that creates new work is blocked.
    expect(screen.getByTestId("extract").textContent).toBe("false");
    expect(screen.getByTestId("batch").textContent).toBe("false");
  });

  it("reports the lapse through whyCannot, not as a plan-limit message", async () => {
    entMocks.loadEntitlement.mockResolvedValue(suspendedPro);
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("suspended"));

    const why = seen.whyCannot("extract");
    expect(why.allowed).toBe(false);
    expect(why.code).toBe("SUSPENDED");
    expect(why.reason).toMatch(/lapsed/i);
    expect(seen.isSuspended).toBe(true);
  });

  it("ignores a localStorage plan that disagrees with the server row", async () => {
    // The whole point of PR1: localStorage is a display cache, not authority.
    localStorage.setItem(
      "datiq.subscription",
      JSON.stringify({ planId: "agency", activatedAt: new Date().toISOString() }),
    );
    entMocks.loadEntitlement.mockResolvedValue(suspendedPro);
    render(<Tree />);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("suspended"));
    expect(screen.getByTestId("planId").textContent).toBe("pro"); // server wins
    expect(screen.getByTestId("extract").textContent).toBe("false");
  });
});

/**
 * Reproduces the live bug: a frozen or deletion-pending account could still
 * click Extract, because BillingProvider's `entitlement` object (the one
 * `can()` decides against for every client-side pre-flight check) never
 * carried `frozen_at` / `deletion_requested_at` off the server row — so the
 * pre-flight check always saw a "clean" entitlement and let the request
 * through to consume a real provider call before the SERVER finally refused
 * it. Free plan on purpose: freeze/deletion are account-level, independent of
 * plan or billing history (see migration 0035).
 */
describe("frozen / deletion-pending account — the pre-flight must actually see it", () => {
  it("blocks extraction client-side for a frozen account, before any request is made", async () => {
    entMocks.loadEntitlement.mockResolvedValue({
      user_id: "u1",
      plan_id: "free",
      status: "active",
      frozen_at: new Date().toISOString(),
      frozen_reason: "user_requested",
    });
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    expect(screen.getByTestId("extract").textContent).toBe("false");
    // Read/export stays available — freezing is view-only, not a lockout.
    expect(screen.getByTestId("csv").textContent).toBe("true");

    const why = seen.whyCannot("extract");
    expect(why.code).toBe("FROZEN");
    expect(why.reason).toMatch(/frozen/i);
  });

  it("blocks extraction client-side for a deletion-pending account, and names the right code", async () => {
    entMocks.loadEntitlement.mockResolvedValue({
      user_id: "u1",
      plan_id: "free",
      status: "active",
      frozen_at: new Date().toISOString(),
      frozen_reason: "deletion_requested",
      deletion_requested_at: new Date().toISOString(),
      deletion_purge_after: new Date(Date.now() + 30 * DAY).toISOString(),
    });
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));

    expect(screen.getByTestId("extract").textContent).toBe("false");
    expect(screen.getByTestId("batch").textContent).toBe("false");

    const why = seen.whyCannot("extract");
    expect(why.code).toBe("DELETION_PENDING");
    expect(why.reason).toMatch(/scheduled for deletion/i);
  });
});

describe("active and free accounts are unaffected", () => {
  it("an active paid subscriber keeps full access", async () => {
    entMocks.loadEntitlement.mockResolvedValue({
      user_id: "u1",
      plan_id: "pro",
      status: "active",
      source: "payment",
      period_end: new Date(Date.now() + 20 * DAY).toISOString(),
    });
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("planId").textContent).toBe("pro"));
    expect(screen.getByTestId("extract").textContent).toBe("true");
    expect(screen.getByTestId("batch").textContent).toBe("true");
  });

  it("a user with no entitlement row falls back to plan-only gating", async () => {
    entMocks.loadEntitlement.mockResolvedValue(null);
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));
    // Free plan: CSV yes, PDF no — the pre-existing plan rules still apply.
    expect(screen.getByTestId("csv").textContent).toBe("true");
    expect(screen.getByTestId("pdf").textContent).toBe("false");
    expect(screen.getByTestId("extract").textContent).toBe("true");
  });

  it("never suspends a free account however stale its dates look", async () => {
    entMocks.loadEntitlement.mockResolvedValue({
      user_id: "u1",
      plan_id: "free",
      status: "active",
      source: "migration", // legacy row — not lifecycle-managed
      period_end: daysAgo(400),
    });
    render(<Tree />);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("active"));
    expect(screen.getByTestId("extract").textContent).toBe("true");
  });
});
