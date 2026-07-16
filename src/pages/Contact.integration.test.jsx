// src/pages/Contact.integration.test.jsx
// I-41 — Contact form integration.
//
//   - ?type=bug → "Bug report" pre-selected, subject pre-filled "Bug report: "
//   - Submit opens a mailto: link (the form's primary delivery)

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

const emailCaptureMocks = vi.hoisted(() => ({
  captureEmail: vi.fn(() => Promise.resolve()),
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

vi.mock("../lib/emailCaptureService.js", () => emailCaptureMocks);

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
  // Stub window.open so the mailto: click doesn't open a real window.
  vi.spyOn(window, "open").mockImplementation(() => null);
  window.history.replaceState(null, "", window.location.pathname);
});

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

  it("submitting the form with email + message calls captureEmail + opens a mailto: window", async () => {
    render(<Tree initialPath="/contact" />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "alice@example.com" } });
    fireEvent.change(screen.getByLabelText(/message/i), { target: { value: "Please help with X." } });
    act(() => {
      screen.getByRole("button", { name: /send message/i }).click();
    });
    await act(async () => { await Promise.resolve(); });
    expect(emailCaptureMocks.captureEmail).toHaveBeenCalledWith("alice@example.com", expect.stringMatching(/contact-form/));
    expect(window.open).toHaveBeenCalled();
    const openArg = window.open.mock.calls[0][0];
    expect(openArg).toMatch(/^mailto:/);
  });
});

// Local import to keep the test file self-contained.
import { fireEvent } from "@testing-library/react";
