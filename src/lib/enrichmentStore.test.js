import { describe, expect, it } from "vitest";
import {
  mergeEnrichments,
  readCurrent,
  readEnrichments,
  saveCurrent,
  saveEnrichment,
} from "./enrichmentStore.js";

describe("enrichment persistence", () => {
  it("stores one entry per URL/capability and refreshes it in place", () => {
    saveEnrichment("https://example.com", { key: "contacts", created_at: "2026-01-01T00:00:00.000Z", data: { total: 1 } });
    saveEnrichment("https://example.com", { key: "contacts", created_at: "2026-01-02T00:00:00.000Z", data: { total: 2 } });
    saveEnrichment("https://other.example", { key: "pricing", data: { total: 3 } });

    expect(readEnrichments("https://example.com")).toEqual({
      contacts: { key: "contacts", created_at: "2026-01-02T00:00:00.000Z", data: { total: 2 } },
    });
    expect(readEnrichments("https://missing.example")).toEqual({});
    expect(readEnrichments("")).toEqual({});
  });

  it("keeps the newest entry per capability when database and local tabs merge", () => {
    const persisted = {
      contacts: { key: "contacts", created_at: "2026-01-01T00:00:00.000Z", data: "old" },
      pricing: { key: "pricing", created_at: "2026-01-03T00:00:00.000Z", data: "database" },
    };
    const local = {
      contacts: { key: "contacts", created_at: "2026-01-02T00:00:00.000Z", data: "new" },
      pricing: { key: "pricing", created_at: "2026-01-01T00:00:00.000Z", data: "stale" },
      social: { key: "social", created_at: "2026-01-02T00:00:00.000Z", data: "local-only" },
    };

    expect(mergeEnrichments(persisted, local)).toEqual({
      contacts: local.contacts,
      pricing: persisted.pricing,
      social: local.social,
    });
  });

  it("persists and clears the current preview safely", () => {
    const current = { id: "ex_1", url: "https://example.com" };
    saveCurrent(current);
    expect(readCurrent()).toEqual(current);
    saveCurrent(null);
    expect(readCurrent()).toBeNull();
  });

  it("degrades gracefully when malformed local data is encountered", () => {
    localStorage.setItem("datiq.enrichments", "not json");
    localStorage.setItem("datiq.current", "not json");
    expect(readEnrichments("https://example.com")).toEqual({});
    expect(readCurrent()).toBeNull();
  });
});
