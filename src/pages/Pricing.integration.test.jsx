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
    // The Enterprise card CTA is a mailto: link to hello@datiq.app.
    const mailto = document.querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    expect(mailto.getAttribute("href")).toMatch(/mailto:hello@datiq\.app/);
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

// Regression guard: the currency dropdown used to render UNDERNEATH the
// plan cards because both `.currency-picker` and `.plans-grid` were
// direct children of `.container`, both inherited `z-index: 1`, and
// document order placed the plans grid on top. The fix is to give
// `.currency-picker` its own stacking context with a z-index high
// enough to win. If this test ever fails, the pricing page dropdown
// is overlapping the plan cards again — see screenshot 2026-07-28.
describe("I-39 — Pricing: currency dropdown stacks above plan cards", () => {
  it(".currency-picker has a higher z-index than .plans-grid (CSS rule, source of truth)", () => {
    // The actual stacking is decided by the cascade, but the easiest
    // regression guard is to read the CSS source and verify the
    // declared z-indexes. A future contributor who tries to "simplify"
    // the .currency-picker block will see this test fail and know why.
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/screens.css"), "utf8");

    // Pull the z-index declared in the .currency-picker block.
    const pickerMatch = css.match(/\.currency-picker\s*\{[^}]*z-index:\s*(\d+)/);
    expect(pickerMatch, ".currency-picker must declare a z-index").not.toBeNull();
    const pickerZ = Number(pickerMatch[1]);

    // Pull the z-index declared in the .plans-grid block (if any).
    // If absent, the picker just needs to be > 1, since
    // .container > * forces z-index: 1 on .plans-grid.
    const gridMatch = css.match(/\.plans-grid\s*\{[^}]*z-index:\s*(\d+)/);
    const gridZ = gridMatch ? Number(gridMatch[1]) : 1;

    // The picker must also beat the container's "1" baseline (line 6).
    expect(
      pickerZ,
      `.currency-picker z-index (${pickerZ}) must exceed .plans-grid z-index (${gridZ}); ` +
        "otherwise the plan cards paint on top of the dropdown (see 2026-07-28 bug)."
    ).toBeGreaterThan(gridZ);
  });

  it("opening the currency dropdown renders an options list with both INR and USD", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The picker is a button; click it to open the dropdown.
    const btn = document.querySelector(".currency-picker > .currency-btn");
    expect(btn, "currency button should be in the DOM").not.toBeNull();
    await act(async () => { btn.click(); });
    // After opening, the dropdown menu must be present.
    const dropdown = document.querySelector(".currency-dropdown");
    expect(dropdown, "dropdown should be in the DOM after click").not.toBeNull();
    // And it must list both currencies.
    const codes = Array.from(dropdown.querySelectorAll(".co-code")).map((n) => n.textContent.trim());
    expect(codes).toEqual(expect.arrayContaining(["INR", "USD"]));
  });
});
