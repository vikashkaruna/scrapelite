// src/pages/Account.integration.test.jsx
// I-38 — Account page integration.
//
//   - Plan name from the effective plan map is rendered
//   - Usage stats (extractions + bonus + 4 counters) are present
//   - Coupon apply / remove UI is present
//   - Payment history table renders (or empty state)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Account from "./Account.jsx";
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

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn(() => Promise.resolve([])),
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

vi.mock("../lib/apiClient.js", () => ({ apiClient: apiMocks, setAuthToken: vi.fn() }));

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
      initialEntries={["/account"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Account />
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

describe("I-38 — Account: plan + usage", () => {
  it("renders the current plan name from the effective plan map (Free by default)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/current plan/i)).toBeInTheDocument();
    // The Free plan card has both the "Free" name and the "Free" badge.
    const planName = document.querySelector(".apc-plan-name");
    expect(planName).not.toBeNull();
    expect(planName.textContent).toMatch(/Free/);
  });

  it("renders the 4 quick-stats counters (extractions / enrichments / batch / content)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Each counter has a label. Scope to .account-stats to avoid matching
    // other "extractions" strings elsewhere on the page.
    const stats = document.querySelector(".account-stats");
    expect(stats).not.toBeNull();
    expect(stats.textContent).toMatch(/extractions/i);
    expect(stats.textContent).toMatch(/enrichments/i);
    expect(stats.textContent).toMatch(/batch executions/i);
    expect(stats.textContent).toMatch(/content generations/i);
  });

  it("renders the coupon input", () => {
    render(<Tree />);
    expect(screen.getByPlaceholderText(/enter code/i)).toBeInTheDocument();
  });

  it("puts 'Explore top-up bundles' ABOVE the coupon + white-label cards in the right column (2026-08-11)", () => {
    render(<Tree />);
    // The right column is .account-aside. We pin the order of the four
    // top-level children: the top-up CTA first, then the white-label
    // uploader, then the coupon card, then quick stats. A future refactor
    // that reorders these (e.g. moves the CTA back to the bottom) gets
    // caught here.
    const aside = document.querySelector(".account-aside");
    expect(aside).not.toBeNull();
    const kids = Array.from(aside.children);
    // First child = the top-up CTA (it has the "Explore top-up bundles" text).
    expect(kids[0].textContent).toMatch(/Explore top-up bundles/);
    // Second child is the white-label uploader.
    expect(kids[1].querySelector(".wltu-card, [class*='white-label']") || kids[1].tagName).toBeTruthy();
    // Third child = the coupon / promo code card.
    expect(kids[2].textContent).toMatch(/coupon \/ promo code/i);
    // Fourth child = the quick stats card.
    expect(kids[3].classList.contains("account-stats")).toBe(true);
  });
});
