// Button.test.jsx — the `loading` prop contract.
//
// `loading` was passed by 15 call sites for a long time while Button did not
// destructure it, so it fell through ...rest onto the native <button> element:
// React logged "Received `true` for a non-boolean attribute `loading`" and the
// prop did nothing. These tests pin down that it is consumed, that it disables
// the button (which is what prevents a second click landing on an in-flight
// payment or integration push), and that the label survives.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Button from "./Button.jsx";

describe("Button — loading prop", () => {
  it("never forwards `loading` to the DOM element", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn.hasAttribute("loading")).toBe(false);
  });

  it("logs no React unknown-attribute warning when loading is passed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Button loading icon="download">Export</Button>);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("disables the button and marks it busy while loading", () => {
    render(<Button loading>Pay</Button>);
    const btn = screen.getByRole("button", { name: /pay/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });

  it("does not fire onClick while loading — a second click can't double-submit", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Pay</Button>);
    await userEvent.click(screen.getByRole("button", { name: /pay/i }), { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the label visible so the button doesn't change width", () => {
    render(<Button loading icon="download">Export</Button>);
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("renders normally (enabled, clickable) when not loading", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    const btn = screen.getByRole("button", { name: /go/i });
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute("aria-busy")).toBeNull();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still honours an explicit disabled prop", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button", { name: /nope/i })).toBeDisabled();
  });
});
