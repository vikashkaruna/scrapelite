// src/pages/Home.outcome-singleselect.integration.test.jsx — Q3 single-select on Home.
//
// Verifies the real user flow for the outcome tiles: clicking one tile seeds
// the composer (URL + intent + custom prompt) without combining prompts.
// The previous multi-select behaviour was removed because the "What do you
// want to extract?" label duplicated the intent-chips row below the
// composer and the first-section multi-select felt confusing.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

function renderHome() {
  return render(
    <AppProviders>
      <Home />
    </AppProviders>,
  );
}

function outcomeTile(title) {
  return Array.from(document.querySelectorAll(".outcome-tile"))
    .find((b) => b.textContent.includes(title));
}

beforeEach(() => {
  authMocks.getSession.mockResolvedValue(null);
});

describe("Q3 (single-select) — Home outcome tiles", () => {
  it("renders 6 outcome tiles with the 'Common jobs' label (NOT 'What do you want to extract?')", async () => {
    renderHome();
    await waitFor(() => {
      expect(document.querySelectorAll(".outcome-tile").length).toBe(6);
    });
    // The tiles use the dedicated label, not the duplicate intent-chips label.
    expect(document.querySelector(".outcome-tiles-label")?.textContent).toMatch(/Common jobs/i);
    // The OUTCOME_TILES section itself must not contain the duplicate label.
    const tilesSection = document.querySelector(".outcome-tiles");
    expect(tilesSection?.textContent).not.toMatch(/What do you want to extract\?/);
  });

  it("clicking an outcome tile seeds the composer URL and selects the matching intent", async () => {
    renderHome();
    const leadTile = outcomeTile(OUTCOME_TILES.find((t) => t.key === "lead").title);
    fireEvent.click(leadTile);
    await waitFor(() => {
      expect(leadTile.getAttribute("aria-pressed")).toBe("true");
    });
    // The custom intent chip is active for the lead tile.
    const customChip = document.querySelector(".intent-chips .intent-chip:last-child");
    expect(customChip).toHaveClass("intent-chip-active");
  });

  it("clicking a second outcome tile REPLACES the first (does not combine)", async () => {
    renderHome();
    const first  = outcomeTile(OUTCOME_TILES[0].title);
    const second = outcomeTile(OUTCOME_TILES[1].title);
    fireEvent.click(first);
    fireEvent.click(second);
    // Only the most-recently-clicked tile is active.
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the active tile again DESELECTS it (no Clear (N) button)", async () => {
    renderHome();
    const tile = outcomeTile(OUTCOME_TILES[0].title);
    fireEvent.click(tile);
    fireEvent.click(tile);
    expect(tile).toHaveAttribute("aria-pressed", "false");
    // No multi-select clear button is rendered.
    expect(document.querySelector(".outcome-tiles-clear")).toBeNull();
  });
});
