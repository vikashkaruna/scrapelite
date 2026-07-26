// SuspendedBanner.integration.test.jsx
//
// The banner is the only place a lapsed user is told WHY the product stopped
// working and that their data has a deadline, so the copy is tested as
// carefully as the visibility rules.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SuspendedBanner from "./SuspendedBanner.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { AuthProvider } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
const entMocks = vi.hoisted(() => ({
  loadEntitlement: vi.fn(),
  getCachedEntitlement: vi.fn(() => null),
  clearEntitlementCache: vi.fn(),
}));
const repoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess"),
}));

vi.mock("../lib/authService.js", async () => ({
  ...(await vi.importActual("../lib/authService.js")),
  getSession: authMocks.getSession,
  onAuthStateChange: authMocks.onAuthStateChange,
}));
vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));
vi.mock("../lib/usageRepo.js", () => repoMocks);
vi.mock("../lib/paymentRepo.js", () => repoMocks);
vi.mock("../lib/billingRepo.js", () => ({
  claimBillingSession: vi.fn(() => Promise.resolve({ claimed: true })),
  getAuthUserId: vi.fn(() => Promise.resolve("u1")),
  fetchEntitlement: vi.fn(() => Promise.resolve(null)),
  fetchInvoices: vi.fn(() => Promise.resolve([])),
  fetchInvoiceLines: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../lib/entitlementClient.js", () => entMocks);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

const paid = (over = {}) => ({
  user_id: "u1",
  plan_id: "pro",
  status: "active",
  source: "payment",
  period_end: daysAgo(5),
  ...over,
});

function Tree() {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <SuspendedBanner />
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue({ user: { id: "u1" }, access_token: "t" });
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  entMocks.getCachedEntitlement.mockReturnValue(null);
  entMocks.loadEntitlement.mockResolvedValue(null);
});

describe("when it appears", () => {
  it("is hidden for a healthy account", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: new Date(Date.now() + 20 * DAY).toISOString() }));
    render(<Tree />);
    await waitFor(() => expect(entMocks.loadEntitlement).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is hidden for a free account, however old", async () => {
    entMocks.loadEntitlement.mockResolvedValue({
      user_id: "u1", plan_id: "free", status: "active", source: null, period_end: null,
    });
    render(<Tree />);
    await waitFor(() => expect(entMocks.loadEntitlement).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is hidden for a signed-out visitor", async () => {
    authMocks.getSession.mockResolvedValue(null);
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    await waitFor(() => expect(entMocks.loadEntitlement).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears for a suspended subscriber", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});

describe("what it says", () => {
  it("explains what stopped and that data can still be exported", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/paused/i);
    expect(banner.textContent).toMatch(/export/i);
  });

  it("names the date the data is kept until", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/kept until/i);
  });

  it("counts down only in the final week, so urgency keeps its meaning", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: daysAgo(85) }));
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/5 days left/);
    expect(banner.className).toMatch(/suspended-urgent/);
  });

  it("does not shout at someone who just lapsed", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: daysAgo(1) }));
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.className).not.toMatch(/suspended-urgent/);
  });

  it("changes wording once the account is deactivated", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: daysAgo(40) }));
    render(<Tree />);
    expect((await screen.findByRole("status")).textContent).toMatch(/deactivated/i);
  });

  it("tells a purged user their invoices survive", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: daysAgo(120) }));
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(/removed/i);
    expect(banner.textContent).toMatch(/invoices/i);
  });
});

describe("action", () => {
  it("offers reactivation", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    expect(await screen.findByRole("button", { name: /Reactivate/i })).toBeInTheDocument();
  });

  it("offers plan selection once purged, since there is nothing to reactivate", async () => {
    entMocks.loadEntitlement.mockResolvedValue(paid({ period_end: daysAgo(120) }));
    render(<Tree />);
    expect(await screen.findByRole("button", { name: /Choose a plan/i })).toBeInTheDocument();
  });

  it("cannot be dismissed", async () => {
    // Deliberate: dismissing a deletion deadline and then losing the data would
    // be indefensible.
    entMocks.loadEntitlement.mockResolvedValue(paid());
    render(<Tree />);
    const banner = await screen.findByRole("status");
    expect(banner.querySelector('[aria-label="Dismiss"]')).toBeNull();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
