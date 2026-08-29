// src/pages/NotFound.integration.test.jsx
// I-48 — NotFound 404 page integration.
//
//   - Renders the 404 copy + brand-consistent actions at an unknown route.
//   - Provides quick-link destinations for the most common routes.
//   - The "Back to DatIQ" link returns to /.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import NotFound from "./NotFound.jsx";
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

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

const usageRepoMocks = vi.hoisted(() => ({
  fetchUsageFromDb: vi.fn(() => Promise.resolve(null)),
  fetchSubscriptionFromDb: vi.fn(() => Promise.resolve(null)),
  fetchPaymentHistory: vi.fn(() => Promise.resolve([])),
  syncUsageToDb: vi.fn(() => Promise.resolve()),
  syncSubscriptionToDb: vi.fn(() => Promise.resolve()),
  logPaymentEvent: vi.fn(() => Promise.resolve()),
  getSessionId: vi.fn(() => "sess_test"),
}));

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

function Tree({ initialPath = "/totally-bogus" }) {
  return (
    <MemoryRouter
      initialEntries={[initialPath]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Routes>
                      <Route path="/known" element={<div>known</div>} />
                      <Route path="*" element={<NotFound />} />
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

describe("I-48 — NotFound", () => {
  it("renders the 404 eyebrow + title at an unknown route", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/404 — Page not found/i)).toBeInTheDocument();
    expect(screen.getByText(/we could not find that page/i)).toBeInTheDocument();
  });

  it("renders the brand-consistent 'Back to DatIQ' CTA", () => {
    render(<Tree />);
    expect(screen.getByRole("link", { name: /back to datIQ/i })).toBeInTheDocument();
  });

  it("renders the 6 quick-link destinations", () => {
    render(<Tree />);
    // Scope to the .notfound-links list to avoid matching the "Open
    // dashboard" CTA button in .notfound-actions.
    const list = document.querySelector(".notfound-links");
    expect(list).not.toBeNull();
    expect(list.textContent).toMatch(/extract a page/i);
    expect(list.textContent).toMatch(/open dashboard/i);
    expect(list.textContent).toMatch(/run a batch/i);
    expect(list.textContent).toMatch(/schedules/i);
    expect(list.textContent).toMatch(/pricing/i);
    expect(list.textContent).toMatch(/contact support/i);
  });

  it("does not render for a known route (router-level catch-all)", () => {
    render(<Tree initialPath="/known" />);
    expect(screen.getByText("known")).toBeInTheDocument();
    expect(screen.queryByText(/we could not find that page/i)).toBeNull();
  });
});
