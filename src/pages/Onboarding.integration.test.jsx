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
import { PERSONAS } from "../lib/personaConfig.js";
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
                      <Route path="/templates" element={<div data-testid="templates">templates</div>} />
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

describe("I-40 — Onboarding: role flow (face-lift, 2026-09-24)", () => {
  const cards = () => [...document.querySelectorAll(".ob-role")];

  it("renders the 8 roles as a radio group, each showing its primary job", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("heading", { level: 1, name: /What do you want DatIQ to do for you/i })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /your role/i })).toBeInTheDocument();
    expect(cards()).toHaveLength(8);
    expect(cards().map((c) => c.querySelector(".ob-role-label").textContent)).toEqual(PERSONAS.map((p) => p.label));
    for (const [i, p] of PERSONAS.entries()) expect(cards()[i]).toHaveTextContent(p.job);
  });

  it("before a role is picked, the panel shows DatIQ at a glance", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/DatIQ at a glance/i)).toBeInTheDocument();
  });

  it("picking a role opens its detail: jobs with modules, modules, outcome, first step", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const seo = PERSONAS.find((p) => p.id === "seo");
    const card = cards()[PERSONAS.indexOf(seo)];
    act(() => card.click());
    expect(card.getAttribute("aria-checked")).toBe("true");
    const panel = document.getElementById("ob-role-detail");
    for (const j of seo.jobs) expect(panel).toHaveTextContent(j.text);
    expect(panel).toHaveTextContent(seo.outcome);
    expect(panel).toHaveTextContent("Discover");
    expect(screen.getByRole("button", { name: new RegExp(seo.firstStep.label, "i") })).toBeInTheDocument();
    expect(localStorage.getItem("datiq.persona")).toBe("seo");
  });

  it("arrow keys move the selection like a native radio set", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    act(() => cards()[0].click());
    act(() => { cards()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(cards()[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(cards()[1]);
  });

  it("step 2 lists the first three steps and finishes on the role's first step", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    act(() => cards()[0].click()); // sales
    act(() => screen.getByRole("button", { name: /^Continue/ }).click());
    expect(screen.getByRole("heading", { name: /Your first three steps/i })).toBeInTheDocument();
    const sales = PERSONAS[0];
    for (const j of sales.jobs.slice(0, 3)) expect(screen.getByText(j.text)).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: new RegExp(`^${sales.firstStep.label}`) }).click());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("templates")).toBeInTheDocument();
    expect(localStorage.getItem("datiq.onboarded")).toBe("1");
    expect(localStorage.getItem("datiq.starterPack")).toBe(sales.starterPack);
  });

  it("a legacy recruiter sees no role pre-selected rather than an error", async () => {
    localStorage.setItem("datiq.persona", "recruiter");
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(cards().some((c) => c.getAttribute("aria-checked") === "true")).toBe(false);
  });

  it("a stored market-research role opens as Founder, VC & Market Research", async () => {
    localStorage.setItem("datiq.persona", "market-research");
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const i = PERSONAS.findIndex((p) => p.id === "founder-vc");
    expect(cards()[i].getAttribute("aria-checked")).toBe("true");
  });

  it("'Skip for now' is present and navigates to home", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    const skip = screen.getByText(/skip for now/i);
    act(() => skip.click());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("home")).toBeInTheDocument();
  });
});
