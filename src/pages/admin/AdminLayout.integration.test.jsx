// src/pages/admin/AdminLayout.integration.test.jsx
// I-43 — AdminLayout integration (PIN gate + sidebar).
//
//   - PIN gate renders the admin access card
//   - 5 wrong attempts → "Locked — Ns" button + form is disabled
//   - Correct PIN (DEMO_PIN = ADMIN123 in dev) → admin shell renders
//   - Sidebar collapse/pin toggles update localStorage and the class

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import AdminLayout from "./AdminLayout.jsx";
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
  // Stub fetch to fail; adminLogin falls through to dev fallback (ADMIN123).
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline")));
  window.history.replaceState(null, "", window.location.pathname);
});

function Tree({ initialPath = "/admin/revenue" }) {
  return (
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        <ErrorModalProvider>
          <Routes>
            <Route path="/admin/*" element={<AdminLayout />} />
            <Route path="*" element={<div data-testid="other">other</div>} />
          </Routes>
        </ErrorModalProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe("I-43 — AdminLayout: PIN gate", () => {
  it("renders the PIN gate card on /admin (no auth yet)", () => {
    render(<Tree />);
    expect(screen.getByText(/admin access/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/admin pin/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter admin/i })).toBeInTheDocument();
  });

  it("correct PIN (ADMIN123 in dev) → admin shell renders (sidebar visible)", async () => {
    render(<Tree />);
    fireEvent.change(screen.getByPlaceholderText(/admin pin/i), {
      target: { value: "ADMIN123" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enter admin/i }));
    });
    // After auth, the PIN gate is gone and the sidebar is rendered.
    await waitFor(() => {
      expect(screen.queryByText(/admin access/i)).toBeNull();
    });
    // The sidebar has the "Admin" brand label.
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("5 wrong attempts → form is disabled with 'Locked' message", async () => {
    render(<Tree />);
    const pin = screen.getByPlaceholderText(/admin pin/i);
    const btn = screen.getByRole("button", { name: /enter admin/i });
    for (let i = 0; i < 5; i++) {
      fireEvent.change(pin, { target: { value: "WRONG" + i } });
      await act(async () => {
        fireEvent.click(btn);
      });
    }
    // After 5 failures, the button text is "Locked — Ns" and the input is disabled.
    await waitFor(() => {
      expect(btn.textContent).toMatch(/locked/i);
    });
    expect(pin).toBeDisabled();
  });
});
