import { describe, expect, it } from "vitest";
import { PERSONAS, PERSONA_BY_ID } from "./personaConfig.js";

/**
 * U-38 — personaConfig defines the 7 personas that shape the product
 * experience. Schema invariants here keep the persona-aware components
 * safe (Home, Dashboard, Onboarding, TopBar) — a missing icon or
 * duplicate id is a release blocker.
 */

describe("PERSONAS schema (U-38)", () => {
  it("has 7 entries", () => {
    expect(PERSONAS.length).toBe(7);
  });

  it("ids are unique", () => {
    const ids = PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each persona has id, label, icon, tagline", () => {
    for (const p of PERSONAS) {
      expect(p.id, `${p.id}.id is required`).toBeTruthy();
      expect(p.label, `${p.id}.label is required`).toBeTruthy();
      expect(p.icon, `${p.id}.icon is required`).toBeTruthy();
      expect(p.tagline, `${p.id}.tagline is required`).toBeTruthy();
    }
  });

  it("PERSONA_BY_ID keys by id and is in sync with PERSONAS", () => {
    for (const p of PERSONAS) {
      expect(PERSONA_BY_ID[p.id]?.id).toBe(p.id);
    }
  });
});
