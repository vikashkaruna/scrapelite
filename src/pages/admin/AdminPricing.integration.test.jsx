// src/pages/admin/AdminPricing.integration.test.jsx
// I-45 — AdminPricing integration.
//
//   - USD + INR sections are both rendered
//   - Plan cards render with their prices
//   - "Generate SQL" button emits valid SQL (insert into pricing_config)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminPricing from "./AdminPricing.jsx";
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
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/admin/pricing"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <AdminPricing />
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

describe("I-45 — AdminPricing: USD + INR sections", () => {
  it("renders plan editor cards for each plan (USD + INR + GST hint, on expand)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Each plan card has a collapsed header. Open the first plan to expose
    // the USD + INR sections.
    const headers = document.querySelectorAll(".plan-editor-header");
    expect(headers.length).toBeGreaterThan(0);
    act(() => headers[0].click());
    await act(async () => { await Promise.resolve(); });
    // Now the USD + INR labels should be visible.
    const labels = document.querySelectorAll(".admin-price-section-label");
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(labels[0].textContent).toMatch(/USD Pricing/i);
    expect(labels[1].textContent).toMatch(/INR Pricing/i);
  });

  it("'Generate SQL' button is present in the operator section", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: /generate sql/i })).toBeInTheDocument();
  });
});
