// src/pages/Changelog.test.jsx — the changelog page.
//
// Asserts: the page renders its header (with NO product version number), all feature groups with their
// counts, the Product Hunt banner, the in-page TOC, and the SEO meta.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Changelog from "./Changelog.jsx";

vi.mock("../lib/seoMeta.js", () => ({
  setMeta: vi.fn(),
  // Real implementation, not a stub: these tests assert the canonical
  // URL that gets set, and a mocked-away canonicalUrl would let a
  // localhost or query-string canonical pass unnoticed — which is the
  // exact bug it was introduced to prevent.
  canonicalUrl: (p) => `https://datiq.app${String(p || "/").split(/[?#]/)[0]}`,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/changelog"]}>
      <Changelog />
    </MemoryRouter>,
  );
}

describe("Changelog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title with no version number (plan §22, D22a)", () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { name: /^What's in DatIQ$/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bV\d+\.\d+/);
  });

  it("renders all 22 feature groups with at least one item each", () => {
    const { container } = renderPage();
    const groups = container.querySelectorAll(".cl-group");
    expect(groups.length).toBe(22);
    groups.forEach((g) => {
      const items = g.querySelectorAll(".cl-group-list li");
      expect(items.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("renders the canonical capability groups", () => {
    const { container } = renderPage();
    const ids = Array.from(container.querySelectorAll(".cl-group")).map((g) => g.id);
    // Spot-check the canonical group ids so refactors can't accidentally rename them.
    for (const id of [
      "feature-extraction",
      "feature-batch",
      "feature-schedules",
      "feature-dashboard",
      "feature-preview",
      "feature-auth",
      "feature-billing",
      "feature-guest",
      "feature-ux",
      "feature-docs",
      "feature-workflow-hub",
      "feature-template-hub",
      "feature-roles",
      "feature-engagement",
      "feature-credits",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("shows the Product Hunt banner with a notify-me mailto", () => {
    renderPage();
    const banner = screen.getByText(/Launching soon/i).closest("div");
    expect(banner).toBeTruthy();
    const link = screen.getByRole("link", { name: /Notify me/i });
    expect(link.getAttribute("href")).toMatch(/mailto:hello@datiq\.app/);
  });

  it("renders the feature TOC with anchor links to each group", () => {
    renderPage();
    const toc = screen.getByLabelText("Feature groups");
    const links = within(toc).getAllByRole("link");
    // 22 groups → 22 TOC links
    expect(links.length).toBe(22);
    for (const l of links) {
      expect(l.getAttribute("href")).toMatch(/^#feature-/);
    }
  });

  it("sets SEO meta on mount with the canonical /changelog URL", async () => {
    const { setMeta } = await import("../lib/seoMeta.js");
    renderPage();
    expect(setMeta).toHaveBeenCalledTimes(1);
    const arg = setMeta.mock.calls[0][0];
    expect(arg.title).toMatch(/What's in DatIQ/);
    expect(arg.title).not.toMatch(/\bV\d+\.\d+/);
    expect(arg.url).toMatch(/\/changelog$/);
  });

  it("renders back-link to home", () => {
    renderPage();
    const back = screen.getByText(/Back to DatIQ/i);
    expect(back.getAttribute("href")).toBe("/");
  });

  it("does not include the old R0–R19 version tags anywhere on the page", () => {
    const { container } = renderPage();
    const text = container.textContent;
    // R-numbered history is retired; only the group names should appear.
    expect(text).not.toMatch(/\bR1[0-9]\b/);
    expect(text).not.toMatch(/\bR[0-9]\b/);
  });
});
