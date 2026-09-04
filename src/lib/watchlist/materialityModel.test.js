import { describe, it, expect } from "vitest";
import {
  classifyMateriality,
  buildChangeRecord,
  MATERIALITY,
} from "./materialityModel.js";

describe("materialityModel", () => {
  it("classifies copyright year changes as LOW materiality", () => {
    const res = classifyMateriality({
      field: "footer_text",
      category: "other",
      oldValue: "© 2025 Acme Inc. All rights reserved.",
      newValue: "© 2026 Acme Inc. All rights reserved.",
    });

    expect(res.materiality).toBe(MATERIALITY.LOW);
    expect(res.alertCadence).toBe("none");
  });

  it("classifies major price increases (>=20%) as CRITICAL materiality", () => {
    const res = classifyMateriality({
      field: "starter_price",
      category: "pricing",
      oldValue: "$50/mo",
      newValue: "$75/mo",
    });

    expect(res.materiality).toBe(MATERIALITY.CRITICAL);
    expect(res.alertCadence).toBe("immediate");
    expect(res.reason).toContain("50.0%");
  });

  it("classifies modest price changes (<20%) as HIGH materiality", () => {
    const res = classifyMateriality({
      field: "starter_price",
      category: "pricing",
      oldValue: "$100/mo",
      newValue: "$110/mo",
    });

    expect(res.materiality).toBe(MATERIALITY.HIGH);
    expect(res.alertCadence).toBe("daily");
    expect(res.reason).toContain("10.0%");
  });

  it("classifies core positioning pivots as CRITICAL materiality", () => {
    const res = classifyMateriality({
      field: "hero_headline",
      category: "positioning",
      oldValue: "The modern CRM for small business sales teams",
      newValue: "Enterprise AI orchestration platform for Fortune 500 banks",
    });

    expect(res.materiality).toBe(MATERIALITY.CRITICAL);
    expect(res.alertCadence).toBe("immediate");
    expect(res.reason).toContain("Major positioning");
  });

  it("builds strictly separated fact summary and AI interpretation", () => {
    const rec = buildChangeRecord({
      targetDomain: "competitor.com",
      field: "pro_plan",
      category: "pricing",
      oldValue: "$49/mo",
      newValue: "$99/mo",
    });

    expect(rec.factSummary).toBe("'pro_plan' changed on competitor.com from \"$49/mo\" to \"$99/mo\"");
    expect(rec.aiInterpretation).toContain("High-impact change on competitor.com");
    expect(rec.materiality).toBe(MATERIALITY.CRITICAL);
  });
});
