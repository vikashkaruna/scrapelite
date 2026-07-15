// src/components/Toast.integration.test.jsx
// I-12 — Toast provider integration.
//
//   - useToast() returns the show function DIRECTLY (not {showToast})
//   - Calling it renders a `.toast` node with the message text
//   - The 2.6s auto-dismiss timer clears the toast
//
// Why this is an integration test and not a unit test:
//   The contract is "the hook returns a function, and the function mutates
//   the live DOM". Both pieces of behaviour only make sense together — a
//   unit test that asserted `expect(useToast()).toBeTypeOf("function")`
//   would pass even if the provider never rendered the toast node.

import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useToast, ToastProvider } from "./Toast.jsx";

function Capture() {
  const showToast = useToast();
  // Expose the function so the test can call it from outside React.
  Capture.last = showToast;
  return null;
}

describe("I-12 — Toast", () => {
  it("useToast() returns a function (not an object)", () => {
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    expect(typeof Capture.last).toBe("function");
  });

  it("calling the toast function shows a .toast node with the message", () => {
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => Capture.last("Saved!"));
    const toast = document.querySelector(".toast");
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain("Saved!");
  });

  it("the toast auto-dismisses after ~2.6s", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => Capture.last("Hello"));
    expect(document.querySelector(".toast")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(2600);
    });
    expect(document.querySelector(".toast")).toBeNull();
    vi.useRealTimers();
  });

  it("a second toast call within 2.6s replaces the previous message", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Capture />
      </ToastProvider>,
    );
    act(() => Capture.last("First"));
    act(() => Capture.last("Second"));
    expect(document.querySelector(".toast").textContent).toContain("Second");
    vi.useRealTimers();
  });
});
