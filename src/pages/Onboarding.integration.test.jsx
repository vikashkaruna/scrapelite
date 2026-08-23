// src/pages/Onboarding.integration.test.jsx
// I-40 — Onboarding persona flow integration.
//
//   - Step 1 renders the persona cards (7 of them)
//   - Selecting a persona → it becomes visually selected
//   - "Skip for now" navigates home without picking a persona

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import Onboarding from "./Onboarding.jsx";
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
      initialEntries={["/onboarding"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Routes>
                      <Route path="/onboarding" element={<Onboarding />} />
                      <Route path="/" element={<div data-testid="home">home</div>} />
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

describe("I-40 — Onboarding: persona flow", () => {
  it("renders the persona picker (step 1) with 7 persona cards", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // 7 persona cards (PERSONAS array in personaConfig.js).
    const cards = document.querySelectorAll(".ob-card");
    expect(cards.length).toBe(7);
  });

  it("clicking a persona card selects it (aria-pressed=true)", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const firstCard = document.querySelector(".ob-card");
    expect(firstCard.getAttribute("aria-pressed")).toBe("false");
    act(() => firstCard.click());
    expect(firstCard.getAttribute("aria-pressed")).toBe("true");
  });

  it("'Skip for now' link is present and navigates to home", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const skip = screen.getByText(/skip for now/i);
    expect(skip).toBeInTheDocument();
    act(() => skip.click());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});
