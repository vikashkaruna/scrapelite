// src/__tests__/system/hard-block-reload.test.jsx
// S-02 — A reload must not hand an over-limit guest a fresh allowance.
//
// This originally asserted that the hard block DIALOG rendered on first render,
// guarding the R17 regression where it only appeared after an extraction
// attempt. That was the right guard at the time for the wrong-looking reason:
// back then four extraction paths (batch Retry, schedule Run-now, the battle
// card, quick-enrich) never called the gate at all, so "only on attempt"
// really did mean "sometimes never", and mount-time visibility was papering
// over it.
//
// requireGuestCredit() now runs on every entry point, so the dialog enforces
// nothing at mount — it can be closed, and closing grants nothing. What must
// survive a reload is the ENFORCEMENT, which is what these tests assert now.
// The interstitial-on-page-load was dropped deliberately: it hit someone who
// had just opened the site and done nothing, which is the worst moment to ask
// them to sign up. See the note in GuestTrialProvider.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AppProviders } from "../harness/AppProviders.jsx";
import { useGuestTrial } from "../../components/GuestTrialProvider.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
});

function Probe() {
  const { showHardBlock, hardBlockReason, count, requireGuestCredit } = useGuestTrial();
  return (
    <div>
      <span data-testid="showHardBlock">{String(showHardBlock)}</span>
      <span data-testid="hardBlockReason">{hardBlockReason}</span>
      <span data-testid="count">{count}</span>
      <button data-testid="gateSingle" onClick={() => requireGuestCredit("single")}>single</button>
      <button data-testid="gateBatch" onClick={() => requireGuestCredit("batch")}>batch</button>
    </div>
  );
}

function mount() {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
}

describe("S-02 — a reload does not reset the guest gate", () => {
  it("count=10 survives a reload: refused on the first attempt, dialog raised", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 10, batchCount: 0, sid: "s1",
    }));
    mount();
    await act(async () => { await Promise.resolve(); });

    // The count is restored...
    expect(screen.getByTestId("count").textContent).toBe("10");
    // ...but no interstitial is thrown at someone who has done nothing yet.
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");

    // The gate is what carries across the reload.
    act(() => screen.getByTestId("gateSingle").click());
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("single");
  });

  it("count=9 → below the limit, the attempt is allowed", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 9, batchCount: 0, sid: "s1",
    }));
    mount();
    await act(async () => { await Promise.resolve(); });
    act(() => screen.getByTestId("gateSingle").click());
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");
  });

  it("batchCount=5 survives a reload and refuses with reason 'batch'", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 0, batchCount: 5, sid: "s1",
    }));
    mount();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");

    act(() => screen.getByTestId("gateBatch").click());
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("batch");
  });

  it("an exhausted batch allowance does not close the single-URL path", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 0, batchCount: 5, sid: "s1",
    }));
    mount();
    await act(async () => { await Promise.resolve(); });
    act(() => screen.getByTestId("gateSingle").click());
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");
  });
});
