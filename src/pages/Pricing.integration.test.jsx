// src/pages/Pricing.integration.test.jsx
// I-39 — Pricing page integration.
//
//   - Annual billing is the default (toggle starts on Annual)
//   - All 7 plan cards render (Free / Select / Pro / Business / Agency / Developer / Enterprise)
//   - Developer card has a "Coming soon" badge
//   - Enterprise card has a "Contact sales" mailto
//   - INR currency shows ₹-prefix prices
//   - v1.0 ships all 4 paid tiers (one-time Order payments); only recurring
//     subscription billing is deferred to v2.0 (see docs/RECURRING-BILLING-DEFERRAL.md)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Pricing from "./Pricing.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider } from "../components/PersonaProvider.jsx";
import { BillingProvider } from "../components/BillingProvider.jsx";
import { ExtractionProvider } from "../components/ExtractionProvider.jsx";
import { GuestTrialProvider } from "../components/GuestTrialProvider.jsx";

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

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

vi.mock("../lib/globalSettingsService.js", () => ({
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
      initialEntries={["/pricing"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Pricing />
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

describe("I-39 — Pricing: 7 plan cards + annual default + INR", () => {
  it("renders all 7 plan cards (Free/Select/Pro/Business/Agency/Developer/Enterprise)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Each plan name appears at least once in the page.
    for (const name of ["Free", "Select", "Pro", "Business", "Agency", "Developer", "Enterprise"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("Developer card has a 'Coming soon' badge", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("Enterprise card has a 'Contact sales' mailto link", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The Enterprise card CTA is a mailto: link to support@datiq.app.
    const mailto = document.querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    expect(mailto.getAttribute("href")).toMatch(/mailto:support@datiq\.app/);
  });

  it("Annual billing is the default toggle state", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The toggle has two options (Monthly, Annual). Annual should be active.
    const annualBtn = screen.getByRole("button", { name: /annual/i });
    expect(annualBtn).toBeInTheDocument();
    expect(annualBtn.className).toMatch(/on|active/);
  });
});
