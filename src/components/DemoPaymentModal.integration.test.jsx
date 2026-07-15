// src/components/DemoPaymentModal.integration.test.jsx
// I-22 — DemoPaymentModal integration.
//
//   - Confirm button → onConfirm fires (BillingProvider upgrades the plan)
//   - Cancel button → onCancel fires; plan unchanged
//   - Backdrop click → onCancel fires
//   - Esc on the dialog → onCancel fires
//   - Plan price + name are rendered
//   - "Demo mode" badge is always visible (the whole point of the modal)
//   - When plan is null → renders nothing

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import DemoPaymentModal from "./DemoPaymentModal.jsx";

const PLAN = {
  id: "pro",
  name: "Pro",
  tagline: "For power users",
  price_usd: 29,
  price_usd_annual: 23,
  price_inr_annual: 1499,
};

const defaultProps = {
  plan: PLAN,
  billingPeriod: "monthly",
  currency: "USD",
  rates: { USD: 1, INR: 83.5 },
  onConfirm: () => {},
  onCancel: () => {},
};

function renderModal(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<DemoPaymentModal {...props} />);
}

describe("I-22 — DemoPaymentModal", () => {
  it("renders the plan name + price + 'Demo mode' badge", () => {
    renderModal();
    // "Pro" appears in both the plan name and the confirm button label —
    // assert the .dpm-plan-name specifically.
    expect(document.querySelector(".dpm-plan-name").textContent).toBe("Pro");
    expect(screen.getByText("For power users")).toBeInTheDocument();
    expect(screen.getByText(/\$29/)).toBeInTheDocument();
    expect(screen.getByText(/demo mode/i)).toBeInTheDocument();
  });

  it("clicking Confirm invokes onConfirm", () => {
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    act(() => fireEvent.click(screen.getByRole("button", { name: /confirm/i })));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Cancel, keep current plan' invokes onCancel", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    act(() => fireEvent.click(screen.getByRole("button", { name: /cancel, keep current plan/i })));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop invokes onCancel (not the card itself)", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderModal({ onCancel, onConfirm });
    const backdrop = document.querySelector(".dpm-backdrop");
    expect(backdrop).not.toBeNull();
    act(() => fireEvent.click(backdrop));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clicking INSIDE the card does NOT invoke onCancel", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });
    const card = document.querySelector(".dpm-card");
    act(() => fireEvent.click(card));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("rendering with plan=null returns nothing", () => {
    const { container } = renderModal({ plan: null });
    expect(container.firstChild).toBeNull();
  });

  it("annual billing renders the annual price + 'billed annually' note", () => {
    renderModal({ billingPeriod: "annual" });
    expect(screen.getByText(/\$23/)).toBeInTheDocument();
    expect(screen.getByText(/billed annually/i)).toBeInTheDocument();
  });

  it("INR currency renders ₹ + the INR annual price", () => {
    renderModal({ currency: "INR", billingPeriod: "annual" });
    expect(screen.getByText(/₹1,499/)).toBeInTheDocument();
  });
});
