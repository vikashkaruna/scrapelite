// src/__tests__/system/plan-upgrade.test.jsx
// S-04 — Upgrading the plan (free → select) does NOT reset datiq.usage.
// The monthly counter is preserved across the upgrade.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { AppProviders } from "../harness/AppProviders.jsx";
import { useBilling } from "../../components/BillingProvider.jsx";

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

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

vi.mock("../../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../../lib/paymentRepo.js", () => usageRepoMocks);

vi.mock("../../lib/globalSettingsService.js", () => ({
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

// Mirrors the private monthKey() format in usageService.js ("YYYY-MM") — the
// seeded row must match whatever the real wall clock resolves to when the
// test runs, not a fixed month string (regression: a hardcoded "2026-07" key
// silently stopped matching the moment the calendar rolled into August).
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  // Seed the monthly usage counter BEFORE render so the BillingProvider's
  // useState initializer reads the seeded value.
  const mk = currentMonthKey();
  const raw = { [mk]: { month: mk, extractions: 7, enrichments: {}, batchRuns: 0, contentGenerations: 0 } };
  localStorage.setItem("datiq.usage", JSON.stringify(raw));
  window.history.replaceState(null, "", window.location.pathname);
});

function Probe() {
  const { planId, usage, upgradePlan } = useBilling();
  return (
    <div>
      <span data-testid="planId">{planId}</span>
      <span data-testid="extractions">{usage?.extractions ?? 0}</span>
      <button data-testid="upgrade" onClick={() => upgradePlan("select")}>Upgrade</button>
    </div>
  );
}

describe("S-04 — Plan upgrade does NOT reset datiq.usage", () => {
  it("after upgradePlan('select'), the extractions counter is preserved", async () => {
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("planId").textContent).toBe("free");
    expect(screen.getByTestId("extractions").textContent).toBe("7");
    // Click upgrade.
    act(() => screen.getByTestId("upgrade").click());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("planId").textContent).toBe("select");
    // Usage counter is preserved (still 7).
    expect(screen.getByTestId("extractions").textContent).toBe("7");
  });
});
