// Account.invoices.integration.test.jsx
//
// Covers the user-facing contract: invoices are listed in a table, clicking one
// opens the document with its itemized breakdown, and it can be downloaded.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Account from "./Account.jsx";
import { BillingProvider } from "../components/BillingProvider.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider } from "../components/PersonaProvider.jsx";
import { GuestTrialProvider } from "../components/GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
const billingRepoMocks = vi.hoisted(() => ({
  fetchInvoices: vi.fn(),
  fetchInvoiceLines: vi.fn(),
  claimBillingSession: vi.fn(() => Promise.resolve({ claimed: true })),
  getAuthUserId: vi.fn(() => Promise.resolve("u1")),
  fetchEntitlement: vi.fn(() => Promise.resolve(null)),
  fetchAdminGrantCoupon: vi.fn(() => Promise.resolve(null)),
  redeemAdminGrantCoupon: vi.fn(),
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
vi.mock("../lib/billingRepo.js", () => billingRepoMocks);
// Keep ALL exports the real module provides so the mock stays in sync
// as Account.jsx (or anything else) starts importing more of them. The
// 2026-08-10 incident that this test file was missing `isSupabaseEnabled`
// from the mock manifested as 6 simultaneous vitest failures — every
// render path that touched Account.jsx blew up at the `!isSupabaseEnabled`
// JSX check because the destructure left the binding undefined. Future-
// proof: spread the real module's exports and override only `supabase`.
vi.mock("../lib/supabaseClient.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) } },
  };
});

const INVOICE = {
  id: "inv-1",
  invoice_no: "DTQ/26-27/000123",
  doc_type: "tax_invoice",
  user_id: "u1",
  plan_id: "pro",
  billing_period: "annual",
  qty: 1,
  period_start: "2026-07-27T00:00:00Z",
  period_end: "2027-07-27T00:00:00Z",
  currency: "INR",
  gross_minor: 1798800,
  discount_minor: 359760,
  proration_credit_minor: 0,
  taxable_minor: 1439040,
  tax_rate: 0.18,
  tax_treatment: "intra",
  cgst_minor: 129513,
  sgst_minor: 129514,
  igst_minor: 0,
  tax_minor: 259027,
  total_minor: 1698067,
  place_of_supply: "Karnataka",
  status: "paid",
  refunded_minor: 0,
  issued_at: "2026-07-27T10:00:00Z",
  supplier_snapshot: { legal_name: "DatIQ Technologies", gstin: "29ABCDE1234F1Z5" },
  buyer_snapshot: { legal_name: "Acme Pvt Ltd" },
  provider: "razorpay",
  provider_payment_id: "pay_X",
};

const LINES = [
  { id: "l1", line_no: 1, kind: "plan", description: "Pro plan - annual, 12 months", hsn_sac: "998314", qty: 1, amount_minor: 1798800 },
  { id: "l2", line_no: 2, kind: "discount", description: "Coupon LAUNCH20 (-20%)", hsn_sac: null, qty: 1, amount_minor: -359760 },
];

function Tree() {
  return (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <Account />
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
  billingRepoMocks.fetchInvoices.mockResolvedValue([INVOICE]);
  billingRepoMocks.fetchInvoiceLines.mockResolvedValue(LINES);
});

describe("invoice history list", () => {
  it("lists invoices in a table with number, amount and status", async () => {
    render(<Tree />);
    const row = await screen.findByRole("button", { name: /View invoice DTQ\/26-27\/000123/i });
    expect(within(row).getByText("DTQ/26-27/000123")).toBeInTheDocument();
    // Total, formatted with Indian grouping and an ASCII currency code.
    expect(within(row).getByText("INR 16,980.67")).toBeInTheDocument();
    expect(within(row).getByText("paid")).toBeInTheDocument();
  });

  it("shows an explicit empty state when there are none", async () => {
    billingRepoMocks.fetchInvoices.mockResolvedValue([]);
    render(<Tree />);
    expect(await screen.findByText(/No invoices yet/i)).toBeInTheDocument();
    expect(screen.getByText(/emailed to you automatically/i)).toBeInTheDocument();
  });
});

describe("opening an invoice", () => {
  it("opens the document with its itemized breakdown when the row is clicked", async () => {
    const user = userEvent.setup();
    render(<Tree />);
    await user.click(await screen.findByRole("button", { name: /View invoice/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Tax Invoice")).toBeInTheDocument();

    // Itemisation (requirement 4): the plan line AND the coupon line.
    expect(await within(dialog).findByText("Pro plan - annual, 12 months")).toBeInTheDocument();
    expect(within(dialog).getByText("Coupon LAUNCH20 (-20%)")).toBeInTheDocument();

    // Tax breakdown, split for an intra-state supply.
    expect(within(dialog).getByText("CGST @ 9%")).toBeInTheDocument();
    expect(within(dialog).getByText("SGST @ 9%")).toBeInTheDocument();
    expect(within(dialog).getByText("Total paid")).toBeInTheDocument();
  });

  it("offers download and email actions", async () => {
    const user = userEvent.setup();
    render(<Tree />);
    await user.click(await screen.findByRole("button", { name: /View invoice/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Download PDF/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Email to me/i })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Tree />);
    await user.click(await screen.findByRole("button", { name: /View invoice/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("is reachable by keyboard", async () => {
    const user = userEvent.setup();
    render(<Tree />);
    const row = await screen.findByRole("button", { name: /View invoice/i });
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
