// src/pages/Changelog.test.jsx — V1.0 page.
//
// Asserts: the page renders the V1.0 header, all feature groups with their
// counts, the Product Hunt banner, the in-page TOC, and the SEO meta.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Changelog from "./Changelog.jsx";

vi.mock("../lib/seoMeta.js", () => ({
  setMeta: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/changelog"]}>
      <Changelog />
    </MemoryRouter>,
  );
}

describe("Changelog V1.0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the V1.0 title", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /What's in DatIQ V1\.0/i })).toBeInTheDocument();
  });

  it("renders all 11 feature groups with at least one item each", () => {
    const { container } = renderPage();
    const groups = container.querySelectorAll(".cl-group");
    expect(groups.length).toBe(11);
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
    // 11 groups → 11 TOC links
    expect(links.length).toBe(11);
    for (const l of links) {
      expect(l.getAttribute("href")).toMatch(/^#feature-/);
    }
  });

  it("sets SEO meta on mount with the canonical /changelog URL", async () => {
    const { setMeta } = await import("../lib/seoMeta.js");
    renderPage();
    expect(setMeta).toHaveBeenCalledTimes(1);
    const arg = setMeta.mock.calls[0][0];
    expect(arg.title).toMatch(/V1\.0/);
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
    // R-numbered history is retired; only V1.0 + the group names should appear.
    expect(text).not.toMatch(/\bR1[0-9]\b/);
    expect(text).not.toMatch(/\bR[0-9]\b/);
  });
});
