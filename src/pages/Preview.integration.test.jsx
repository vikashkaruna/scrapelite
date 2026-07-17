// src/pages/Preview.integration.test.jsx
// I-35 — Preview page integration.
//
//   - Download ▾ opens CSV / PDF / Markdown / JSON options
//   - "View Dashboard" is the primary action
//   - "Delete" removes the extraction and navigates back to /

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import Preview from "./Preview.jsx";
import { ExtractionProvider, useExtraction } from "../components/ExtractionProvider.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider } from "../components/PersonaProvider.jsx";
import { BillingProvider } from "../components/BillingProvider.jsx";
import { GuestTrialProvider } from "../components/GuestTrialProvider.jsx";
import { buildExtraction } from "../../test/fixtures/buildExtraction.js";

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

const apiMocks = vi.hoisted(() => ({
  listExtractions: vi.fn(() => Promise.resolve([])),
  saveExtraction: vi.fn(() => Promise.resolve({ id: "ext_x" })),
  patchExtraction: vi.fn(() => Promise.resolve()),
  deleteExtraction: vi.fn(() => Promise.resolve()),
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

function Seeder({ item }) {
  // Seed the ExtractionProvider's "current" via the public commit path
  // by saving to extractionsRepo first; the provider auto-loads on mount.
  // For Preview to show the item, we set current via localStorage + reload.
  return null;
}

function Tree({ item }) {
  if (item) {
    localStorage.setItem("datiq.current", JSON.stringify(item));
  }
  return (
    <MemoryRouter
      initialEntries={["/preview"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Routes>
                      <Route path="/preview" element={<Preview />} />
                      <Route path="/" element={<div data-testid="home">home</div>} />
                      <Route path="/dashboard" element={<div data-testid="dashboard">dashboard</div>} />
                    </Routes>
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

describe("I-35 — Preview: action bar", () => {
  it("renders 'View Dashboard' as the primary action", async () => {
    const item = buildExtraction({ id: "ext_p1", title: "Pricing — Example" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    const view = screen.getByRole("button", { name: /view dashboard/i });
    expect(view).toBeInTheDocument();
  });

  it("Download ▾ opens a menu with CSV / PDF / Markdown / JSON options (plus a Copy section)", async () => {
    const item = buildExtraction({ id: "ext_p2" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    // Open the Download dropdown.
    const dl = screen.getByRole("button", { name: /download/i });
    act(() => fireEvent.click(dl));
    await act(async () => { await Promise.resolve(); });
    // The download section's items render (4 formats).
    expect(screen.getByText(/^CSV$/i)).toBeInTheDocument();
    expect(screen.getByText(/^PDF$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Markdown$/i)).toBeInTheDocument();
    expect(screen.getByText(/^JSON$/i)).toBeInTheDocument();
    // F01 — Copy section header is also present.
    expect(screen.getByText(/Copy to clipboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Copy summary/i)).toBeInTheDocument();
  });

  it("'Delete' returns the user to /", async () => {
    const item = buildExtraction({ id: "ext_p3" });
    render(<Tree item={item} />);
    await act(async () => { await Promise.resolve(); });
    const delBtn = screen.getByRole("button", { name: /delete/i });
    act(() => fireEvent.click(delBtn));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});
