// src/lib/outcomeTiles.test.js — Q3 (outcome tiles) data sanity tests.

import { describe, expect, it } from "vitest";
import { OUTCOME_TILES, getOutcomeTile } from "./outcomeTiles.js";

describe("Q3 — outcomeTiles: data shape", () => {
  it("exports exactly 6 outcome tiles", () => {
    expect(OUTCOME_TILES).toHaveLength(6);
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
