import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertPrice,
  detectCurrency,
  formatPrice,
  getDefaultRates,
  getRates,
} from "./currencyService.js";

/**
 * U-09..11 — currency service is the single source of truth for the
 * "USD vs INR" choice and the USD→INR conversion. detectCurrency runs
 * once at first visit; the rest is pure conversion + formatting.
 */

describe("detectCurrency (U-09)", () => {
  // Save originals so we can restore after each test.
  const originalDateTimeFormat = Intl.DateTimeFormat;
  const originalLanguage = navigator.language;

  afterEach(() => {
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: originalDateTimeFormat,
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: originalLanguage,
    });
  });

  /**
   * Replace Intl.DateTimeFormat with a stub whose `resolvedOptions().timeZone`
   * returns the supplied value. The stub is a function (constructable) so
   * `new Intl.DateTimeFormat()` and `Intl.DateTimeFormat()` both work —
   * detectCurrency uses the function-call form, the spec supports both.
   */
  function stubTimezone(tz) {
    const Stub = function StubDateTimeFormat() {
      // `new.target` lets the function serve as a constructor.
      if (!(this instanceof Stub)) return new Stub();
      return {
        resolvedOptions: () => ({ timeZone: tz }),
        format: () => "",
        formatToParts: () => [],
      };
    };
    Object.defineProperty(Intl, "DateTimeFormat", {
      configurable: true,
      writable: true,
      value: Stub,
    });
  }

  it("Asia/Kolkata → INR", () => {
    stubTimezone("Asia/Kolkata");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    expect(detectCurrency()).toBe("INR");
  });

  it("Asia/Calcutta → INR", () => {
    stubTimezone("Asia/Calcutta");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    expect(detectCurrency()).toBe("INR");
  });

  it("America/New_York + en-US → USD", () => {
    stubTimezone("America/New_York");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
    expect(detectCurrency()).toBe("USD");
  });

  it("Europe/London + en-GB → USD", () => {
    stubTimezone("Europe/London");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-GB" });
    expect(detectCurrency()).toBe("USD");
  });

  it("language suffix -in → INR even with non-Indian timezone", () => {
    stubTimezone("America/New_York");
    Object.defineProperty(navigator, "language", { configurable: true, value: "en-IN" });
    expect(detectCurrency()).toBe("INR");
  });
});

describe("convertPrice (U-10)", () => {
  it("INR uses DEFAULT_RATES.INR (no live conversion needed)", () => {
    const result = convertPrice(10, getDefaultRates(), "INR");
    expect(result).toBe(10 * 83.5);
  });

  it("USD is a no-op (rate = 1)", () => {
    const result = convertPrice(19, { USD: 1, INR: 83.5 }, "USD");
    expect(result).toBe(19);
  });

  it("falls back to DEFAULT_RATES when rate missing", () => {
    const result = convertPrice(10, { USD: 1 }, "INR");
    expect(result).toBe(10 * 83.5);
  });

  it("returns 0 for falsy usdAmount", () => {
    expect(convertPrice(0, getDefaultRates(), "INR")).toBe(0);
    expect(convertPrice(null, getDefaultRates(), "INR")).toBe(0);
    expect(convertPrice(undefined, getDefaultRates(), "INR")).toBe(0);
  });
});

describe("formatPrice (U-11)", () => {
  it("USD renders $X for whole numbers; $X.XX for fractional", () => {
    expect(formatPrice(19, "USD")).toBe("$19");
    expect(formatPrice(19.5, "USD")).toBe("$19.50");
    expect(formatPrice(0, "USD")).toBe("$0");
  });

  it("INR renders ₹X,XXX (rounded; en-IN thousands separator)", () => {
    expect(formatPrice(999, "INR")).toBe("₹999");
    expect(formatPrice(1499, "INR")).toBe("₹1,499");
    expect(formatPrice(99999, "INR")).toBe("₹99,999");
  });
});

describe("getRates — fetch + cache (U-10, U-11)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached rates when fresh", async () => {
    const futureFetchedAt = Date.now() + 60_000;
    localStorage.setItem(
      "datiq.currencyRates",
      JSON.stringify({ rates: { USD: 1, INR: 90 }, fetchedAt: futureFetchedAt }),
    );
    const rates = await getRates();
    expect(rates.INR).toBe(90);
  });

  it("falls back to DEFAULT_RATES when fetch fails and no cache", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const rates = await getRates();
    expect(rates).toEqual(getDefaultRates());
  });
});
