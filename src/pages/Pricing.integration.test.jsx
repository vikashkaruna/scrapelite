// src/pages/Pricing.integration.test.jsx
// I-39 — Pricing page integration.
//
//   - Monthly billing is the default (toggle starts on Monthly)
//   - All 8 plan cards render (Free / Go / Select / Pro / Business / Agency / Developer / Enterprise)
//   - Developer card is marked coming-soon (badge + disabled "Notify me")
//   - Enterprise card has a "Contact sales" mailto
//   - INR currency shows ₹-prefix prices
//   - v1.0 ships all 4 paid tiers (one-time Order payments); only recurring
//     subscription billing is deferred to v2.0 (see docs/RECURRING-BILLING-DEFERRAL.md)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { PLANS } from "../lib/pricingConfig.js";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

describe("I-39 — Pricing: 8 plan cards + monthly default + INR", () => {
  it("renders all 8 plan cards (Free/Go/Select/Pro/Business/Agency/Developer/Enterprise)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Each plan name appears at least once in the page.
    for (const name of ["Free", "Go", "Select", "Pro", "Business", "Agency", "Developer", "Enterprise"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  it("Developer card carries its coming-soon badge and a disabled CTA", async () => {
    // This asserted `/coming soon/i` and passed for the WRONG REASON: it was
    // matching the referral teaser elsewhere on the page, not the plan card.
    // The card's badge is the specific, dated string from pricingConfig
    // ("Coming H3 2026"), which is also what e2e/smoke/pricing.spec.js pins —
    // so the two suites had drifted into asserting different things.
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const badge = PLANS.find((p) => p.comingSoon)?.badge;
    expect(badge).toBeTruthy();
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notify me/i })).toBeDisabled();
  });

  it("Enterprise card has a 'Contact sales' mailto link", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The Enterprise card CTA is a mailto: link to hello@datiq.app.
    const mailto = document.querySelector('a[href^="mailto:"]');
    expect(mailto).not.toBeNull();
    expect(mailto.getAttribute("href")).toMatch(/mailto:hello@datiq\.app/);
  });

  it("Monthly billing is the default toggle state", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The toggle has two options (Monthly, Annual). Monthly should be active
    // by default so users aren't defaulted into an annual commitment.
    const monthlyBtn = screen.getByRole("button", { name: /monthly/i });
    expect(monthlyBtn).toBeInTheDocument();
    expect(monthlyBtn.className).toMatch(/active/);
    const annualBtn = screen.getByRole("button", { name: /annual/i });
    expect(annualBtn.className).not.toMatch(/active/);
  });

  it("switching to Annual shows the struck-through original total and a Save line", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const annualBtn = screen.getByRole("button", { name: /annual/i });
    await act(async () => { annualBtn.click(); });
    expect(annualBtn.className).toMatch(/active/);
    expect(screen.getAllByText(/^Save /).length).toBeGreaterThan(0);
    expect(document.querySelector(".price-original")).not.toBeNull();
  });
});

// Regression guard: the currency dropdown used to render UNDERNEATH the
// plan cards. Both `.pricing-hero` and `.plans-grid` are direct children
// of `.container`, both inherit `position: relative; z-index: 1` from
// `.container > *`, and `.plans-grid` comes later in document order so
// it painted on top of the absolutely-positioned `.currency-dropdown`.
//
// Bumping the z-index on `.currency-picker` or `.currency-dropdown`
// does NOT fix this — z-indexes only compare within the same stacking
// context, and the picker's stacking context is capped by the hero's
// z=1. The fix is to give `.pricing-hero` a z-index higher than 1 so
// it wins against the `.plans-grid` sibling. See the comment block
// above `.pricing-hero` in screens.css for the full explanation.
// If this test ever fails, the pricing page dropdown is overlapping
// the plan cards again — see screenshot 2026-07-28.
describe("I-39 — Pricing: currency dropdown stacks above plan cards", () => {
  it(".pricing-hero has a higher z-index than .plans-grid (CSS rule, source of truth)", () => {
    // Read the CSS source and verify the declared z-indexes. A future
    // contributor who tries to "simplify" the .pricing-hero block will
    // see this test fail and know why.
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const css = readFileSync(resolve(__dirname, "../styles/screens.css"), "utf8");

    // Pull the z-index declared in the .pricing-hero block.
    const heroMatch = css.match(/\.pricing-hero\s*\{[^}]*z-index:\s*(\d+)/);
    expect(heroMatch, ".pricing-hero must declare a z-index").not.toBeNull();
    const heroZ = Number(heroMatch[1]);

    // Pull the z-index declared in the .plans-grid block (if any).
    // If absent, fall back to the .container > * baseline of 1.
    const gridMatch = css.match(/\.plans-grid\s*\{[^}]*z-index:\s*(\d+)/);
    const gridZ = gridMatch ? Number(gridMatch[1]) : 1;

    // The hero must win against the plans-grid sibling — otherwise the
    // plans grid paints on top of the dropdown (see 2026-07-28 bug).
    expect(
      heroZ,
      `.pricing-hero z-index (${heroZ}) must exceed .plans-grid z-index (${gridZ}); ` +
        "otherwise the plan cards paint on top of the dropdown (see 2026-07-28 bug)."
    ).toBeGreaterThan(gridZ);

    // And it must stay below the modal layer so future modals still
    // cover the page (modals are >=1000 in this codebase).
    expect(
      heroZ,
      `.pricing-hero z-index (${heroZ}) must stay below the modal layer (1000); ` +
        "otherwise modals/dialogs would render behind the hero."
    ).toBeLessThan(1000);
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
