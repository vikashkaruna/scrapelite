// src/components/BillingProvider.coupon.integration.test.jsx
//
// Account-page "Apply coupon" used to validate purely against local,
// per-browser data — so it could report success for a coupon already
// exhausted server-side, and it validated a plan-restricted coupon against
// the user's CURRENT plan rather than the plan the coupon actually
// restricts to, producing a misleading "on your next upgrade" message even
// when there's no upgrade path the coupon could ever apply to.
//
// These tests drive BillingProvider.applyCoupon() through checkCouponServer()
// (netlify/functions/validate-coupon.js), mocked at the fetch layer, and
// assert the corrected behavior:
//   - exhausted / expired / inactive server verdicts are surfaced as errors,
//     never as a fabricated success message.
//   - a plan-restricted coupon states which plan it applies to.
//   - a plan-restricted coupon the user is already ON says so, instead of
//     promising a discount "on your next upgrade" that plan restriction
//     would immediately reject.
//   - a coupon the server doesn't recognize falls back to the existing local
//     validation path unchanged (covers extraction-bonus / manual coupons).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";
import { BillingProvider, useBilling } from "./BillingProvider.jsx";
import { AuthProvider } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { ExtractionProvider } from "./ExtractionProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const usageRepoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return { ...actual, getSession: authMocks.getSession, onAuthStateChange: authMocks.onAuthStateChange };
});
vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));
vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

let fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  fetchMock = vi.fn(async () => ({ ok: false })); // default: server has no such coupon
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockValidateCoupon(response) {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("validate-coupon")) {
      return { ok: true, json: async () => response };
    }
    return { ok: false };
  });
}

function Tree({ initialPlanId }) {
  if (initialPlanId) {
    localStorage.setItem("datiq.subscription", JSON.stringify({ planId: initialPlanId }));
  }
  return (
    <MemoryRouter initialEntries={["/account"]}>
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

function Probe() {
  const billing = useBilling();
  return (
    <div>
      <span data-testid="planId">{billing.planId}</span>
      <span data-testid="couponError">{billing.couponError}</span>
      <span data-testid="couponSuccess">{billing.couponSuccess}</span>
      <button data-testid="apply" onClick={() => billing.applyCoupon("SPECIAL99")}>apply</button>
    </div>
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BillingProvider.applyCoupon — real server verdict", () => {
  it("reports an exhausted coupon as an error, not success", async () => {
    mockValidateCoupon({ found: true, active: true, expired: false, exhausted: true, planId: null, type: "percent", value: 99 });
    render(<Tree />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    expect(screen.getByTestId("couponError").textContent).toMatch(/usage limit/i);
    expect(screen.getByTestId("couponSuccess").textContent).toBe("");
  });

  it("reports an expired coupon as an error, not success", async () => {
    mockValidateCoupon({ found: true, active: true, expired: true, exhausted: false, planId: null, type: "percent", value: 99 });
    render(<Tree />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    expect(screen.getByTestId("couponError").textContent).toMatch(/expired/i);
    expect(screen.getByTestId("couponSuccess").textContent).toBe("");
  });

  it("reports an inactive coupon as an error, not success", async () => {
    mockValidateCoupon({ found: true, active: false, expired: false, exhausted: false, planId: null, type: "percent", value: 99 });
    render(<Tree />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    expect(screen.getByTestId("couponError").textContent).toMatch(/deactivated/i);
  });

  it("names the target plan when the coupon is restricted to a plan the user is NOT on", async () => {
    mockValidateCoupon({ found: true, active: true, expired: false, exhausted: false, planId: "go", type: "percent", value: 99 });
    render(<Tree initialPlanId="select" />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    expect(screen.getByTestId("couponError").textContent).toBe("");
    expect(screen.getByTestId("couponSuccess").textContent).toMatch(/upgrade to/i);
    expect(screen.getByTestId("couponSuccess").textContent).toMatch(/Go/);
  });

  it("says so, instead of a fake 'next upgrade' promise, when the user is already on the coupon's restricted plan", async () => {
    mockValidateCoupon({ found: true, active: true, expired: false, exhausted: false, planId: "go", type: "percent", value: 99 });
    render(<Tree initialPlanId="go" />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    expect(screen.getByTestId("couponError").textContent).toBe("");
    const msg = screen.getByTestId("couponSuccess").textContent;
    expect(msg).toMatch(/already on it|already on/i);
    expect(msg).not.toMatch(/next upgrade/i);
  });

  it("falls back to local validation when the server doesn't recognize the code", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, found: false }) });
    render(<Tree />);
    await settle();
    act(() => screen.getByTestId("apply").click());
    await settle();
    // SPECIAL99 isn't in the local seed data either → local validateCoupon rejects it.
    expect(screen.getByTestId("couponError").textContent).toMatch(/not found/i);
  });
});
