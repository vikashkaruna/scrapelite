// credit-pack-parity.test.js — the price on screen and the price charged must
// be the same number, and a pack that cannot be bought is a price list.
//
// ── WHY THIS IS A TEST AND NOT A CONVENTION ─────────────────────────────────
// pricingConfig.js (what the browser renders) and pricingSource.js (what the
// server charges from, when pricing_config carries no override) are two hand-
// maintained tables. Nothing made them agree. A pack added to one and not the
// other either cannot be purchased at all, or is purchased at a price nobody
// chose — and neither failure produces an error anywhere.

import { describe, it, expect } from "vitest";
import { CREDIT_PACKS, TOPUP_BUNDLES } from "../../src/lib/pricingConfig.js";
import { ALLOWED_BUNDLES } from "../functions/lib/pricingSource.js";

const pricing = await import("../functions/lib/pricingSource.js");

describe("every purchasable thing on screen is purchasable on the server", () => {
  it.each(CREDIT_PACKS.map((p) => p.id))("%s is accepted by checkout", (id) => {
    expect(ALLOWED_BUNDLES.has(id)).toBe(true);
  });

  it.each(TOPUP_BUNDLES.map((b) => b.id))("%s is accepted by checkout", (id) => {
    expect(ALLOWED_BUNDLES.has(id)).toBe(true);
  });

  // 🔴 The retired bundle must not survive on the server, or it stays
  // purchasable by anyone who hand-builds the request — selling consumption
  // at 14x plan rate through a door the UI no longer shows.
  it("the retired Extractions Bundle is gone from BOTH tables", () => {
    expect(ALLOWED_BUNDLES.has("extractions-bundle")).toBe(false);
    expect(TOPUP_BUNDLES.some((b) => b.id === "extractions-bundle")).toBe(false);
  });
});

describe("the price shown is the price charged", () => {
  it("matches USD and INR for every pack and bundle", async () => {
    const loaded = await pricing.loadPricing();
    for (const item of [...CREDIT_PACKS, ...TOPUP_BUNDLES]) {
      const server = loaded.bundles[item.id];
      expect(server, `${item.id} missing server-side`).toBeTruthy();
      expect(server.usd, `${item.id} USD`).toBe(item.price_usd);
      expect(server.inr, `${item.id} INR`).toBe(item.price_inr);
    }
  });

  // A pack whose server row carries no `credits` takes the money and grants
  // nothing — the silent half of this failure.
  it("every credit pack carries its grant size on the server too", async () => {
    const loaded = await pricing.loadPricing();
    for (const pack of CREDIT_PACKS) {
      expect(loaded.bundles[pack.id].credits, `${pack.id}`).toBe(pack.credits);
    }
  });

  // ...and the mirror: a capacity add-on must NOT grant credits, or buying a
  // monitor slot quietly hands over a second unmetered budget.
  it("no capacity add-on grants credits", async () => {
    const loaded = await pricing.loadPricing();
    for (const bundle of TOPUP_BUNDLES) {
      expect(loaded.bundles[bundle.id].credits, `${bundle.id}`).toBeUndefined();
    }
  });
});
