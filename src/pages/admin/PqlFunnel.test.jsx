import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PqlFunnel from "./PqlFunnel.jsx";
import { buildPqlFunnel } from "../../lib/pql/funnelModel.js";

const row = (o = {}) => ({ score: 60, coverage: 1, is_pql: true, activated: true, persona: "sales", ...o });

describe("PqlFunnel — 'no data' must never render as a zero", () => {
  // The distinction this whole component exists for. An unapplied migration
  // reported as "0% activated" would get used to decide whether to spend on
  // acquisition.
  it("says the table is unreadable rather than showing zeros", () => {
    render(<PqlFunnel funnel={null} available={false} />);
    expect(screen.getByText(/0040_pql\.sql/)).toBeInTheDocument();
    expect(screen.getByText(/not the same as/i)).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders nothing when there is simply no funnel yet", () => {
    const { container } = render(<PqlFunnel funnel={null} available />);
    expect(container.firstChild).toBeNull();
  });

  it("shows 'no data' instead of 0 for an empty cohort", () => {
    render(<PqlFunnel funnel={buildPqlFunnel([])} available />);
    expect(screen.getAllByText(/no data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing scored yet/i)).toBeInTheDocument();
  });
});

describe("PqlFunnel — instrumentation caveats are surfaced, not hidden", () => {
  it("reports accounts that could not be scored at all", () => {
    render(<PqlFunnel available funnel={buildPqlFunnel([
      row(), row({ score: null, is_pql: false, activated: false }),
    ])} />);
    expect(screen.getByText(/could not be\s+scored at all/i)).toBeInTheDocument();
  });

  // Two of the nine signals have no source yet, so a PQL count today is a
  // floor. Without this the number silently jumps when Phase 4 ships.
  it("warns that the count is a FLOOR when coverage is partial", () => {
    render(<PqlFunnel available funnel={buildPqlFunnel([row({ coverage: 0.731 })])} />);
    expect(screen.getByText(/floor/i)).toBeInTheDocument();
    expect(screen.getByText(/73%/)).toBeInTheDocument();
  });

  it("does not cry wolf when coverage is complete", () => {
    render(<PqlFunnel available funnel={buildPqlFunnel([row({ coverage: 1 })])} />);
    expect(screen.queryByText(/floor/i)).toBeNull();
  });
});

describe("PqlFunnel — the numbers", () => {
  const funnel = buildPqlFunnel([
    row({ score: 80, persona: "sales" }),
    row({ score: 20, is_pql: false, activated: false, persona: "seo" }),
    row({ score: null, is_pql: false, activated: false, persona: null }),
  ]);

  it("states the scale rather than hardcoding it", () => {
    render(<PqlFunnel funnel={funnel} available />);
    expect(screen.getByText(`PQL at ${funnel.threshold} of ${funnel.maxPoints} points`)).toBeInTheDocument();
  });

  it("labels each rate with the denominator it used", () => {
    render(<PqlFunnel funnel={funnel} available />);
    expect(screen.getByText(/of all accounts/i)).toBeInTheDocument();
    expect(screen.getByText(/of scored/i)).toBeInTheDocument();
  });

  it("lists every activation group, dimming the empty ones", () => {
    render(<PqlFunnel funnel={funnel} available />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("sales-sdr")).toBeInTheDocument();
    expect(within(table).getByText("revops")).toBeInTheDocument();
    // A persona we could not map still gets counted, never dropped.
    expect(within(table).getByText("unknown")).toBeInTheDocument();
  });

  it("renders an em dash, not 0%, for a group with no users", () => {
    render(<PqlFunnel funnel={funnel} available />);
    const agencyRow = screen.getByText("agency").closest("tr");
    expect(within(agencyRow).getByText("—")).toBeInTheDocument();
  });
});
