import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, getSettings, loadSettings, updateCachedSettings } from "./globalSettingsService.js";

/**
 * U-53..55 — globalSettingsService is the read-side of the Admin / General
 * Settings page. Settings are cached for 5 min and re-validated on each
 * loadSettings() call. Synchronous getSettings() powers the
 * GuestTrialProvider's pre-flight checks.
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("getSettings — sync (U-53)", () => {
  it("returns DEFAULTS when cache is empty", () => {
    expect(getSettings()).toEqual(DEFAULTS);
  });

  it("merges cached overrides on top of DEFAULTS", () => {
    localStorage.setItem(
      "datiq.globalSettings",
      JSON.stringify({ ts: Date.now(), settings: { guest_trial_soft_limit: 5 } }),
    );
    expect(getSettings().guest_trial_soft_limit).toBe(5);
    // Other fields still use defaults
    expect(getSettings().guest_single_hard_limit).toBe(DEFAULTS.guest_single_hard_limit);
  });
});

describe("loadSettings — async (U-54)", () => {
  it("fetches and caches; second call within TTL returns cached value (no second fetch)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, settings: { guest_trial_soft_limit: 7 } }), {
          status: 200,
        }),
      );
    globalThis.fetch = fetchMock;

    const a = await loadSettings();
    expect(a.guest_trial_soft_limit).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const b = await loadSettings();
    expect(b.guest_trial_soft_limit).toBe(7);
    // Cache hit — no second fetch
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("failure → returns DEFAULTS (or cached) without throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Network unreachable");
    });
    const s = await loadSettings();
    expect(s).toEqual(DEFAULTS);
  });
});

describe("updateCachedSettings (U-55)", () => {
  it("reflects on next getSettings() call", () => {
    updateCachedSettings({ guest_trial_soft_limit: 10 });
    expect(getSettings().guest_trial_soft_limit).toBe(10);
    // Other fields stay default
    expect(getSettings().guest_single_hard_limit).toBe(DEFAULTS.guest_single_hard_limit);
  });
});
