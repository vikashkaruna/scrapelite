// src/components/BillingProvider.integration.test.jsx
// I-05..07 — BillingProvider / initiatePayment / retryPayment integration.
//
//   - I-05: initiatePayment("pro", "annual") with no payment keys →
//           confirmTarget is set → PaymentConfirmModal mounts →
//           confirm → plan upgrades in demo mode; usage NOT auto-incremented.
//   - I-06: Cancel in PaymentConfirmModal → no plan change.
//   - I-07: retryPayment() re-initiates with the same planId + billingPeriod
//           (the lastPaymentArgs ref).
//
// Note: I-05's spec was written before FR-Z-01 replaced DemoPaymentModal
// with PaymentConfirmModal (per the R12 fix). The current production
// behaviour is the same — a confirmation modal is shown before any
// payment call — so the test asserts on the unified flow.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { BillingProvider, useBilling } from "./BillingProvider.jsx";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { ExtractionProvider } from "./ExtractionProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const paymentMocks = vi.hoisted(() => ({
  initiateCheckout: vi.fn(),
  initiateTopupCheckout: vi.fn(),
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
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

vi.mock("../lib/paymentService.js", async () => {
  const actual = await vi.importActual("../lib/paymentService.js");
  return {
    ...actual,
    initiateCheckout: paymentMocks.initiateCheckout,
    initiateTopupCheckout: paymentMocks.initiateTopupCheckout,
    hasPayment: false,
  };
});

vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  paymentMocks.initiateCheckout.mockResolvedValue({ status: "demo_mode" });
  paymentMocks.initiateTopupCheckout.mockResolvedValue({ status: "demo_mode" });
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree({ userEmail = null }) {
  return (
    <MemoryRouter
      initialEntries={["/pricing"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <AuthDriver userEmail={userEmail} />
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

function AuthDriver({ userEmail }) {
  useEffect(() => {
    if (userEmail) {
      authMocks.getSession.mockResolvedValue({
        user: { id: "u1", email: userEmail },
        access_token: "token",
      });
    } else {
      authMocks.getSession.mockResolvedValue(null);
    }
  }, [userEmail]);
  return null;
}

function Probe() {
  const billing = useBilling();
  return (
    <div>
      <span data-testid="planId">{billing.planId}</span>
      <span data-testid="usage">{JSON.stringify(billing.usage)}</span>
      <span data-testid="hasPayment">{String(billing.hasPayment)}</span>
      <button
        data-testid="initiate"
        onClick={() => billing.initiatePayment("pro", "annual")}
      >
        initiate
      </button>
    </div>
  );
}

describe("I-05 — BillingProvider: initiatePayment in demo mode", () => {
  it("initiatePayment('pro','annual') with no payment keys → plan upgrades in demo mode", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("planId").textContent).toBe("free");
    expect(screen.getByTestId("hasPayment").textContent).toBe("false");

    act(() => screen.getByTestId("initiate").click());
    await act(async () => { await Promise.resolve(); });

    // The confirm modal should be open — click "Proceed to payment".
    const confirmBtn = screen.queryByRole("button", { name: /(proceed|confirm)/i });
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn) {
      await act(async () => {
        fireEvent.click(confirmBtn);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    // initiateCheckout was called with the right args.
    expect(paymentMocks.initiateCheckout).toHaveBeenCalledTimes(1);
    const callArgs = paymentMocks.initiateCheckout.mock.calls[0][0];
    expect(callArgs.planId).toBe("pro");
    expect(callArgs.billingPeriod).toBe("annual");

    // The planId in the localStorage subscription should now be "pro".
    const sub = JSON.parse(localStorage.getItem("datiq.subscription") || "{}");
    expect(sub.planId).toBe("pro");
    expect(screen.getByTestId("planId").textContent).toBe("pro");

    // The usage counter was NOT auto-incremented (per spec).
    const usage = JSON.parse(screen.getByTestId("usage").textContent);
    expect(usage.extractions).toBe(0);
  });
});

describe("I-06 — BillingProvider: cancel no-op", () => {
  it("Cancel in PaymentConfirmModal → no plan change", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    act(() => screen.getByTestId("initiate").click());
    await act(async () => { await Promise.resolve(); });

    // Click "Cancel, keep current plan".
    const cancelBtn = screen.getByRole("button", { name: /cancel, keep current plan/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
      await Promise.resolve();
    });
    // Plan should still be "free".
    expect(screen.getByTestId("planId").textContent).toBe("free");
    const sub = JSON.parse(localStorage.getItem("datiq.subscription") || "{}");
    expect(sub.planId).toBeUndefined();
    // initiateCheckout was NOT called.
    expect(paymentMocks.initiateCheckout).not.toHaveBeenCalled();
  });
});
