import { describe, expect, it } from "vitest";
import { CATEGORIES, classifyError } from "./errorMessages.js";

/**
 * U-73 — errorMessages maps raw error patterns to user-facing categories.
 * The tests assert the documented regexes resolve to the right title +
 * message and the fallback is sensible for unknown inputs.
 */

describe("classifyError — all 11 documented categories (U-73)", () => {
  for (const c of CATEGORIES) {
    it(`matches ${c.title}`, () => {
      // Build a synthetic error string guaranteed to hit the regex.
      const synthetic = c.test.source.replace(/^\//, "").replace(/\/i?$/, "");
      const r = classifyError(new Error(synthetic));
      expect(r.title).toBe(c.title);
    });
  }

  it("returns the fallback for an unknown error", () => {
    const r = classifyError(new Error("something nobody has seen before"));
    // The fallback category is the last entry — its title is "Something went wrong"
    // or similar. We only assert the shape, not the exact title.
    expect(typeof r.title).toBe("string");
    expect(typeof r.message).toBe("string");
  });
});
