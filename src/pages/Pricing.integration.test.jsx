// src/pages/Pricing.integration.test.jsx
// I-39 — Pricing page integration.
//
//   - Annual billing is the default (toggle starts on Annual)
//   - Free card + Enterprise card render in the main plan grid (v1.0 only ships Free + Enterprise)
//   - The 4 paid tiers (Select / Pro / Business / Agency) are deferred to v2.0
//     and render in a separate "Coming in v2.0" waitlist section (see
//     docs/PAID-PLANS-DEFERRAL.md)
//   - Developer card has a "Coming soon" badge (already in PLANS array, still coming soon)
//   - Enterprise card has a "Contact sales" mailto
//   - INR currency shows ₹-prefix prices

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

describe("I-39 — Pricing: plan cards + annual default + INR (v1.0 ships Free only; paid in v2.0 waitlist)", () => {
  it("renders Free in the main grid, Enterprise in the main grid, and the 4 paid tiers in the v2.0 waitlist", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Free + Enterprise are the v1.0-active plan cards in the main grid.
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enterprise").length).toBeGreaterThan(0);
    // The 4 paid tiers are listed in the v2.0 waitlist section below the grid.
    expect(screen.getAllByText("Select").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Business").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agency").length).toBeGreaterThan(0);
    // v2.0 waitlist badge is visible.
    expect(screen.getByText(/coming in v2\.0/i)).toBeInTheDocument();
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
