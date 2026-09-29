// providerRegistry.test.js — the catalogue every other provider module reads.
//
// Its whole reason for existing is that provider knowledge used to be scattered
// across four files that each knew a different subset, with nothing recording
// WHICH FEATURE a provider served. These tests keep the registry and its
// consumers from drifting apart again.
import { describe, it, expect } from "vitest";
import {
  PROVIDERS, PROVIDER_KEYS, AI_PROVIDERS, SCRAPE_PROVIDERS_LIST, INTEL_PROVIDERS,
  FUNCTION_AREAS, FUNCTION_AREA_KEYS, AI_AREA_KEYS, MODEL_TIER, PROVIDER_KIND,
  areasForProvider, keyEnvNames, readKey, defaultModel,
  RETIRED_GEMINI_MODELS, isRetiredGeminiModel,
} from "./providerRegistry.js";
import { CAPABILITY_SCHEMAS } from "./extractionSchemas.js";
import { RELATED_PAGE_HINTS, QUICK_ACTION_BY_KEY } from "./extractionPresets.js";

describe("catalogue integrity", () => {
  it("every provider has a kind, a label and a resolvable key policy", () => {
    for (const k of PROVIDER_KEYS) {
      const p = PROVIDERS[k];
      expect(Object.values(PROVIDER_KIND), k).toContain(p.kind);
      expect(p.label, k).toBeTruthy();
      // Either it needs no key, or it names at least one env var to read.
      if (p.requiresKey !== false) expect(keyEnvNames(k).length, k).toBeGreaterThan(0);
    }
  });

  it("every AI provider declares both model tiers", () => {
    for (const k of AI_PROVIDERS) {
      expect(PROVIDERS[k].models.fast, k).toBeTruthy();
      expect(PROVIDERS[k].models.deep, k).toBeTruthy();
      // The catalogue is a picker hint, so the defaults must be IN it or the
      // console shows a value its own dropdown does not offer.
      expect(PROVIDERS[k].models.catalogue, k).toContain(PROVIDERS[k].models.fast);
      expect(PROVIDERS[k].models.catalogue, k).toContain(PROVIDERS[k].models.deep);
    }
  });

  it("the kind groups partition the catalogue exactly", () => {
    expect([...AI_PROVIDERS, ...SCRAPE_PROVIDERS_LIST, ...INTEL_PROVIDERS].sort())
      .toEqual([...PROVIDER_KEYS].sort());
  });
});

describe("function areas", () => {
  it("every area's default chain names only real providers OF THE RIGHT KIND", () => {
    // A scrape area whose chain named an AI provider would resolve to a
    // provider with no scrape adapter and fail at request time, not at review.
    for (const a of FUNCTION_AREA_KEYS) {
      const area = FUNCTION_AREAS[a];
      expect(area.defaultOrder.length, a).toBeGreaterThan(0);
      for (const p of area.defaultOrder) {
        expect(PROVIDERS[p], `${a} -> ${p}`).toBeTruthy();
        expect(PROVIDERS[p].kind, `${a} -> ${p}`).toBe(area.kind);
      }
    }
  });

  it("every area says what a user sees and where the code calls it", () => {
    // The callsite field is what keeps "add an area" from being half a job:
    // an area whose calling code never passes its id is a config nobody reads.
    for (const a of FUNCTION_AREA_KEYS) {
      expect(FUNCTION_AREAS[a].userVisibleAs, a).toBeTruthy();
      expect(FUNCTION_AREAS[a].callsite, a).toBeTruthy();
      expect(FUNCTION_AREAS[a].blurb, a).toBeTruthy();
    }
  });

  it("AI areas declare a valid tier; only AI areas are overridable", () => {
    for (const a of AI_AREA_KEYS) {
      expect(Object.values(MODEL_TIER), a).toContain(FUNCTION_AREAS[a].defaultTier);
      expect(FUNCTION_AREAS[a].kind).toBe(PROVIDER_KIND.AI);
    }
    expect(AI_AREA_KEYS).not.toContain("scrape");
  });

  it("classification runs on the FAST tier and synthesis on DEEP", () => {
    // The whole point of tiering: tagging 60 links and writing a client-facing
    // brief must not share a model.
    expect(FUNCTION_AREAS.classification.defaultTier).toBe(MODEL_TIER.FAST);
    expect(FUNCTION_AREAS.synthesis.defaultTier).toBe(MODEL_TIER.DEEP);
    expect(FUNCTION_AREAS.enrichment.defaultTier).toBe(MODEL_TIER.DEEP);
  });

  it("the scrape chain puts the lowest-fidelity provider LAST", () => {
    // Production had `direct` first, so every page a paid provider could have
    // rendered properly came back as raw unrendered HTML instead.
    const order = FUNCTION_AREAS.scrape.defaultOrder;
    expect(order[order.length - 1]).toBe("direct");
    expect(order[0]).toBe("firecrawl");
  });

  it("areasForProvider answers 'if I disable this, what breaks?'", () => {
    expect(areasForProvider("firecrawl")).toEqual(expect.arrayContaining(["scrape", "map"]));
    expect(areasForProvider("gemini")).toContain("enrichment");
    expect(areasForProvider("pagespeed")).toEqual(["vitals"]);
  });
});

