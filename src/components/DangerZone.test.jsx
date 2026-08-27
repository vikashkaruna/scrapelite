// DangerZone.test.jsx — the two actions on the Account page you cannot casually undo.
//
// What these pin, beyond "the buttons call the right thing":
//
//   * Freezing does NOT pause billing, and the UI says so. People reliably
//     assume the opposite, and discovering it from an invoice is the worst way
//     to find out.
//   * Deletion is scheduled, not instant, and cancellable — which is good news
//     the copy has to actually deliver, or it reads as a failure to delete.
//   * The confirm button stays disabled until the exact word is typed, so the
//     destructive action can never be one stray click.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DangerZone, { daysUntil } from "./DangerZone.jsx";
import { ToastProvider } from "./Toast.jsx";

const freeze = vi.fn();
const unfreeze = vi.fn();
const requestDeletion = vi.fn();
const cancelDeletion = vi.fn();

vi.mock("../lib/accountStateService.js", () => ({
  DELETE_CONFIRMATION: "DELETE",
  freezeAccount: (...a) => freeze(...a),
  unfreezeAccount: (...a) => unfreeze(...a),
  requestAccountDeletion: (...a) => requestDeletion(...a),
  cancelAccountDeletion: (...a) => cancelDeletion(...a),
}));

const ACTIVE = { available: true, frozen: false };
const draw = (state = ACTIVE, onChange = () => {}) =>
  render(<ToastProvider><DangerZone state={state} onChange={onChange} /></ToastProvider>);

beforeEach(() => {
  freeze.mockResolvedValue({ ok: true, state: { available: true, frozen: true } });
  unfreeze.mockResolvedValue({ ok: true, state: ACTIVE });
  requestDeletion.mockResolvedValue({
    ok: true, state: { available: true, frozen: true, deletionRequestedAt: "2026-08-27T00:00:00Z" },
  });
  cancelDeletion.mockResolvedValue({ ok: true, state: ACTIVE });
});

describe("DangerZone — visibility", () => {
  it("renders nothing when the account state could not be read", () => {
    // Better to show no danger zone than one whose buttons may not work.
    const { container } = draw({ available: false });
    expect(container.firstChild).toBeNull();
  });
});

describe("DangerZone — freeze", () => {
  it("says plainly that billing continues", () => {
    // THE misconception this copy exists to prevent.
    draw();
    expect(screen.getByText(/subscription continues to be charged/i)).toBeInTheDocument();
  });

  it("says what still works while frozen", () => {
    draw();
    expect(screen.getByText(/Reading and exporting keep working/i)).toBeInTheDocument();
  });

  it("freezes on click", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Freeze account/i }));
    await waitFor(() => expect(freeze).toHaveBeenCalled());
  });

  it("offers to unfreeze once frozen, and still says billing is unaffected", async () => {
    draw({ available: true, frozen: true, frozenAt: "2026-08-27T00:00:00Z" });
    expect(screen.getByText(/Billing is unaffected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unfreeze account/i }));
    await waitFor(() => expect(unfreeze).toHaveBeenCalled());
  });
});

describe("DangerZone — deletion", () => {
  it("does not show the confirmation field until asked", () => {
    draw();
    expect(screen.queryByLabelText(/Type DELETE/i)).toBeNull();
  });

  it("keeps the destructive button disabled until the exact word is typed", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Delete account/i }));
    const confirm = screen.getByRole("button", { name: /Schedule deletion/i });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(/Type DELETE/i);
    for (const near of ["", "d", "delete", "Delete", "DELET"]) {
      fireEvent.change(input, { target: { value: near } });
      expect(confirm, `enabled for ${JSON.stringify(near)}`).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
  });

  it("sends the confirmation with the request", async () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Delete account/i }));
    fireEvent.change(screen.getByLabelText(/Type DELETE/i), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: /Schedule deletion/i }));
    await waitFor(() => expect(requestDeletion).toHaveBeenCalledWith("DELETE"));
  });

  it("offers a way out that is not the destructive button", () => {
    draw();
    fireEvent.click(screen.getByRole("button", { name: /Delete account/i }));
    fireEvent.click(screen.getByRole("button", { name: /Keep my account/i }));
    expect(screen.queryByLabelText(/Type DELETE/i)).toBeNull();
  });

  it("says deletion is scheduled and cancellable, not instant", () => {
    draw();
    expect(screen.getByText(/Scheduled 30 days out, and cancellable/i)).toBeInTheDocument();
  });

  it("says invoices are kept", () => {
    // We are required to keep them, so promising total erasure would be a lie.
    draw();
    expect(screen.getByText(/Invoices are kept/i)).toBeInTheDocument();
  });
});

describe("DangerZone — pending deletion", () => {
  const pending = {
    available: true, frozen: true,
    deletionRequestedAt: "2026-08-27T00:00:00Z",
    deletionPurgeAfter: new Date(Date.now() + 12 * 86400000).toISOString(),
  };

  it("takes over the panel — cancelling is the only thing that matters", () => {
    draw(pending);
    expect(screen.getByText(/scheduled for deletion/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel deletion/i })).toBeInTheDocument();
    // The other controls must not be reachable while a deletion is pending:
    // freezing an account that is already frozen-and-scheduled is meaningless,
    // and "Delete account" again is worse than meaningless.
    expect(screen.queryByRole("button", { name: /Freeze account/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete account/i })).toBeNull();
  });

  it("counts down the days left", () => {
    draw(pending);
    expect(screen.getByText(/12 days from now/i)).toBeInTheDocument();
  });

  it("cancels", async () => {
    draw(pending);
    fireEvent.click(screen.getByRole("button", { name: /Cancel deletion/i }));
    await waitFor(() => expect(cancelDeletion).toHaveBeenCalled());
  });
});

describe("daysUntil", () => {
  it("counts whole days forward", () => {
    expect(daysUntil(new Date(Date.now() + 3 * 86400000).toISOString())).toBe(3);
  });
  it("never goes negative — an overdue purge is 0 days, not -4", () => {
    expect(daysUntil(new Date(Date.now() - 4 * 86400000).toISOString())).toBe(0);
  });
  it("returns null for a missing or unparseable date", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("not a date")).toBeNull();
  });
});
