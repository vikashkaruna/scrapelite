// src/pages/admin/AdminRevenue.integration.test.jsx
// I-44 — AdminRevenue integration.
//
//   - Loading → KPI cards (mocked via getRevenueData)
//   - "from seed" warning shown when data is fallback
//   - Refresh button re-triggers the fetch

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminRevenue from "./AdminRevenue.jsx";
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
  getRevenueData: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
  // Default: live data, no fallback. Use the actual metric field names
  // the AdminRevenue component reads (mrr, arr, totalUsers, payingUsers,
  // freeUsers, newThisMonth, couponUsage, byPlan).
  // The trend chart reads d.label + d.mrr (one bar per month).
  adminConfigMocks.getRevenueData.mockResolvedValue({
    metrics: {
      mrr: 1234,
      arr: 14808,
      totalUsers: 42,
      payingUsers: 7,
      freeUsers: 35,
      newThisMonth: 3,
      couponUsage: 2,
      byPlan: { free: 35, pro: 5, business: 2 },
    },
    trend: [
      { label: "Jan 2026", mrr: 1000 },
      { label: "Feb 2026", mrr: 1100 },
      { label: "Mar 2026", mrr: 1234 },
    ],
    fromSeed: false,
  });
});

const usageRepoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

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

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/admin/revenue"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <AdminRevenue />
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

describe("I-44 — AdminRevenue: KPIs + Refresh + fromSeed warning", () => {
  it("renders the KPI cards once data loads (MRR, ARR, users, coupons)", async () => {
    render(<Tree />);
    // Cold CI runners can exceed waitFor's 1s default while the full
    // provider tree mounts — give the async load explicit headroom.
    await waitFor(
      () => {
        expect(screen.getByText(/\$1[,.]?234/)).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    // The fromSeed warning is NOT shown.
    expect(screen.queryByText(/from seed|fallback/i)).toBeNull();
  });

  it("shows the fromSeed warning banner when the data is fallback", async () => {
    adminConfigMocks.getRevenueData.mockResolvedValueOnce({
      metrics: { mrr: 0, arr: 0, totalUsers: 0, payingUsers: 0, freeUsers: 0, newThisMonth: 0, couponUsage: 0, byPlan: {} },
      trend: [],
      fromSeed: true,
    });
    render(<Tree />);
    await waitFor(
      () => {
        expect(screen.getByText(/from seed|fallback|supabase/i)).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  it("Refresh button re-fetches the data", async () => {
    render(<Tree />);
    await waitFor(
      () => {
        expect(screen.getByText(/\$1[,.]?234/)).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    // Click Refresh — fetch should be called again.
    const before = adminConfigMocks.getRevenueData.mock.calls.length;
    act(() => screen.getByRole("button", { name: /refresh/i }).click());
    await waitFor(
      () => {
        expect(adminConfigMocks.getRevenueData.mock.calls.length).toBeGreaterThan(before);
      },
      { timeout: 5000 }
    );
  });
});
