// PricingMatrix.test.jsx — F13 (tier × feature comparison) tests.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import PricingMatrix from "./PricingMatrix.jsx";
import { PLANS } from "../lib/pricingConfig.js";
import { resolvePlanPrice } from "../lib/planPricing.js";
import { formatPrice } from "../lib/currencyService.js";

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

  // ── ONE POOL. The two separate monthly budgets this table used to quote —
  // extractions and audits — are what let a customer be refused an audit
  // while holding a month of unused extractions.
  it("leads with the credit pool", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.getByRole("rowheader", { name: /Credits \/ month/i })).toBeInTheDocument();
  });

  it("shows plan-specific pools (Free = 500)", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    const row = screen.getByRole("row", { name: /Credits \/ month/i });
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((c) => c.textContent.trim()).join("|")).toContain("500");
  });

  // ⚠️ A raw credit count means nothing on its own. The table has to translate
  // it into the units people actually think in, or "750 credits" is a number
  // nobody can compare against a competitor.
  it("translates the pool into runs a buyer can picture", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.getByRole("rowheader", { name: /Discoverability runs/i })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /pages extracted/i })).toBeInTheDocument();
  });

  // Retired: it capped DEPTH per URL while the cost is per CALL, and every
  // plan had it at Infinity — a limit nobody ever set is a limit nobody wanted.
  it("no longer quotes enrichments per extraction", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.queryByRole("rowheader", { name: /Enrichments per extraction/i })).toBeNull();
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

  // The header prices used to read the ANNUAL figure unconditionally, so with
  // /pricing on its Monthly default the table disagreed with every plan card.
  for (const billingPeriod of ["monthly", "annual"]) {
    for (const currency of ["USD", "INR"]) {
      it(`header prices follow the selected period (${billingPeriod}, ${currency})`, () => {
        const { container } = render(
          <MemoryRouter><PricingMatrix billingPeriod={billingPeriod} currency={currency} /></MemoryRouter>
        );
        const shown = Array.from(container.querySelectorAll(".pm-plan-price"))
          .map((n) => n.firstChild.textContent.trim());
        const expected = PLANS.filter((p) => !p.comingSoon)
          .map((p) => formatPrice(resolvePlanPrice(p, billingPeriod, currency), currency));
        expect(shown).toEqual(expected);
      });
    }
  }

  it("defaults to monthly prices, matching the /pricing page default", () => {
    const { container } = render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    const select = PLANS.find((p) => p.id === "select");
    const headers = Array.from(container.querySelectorAll(".pm-plan-price")).map((n) => n.textContent);
    expect(headers.some((t) => t.startsWith(formatPrice(select.price_usd, "USD")))).toBe(true);
    expect(headers.some((t) => t.startsWith(formatPrice(select.price_usd_annual, "USD") + "/"))).toBe(false);
  });

  it("renders a 'Compare every plan' heading", () => {
    render(<MemoryRouter><PricingMatrix /></MemoryRouter>);
    expect(screen.getByText(/Compare every plan/i)).toBeInTheDocument();
  });
});