describe("key + model resolution", () => {
  it("reads the primary env var, then the fallback, and never leaks a default", () => {
    expect(readKey("gemini", { GEMINI_API_KEY: "g" })).toBe("g");
    expect(readKey("anthropic", { ANTHROPIC_API_KEY: "explicit" })).toBe("explicit");
    // AI_API_KEY is the LEGACY name, kept so staging/production keep resolving
    // the credential they resolve today — reordering the list must never double
    // as a key rotation.
    expect(readKey("anthropic", { AI_API_KEY: "legacy" })).toBe("legacy");
    expect(readKey("anthropic", { ANTHROPIC_API_KEY: "explicit", AI_API_KEY: "legacy" })).toBe("explicit");
    expect(readKey("gemini", {})).toBe("");
  });

  it("a VITE_-prefixed name is never a server key source", () => {
    // 🔴 This assertion used to be the OPPOSITE — the suite pinned
    // `VITE_AI_API_KEY` as the anthropic fallback, so the "fix" that put a live
    // `sk-ant-api03-…` in the public browser bundle was, by the repo's own
    // tests, correct behaviour. A `VITE_` name is inlined into the shipped JS
    // by definition, so it cannot be a server credential.
    expect(readKey("anthropic", { VITE_AI_API_KEY: "sk-ant-browser" })).toBe("");
    expect(keyEnvNames("anthropic")).not.toContain("VITE_AI_API_KEY");
  });

  it("a single *_MODEL env var pins BOTH tiers", () => {
    // It predates tiering, and the operator who set it meant "use exactly
    // this" — honouring it for only half the tiers would silently retire a
    // live setting.
    const env = { GEMINI_MODEL: "gemini-pinned" };
    expect(defaultModel("gemini", MODEL_TIER.FAST, env)).toBe("gemini-pinned");
    expect(defaultModel("gemini", MODEL_TIER.DEEP, env)).toBe("gemini-pinned");
  });

  it("tier-specific env vars override fast and deep individually", () => {
    const env = {
      GEMINI_MODEL_FAST: "gemini-custom-fast",
      GEMINI_MODEL_DEEP: "gemini-custom-deep",
    };
    expect(defaultModel("gemini", MODEL_TIER.FAST, env)).toBe("gemini-custom-fast");
    expect(defaultModel("gemini", MODEL_TIER.DEEP, env)).toBe("gemini-custom-deep");
  });

  it("tier-specific env vars take precedence over generic GEMINI_MODEL", () => {
    const env = {
      GEMINI_MODEL: "gemini-generic",
      GEMINI_MODEL_FAST: "gemini-specific-fast",
    };
    expect(defaultModel("gemini", MODEL_TIER.FAST, env)).toBe("gemini-specific-fast");
    expect(defaultModel("gemini", MODEL_TIER.DEEP, env)).toBe("gemini-generic");
  });

  it("falls back to the registry tier defaults with no env", () => {
    expect(defaultModel("gemini", MODEL_TIER.FAST, {})).toBe(PROVIDERS.gemini.models.fast);
    expect(defaultModel("gemini", MODEL_TIER.DEEP, {})).toBe(PROVIDERS.gemini.models.deep);
  });

  it("identifies retired Gemini models accurately", () => {
    for (const retired of RETIRED_GEMINI_MODELS) {
      expect(isRetiredGeminiModel(retired)).toBe(true);
    }
    expect(isRetiredGeminiModel("gemini-2.0-flash")).toBe(true);
    expect(isRetiredGeminiModel("gemini-2.5-pro")).toBe(true);
    expect(isRetiredGeminiModel("gemini-1.5-flash")).toBe(true);
    expect(isRetiredGeminiModel("gemini-3.8-flash")).toBe(false);
    expect(isRetiredGeminiModel("gemini-pro-latest")).toBe(false);
    expect(isRetiredGeminiModel("gemini-flash-latest")).toBe(false);
  });
});

describe("capability wiring stays consistent across modules", () => {
  it("every schema capability is a known quick action with related-page hints", () => {
    // Three modules describe the same capability set. When they drift, the
    // server whitelists a key the client never sends (or vice versa) and the
    // capability silently loses its subpage scanning.
    for (const key of Object.keys(CAPABILITY_SCHEMAS)) {
      expect(QUICK_ACTION_BY_KEY[key], key).toBeTruthy();
      expect(RELATED_PAGE_HINTS, key).toHaveProperty(key);
    }
  });

  it("every quick action has a schema, so no capability falls back to free-text", () => {
    for (const key of Object.keys(QUICK_ACTION_BY_KEY)) {
      expect(CAPABILITY_SCHEMAS[key], key).toBeTruthy();
    }
  });

  it("every capability schema declares groups the UI can render", () => {
    for (const [key, cap] of Object.entries(CAPABILITY_SCHEMAS)) {
      expect(cap.groups.length, key).toBeGreaterThan(0);
      for (const g of cap.groups) {
        // A declared group with no matching schema property renders an empty
        // section header — worse than not declaring it.
        expect(cap.schema.properties, `${key}.${g.key}`).toHaveProperty(g.key);
      }
      expect(cap.schema.properties.evidence, key).toBeTruthy();
    }
  });
});
