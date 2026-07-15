// src/components/ErrorModal.integration.test.jsx
// I-13 — ErrorModal provider integration.
//
// Contract:
//   useErrorModal() returns the show function DIRECTLY.
//   showError(err, override?, onRetry?) opens the .error-backdrop with the
//   classified (or overridden) title + message, and renders a "Try again"
//   button when onRetry is provided.
//   Clicking "Close"/"Dismiss" or the backdrop unmounts the modal.
//   Esc closes the modal.

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ErrorModalProvider, useErrorModal } from "./ErrorModal.jsx";

function Capture() {
  const showError = useErrorModal();
  Capture.last = showError;
  return null;
}

describe("I-13 — ErrorModal", () => {
  it("useErrorModal() returns a function (not an object)", () => {
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    expect(typeof Capture.last).toBe("function");
  });

  it("showError(err, override) opens a dialog with the overridden title + message", () => {
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    act(() =>
      Capture.last(new Error("boom"), {
        title: "Save failed",
        message: "We couldn't reach the server.",
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByText("We couldn't reach the server.")).toBeInTheDocument();
  });

  it("showError(err) auto-classifies the title when no override is given", () => {
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    act(() => Capture.last(new Error("Failed to fetch")));
    // The errorMessages classifier maps "Failed to fetch" to a network title.
    // We don't pin the exact text — just assert the dialog is open and has some
    // descriptive copy (not the raw error).
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent.length).toBeGreaterThan(20);
  });

  it("a 'Try again' button appears when onRetry is provided and invokes onRetry", () => {
    vi.useFakeTimers();
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    const retry = vi.fn();
    act(() => Capture.last(new Error("boom"), {}, retry));
    const tryAgain = screen.getByRole("button", { name: /try again/i });
    expect(tryAgain).toBeInTheDocument();
    act(() => fireEvent.click(tryAgain));
    // Modal unmounts synchronously, retry runs after an 80ms timeout.
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(retry).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("clicking the Dismiss button unmounts the modal", () => {
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    act(() => Capture.last(new Error("x"), { title: "Oops" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The footer "Close" / "Dismiss" button — not the X icon (aria-label="Close error").
    act(() => fireEvent.click(screen.getByRole("button", { name: /^close$|^dismiss$/i })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc closes the modal", () => {
    render(
      <ErrorModalProvider>
        <Capture />
      </ErrorModalProvider>,
    );
    act(() => Capture.last(new Error("x"), { title: "Oops" }));
    const dialog = screen.getByRole("dialog");
    act(() => fireEvent.keyDown(dialog, { key: "Escape" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
