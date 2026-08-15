// src/components/ConsentBanner.test.jsx
// The auto-hide behavior is the safety-critical part: it must NEVER call
// setConsent(), or an ignored prompt would silently become "denied" forever
// with no way for the visitor to notice. See the invariant documented in
// ConsentBanner.jsx itself.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ConsentBanner from "./ConsentBanner.jsx";
import { hasChosen } from "../lib/consentService.js";

vi.mock("../lib/apiClient.js", () => ({
  apiClient: {
    recordConsent: vi.fn().mockResolvedValue({ ok: true }),
    linkConsent: vi.fn().mockResolvedValue({ ok: true, linked: true }),
    withdrawConsent: vi.fn().mockResolvedValue({ ok: true, deleted: 0 }),
  },
}));

function renderBanner() {
  return render(
    <MemoryRouter>
      <ConsentBanner />
    </MemoryRouter>
  );
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  window.__datiqConsent = { set: vi.fn(), clientId: (cb) => cb("GA1.1.test") };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConsentBanner", () => {
  it("renders the prompt when no choice has been recorded yet", () => {
    renderBanner();
    expect(screen.getByRole("region", { name: /cookie and analytics consent/i })).toBeInTheDocument();
    expect(hasChosen()).toBe(false);
  });

  it("clicking Allow records GRANTED and hides the banner", () => {
    renderBanner();
    fireEvent.click(screen.getByText("Allow analytics"));
    expect(hasChosen()).toBe(true);
    expect(screen.queryByRole("region", { name: /cookie and analytics consent/i })).not.toBeInTheDocument();
  });

  it("clicking Decline records DENIED and hides the banner", () => {
    renderBanner();
    fireEvent.click(screen.getByText("Decline analytics"));
    expect(hasChosen()).toBe(true);
    expect(screen.queryByRole("region", { name: /cookie and analytics consent/i })).not.toBeInTheDocument();
  });

  it("auto-hides after 20s of no interaction WITHOUT recording a choice", () => {
    renderBanner();
    expect(screen.getByRole("region", { name: /cookie and analytics consent/i })).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(20_000); });

    expect(screen.queryByRole("region", { name: /cookie and analytics consent/i })).not.toBeInTheDocument();
    // This is the invariant: auto-hide is purely visual.
    expect(hasChosen()).toBe(false);
  });

  it("does not auto-hide before 20s", () => {
    renderBanner();
    act(() => { vi.advanceTimersByTime(19_000); });
    expect(screen.getByRole("region", { name: /cookie and analytics consent/i })).toBeInTheDocument();
  });

  it("clicking a button before the timer fires cancels the auto-hide timer cleanly", () => {
    renderBanner();
    fireEvent.click(screen.getByText("Allow analytics"));
    // Advancing timers after unmount must not throw (timer was cleared).
    expect(() => act(() => { vi.advanceTimersByTime(30_000); })).not.toThrow();
  });

  it("renders nothing when a choice was already recorded before mount", () => {
    localStorage.setItem("datiq.consent", JSON.stringify({
      analytics: "granted", ts: new Date().toISOString(), policyVersion: "test", version: 1,
    }));
    renderBanner();
    expect(screen.queryByRole("region", { name: /cookie and analytics consent/i })).not.toBeInTheDocument();
  });
});
