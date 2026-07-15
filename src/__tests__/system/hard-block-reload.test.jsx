// src/__tests__/system/hard-block-reload.test.jsx
// S-02 — When datiq.guestTrial.count >= SINGLE_HARD_LIMIT in localStorage at
// mount time, the GuestTrialProvider renders the hard block on first render
// (before any user action). Catches the R17 regression where the hard block
// only mounted after the user attempted an extraction.

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
  const { showHardBlock, hardBlockReason, count } = useGuestTrial();
  return (
    <div>
      <span data-testid="showHardBlock">{String(showHardBlock)}</span>
      <span data-testid="hardBlockReason">{hardBlockReason}</span>
      <span data-testid="count">{count}</span>
    </div>
  );
}

describe("S-02 — Hard block mounts on reload when count >= hard limit", () => {
  it("count=10 in localStorage → showHardBlock=true on first render", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 10, batchCount: 0, sid: "s1",
    }));
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("count").textContent).toBe("10");
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("single");
  });

  it("count=9 → no hard block (below limit)", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 9, batchCount: 0, sid: "s1",
    }));
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("showHardBlock").textContent).toBe("false");
  });

  it("batchCount=5 → hard block with reason 'batch'", async () => {
    localStorage.setItem("datiq.guestTrial", JSON.stringify({
      count: 0, batchCount: 5, sid: "s1",
    }));
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("showHardBlock").textContent).toBe("true");
    expect(screen.getByTestId("hardBlockReason").textContent).toBe("batch");
  });
});
