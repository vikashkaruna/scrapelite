// TrustStrip.test.jsx — F14 (in-product trust messaging) tests.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import TrustStrip from "./TrustStrip.jsx";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("F14 — TrustStrip", () => {
  it("renders all three trust pills with the canonical text", () => {
    render(<MemoryRouter><TrustStrip /></MemoryRouter>);
    expect(screen.getByText(/Encrypted in transit/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-deleted in 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Never used to train AI/i)).toBeInTheDocument();
  });

  it("every pill is a link to /privacy", () => {
    render(<MemoryRouter><TrustStrip /></MemoryRouter>);
    const links = screen.getAllByRole("link");
    expect(links.length).toBe(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe("/privacy");
    }
  });

  it("renders a labelled region (aria-label) for screen readers", () => {
    render(<MemoryRouter><TrustStrip /></MemoryRouter>);
    const region = screen.getByLabelText(/Data privacy guarantees/i);
    expect(region).toBeInTheDocument();
    expect(within(region).getAllByRole("link")).toHaveLength(3);
  });

  it("compact mode still renders all 3 pills (no truncation)", () => {
    render(<MemoryRouter><TrustStrip compact /></MemoryRouter>);
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});
