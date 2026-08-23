// src/__tests__/a11y/components-a11y.test.jsx
// A-01..06 — vitest-axe audit for the 6 most-accessible components:
//   A-01 TopBar
//   A-02 TopupBundleModal
//   A-03 DemoPaymentModal
//   A-04 PaymentConfirmModal
//   A-05 AuthModal
//   A-06 GuestTrialModal
//
// Each component is mounted with the minimum provider context it needs and
// asserted to have no serious/critical axe-core violations. Tests use the
// `toHaveNoViolations()` matcher registered in test/a11y-setup.js.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { axe } from "vitest-axe";

// ── Mocks for provider-bound components ───────────────────────────────────────
const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => () => {}),
}));

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

import TopBar from "../../components/TopBar.jsx";
import TopupBundleModal from "../../components/TopupBundleModal.jsx";
import DemoPaymentModal from "../../components/DemoPaymentModal.jsx";
import PaymentConfirmModal from "../../components/PaymentConfirmModal.jsx";
import AuthModal from "../../components/AuthModal.jsx";
import GuestTrialModal from "../../components/GuestTrialModal.jsx";

import { AuthProvider, useAuth } from "../../components/AuthProvider.jsx";
import { PersonaProvider } from "../../components/PersonaProvider.jsx";
import { ThemeProvider } from "../../components/ThemeProvider.jsx";
import { ToastProvider } from "../../components/Toast.jsx";
import { ErrorModalProvider } from "../../components/ErrorModal.jsx";
import { GuestTrialProvider } from "../../components/GuestTrialProvider.jsx";
import { BillingProvider } from "../../components/BillingProvider.jsx";

const BUNDLE = {
  id: "batch-pack",
  name: "Batch Pack",
  description: "Add 50 batch URLs to your plan",
  icon: "layers-2",
  price_usd: 49,
  price_inr: 3999,
  bonusBatchUrls: 50,
  bonusExtractions: 0,
};

function withProviders(ui, { user = null, autoOpenAuth = false } = {}) {
  if (user) {
    authMocks.getSession.mockResolvedValue({
      user: { id: "u1", email: user, user_metadata: { full_name: "Test" } },
      access_token: "t",
    });
  } else {
    authMocks.getSession.mockResolvedValue(null);
  }

  // If requested, mount a child that calls openAuth("signin") on mount so
  // the AuthModal opens.
  function Opener() {
    const { openAuth } = useAuth();
    useEffect(() => { if (autoOpenAuth) openAuth("signin"); }, []);
    return null;
  }

  const tree = (
    <MemoryRouter>
      <ThemeProvider>
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <PersonaProvider>
                <GuestTrialProvider>
                  <BillingProvider>
                    {autoOpenAuth ? <Opener /> : null}
                    {ui}
                  </BillingProvider>
                </GuestTrialProvider>
              </PersonaProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return render(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// Filter axe results to just serious/critical (the FR-A-* exit criterion).
function seriousOnly(results) {
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

// ── A-01 — TopBar ─────────────────────────────────────────────────────────────
describe("A-01 — TopBar a11y", () => {
  it("logged-out TopBar has no serious/critical violations", async () => {
    const { container } = withProviders(<TopBar />);
    const results = await axe(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});

// ── A-02 — TopupBundleModal ───────────────────────────────────────────────────
describe("A-02 — TopupBundleModal a11y", () => {
  it("modal has no serious/critical violations", async () => {
    const { container } = withProviders(
      <TopupBundleModal
        bundle={BUNDLE}
        currency="USD"
        rates={{ USD: 1, INR: 83.5 }}
        currentPlanId="free"
        onClose={() => {}}
        onPurchase={() => {}}
        onUpgrade={() => {}}
        loading={false}
      />
    );
    const results = await axe(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});

// ── A-03 — DemoPaymentModal ───────────────────────────────────────────────────
describe("A-03 — DemoPaymentModal a11y", () => {
  it("modal has no serious/critical violations", async () => {
    const { container } = withProviders(
      <DemoPaymentModal
        planId="pro"
        billingPeriod="monthly"
        currency="USD"
        rates={{ USD: 1, INR: 83.5 }}
        currentPlanId="free"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});

// ── A-04 — PaymentConfirmModal ────────────────────────────────────────────────
describe("A-04 — PaymentConfirmModal a11y", () => {
  it("modal has no serious/critical violations", async () => {
    const { container } = withProviders(
      <PaymentConfirmModal
        planId="pro"
        billingPeriod="monthly"
        currency="USD"
        rates={{ USD: 1, INR: 83.5 }}
        currentPlanId="free"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const results = await axe(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});

// ── A-05 — AuthModal ──────────────────────────────────────────────────────────
describe("A-05 — AuthModal a11y", () => {
  it("sign-in modal has no serious/critical violations", async () => {
    // Mount AuthModal directly (bypassing App.jsx's {showAuthModal &&} gate)
    // and trigger openAuth("signin") so the dialog renders.
    const { container } = withProviders(<AuthModal />, { autoOpenAuth: true });
    // The modal renders into a portal — query the full document.
    const results = await axe(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});

// ── A-06 — GuestTrialModal ────────────────────────────────────────────────────
describe("A-06 — GuestTrialModal a11y", () => {
  it("hard-block modal has no serious/critical violations", async () => {
    // Seed the hard-block condition so the dialog renders on mount.
    localStorage.setItem(
      "datiq.guestTrial",
      JSON.stringify({ count: 10, batchCount: 0, sid: "a06" })
    );
    const { container } = withProviders(<GuestTrialModal />);
    const results = await axe(document.body, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    expect(seriousOnly(results)).toEqual([]);
  });
});
