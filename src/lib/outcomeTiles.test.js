// src/lib/outcomeTiles.test.js — Q3 (outcome tiles) data sanity tests.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { OUTCOME_TILES, MODULE_TILES, PRICING_WATCH_TILE, homeTiles, getOutcomeTile } from "./outcomeTiles.js";

describe("Q3 — outcomeTiles: data shape", () => {
  it("exports exactly 7 outcome tiles (the content brief joined 2026-09-24)", () => {
    expect(OUTCOME_TILES).toHaveLength(7);
    expect(OUTCOME_TILES.map((t) => t.key)).toContain("content");
  });

  it("every tile has the required fields and a non-empty example URL", () => {
    for (const tile of OUTCOME_TILES) {
      expect(tile.key).toBeTypeOf("string");
      expect(tile.key.length).toBeGreaterThan(0);
      expect(tile.icon).toBeTypeOf("string");
      expect(tile.title).toBeTypeOf("string");
      expect(tile.title.length).toBeGreaterThan(0);
      expect(tile.desc).toBeTypeOf("string");
      expect(tile.desc.length).toBeGreaterThan(0);
      expect(tile.example?.url).toMatch(/^https?:\/\//);
      expect(tile.prompt).toBeTypeOf("string");
      expect(tile.prompt.length).toBeGreaterThan(20);
    }
  });

  it("every key is unique", () => {
    const keys = OUTCOME_TILES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("getOutcomeTile returns the matching tile or null", () => {
    expect(getOutcomeTile("lead").key).toBe("lead");
    expect(getOutcomeTile("nope")).toBeNull();
  });

  it("every tile's example URL is unique", () => {
    const urls = OUTCOME_TILES.map((t) => t.example.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("Common jobs — 12 tiles (owner, 2026-09-24)", () => {
  // Top-level routes the app serves, read from App.jsx rather than restated.
  const APP_ROUTES = new Set(
    [...readFileSync(`${process.cwd()}/src/App.jsx`, "utf8").matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
  );

  it("always 12, so the row fills whole rows at 6, 3 and 2 columns", () => {
    for (const engageAccess of [true, false]) {
      const tiles = homeTiles({ engageAccess });
      expect(tiles).toHaveLength(12);
      for (const cols of [6, 3, 2]) expect(tiles.length % cols).toBe(0);
      expect(new Set(tiles.map((t) => t.key)).size).toBe(12);
    }
  });

  it("the outreach tile only for accounts in the Engagement beta", () => {
    expect(homeTiles({ engageAccess: true }).map((t) => t.key)).toContain("outreach");
    const outside = homeTiles({ engageAccess: false }).map((t) => t.key);
    expect(outside).not.toContain("outreach");
    expect(outside).toContain("pricing-watch");
  });

  it("every open tile names a real route and its module", () => {
    for (const t of [...MODULE_TILES, PRICING_WATCH_TILE]) {
      expect(APP_ROUTES, t.key).toContain(t.open.to.split("?")[0]);
      expect(t.open.module, t.key).toBeTruthy();
    }
  });

  it("the Discover tile prefills the audit and never asks to run it", () => {
    const tile = getOutcomeTile("ai-visibility");
    expect(tile.open.state("https://acme.test/")).toEqual({ auditUrl: "https://acme.test/" });
    expect(tile.open.state(null)).toBeUndefined();
  });

  it("the pricing watch opens the schedule editor on a weekly pricing draft", () => {
    const st = PRICING_WATCH_TILE.open.state("https://acme.test/pricing");
    expect(st.openEditor).toBe(true);
    expect(st.draftSchedule).toMatchObject({ target: "https://acme.test/pricing", intent: "pricing", cadenceKey: "weekly" });
  });
});
