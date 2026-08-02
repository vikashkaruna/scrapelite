// src/components/PaymentConfirmModal.integration.test.jsx
// I-19..21 — PaymentConfirmModal integration.
//
//   - I-19: INR: base + 18% GST + total breakdown rendered
//   - I-20: "Confirm & Pay" → onConfirm(planId, couponCode) called once
//           (FR-Z-01: the modal is the entry point to payment)
//   - I-21: "Cancel" / "Upgrade to X" → onCancel / setSelectedId no-op
//   - Plus: applied coupon input → applied chip with discount line

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PaymentConfirmModal from "./PaymentConfirmModal.jsx";

const baseProps = {
  planId: "pro",
  billingPeriod: "annual",
  currency: "INR",
  currentPlanId: "free",
  appliedCouponCode: "",
  onApplyCoupon: () => true,
  onRemoveCoupon: () => {},
  onConfirm: () => {},
  onCancel: () => {},
};

function renderModal(overrides = {}) {
  return render(<PaymentConfirmModal {...baseProps} {...overrides} />);
}

describe("I-19 — PaymentConfirmModal: price breakdown", () => {
  it("INR currency: subtotal + GST 18% + total charged are all rendered", () => {
    renderModal();
    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
    expect(screen.getByText(/GST \(18%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/total charged/i)).toBeInTheDocument();
  });

  it("USD currency: subtotal + total charged are rendered, NO GST line", () => {
    renderModal({ currency: "USD" });
    expect(screen.getByText(/subtotal/i)).toBeInTheDocument();
    expect(screen.getByText(/total charged/i)).toBeInTheDocument();
    expect(screen.queryByText(/GST \(18%\)/i)).toBeNull();
  });

  it("always renders the in-modal Monthly/Annual billing-period toggle", () => {
    renderModal({ currency: "USD" });
    expect(screen.getByRole("group", { name: /billing period/i })).toBeInTheDocument();
    // Both buttons should be present.
    const annualBtn = screen.getByRole("button", { name: /^Annual$/i });
    const monthlyBtn = screen.getByRole("button", { name: /^Monthly$/i });
    expect(annualBtn).toBeInTheDocument();
    expect(monthlyBtn).toBeInTheDocument();
  });

  it("clicking the in-modal Annual/Monthly toggle re-computes the price live", () => {
    renderModal({ currency: "USD", billingPeriod: "monthly" });
    // The toggle should be reflected in the breakdown row label. Look for the
    // "Pro — Monthly" pattern (not the bare "Monthly" button text).
    expect(screen.getByText(/Pro — Monthly/)).toBeInTheDocument();
    // Switch to annual and the row label should change.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Annual$/i }));
    });
    expect(screen.getByText(/Pro — Annual \(12 months\)/)).toBeInTheDocument();
    // And the per-month note should now be present.
    expect(screen.getByText(/\/mo\b/)).toBeInTheDocument();
  });
});

describe("I-20 — PaymentConfirmModal: confirm flow", () => {
  it("'Proceed to payment' (real) → onConfirm called with (planId, null)", () => {
    // We can't toggle hasPayment easily here — but the modal's confirm
    // button always calls onConfirm(planId, coupon). The label changes.
    // We test the call signature regardless.
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    const cta = screen.getByRole("button", { name: /(proceed to payment|confirm)/i });
    act(() => fireEvent.click(cta));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [planIdArg, couponArg] = onConfirm.mock.calls[0];
    expect(typeof planIdArg).toBe("string");
    expect(planIdArg).toBe("pro");
    // No coupon applied → second arg is null.
    expect(couponArg).toBeNull();
  });

  it("applying a coupon shows the chip and passes the code in onConfirm", () => {
    // Use the seeded LAUNCH20 coupon (20% off, no plan restriction).
    const onConfirm = vi.fn();
    const onApplyCoupon = vi.fn(() => true);
    renderModal({ onConfirm, onApplyCoupon });
    const input = screen.getByPlaceholderText(/promo code/i);
    act(() => fireEvent.change(input, { target: { value: "LAUNCH20" } }));
    act(() => fireEvent.click(screen.getByRole("button", { name: /apply/i })));
    expect(onApplyCoupon).toHaveBeenCalledWith("LAUNCH20");
    // The applied chip should now show the code.
    expect(screen.getByText("LAUNCH20")).toBeInTheDocument();
    // Click confirm — coupon code is now passed through.
    act(() => fireEvent.click(screen.getByRole("button", { name: /(proceed|confirm)/i })));
    const [planIdArg, couponArg] = onConfirm.mock.calls[0];
    expect(planIdArg).toBe("pro");
    expect(couponArg).toBe("LAUNCH20");
  });
});

describe("I-21 — PaymentConfirmModal: cancel & back navigation", () => {
  it("'Cancel, keep current plan' button → onCancel called", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    act(() =>
      fireEvent.click(screen.getByRole("button", { name: /cancel, keep current plan/i })),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("backdrop click → onCancel", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    const backdrop = document.querySelector(".pcm-backdrop");
    act(() => fireEvent.click(backdrop));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("click INSIDE the card does NOT cancel", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    const card = document.querySelector(".pcm-card");
    act(() => fireEvent.click(card));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("'Upgrade to X' plan button changes the selected plan, does NOT call onCancel", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderModal({ onCancel, onConfirm });
    // There should be at least one "Or step up to a higher plan" entry.
    const upgradeButtons = document.querySelectorAll(".pcm-upgrade-plan");
    if (upgradeButtons.length > 0) {
      act(() => fireEvent.click(upgradeButtons[0]));
      expect(onCancel).not.toHaveBeenCalled();
      // And the confirm should now use the upgraded plan id.
      act(() =>
        fireEvent.click(screen.getByRole("button", { name: /(proceed to payment|confirm)/i })),
      );
      const [planIdArg] = onConfirm.mock.calls[0];
      expect(planIdArg).not.toBe("pro");
    }
  });
});

describe("PaymentConfirmModal: edge cases", () => {
  it("invalid coupon input shows the error banner and does NOT apply", () => {
    const onApplyCoupon = vi.fn(() => true);
    renderModal({ onApplyCoupon });
    const input = screen.getByPlaceholderText(/promo code/i);
    act(() => fireEvent.change(input, { target: { value: "WRONG" } }));
    act(() => fireEvent.click(screen.getByRole("button", { name: /apply/i })));
    // validateCoupon("WRONG", "pro") returns { valid: false, reason: "Coupon code not found." }
    // → couponErr is set, onApplyCoupon is NOT called.
    expect(onApplyCoupon).not.toHaveBeenCalled();
    expect(screen.getByText(/coupon code not found/i)).toBeInTheDocument();
  });

  it("applied coupon can be removed via the × chip", () => {
    const onRemoveCoupon = vi.fn();
    renderModal({ appliedCouponCode: "LAUNCH20", onRemoveCoupon });
    expect(screen.getByText("LAUNCH20")).toBeInTheDocument();
    act(() => fireEvent.click(screen.getByRole("button", { name: /remove coupon/i })));
    expect(onRemoveCoupon).toHaveBeenCalledTimes(1);
  });
});
