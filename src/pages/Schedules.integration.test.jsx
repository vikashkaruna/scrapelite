// src/pages/Schedules.integration.test.jsx
// I-36..37 — Schedules page integration.
//
//   - I-36: Empty state has 'Create your first schedule' CTA
//   - I-37: A schedule renders with cadence + cron + next-run + Run now
//           + Pause/Resume toggles persist status to localStorage

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Schedules from "./Schedules.jsx";
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
      initialEntries={["/schedules"]}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Schedules />
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

describe("I-36 — Schedules: empty state + editor", () => {
  it("empty state shows 'No schedules yet' + 'New schedule' CTA", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/no schedules yet/i)).toBeInTheDocument();
    // The "New schedule" button shows up in both the header and the empty state.
    // We only need to confirm at least one is present.
    const buttons = screen.getAllByRole("button", { name: /new schedule/i });
    expect(buttons.length).toBeGreaterThan(0);
  });
});

describe("I-37 — Schedules: list + Pause/Resume", () => {
  it("a seeded schedule renders with Run now + Pause buttons", async () => {
    const sched = {
      id: "sch1",
      label: "Daily pricing check",
      type: "track",
      target: "https://example.com/pricing",
      cron: "0 9 * * *",
      intent: "summary",
      customPrompt: "",
      renderJs: false,
      paused: false,
      createdAt: "2026-07-15T10:00:00.000Z",
      lastFiredAt: null,
      nextRunAt: "2026-07-16T09:00:00.000Z",
    };
    localStorage.setItem("datiq.schedules", JSON.stringify([sched]));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // The schedule label is visible.
    expect(screen.getByText("Daily pricing check")).toBeInTheDocument();
    // Run now + Pause/Resume buttons are present.
    expect(screen.getByRole("button", { name: /run now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
  });

  it("clicking Pause persists status='paused' to localStorage", async () => {
    const sched = {
      id: "sch_pause",
      label: "Pause target",
      type: "track",
      target: "https://x.example.com",
      cron: "0 0 * * *",
      intent: "summary",
      status: "active",
      createdAt: "2026-07-15T10:00:00.000Z",
    };
    localStorage.setItem("datiq.schedules", JSON.stringify([sched]));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Find the Pause button in the schedule card.
    const pauseBtns = screen.getAllByRole("button", { name: /pause/i });
    act(() => pauseBtns[pauseBtns.length - 1].click());
    await act(async () => { await Promise.resolve(); });
    const stored = JSON.parse(localStorage.getItem("datiq.schedules"));
    // The schedule's status field flips to "paused" (not "paused: true").
    expect(stored[0].status).toBe("paused");
  });
});
