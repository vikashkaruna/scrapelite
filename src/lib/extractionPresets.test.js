import { describe, expect, it } from "vitest";
import {
  CONTACTS_PROMPT,
  QUICK_ACTIONS,
  QUICK_ACTION_BY_KEY,
  enrichMeta,
  resolveCustomPrompt,
} from "./extractionPresets.js";

/**
 * U-76 — extractionPresets is the shared vocabulary for Quick
 * Enrichment, the Contacts toggle, and the custom-prompt composer.
 * The presets must stay in sync across the Home form, Preview
 * quick-actions, and firecrawlService.
 */

describe("extractionPresets", () => {
  it("CONTACTS_PROMPT is non-empty and mentions leadership", () => {
    expect(typeof CONTACTS_PROMPT).toBe("string");
    expect(CONTACTS_PROMPT.length).toBeGreaterThan(50);
    expect(CONTACTS_PROMPT).toMatch(/leadership|board|executive/i);
  });

  it("QUICK_ACTIONS has 5 entries (contacts, leadership, social, mission, pricing)", () => {
    expect(QUICK_ACTIONS.length).toBe(5);
  });

  it("QUICK_ACTION_BY_KEY keys every entry by its key", () => {
    for (const a of QUICK_ACTIONS) {
      expect(QUICK_ACTION_BY_KEY[a.key]?.key).toBe(a.key);
    }
  });

  it("enrichMeta returns a known entry for a known key", () => {
    const m = enrichMeta("contacts");
    expect(m.label).toBe("Find Contact Info");
    expect(m.icon).toBe("mail");
  });

  it("enrichMeta falls back to a generic 'Custom extraction' for unknown keys", () => {
    const m = enrichMeta("totally-new");
    expect(m.label).toBe("Custom extraction");
  });

  it("enrichMeta handles empty / null key", () => {
    expect(enrichMeta("").label).toBe("Custom extraction");
    expect(enrichMeta(null).label).toBe("Custom extraction");
  });
});

describe("resolveCustomPrompt", () => {
  it("returns the typed prompt when customMode is on", () => {
    expect(
      resolveCustomPrompt({ customMode: true, customPrompt: "Find the founders", contactsMode: false }),
    ).toBe("Find the founders");
  });

  it("returns '' when neither customMode nor contactsMode is on", () => {
    expect(
      resolveCustomPrompt({ customMode: false, customPrompt: "ignored", contactsMode: false }),
    ).toBe("");
  });

  it("returns CONTACTS_PROMPT alone when contactsMode is on", () => {
    expect(
      resolveCustomPrompt({ customMode: false, customPrompt: "", contactsMode: true }),
    ).toBe(CONTACTS_PROMPT);
  });

  it("combines CONTACTS_PROMPT with the typed prompt when both are on", () => {
    const r = resolveCustomPrompt({
      customMode: true,
      customPrompt: "and the pricing",
      contactsMode: true,
    });
    expect(r).toMatch(/leadership/);
    expect(r).toMatch(/Also: and the pricing/);
  });
});
