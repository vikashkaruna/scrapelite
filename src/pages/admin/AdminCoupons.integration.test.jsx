// src/pages/admin/AdminCoupons.integration.test.jsx
// I-47 — AdminCoupons integration.
//
//   - planId="manual" rows show the purple "Manual assign" pill
//   - The "Restrict to plan" select has a "Manually Assigned To User(s)" option
//   - Coupon form is gated behind admin auth (no real auth in test → render in isolation)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminCoupons from "./AdminCoupons.jsx";
import { ToastProvider } from "../../components/Toast.jsx";
import { ErrorModalProvider } from "../../components/ErrorModal.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock("../../lib/apiClient.js", () => ({ setAuthToken: vi.fn() }));

vi.mock("../../lib/authService.js", async () => {
  const actual = await vi.importActual("../../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree() {
  return (
    <MemoryRouter
      initialEntries={["/admin/coupons"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <AdminCoupons />
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("I-47 — AdminCoupons: manual planId", () => {
  it("renders the coupon list with the seeded 'LAUNCH20' coupon", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("LAUNCH20")).toBeInTheDocument();
  });

  it("'New coupon' button opens the form with a 'Manually Assigned To User(s)' option", async () => {
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    // Click "New coupon" to open the form.
    act(() => screen.getByRole("button", { name: /new coupon/i }).click());
    await act(async () => { await Promise.resolve(); });
    // The new-coupon form now has a select with the manual option.
    const selects = document.querySelectorAll("form select");
    expect(selects.length).toBeGreaterThan(0);
    const planSelect = Array.from(selects).find((s) =>
      Array.from(s.options).some((o) => /manually assigned/i.test(o.textContent))
    );
    expect(planSelect).toBeDefined();
  });

  it("seeded LAUNCH20 row does NOT show 'Manual assign' (it has planId=null)", () => {
    render(<Tree />);
    // Find the LAUNCH20 row and check its plan column has no .coupon-plan-manual pill.
    const launch20 = screen.getByText("LAUNCH20");
    // Walk up to the row.
    const row = launch20.closest("tr");
    expect(row).not.toBeNull();
    const manualPill = row.querySelector(".coupon-plan-manual");
    expect(manualPill).toBeNull();
  });
});
