// src/components/ProvenanceBadge.test.jsx — Q9 UI component tests.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProvenanceBadge, { ProvenanceSummary } from "./ProvenanceBadge.jsx";

describe("Q9 — ProvenanceBadge: UI", () => {
  it("renders nothing when no provenance is provided", () => {
    const { container } = render(<ProvenanceBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the confidence percentage in the high tier when conf >= 0.9", () => {
    render(<ProvenanceBadge prov={{ source_url: "https://a.com", confidence: 0.95, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    const badge = document.querySelector(".prov-badge");
    expect(badge).toHaveClass("conf-high");
    expect(screen.getByText("95%")).toBeInTheDocument();
  });

  it("renders the confidence percentage in the medium tier when 0.7 <= conf < 0.9", () => {
    render(<ProvenanceBadge prov={{ source_url: "https://a.com", confidence: 0.75, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    const badge = document.querySelector(".prov-badge");
    expect(badge).toHaveClass("conf-medium");
  });

  it("renders the confidence percentage in the low tier when conf < 0.7", () => {
    render(<ProvenanceBadge prov={{ source_url: "https://a.com", confidence: 0.5, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    const badge = document.querySelector(".prov-badge");
    expect(badge).toHaveClass("conf-low");
  });

  it("shows the source host in the non-compact variant", () => {
    render(<ProvenanceBadge prov={{ source_url: "https://stripe.com/x", confidence: 0.95, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    expect(screen.getByText("stripe.com")).toBeInTheDocument();
  });

  it("hides the source host in the compact variant", () => {
    render(<ProvenanceBadge compact prov={{ source_url: "https://stripe.com/x", confidence: 0.95, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    expect(screen.queryByText("stripe.com")).toBeNull();
  });

  it("includes the last-checked timestamp in the title attribute for accessibility", () => {
    render(<ProvenanceBadge prov={{ source_url: "https://a.com", confidence: 0.95, last_checked_at: "2026-07-17T00:00:00Z" }} />);
    const badge = document.querySelector(".prov-badge");
    expect(badge.getAttribute("title")).toMatch(/Confidence: 95%/);
    expect(badge.getAttribute("title")).toMatch(/Checked/);
  });
});

describe("Q9 — ProvenanceSummary: per-record strip", () => {
  it("renders nothing when there is no provenance", () => {
    const { container } = render(<ProvenanceSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the source host, field count, avg confidence, and last-checked", () => {
    const ext = {
      _provenance: {
        source_url: "https://stripe.com/x",
        field_count: 8,
        avg_confidence: 0.88,
        last_checked_at: "2026-07-17T00:00:00Z",
      },
    };
    render(<ProvenanceSummary extraction={ext} />);
    expect(screen.getByText(/from stripe\.com/)).toBeInTheDocument();
    expect(screen.getByText(/8 fields/)).toBeInTheDocument();
    expect(screen.getByText(/88% avg confidence/)).toBeInTheDocument();
  });
});
