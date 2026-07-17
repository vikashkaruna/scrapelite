// src/pages/Changelog.test.jsx — F12 (public changelog).
//
// Asserts: the page renders all release entries (R0–R19 in our record), the
// TOC scrolls to anchors, the Product Hunt banner shows, and the SEO meta is
// set on mount.

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

describe("Changelog (F12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page title and at least R19 + R1 + v0 entries", () => {
    const { container } = renderPage();
    expect(screen.getByRole("heading", { name: /What's new in DatIQ/i })).toBeInTheDocument();
    // Scope to .cl-entry so we don't collide with the TOC links.
    const entries = container.querySelectorAll(".cl-entry");
    const text = Array.from(entries).map((e) => e.textContent).join(" | ");
    expect(text).toMatch(/R19/);
    expect(text).toMatch(/R1/);
    expect(text).toMatch(/v0/);
  });

  it("renders all expected release version tags", () => {
    const { container } = renderPage();
    const expected = ["R19", "R18", "R17", "R16", "R15", "R14", "R13", "R12", "R11", "R10", "R9", "R8", "R7", "R6", "R5", "R4", "R3", "R2", "R1", "v0"];
    const tags = container.querySelectorAll(".cl-version-tag");
    const tagText = Array.from(tags).map((t) => t.textContent);
    for (const v of expected) {
      expect(tagText).toContain(v);
    }
  });

  it("shows the Product Hunt banner with a notify-me mailto", () => {
    renderPage();
    const banner = screen.getByText(/Launching soon/i).closest("div");
    expect(banner).toBeTruthy();
    const link = screen.getByRole("link", { name: /Notify me/i });
    expect(link.getAttribute("href")).toMatch(/mailto:support@datiq\.app/);
  });

  it("renders the release TOC with anchor links to each entry", () => {
    renderPage();
    const toc = screen.getByLabelText("Release index");
    const links = within(toc).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(15);
    // Every link should be an in-page anchor
    for (const l of links) {
      expect(l.getAttribute("href")).toMatch(/^#release-/);
    }
  });

  it("each release card has a heading with the release name", () => {
    renderPage();
    expect(screen.getByText(/Scheduler & unified Home composer/i)).toBeInTheDocument();
  });

  it("sets SEO meta on mount with the canonical /changelog URL", async () => {
    const { setMeta } = await import("../lib/seoMeta.js");
    renderPage();
    expect(setMeta).toHaveBeenCalledTimes(1);
    const arg = setMeta.mock.calls[0][0];
    expect(arg.title).toMatch(/Changelog/);
    expect(arg.url).toMatch(/\/changelog$/);
  });

  it("renders back-link to home", () => {
    renderPage();
    const back = screen.getByText(/Back to DatIQ/i);
    expect(back.getAttribute("href")).toBe("/");
  });

  it("release entries are ordered newest-first (R19 before R18 before R1)", () => {
    const { container } = renderPage();
    const cards = container.querySelectorAll(".cl-entry");
    expect(cards.length).toBeGreaterThanOrEqual(15);
    const first = cards[0].textContent;
    const last = cards[cards.length - 1].textContent;
    expect(first).toMatch(/R19/);
    expect(last).toMatch(/v0/);
  });
});
