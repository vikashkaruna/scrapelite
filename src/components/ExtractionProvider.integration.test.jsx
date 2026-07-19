// src/components/ExtractionProvider.integration.test.jsx
// I-11 — ExtractionProvider pre-flight check integration.
//
//   - When guest is at the single-URL hard limit, extract() is a no-op:
//     checkCanExtractSingle().allowed === false → setShowHardBlock(true)
//     fires, extractStructure is NOT called, no /preview navigation.
//   - When the user is logged in, the pre-flight check is bypassed (logged-in
//     users don't consume trial credits).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ExtractionProvider, useExtraction } from "./ExtractionProvider.jsx";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { PersonaProvider } from "./PersonaProvider.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { GuestTrialProvider, useGuestTrial } from "./GuestTrialProvider.jsx";

const firecrawlMocks = vi.hoisted(() => ({
  extractStructure: vi.fn(),
}));

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

vi.mock("../lib/firecrawlService.js", () => ({
  extractStructure: firecrawlMocks.extractStructure,
  mapDomain: vi.fn(),
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

const TRIAL_KEY = "datiq.guestTrial";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  firecrawlMocks.extractStructure.mockResolvedValue({
    url: "https://x.example.com",
    html: "<html></html>",
    metadata: { title: "X" },
    headings: [],
    links: [],
    domain_map: null,
  });
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <Probe />
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

function Probe() {
  const { extract, loading } = useExtraction();
  const { showHardBlock, hardBlockReason, checkCanExtractSingle } = useGuestTrial();
  const { pathname } = useLocation();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="showHardBlock">{String(showHardBlock)}</span>
      <span data-testid="hardBlockReason">{hardBlockReason}</span>
      <span data-testid="canSingle">{String(checkCanExtractSingle().allowed)}</span>
      <span data-testid="pathname">{pathname}</span>
      <button data-testid="extract" onClick={() => extract("https://x.example.com")}>
        extract
      </button>
    </div>
  );
}

describe("I-11 — ExtractionProvider: pre-flight guest hard block", () => {
  it("guest at the single-URL hard limit → extract() is a no-op (no extractStructure call, no /preview navigation)", async () => {
    // Pre-seed the count at the hard limit.
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 10, batchCount: 0, sid: "s1" }));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });

    // Pre-flight reports not allowed.
    expect(screen.getByTestId("canSingle").textContent).toBe("false");
    // Hard block is mounted.
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("single");

    // Click extract — should be a no-op.
    await act(async () => {
      screen.getByTestId("extract").click();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).not.toHaveBeenCalled();
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });

  it("guest below the hard limit → extract() proceeds", async () => {
    localStorage.setItem(TRIAL_KEY, JSON.stringify({ count: 0, batchCount: 0, sid: "s1" }));
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("canSingle").textContent).toBe("true");
    await act(async () => {
      screen.getByTestId("extract").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(firecrawlMocks.extractStructure).toHaveBeenCalled();
  });
});
