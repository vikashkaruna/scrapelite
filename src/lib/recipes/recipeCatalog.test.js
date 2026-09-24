import { describe, it, expect } from "vitest";
import {
  RECIPES, RECIPE_READINESS, RECIPE_PROVIDERS, recipesForPersona, isRunnable,
} from "./recipeCatalog.js";
import { PUSH_PROVIDERS } from "../integrationsClient.js";
import { PERSONAS, LEGACY_PERSONAS } from "../personaConfig.js";
import { SEED_TEMPLATES } from "../templates/seedTemplates.js";

describe("the catalogue cannot promise what the product cannot do", () => {
  // A gallery advertising a destination that does not exist teaches the user
  // on their first click that the page is decorative.
  it("every recipe targets a real push provider", () => {
    const real = new Set(PUSH_PROVIDERS.map((p) => p.slug));
    for (const r of RECIPES) expect(real, `${r.key} → ${r.provider}`).toContain(r.provider);
  });

  it("RECIPE_PROVIDERS matches the shipped provider list exactly", () => {
    expect([...RECIPE_PROVIDERS].sort()).toEqual(PUSH_PROVIDERS.map((p) => p.slug).sort());
  });

  it("every recipe targets real personas", () => {
    // Current roles plus the hidden legacy one (recruiter), which still resolves.
    const real = new Set([...PERSONAS, ...LEGACY_PERSONAS].map((p) => p.id));
    for (const r of RECIPES) for (const p of r.personas) {
      expect(real, `${r.key} → persona ${p}`).toContain(p);
    }
  });

  // A CTA into a template that is not seeded is a 404 for the user and a
  // broken promise for the gallery.
  it("every recipe naming a template names a real, published one", () => {
    const published = new Set(SEED_TEMPLATES.filter((t) => t.status === "published").map((t) => t.template_key));
    for (const r of RECIPES.filter((x) => x.template)) {
      expect(published, `${r.key} → template ${r.template}`).toContain(r.template);
    }
  });

  it("every runnable recipe has a CTA, and no rules-tier recipe pretends to", () => {
    for (const r of RECIPES) {
      if (r.readiness === RECIPE_READINESS.RULES) {
        expect(isRunnable(r), `${r.key} is rules-tier and must not be runnable`).toBe(false);
        expect(r.phase, `${r.key} must say which phase it waits on`).toBeTruthy();
      } else {
        expect(r.cta?.to, `${r.key} claims to be runnable but has no destination`).toBeTruthy();
        expect(isRunnable(r)).toBe(true);
      }
    }
  });

  it("states an outcome, a trigger and an action for every recipe", () => {
    for (const r of RECIPES) {
      for (const field of ["title", "outcome", "when", "then"]) {
        expect(String(r[field] || "").length, `${r.key}.${field}`).toBeGreaterThan(10);
      }
    }
  });

  it("has unique keys", () => {
    expect(new Set(RECIPES.map((r) => r.key)).size).toBe(RECIPES.length);
  });
});

describe("recipesForPersona", () => {
  it("returns everything for no persona", () => {
    expect(recipesForPersona(null)).toHaveLength(RECIPES.length);
    expect(recipesForPersona("not-a-persona")).toHaveLength(0);
  });

  // A gallery that leads with what the user cannot do yet reads as a roadmap,
  // and a roadmap does not convert anybody.
  it("orders runnable recipes ahead of roadmap ones", () => {
    const order = recipesForPersona(null).map((r) => r.readiness);
    const firstRules = order.indexOf(RECIPE_READINESS.RULES);
    if (firstRules !== -1) {
      expect(order.slice(firstRules).every((s) => s === RECIPE_READINESS.RULES)).toBe(true);
    }
  });

  it("gives every shipped persona at least one runnable recipe", () => {
    for (const p of PERSONAS) {
      const runnable = recipesForPersona(p.id).filter(isRunnable);
      expect(runnable.length, `persona "${p.id}" has no runnable recipe`).toBeGreaterThan(0);
    }
  });

  it("does not mutate the source catalogue when sorting", () => {
    const before = RECIPES.map((r) => r.key).join(",");
    recipesForPersona(null);
    recipesForPersona("sales");
    expect(RECIPES.map((r) => r.key).join(",")).toBe(before);
  });
});
