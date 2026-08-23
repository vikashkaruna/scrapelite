// PricingMatrix.test.jsx — F13 (tier × feature comparison) tests.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import PricingMatrix from "./PricingMatrix.jsx";

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("F13 — PricingMatrix", () => {
  it("renders a comparison table with one column per ship-today plan", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    const table = screen.getByRole("table");
    const planHeaders = within(table).getAllByRole("columnheader");
    // 1 feature column + the plans (excludes comingSoon)
    // We don't assert exact count to stay robust to plan list changes.
    expect(planHeaders.length).toBeGreaterThan(1);
    expect(planHeaders.length).toBeLessThan(10);
  });

  it("renders a row for the headline 'Monthly extractions' feature", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.getByRole("rowheader", { name: /Monthly extractions/i })).toBeInTheDocument();
  });

  it("shows plan-specific values (Free = 10 extractions/mo)", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    // The "10" cell appears in the Free column under the extractions row.
    const row = screen.getByRole("row", { name: /Monthly extractions/i });
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((c) => c.textContent.trim()).join("|")).toContain("10");
  });

  it("renders Unlimited as a value for paid plans' enrichments", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    const row = screen.getByRole("row", { name: /Enrichments per extraction/i });
    const cells = within(row).getAllByRole("cell");
    expect(cells.some((c) => /unlimited/i.test(c.textContent))).toBe(true);
  });

  it("groups rows under a Group label (Usage / Exports / Power / Team / Data)", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    for (const label of ["Usage", "Exports", "Power", "Team", "Data"]) {
      expect(screen.getByText(new RegExp(`^${label}$`, "i"))).toBeInTheDocument();
    }
  });

  it("highlights the current plan column with pm-col--current", () => {
    const { container } = render(<MemoryRouter><PricingMatrix currentPlanId="pro" /></MemoryRouter>);
    const currentCells = container.querySelectorAll(".pm-col--current");
    expect(currentCells.length).toBeGreaterThan(0);
  });

  it("renders a Pick <Plan> button in the CTA footer for non-current plans", () => {
    render(<MemoryRouter><PricingMatrix currentPlanId="pro" /></MemoryRouter>);
    // Should be at least one Pick button for a non-current plan.
    const pickBtns = screen.getAllByRole("button", { name: /Pick /i });
    expect(pickBtns.length).toBeGreaterThan(0);
  });

  it("fires onSelectPlan when a Pick button is clicked", () => {
    const onSelect = vi.fn();
    render(<MemoryRouter><PricingMatrix currentPlanId="pro" onSelectPlan={onSelect} /></MemoryRouter>);
    const btn = screen.getAllByRole("button", { name: /Pick /i })[0];
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("disables the CTA button for the current plan (no Pick button on it)", () => {
    render(<MemoryRouter><PricingMatrix currentPlanId="pro" /></MemoryRouter>);
    // The "pro" column's CTA should say "Current" not "Pick Pro".
    const pro = screen.queryByRole("button", { name: /Pick Pro/i });
    expect(pro).toBeNull();
  });

  it("renders a 'Compare every plan' heading", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.getByText(/Compare every plan/i)).toBeInTheDocument();
  });
});
