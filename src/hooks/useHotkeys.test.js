// src/hooks/useHotkeys.test.js — Q11 (keyboard shortcuts) unit tests.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys, buildKey, isEditable } from "./useHotkeys.js";

function fireKey(opts) {
  const event = new KeyboardEvent("keydown", {
    key: opts.key,
    code: opts.code,
    shiftKey: !!opts.shift,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    altKey: !!opts.alt,
    bubbles: true,
    cancelable: true,
  });
  // jsdom KeyboardEvent does not carry `target` reliably — set on dispatch.
  Object.defineProperty(event, "target", { value: opts.target || document.body });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Q11 — useHotkeys: basic bindings", () => {
  it("fires the matching handler on the bound combo", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "?": fn }));
    fireKey({ key: "?" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not fire unrelated keys", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "?": fn }));
    fireKey({ key: "a" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("Escape fires when bound to 'esc'", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ esc: fn }));
    fireKey({ key: "Escape" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("mod+k matches Cmd+K and Ctrl+K", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "mod+k": fn }));
    fireKey({ key: "k", meta: true });
    expect(fn).toHaveBeenCalledTimes(1);
    fn.mockClear();
    fireKey({ key: "k", ctrl: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Q11 — useHotkeys: input / textarea suppression", () => {
  it("does not fire when typing in an input", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "/": fn }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey({ key: "/", target: input });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not fire when typing in a textarea", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "/": fn }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKey({ key: "/", target: ta });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does fire for combos opted-in via allowInInputs", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "mod+enter": fn }, { allowInInputs: ["mod+enter"] }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    fireKey({ key: "Enter", meta: true, target: ta });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Q11 — useHotkeys: chords (g d, g b)", () => {
  it("fires on a 'g d' chord", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "g d": fn }));
    fireKey({ key: "g" });
    fireKey({ key: "d" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire if the second key arrives after the chord timeout", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "g d": fn }));
    fireKey({ key: "g" });
    // Advance 900 ms (CHORD_TIMEOUT_MS is 800)
    vi.advanceTimersByTime(900);
    fireKey({ key: "d" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not fire on the chord prefix alone (just 'g')", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "g d": fn }));
    fireKey({ key: "g" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("Q11 — useHotkeys: enabled + cleanup", () => {
  it("does not fire when enabled=false", () => {
    const fn = vi.fn();
    renderHook(() => useHotkeys({ "?": fn }, { enabled: false }));
    fireKey({ key: "?" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("unbinds when the component unmounts", () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => useHotkeys({ "?": fn }));
    unmount();
    fireKey({ key: "?" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("Q11 — pure helpers", () => {
  it("buildKey normalises a plain letter", () => {
    expect(buildKey({ key: "a" })).toBe("a");
  });

  it("buildKey normalises mod+k", () => {
    expect(buildKey({ key: "k", metaKey: true })).toBe("mod+k");
    expect(buildKey({ key: "k", ctrlKey: true })).toBe("mod+k");
  });

  it("isEditable returns true for input/textarea/contentEditable", () => {
    expect(isEditable({ tagName: "INPUT" })).toBe(true);
    expect(isEditable({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditable({ tagName: "SELECT" })).toBe(true);
    expect(isEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditable({ tagName: "BUTTON" })).toBe(false);
  });
});
