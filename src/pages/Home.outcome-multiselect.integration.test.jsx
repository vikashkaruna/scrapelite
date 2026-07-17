// src/pages/Home.outcome-multiselect.integration.test.jsx — Q3 multi-select on Home.
// Verifies the real user flow: clicking 2 outcome tiles appends their prompts,
// the intent chip auto-switches to "custom", and Clear removes everything.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AppProviders } from "../__tests__/harness/AppProviders.jsx";
import Home from "./Home.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

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
vi.mock("../lib/supabaseClient.js", () => ({
  supabase: null,
  isSupabaseEnabled: false,
  EXTRACTIONS_TABLE: "extractions",
}));
vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    getUserInitials: () => "QA",
    getUserAvatar: () => null,
    getUserDisplayName: (u) => u?.email?.split("@")[0] || "QA",
  };
});
vi.mock("../lib/usageRepo.js", () => usageRepoMocks);
vi.mock("../lib/paymentRepo.js", () => usageRepoMocks);

beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch {}
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockImplementation(() => () => {});
  global.fetch = vi.fn((url) => {
    if (String(url).includes("/api/og-preview")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: false });
  });
});

function renderHome() {
  return render(
    <AppProviders initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </AppProviders>,
  );
}

// Look up the outcome tile by title INSIDE the .outcome-tile container so
// we don't accidentally hit a capability card (which can have overlapping
// titles like "Scrape pricing").
function outcomeTile(title) {
  const container = document.querySelector(".outcome-tiles");
  return Array.from(container.querySelectorAll(".outcome-tile"))
    .find((el) => el.textContent.includes(title));
}

describe("Q3 multi-select — outcome tiles append + intent + clear", () => {
  it("does NOT show the duplicate 'Add multiple URLs' reveal on Home", () => {
    renderHome();
    // The duplicate multi-URL reveal was removed. The /batch page is the
    // only place for multi-URL extraction. The smart composer auto-detects
    // multi-URL input and routes to /batch (covered by Q1 tests).
    expect(screen.queryByText(/^Add multiple URLs$/i)).toBeNull();
    expect(screen.queryByText(/^Extract many URLs$/i)).toBeNull();
  });

  it("clicking a single outcome tile activates it and switches intent to custom", async () => {
    renderHome();
    const tile = outcomeTile(OUTCOME_TILES[0].title);
    fireEvent.click(tile);
    // After click, the tile is aria-pressed
    expect(tile).toHaveAttribute("aria-pressed", "true");
    // The intent chip auto-switched to "Custom" (find the one inside the
    // intent-chips container, not the outcome tile that also has "Custom…")
    const customChip = document.querySelector(".intent-chips .intent-chip:last-child");
    expect(customChip).toHaveClass("intent-chip-active");
  });

  it("clicking a second outcome tile APPENDS its prompt (does not overwrite)", () => {
    renderHome();
    const first  = outcomeTile(OUTCOME_TILES[0].title);
    const second = outcomeTile(OUTCOME_TILES[1].title);
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "true");
    // The combined prompt is BOTH tile prompts joined by \n\n
    const customTa = document.querySelector(".custom-extract-input") || document.querySelector("textarea");
    const combined = customTa ? customTa.value : "";
    expect(combined).toContain(OUTCOME_TILES[0].prompt);
    expect(combined).toContain(OUTCOME_TILES[1].prompt);
  });

  it("clicking an active tile again DEACTIVATES it (removes its prompt)", () => {
    renderHome();
    const first = outcomeTile(OUTCOME_TILES[0].title);
    fireEvent.click(first);
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "false");
    const customTa = document.querySelector(".custom-extract-input, [aria-label*='custom']") ||
      document.querySelector("textarea");
    const combined = customTa ? customTa.value : "";
    expect(combined).not.toContain(OUTCOME_TILES[0].prompt);
  });

  it("the Clear (N) button removes every active tile in one click", () => {
    renderHome();
    fireEvent.click(outcomeTile(OUTCOME_TILES[0].title));
    fireEvent.click(outcomeTile(OUTCOME_TILES[1].title));
    fireEvent.click(outcomeTile(OUTCOME_TILES[2].title));
    const clearBtn = screen.getByRole("button", { name: /Clear/ });
    fireEvent.click(clearBtn);
    // All outcome tiles deactivated
    const tiles = Array.from(document.querySelectorAll(".outcome-tile"));
    for (const t of tiles) {
      expect(t.getAttribute("aria-pressed")).toBe("false");
    }
    // Clear button is gone (no active tiles)
    expect(screen.queryByRole("button", { name: /Clear \(/ })).toBeNull();
  });
});
