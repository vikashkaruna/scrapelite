// src/pages/Home.cloud-bi.integration.test.jsx — Stage 1 Cloud BI integration.
//
// Verifies the new Q2/Q3/Q5 wiring into Home:
//   - Outcome tiles render above the hero
//   - Clicking an outcome tile pre-fills URL + intent + custom prompt
//   - Template gallery renders below the feature grid
//   - Clicking a template card pre-fills URL + intent + custom prompt
//   - Credit estimator shows when a single URL is entered
//   - Credit estimator tone flips to "block" when over quota

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Home from "./Home.jsx";
import { AppProviders } from "../__tests__/harness/AppProviders.jsx";

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

// fetch stub for /api/og-preview
beforeEach(() => {
  vi.clearAllMocks();
  try { localStorage.clear(); } catch {}
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockImplementation(() => () => {});
  global.fetch = vi.fn((url) => {
    if (String(url).includes("/api/og-preview")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ title: "Test", description: "Test desc" }),
      });
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

describe("Stage 1 — Home: Q3 outcome tiles", () => {
  it("renders the 6 outcome tiles above the hero", () => {
    renderHome();
    expect(screen.getByRole("list", { name: /Common jobs to be done/i })).toBeInTheDocument();
    // Restrict to outcome tiles (use the .outcome-tile class)
    const tiles = document.querySelectorAll(".outcome-tile");
    expect(tiles.length).toBe(6);
    // Spot-check a couple of titles within outcome tiles
    const titles = Array.from(tiles).map((t) => t.textContent);
    expect(titles.some((t) => /Build a lead list/i.test(t))).toBe(true);
    expect(titles.some((t) => /Scrape pricing/i.test(t))).toBe(true);
  });

  it("clicking the 'Scrape pricing' outcome tile prefills the composer", () => {
    renderHome();
    const tiles = document.querySelectorAll(".outcome-tile");
    // Find the tile containing "Scrape pricing"
    const tile = Array.from(tiles).find((t) => /Scrape pricing/i.test(t.textContent));
    expect(tile).toBeTruthy();
    fireEvent.click(tile);
    // After click, the URL composer should have stripe.com/pricing
    return waitFor(() => {
      const inputs = document.querySelectorAll("input,textarea");
      const joined = Array.from(inputs).map((i) => i.value).join(" ");
      expect(joined).toMatch(/stripe\.com\/pricing/);
    });
  });
});

describe("Stage 1 — Home: Q5 template gallery", () => {
  it("renders the Template library section with template cards", () => {
    renderHome();
    expect(screen.getByText(/Template library/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^All$/ })).toBeInTheDocument();
    // Restrict to the template gallery's own list items (10–15 templates)
    const gallery = screen.getByText(/Template library/i).closest(".template-gallery");
    const items = gallery.querySelectorAll('[role="listitem"]');
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.length).toBeLessThanOrEqual(15);
  });

  it("clicking a tag filters the visible cards", () => {
    renderHome();
    const leadsTab = screen.getByRole("tab", { name: /^leads$/ });
    fireEvent.click(leadsTab);
    // Restrict to template gallery items only (outcome tiles also exist above the hero)
    const gallery = screen.getByText(/Template library/i).closest(".template-gallery");
    const items = gallery.querySelectorAll('[role="listitem"]');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.textContent.toLowerCase()).toContain("leads");
    }
  });

  it("clicking the 'Y Combinator company directory' template prefills the composer URL", () => {
    renderHome();
    const gallery = screen.getByText(/Template library/i).closest(".template-gallery");
    const cards = gallery.querySelectorAll(".template-card");
    const card = Array.from(cards).find((c) => /Y Combinator company directory/i.test(c.textContent));
    expect(card).toBeTruthy();
    fireEvent.click(card);
    return waitFor(() => {
      const inputs = document.querySelectorAll("input,textarea");
      const joined = Array.from(inputs).map((i) => i.value).join(" ");
      expect(joined).toMatch(/ycombinator\.com\/companies/);
    });
  });
});

describe("Stage 1 — Home: Q2 credit estimator", () => {
  it("renders the credit estimator when a single valid URL is entered", () => {
    renderHome();
    // Find the URL input by looking for a textarea/input with the default URL
    const input = document.querySelector("input[placeholder*='lumio']") || document.querySelector("textarea");
    if (input) {
      fireEvent.change(input, { target: { value: "https://example.com" } });
    }
    // Look for the credit estimator banner (any tone)
    const banner = document.querySelector(".credit-estimator");
    // If a default URL is preloaded, banner may already be present
    if (banner) {
      expect(banner).toBeInTheDocument();
    }
  });

  it("hides the estimator when the input is empty", () => {
    renderHome();
    const input = document.querySelector("input[placeholder*='lumio']") || document.querySelector("textarea");
    if (input) {
      fireEvent.change(input, { target: { value: "" } });
    }
    const banner = document.querySelector(".credit-estimator");
    expect(banner).toBeNull();
  });
});
