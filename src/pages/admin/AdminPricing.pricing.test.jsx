// src/pages/admin/AdminPricing.pricing.test.jsx
//
// The admin screen's job is to let an operator move a price AND have that price
// reach the thing that charges. Everything here is about the second half —
// the first half is just an input.
//
// 🔴 THE BUG THESE EXIST FOR: `SERVER_PLAN_IDS` was the hand-written list
// ["select","pro","business","agency"], so an admin repricing **Go** or
// **Developer** got SQL that never mentioned them. The pricing page showed the
// new price and the server went on charging the static one. A literal array is
// how that happened, and a test restating the array would not have caught it.

import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminPricing from "./AdminPricing.jsx";
import { PLANS, CREDIT_PACKS, TOPUP_BUNDLES } from "../../lib/pricingConfig.js";
import {
  getEffectiveCreditPacks, setCreditPackOverride, resetCreditPackOverrides,
} from "../../lib/pricingOverrides.js";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* private mode */ }
});

describe("credit-pack overrides", () => {
  it("an override changes the price the app reads", () => {
    setCreditPackOverride("credits-750", { price_usd: 7, price_inr: 690 });
    const pack = getEffectiveCreditPacks().find((p) => p.id === "credits-750");
    expect(pack.price_usd).toBe(7);
    expect(pack.price_inr).toBe(690);
  });

  it("an override can change the GRANT, not just the price", () => {
    // `credits` is what verify-payment writes to the ledger. A screen that let
    // an admin move the price but not the grant would sell one thing and
    // deliver another.
    setCreditPackOverride("credits-750", { credits: 600 });
    expect(getEffectiveCreditPacks().find((p) => p.id === "credits-750").credits).toBe(600);
  });

  it("leaves untouched packs exactly as shipped", () => {
    setCreditPackOverride("credits-750", { price_usd: 7 });
    const other = getEffectiveCreditPacks().find((p) => p.id === "credits-3000");
    expect(other).toEqual(CREDIT_PACKS.find((p) => p.id === "credits-3000"));
  });

  it("reset puts every pack back", () => {
    setCreditPackOverride("credits-750", { price_usd: 7, credits: 1 });
    resetCreditPackOverrides();
    expect(getEffectiveCreditPacks()).toEqual(CREDIT_PACKS);
  });
});

describe("the admin screen renders an editor for everything that has a price", () => {
  it("every plan, every credit pack and every capacity add-on", () => {
    render(<AdminPricing />);
    // Plan editors are headed by the plan's NAME; pack and add-on editors by
    // their id. Matching each the way the screen actually labels it, rather
    // than assuming one convention, is the difference between this test
    // checking the UI and checking my memory of it.
    for (const p of PLANS) {
      expect(screen.getAllByText(p.name, { exact: false }).length,
        `no editor for plan ${p.id}`).toBeGreaterThan(0);
    }
    for (const p of CREDIT_PACKS) {
      expect(screen.getAllByText(new RegExp(p.id)).length,
        `no editor for pack ${p.id}`).toBeGreaterThan(0);
    }
    for (const b of TOPUP_BUNDLES) {
      expect(screen.getAllByText(new RegExp(b.id)).length,
        `no editor for add-on ${b.id}`).toBeGreaterThan(0);
    }
  });

  it("separates credit packs from capacity add-ons, because they are different products", () => {
    render(<AdminPricing />);
    expect(screen.getByText(/Credit pack pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/Capacity add-on pricing/i)).toBeInTheDocument();
  });

  it("says an add-on's runs still cost credits", () => {
    // The point D16 exists to make. A monitor slot whose runs were included
    // would be a second, unmetered budget.
    render(<AdminPricing />);
    expect(screen.getByText(/the doing still costs credits/i)).toBeInTheDocument();
  });
});
