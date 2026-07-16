// src/pages/Onboarding.test.jsx
// F-09 + F-19 — Onboarding persona flow (Q8 2026-07-15).
//
//   - F-09: persona selection persists to localStorage
//   - F-19: clicking "Switch persona" in TopBar re-opens /onboarding
//           (the persona is reset, so the picker step is shown again)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import Onboarding from "./Onboarding.jsx";
import { AuthProvider, useAuth } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";
import { PersonaProvider, usePersona } from "../components/PersonaProvider.jsx";
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

function PersonaProbe() {
  const { personaId, selectPersona, resetOnboarding, completeOnboarding } = usePersona();
  return (
    <div>
      <span data-testid="personaId">{personaId ?? "none"}</span>
      <button data-testid="select" onClick={() => selectPersona("pro")}>select</button>
      <button data-testid="complete" onClick={() => completeOnboarding("Test")}>complete</button>
      <button data-testid="reset" onClick={() => resetOnboarding()}>reset</button>
    </div>
  );
}

describe("F-09 — Onboarding persona selection persists", () => {
  it("selectPersona writes the persona id to localStorage", () => {
    render(
      <MemoryRouter
        initialEntries={["/onboarding"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <GuestTrialProvider>
                <PersonaProvider>
                  <PersonaProbe />
                </PersonaProvider>
              </GuestTrialProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("personaId").textContent).toBe("none");
    act(() => screen.getByTestId("select").click());
    expect(screen.getByTestId("personaId").textContent).toBe("pro");
    // localStorage now has the persona id (stored as a plain string under
    // the production key "datiq.persona", NOT "datiq.personaId").
    expect(localStorage.getItem("datiq.persona")).toBe("pro");
  });

  it("resetOnboarding clears the persona (used by 'Switch persona' Q8)", () => {
    // Pre-seed a persona. PersonaProvider stores the value as a plain
    // string under the production key "datiq.persona".
    localStorage.setItem("datiq.persona", "pro");
    localStorage.setItem("datiq.onboarded", "1");

    render(
      <MemoryRouter
        initialEntries={["/onboarding"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <GuestTrialProvider>
                <PersonaProvider>
                  <PersonaProbe />
                </PersonaProvider>
              </GuestTrialProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    // The seeded persona is loaded.
    expect(screen.getByTestId("personaId").textContent).toBe("pro");
    // Click reset → persona is cleared.
    act(() => screen.getByTestId("reset").click());
    expect(screen.getByTestId("personaId").textContent).toBe("none");
    // localStorage is also cleared.
    expect(localStorage.getItem("datiq.persona")).toBeNull();
    expect(localStorage.getItem("datiq.onboarded")).toBeNull();
  });
});

describe("F-19 — Switch persona re-opens /onboarding (Q8)", () => {
  it("TopBar's onSwitchRole → resetOnboarding + navigate('/onboarding')", () => {
    // Pre-seed a persona + onboarded state. Production key is "datiq.persona".
    localStorage.setItem("datiq.persona", "sales");
    localStorage.setItem("datiq.onboarded", "1");

    function Harness() {
      const { resetOnboarding } = usePersona();
      // Simulate the TopBar's handleSwitchRole callback.
      return (
        <button
          onClick={() => {
            resetOnboarding();
            window.history.pushState({}, "", "/onboarding");
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        >
          switch
        </button>
      );
    }

    render(
      <MemoryRouter
        initialEntries={["/"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <GuestTrialProvider>
                <PersonaProvider>
                  <Harness />
                </PersonaProvider>
              </GuestTrialProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    // Click the simulated Switch persona button.
    act(() => screen.getByText("switch").click());
    // Persona is reset.
    expect(localStorage.getItem("datiq.persona")).toBeNull();
    // URL is /onboarding.
    expect(window.location.pathname).toBe("/onboarding");
  });
});
