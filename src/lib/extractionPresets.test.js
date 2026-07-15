import { describe, expect, it } from "vitest";
import {
  CONTACTS_PROMPT,
  QUICK_ACTION_BY_KEY,
  QUICK_ACTIONS,
  enrichMeta,
  resolveCustomPrompt,
} from "./extractionPresets.js";

describe("extraction presets", () => {
  it("exposes unique, addressable quick-enrichment capabilities", () => {
    expect(QUICK_ACTIONS).toHaveLength(5);
    expect(new Set(QUICK_ACTIONS.map((action) => action.key)).size).toBe(QUICK_ACTIONS.length);
    expect(QUICK_ACTION_BY_KEY.pricing.label).toBe("Pricing & Plans");
  });

  it("returns preset metadata and a safe generic custom fallback", () => {
    expect(enrichMeta("contacts")).toEqual(expect.objectContaining({ key: "contacts", icon: "mail" }));
    expect(enrichMeta("")).toEqual({ key: "custom", label: "Custom extraction", icon: "code" });
  });

  it("resolves contacts and custom prompts without retaining whitespace", () => {
    expect(resolveCustomPrompt({ customMode: true, customPrompt: "  Find founders  ", contactsMode: false }))
      .toBe("Find founders");
    expect(resolveCustomPrompt({ customMode: false, customPrompt: "Ignored", contactsMode: true }))
      .toBe(CONTACTS_PROMPT);
    expect(resolveCustomPrompt({ customMode: true, customPrompt: "Find founders", contactsMode: true }))
      .toBe(`${CONTACTS_PROMPT}\n\nAlso: Find founders`);
    expect(resolveCustomPrompt({ customMode: false, customPrompt: "", contactsMode: false })).toBe("");
  });
});
