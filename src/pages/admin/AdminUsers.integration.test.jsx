// src/pages/admin/AdminUsers.integration.test.jsx
// I-46 — AdminUsers integration.
//
//   - Loading state → users table populated from fetchRealUsers (mocked)
//   - "Assign coupon" action icon opens the CouponModal for that row

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import AdminUsers from "./AdminUsers.jsx";
import { AuthProvider } from "../../components/AuthProvider.jsx";
import { ToastProvider } from "../../components/Toast.jsx";
import { ErrorModalProvider } from "../../components/ErrorModal.jsx";
import { PersonaProvider } from "../../components/PersonaProvider.jsx";
import { BillingProvider } from "../../components/BillingProvider.jsx";
import { ExtractionProvider } from "../../components/ExtractionProvider.jsx";
import { GuestTrialProvider } from "../../components/GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const adminConfigMocks = vi.hoisted(() => ({
  fetchRealUsers: vi.fn(),
  extendUserBonus: vi.fn(),
  assignAdminGrantCoupon: vi.fn(),
  inviteUserByEmail: vi.fn(),
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

vi.mock("../../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../../lib/adminConfigService.js", () => adminConfigMocks);

vi.mock("../../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../../lib/paymentRepo.js", () => usageRepoMocks);

vi.mock("../../lib/globalSettingsService.js", () => ({
  getSettings: () => ({
    guest_trial_soft_limit: 3,
    guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10,
    guest_batch_hard_limit: 5,
  }),
  loadSettings: () => Promise.resolve({
    guest_trial_soft_limit: 3,
    guest_trial_reprompt_interval: 2,
    guest_single_hard_limit: 10,
    guest_batch_hard_limit: 5,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
  // Default: 2 mock users.
  adminConfigMocks.fetchRealUsers.mockResolvedValue({
    users: [
      { id: "u1", name: "Alice", email: "alice@example.com", plan: "pro", planStart: null, planEnd: null, couponAvailed: null, couponDiscount: 0, extractionsThisMonth: 0, planPeriod: null },
      { id: "u2", name: "Bob",   email: "bob@example.com",   plan: "free", planStart: null, planEnd: null, couponAvailed: null, couponDiscount: 0, extractionsThisMonth: 0, planPeriod: null },
    ],
  });
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/admin/users"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <AdminUsers />
                  </ExtractionProvider>
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("I-46 — AdminUsers: real users + assign-coupon modal", () => {
  it("renders the seeded users from fetchRealUsers", async () => {
    render(<Tree />);
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("clicking the 'Assign coupon' action icon opens the Coupon modal", async () => {
    render(<Tree />);
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
    // The first row's "Assign coupon" button (title attribute).
    const couponBtns = screen.getAllByTitle(/assign coupon/i);
    expect(couponBtns.length).toBeGreaterThan(0);
    act(() => fireEvent.click(couponBtns[0]));
    await act(async () => { await Promise.resolve(); });
    // The modal header references the user name.
    expect(screen.getByText(/assign coupon — alice/i)).toBeInTheDocument();
    expect(screen.getByText(/one-time complimentary plan grant/i)).toBeInTheDocument();
    expect(screen.getByText("Plan granted")).toBeInTheDocument();
    expect(screen.getByText("Validity")).toBeInTheDocument();
  });
});
