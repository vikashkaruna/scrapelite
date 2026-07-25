// src/pages/Contact.integration.test.jsx
// I-41 — Contact form integration.
//
//   - ?type=bug → "Bug report" pre-selected, subject pre-filled "Bug report: "
//   - Submit delivers through contactService (Resend), not a mailto: window
//   - Enquiry type drives which of the two inboxes the form shows and routes to
//   - A delivery failure surfaces a mailto: fallback instead of a dead end

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Contact from "./Contact.jsx";
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

const contactMocks = vi.hoisted(() => ({
  submitContactForm: vi.fn(),
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

vi.mock("../lib/contactService.js", () => contactMocks);

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
  contactMocks.submitContactForm.mockResolvedValue({
    ok: true, inbox: "hello", routeTo: "hello@datiq.app",
  });
  // Stub window.open so nothing tries to open a real window.
  vi.spyOn(window, "open").mockImplementation(() => null);
  window.history.replaceState(null, "", window.location.pathname);
});

/** Fill the two required fields and press Send. */
async function fillAndSend({ email = "alice@example.com", message = "Please help with X." } = {}) {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/message/i), { target: { value: message } });
  await act(async () => {
    screen.getByRole("button", { name: /send message/i }).click();
    await Promise.resolve();
  });
}

function Tree({ initialPath = "/contact" }) {
  return (
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Contact />
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

describe("I-41 — Contact form", () => {
  it("?type=bug → 'Bug report' pre-selected, subject pre-filled 'Bug report: '", async () => {
    render(<Tree initialPath="/contact?type=bug" />);
    await act(async () => { await Promise.resolve(); });
    // The Bug report type button is the selected one (aria-pressed or class).
    const bugBtn = screen.getByRole("button", { name: /bug report/i });
    expect(bugBtn).toBeInTheDocument();
    expect(bugBtn.className).toMatch(/active|on|selected/);
    // Subject input is pre-filled.
    const subjectInput = screen.getByLabelText(/subject/i);
    expect(subjectInput.value).toMatch(/^Bug report:/);
  });

  it("default type (no query param) → 'Support' is the pre-selected type", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    const supportBtn = screen.getByRole("button", { name: /support/i });
    expect(supportBtn.className).toMatch(/active|on|selected/);
  });

  it("?type=privacy → 'Privacy & DPDP' pre-selected and routed to admin@datiq.app", async () => {
    render(<Tree initialPath="/contact?type=privacy" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: /privacy & dpdp/i }).className)
      .toMatch(/active|on|selected/);
    expect(screen.getByText(/goes to/i).textContent).toContain("admin@datiq.app");
  });

  it("an unknown ?type falls back to the default rather than breaking the form", async () => {
    render(<Tree initialPath="/contact?type=refund" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: /product support/i }).className)
      .toMatch(/active|on|selected/);
  });

  it("switching enquiry type updates the destination inbox shown to the user", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/goes to/i).textContent).toContain("hello@datiq.app");

    await act(async () => {
      screen.getByRole("button", { name: /enterprise \/ agency/i }).click();
    });
    expect(screen.getByText(/goes to/i).textContent).toContain("admin@datiq.app");
  });

  it("the sidebar lists both inboxes and no retired address", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    const html = document.body.innerHTML;
    expect(html).toContain("hello@datiq.app");
    expect(html).toContain("admin@datiq.app");
    for (const retired of ["support@datiq.app", "legal@datiq.app", "privacy@datiq.app"]) {
      expect(html).not.toContain(retired);
    }
  });

  it("submitting delivers through contactService and shows the success state", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    await fillAndSend();

    expect(contactMocks.submitContactForm).toHaveBeenCalledWith({
      type: "support",
      name: "",
      email: "alice@example.com",
      subject: "",
      message: "Please help with X.",
    });
    expect(screen.getByText(/message received/i)).toBeInTheDocument();
    // Server-side Resend delivery replaces the old mailto: hand-off.
    expect(window.open).not.toHaveBeenCalled();
  });

  it("submitting a legal enquiry routes it to the admin inbox", async () => {
    contactMocks.submitContactForm.mockResolvedValue({
      ok: true, inbox: "admin", routeTo: "admin@datiq.app",
    });
    render(<Tree initialPath="/contact?type=legal" />);
    await act(async () => { await Promise.resolve(); });
    await fillAndSend();
    expect(contactMocks.submitContactForm.mock.calls[0][0].type).toBe("legal");
  });

  it("a delivery failure shows the error plus a mailto: fallback link", async () => {
    contactMocks.submitContactForm.mockResolvedValue({
      ok: false,
      inbox: "hello",
      routeTo: "hello@datiq.app",
      error: "Invalid Access Key",
      mailto: "mailto:hello@datiq.app?subject=x&body=y",
    });
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    await fillAndSend();

    const errorEl = screen.getByText(/invalid access key/i);
    expect(errorEl).toBeInTheDocument();
    expect(screen.queryByText(/message received/i)).not.toBeInTheDocument();
    // Scope to the error paragraph — the sidebar also links hello@datiq.app.
    const link = errorEl.closest(".contact-error").querySelector("a");
    expect(link.getAttribute("href")).toBe("mailto:hello@datiq.app?subject=x&body=y");
  });

  it("does not submit when required fields are empty", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: /send message/i })).toBeDisabled();
    expect(contactMocks.submitContactForm).not.toHaveBeenCalled();
  });
});

// Local import to keep the test file self-contained.
import { fireEvent } from "@testing-library/react";
