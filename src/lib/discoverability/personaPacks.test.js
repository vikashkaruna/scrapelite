import { describe, it, expect } from "vitest";
import {
  PERSONA_PACKS,
  PERSONA_PACK_IDS,
  filterPersonaQueue,
} from "./personaPacks.js";

describe("personaPacks — 7 persona action packs (Deliverable 4.3)", () => {
  it("defines exactly 7 persona packs (§5 / §11.11)", () => {
    expect(PERSONA_PACK_IDS.length).toBe(7);
    expect(PERSONA_PACK_IDS).toEqual([
      "seo",
      "content",
      "ux",
      "cro",
      "product_marketing",
      "agency_client",
      "local_operator",
    ]);
  });

  it("filters recommendations by persona relevance without duplicating queue", () => {
    const canonicalQueue = [
      { id: "rec-1", title: "Fix schema", owner: "engineering", pillar: "technical_accessibility" },
      { id: "rec-2", title: "Add pricing tiers", owner: "product_marketing", pillar: "answer_clarity" },
      { id: "rec-3", title: "Optimize booking CTA", owner: "growth_cro", pillar: "answer_clarity" },
      { id: "rec-4", title: "Add NAP address", owner: "local_ops", pillar: "entity_authority" },
    ];

    // SEO lens
    const seoQueue = filterPersonaQueue(canonicalQueue, "seo");
    expect(seoQueue.matched_count).toBe(1);
    expect(seoQueue.recommendations[0].id).toBe("rec-1");

    // CRO lens
    const croQueue = filterPersonaQueue(canonicalQueue, "cro");
    expect(croQueue.matched_count).toBe(1);
    expect(croQueue.recommendations[0].id).toBe("rec-3");

    // Local operator lens
    const localQueue = filterPersonaQueue(canonicalQueue, "local_operator");
    expect(localQueue.matched_count).toBe(1);
    expect(localQueue.recommendations[0].id).toBe("rec-4");
  });
});
