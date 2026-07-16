import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrationService.js";

/**
 * U-43..44 — migrationService copies `scrapelite.*` keys to `datiq.*`
 * on first load so existing users don't lose their state after the
 * V6 rebrand. The contract is "copy once, then no-op forever".
 */

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("runMigrations (U-43)", () => {
  it("copies all known scrapelite.* keys to datiq.* when no datiq.* exists", () => {
    localStorage.setItem("scrapelite.persona", JSON.stringify({ id: "sales" }));
    localStorage.setItem("scrapelite.saved", JSON.stringify([{ id: "ext_1" }]));
    localStorage.setItem("scrapelite.theme", "dark");

    runMigrations();

    expect(localStorage.getItem("datiq.persona")).toBe(JSON.stringify({ id: "sales" }));
    expect(localStorage.getItem("datiq.saved")).toBe(JSON.stringify([{ id: "ext_1" }]));
    expect(localStorage.getItem("datiq.theme")).toBe("dark");
    expect(localStorage.getItem("datiq.migrated")).toBe("1");
  });

  it("copies datiq.tip.* keys from scrapelite.tip.*", () => {
    localStorage.setItem("scrapelite.tip.sales", "shown");
    runMigrations();
    expect(localStorage.getItem("datiq.tip.sales")).toBe("shown");
  });

  it("does not overwrite an existing datiq.* key (preserves newer data)", () => {
    localStorage.setItem("scrapelite.saved", JSON.stringify([{ id: "old" }]));
    localStorage.setItem("datiq.saved", JSON.stringify([{ id: "new" }]));
    runMigrations();
    expect(localStorage.getItem("datiq.saved")).toBe(JSON.stringify([{ id: "new" }]));
  });
});

describe("runMigrations — idempotent (U-44)", () => {
  it("a second run is a no-op (does not copy again, does not duplicate the flag)", () => {
    localStorage.setItem("scrapelite.saved", JSON.stringify([{ id: "ext_1" }]));
    runMigrations();
    const first = localStorage.getItem("datiq.saved");
    expect(first).toBe(JSON.stringify([{ id: "ext_1" }]));

    // Now mutate the source; second migration should be a no-op
    localStorage.setItem("scrapelite.saved", JSON.stringify([{ id: "ext_2" }]));
    runMigrations();
    expect(localStorage.getItem("datiq.saved")).toBe(first);
  });
});
