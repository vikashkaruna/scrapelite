// src/lib/platformKeys.test.js — formatShortcut() Mac vs. non-Mac display.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

async function loadWithPlatform(platform) {
  vi.resetModules();
  vi.stubGlobal("navigator", { platform, userAgent: "" });
  return import("./platformKeys.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatShortcut — Mac", () => {
  it("renders mod+k as a tight ⌘ glyph cluster", async () => {
    const { formatShortcut } = await loadWithPlatform("MacIntel");
    expect(formatShortcut("mod+k")).toBe("⌘K");
  });

  it("renders every modifier symbol", async () => {
    const { formatShortcut } = await loadWithPlatform("MacIntel");
    expect(formatShortcut("mod+enter")).toBe("⌘ENTER");
    expect(formatShortcut("alt+k")).toBe("⌥K");
    expect(formatShortcut("shift+k")).toBe("⇧K");
  });
});

describe("formatShortcut — non-Mac", () => {
  it("renders mod+k as a hyphenated Ctrl combo", async () => {
    const { formatShortcut } = await loadWithPlatform("Win32");
    expect(formatShortcut("mod+k")).toBe("Ctrl+K");
  });

  it("capitalizes the non-modifier key", async () => {
    const { formatShortcut } = await loadWithPlatform("Linux x86_64");
    expect(formatShortcut("mod+enter")).toBe("Ctrl+Enter");
  });
});

describe("formatShortcut — non-combo tokens pass through unchanged", () => {
  it("chord sequences (space-separated) are untouched on either platform", async () => {
    const mac = await loadWithPlatform("MacIntel");
    expect(mac.formatShortcut("g d")).toBe("g d");
    const win = await loadWithPlatform("Win32");
    expect(win.formatShortcut("g d")).toBe("g d");
  });

  it("bare keys are untouched", async () => {
    const { formatShortcut } = await loadWithPlatform("MacIntel");
    expect(formatShortcut("?")).toBe("?");
    expect(formatShortcut("Esc")).toBe("Esc");
    expect(formatShortcut("/")).toBe("/");
  });
});
