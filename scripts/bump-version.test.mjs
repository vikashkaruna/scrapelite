import { describe, it, expect } from "vitest";
import { bumpVersion } from "./bump-version.mjs";

describe("bumpVersion", () => {
  it("bumps patch by default", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
    expect(bumpVersion("1.0.9", "patch")).toBe("1.0.10");
  });

  it("bumps minor and resets patch", () => {
    expect(bumpVersion("1.0.5", "minor")).toBe("1.1.0");
  });

  it("bumps major and resets minor + patch", () => {
    expect(bumpVersion("1.4.2", "major")).toBe("2.0.0");
  });

  it("rejects a non-semver version string", () => {
    expect(() => bumpVersion("v1.0", "patch")).toThrow();
    expect(() => bumpVersion("1.0", "patch")).toThrow();
  });
});
