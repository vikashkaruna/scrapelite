// src/components/TopupBundleModal.integration.test.jsx
// I-15..18 — TopupBundleModal integration.
//
//   - I-15: qty 1 → "Add 1 bundle — $X"; qty 2 → "Add 2 bundles — $2X";
//           "+" disabled at qty 10; "−" disabled at qty 1
//   - I-16: Upsell section shows plans with price_usd > current;
//           click closes modal and triggers flow
//   - I-17: INR currency: prices in ₹ (per the R13 fix)
//   - I-18: Backdrop click → close

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import TopupBundleModal from "./TopupBundleModal.jsx";

const BUNDLE = {
  id: "batch-pack",
  name: "Batch Pack",
  description: "Add 50 batch URLs to your plan",
  icon: "layers-2",
  price_usd: 49,
  price_inr: 3999,
  bonusBatchUrls: 50,
  bonusExtractions: 0,
};

const baseProps = {
  bundle: BUNDLE,
  currency: "USD",
  rates: { USD: 1, INR: 83.5 },
  currentPlanId: "free",
  onClose: () => {},
  onPurchase: () => {},
  onUpgrade: () => {},
  loading: false,
};

function renderModal(overrides = {}) {
  return render(<TopupBundleModal {...baseProps} {...overrides} />);
}

describe("I-15 — TopupBundleModal: quantity controls", () => {
  it("qty 1 → CTA 'Add 1 bundle — $49'", () => {
    renderModal();
    const cta = screen.getByRole("button", { name: /add 1 bundle/i });
    expect(cta).toBeInTheDocument();
    expect(cta.textContent).toMatch(/\$49/);
  });

  it("qty 2 → CTA 'Add 2 bundles — $98' + per-bundle hint", () => {
    renderModal();
    act(() => fireEvent.click(screen.getByRole("button", { name: /increase quantity/i })));
    const cta = screen.getByRole("button", { name: /add 2 bundles/i });
    expect(cta).toBeInTheDocument();
    expect(cta.textContent).toMatch(/\$98/);
    // Per-bundle hint appears at qty > 1.
    expect(screen.getByText(/\$49 per bundle/i)).toBeInTheDocument();
  });

  it("− disabled at qty 1; + disabled at qty 10", () => {
    renderModal();
    const minus = screen.getByRole("button", { name: /decrease quantity/i });
    const plus = screen.getByRole("button", { name: /increase quantity/i });
    expect(minus).toBeDisabled();
    expect(plus).not.toBeDisabled();
    // Crank up to 10.
    for (let i = 0; i < 9; i++) {
      act(() => fireEvent.click(plus));
    }
    expect(plus).toBeDisabled();
    expect(screen.getByRole("button", { name: /add 10 bundles/i })).toBeInTheDocument();
    expect(minus).not.toBeDisabled();
  });

  it("clicking the CTA calls onPurchase(bundleId, qty)", () => {
    const onPurchase = vi.fn();
    renderModal({ onPurchase });
    act(() => fireEvent.click(screen.getByRole("button", { name: /add 1 bundle/i })));
    expect(onPurchase).toHaveBeenCalledWith(BUNDLE.id, 1);
    // And with qty 2:
    act(() => fireEvent.click(screen.getByRole("button", { name: /increase quantity/i })));
    act(() => fireEvent.click(screen.getByRole("button", { name: /add 2 bundles/i })));
    expect(onPurchase).toHaveBeenLastCalledWith(BUNDLE.id, 2);
  });
});

describe("I-16 — TopupBundleModal: upsell", () => {
  it("upsell section shows plans with price_usd > current", () => {
    // current plan = free (price_usd 0) → all paid plans appear in upsell.
    renderModal({ currentPlanId: "free" });
    const upsellTitle = screen.getByText(/or upgrade for unlimited capacity/i);
    expect(upsellTitle).toBeInTheDocument();
  });

  it("clicking an upsell plan calls onUpgrade(planId)", () => {
    const onUpgrade = vi.fn();
    renderModal({ currentPlanId: "free", onUpgrade });
    // Click any upsell plan button.
    const upsellBtns = document.querySelectorAll(".tbm-upsell-plan");
    expect(upsellBtns.length).toBeGreaterThan(0);
    act(() => fireEvent.click(upsellBtns[0]));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    // The argument is a plan id (e.g. "select" / "pro" / "business" / "agency").
    expect(typeof onUpgrade.mock.calls[0][0]).toBe("string");
  });
});

describe("I-17 — TopupBundleModal: INR currency", () => {
  it("INR currency renders ₹ + GST 18% line + total", () => {
    renderModal({ currency: "INR" });
    expect(screen.getByText(/₹3,999/)).toBeInTheDocument();
    expect(screen.getByText(/GST \(18%\)/i)).toBeInTheDocument();
    // subtotal 3999 + 18% GST (720) = 4719 (rounding: Math.round(3999 * 0.18) = 720)
    const total = document.querySelector(".tbm-total-row");
    expect(total).not.toBeNull();
    expect(total.textContent).toMatch(/₹4,719/);
  });

  it("INR currency: upsell plans show ₹ prices", () => {
    renderModal({ currency: "INR", currentPlanId: "free" });
    const upsellPrices = document.querySelectorAll(".tbm-up-price");
    expect(upsellPrices.length).toBeGreaterThan(0);
    // At least one upsell price should include the ₹ symbol.
    const hasRupee = Array.from(upsellPrices).some((el) => el.textContent.includes("₹"));
    expect(hasRupee).toBe(true);
  });
});

describe("I-18 — TopupBundleModal: backdrop", () => {
  it("backdrop click → onClose", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const backdrop = document.querySelector(".tbm-backdrop");
    act(() => fireEvent.click(backdrop));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click INSIDE the card does NOT close", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    const card = document.querySelector(".tbm-card");
    act(() => fireEvent.click(card));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rendering with bundle=null returns nothing", () => {
    const { container } = renderModal({ bundle: null });
    expect(container.firstChild).toBeNull();
  });
});
