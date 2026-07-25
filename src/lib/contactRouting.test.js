// contactRouting.test.js — enquiry type → inbox mapping.
//
// DatIQ ships exactly two customer-facing addresses. These tests are the guard
// that a new enquiry type can't quietly introduce a third, or land legal /
// privacy traffic in the general support inbox.

import { describe, expect, it } from "vitest";
import {
  CONTACT_TYPES,
  CONTACT_TYPE_BY_VALUE,
  DEFAULT_CONTACT_TYPE,
  INBOX,
  INBOX_EMAIL,
  INBOX_TAG,
  buildSubject,
  emailForType,
  inboxForType,
  isContactType,
  labelForType,
  normalizeContactType,
} from "./contactRouting.js";

describe("contactRouting — inbox constants", () => {
  it("exposes exactly two customer-facing inboxes", () => {
    expect(Object.values(INBOX_EMAIL).sort()).toEqual([
      "admin@datiq.app",
      "hello@datiq.app",
    ]);
  });

  it("never exposes a retired address", () => {
    const all = JSON.stringify({ INBOX_EMAIL, CONTACT_TYPES });
    for (const retired of ["support@datiq.app", "legal@datiq.app", "privacy@datiq.app"]) {
      expect(all).not.toContain(retired);
    }
  });
});

describe("contactRouting — type table", () => {
  it("every type has a value, label, registered icon and a known inbox", () => {
    for (const t of CONTACT_TYPES) {
      expect(t.value).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.icon).toBeTruthy();
      expect(Object.values(INBOX)).toContain(t.inbox);
    }
  });

  it("has no duplicate type values", () => {
    const values = CONTACT_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("the default type is a real type", () => {
    expect(CONTACT_TYPE_BY_VALUE[DEFAULT_CONTACT_TYPE]).toBeDefined();
  });

  it("covers all eight enquiry types the contact form offers", () => {
    expect(CONTACT_TYPES.map((t) => t.value)).toEqual([
      "support", "bug", "billing", "feature",
      "enterprise", "legal", "privacy", "other",
    ]);
  });
});

describe("contactRouting — routing rules", () => {
  it.each(["support", "bug", "billing", "feature", "other"])(
    "%s → hello@datiq.app", (type) => {
      expect(inboxForType(type)).toBe(INBOX.HELLO);
      expect(emailForType(type)).toBe("hello@datiq.app");
    });

  it.each(["enterprise", "legal", "privacy"])(
    "%s → admin@datiq.app", (type) => {
      expect(inboxForType(type)).toBe(INBOX.ADMIN);
      expect(emailForType(type)).toBe("admin@datiq.app");
    });
});

describe("contactRouting — normalizeContactType", () => {
  it("passes through a known type", () => {
    expect(normalizeContactType("billing")).toBe("billing");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeContactType("  PRIVACY ")).toBe("privacy");
  });

  it.each([undefined, null, "", "refund", 42, {}])(
    "falls back to the default for %s", (input) => {
      expect(normalizeContactType(input)).toBe(DEFAULT_CONTACT_TYPE);
    });

  it("an unknown type still routes to a real inbox instead of throwing", () => {
    expect(emailForType("nonsense")).toBe("hello@datiq.app");
  });
});

describe("contactRouting — isContactType", () => {
  it("accepts known values and rejects everything else", () => {
    expect(isContactType("legal")).toBe(true);
    expect(isContactType("refund")).toBe(false);
  });

  it("is not fooled by inherited Object properties", () => {
    expect(isContactType("constructor")).toBe(false);
    expect(isContactType("toString")).toBe(false);
  });
});

describe("contactRouting — buildSubject", () => {
  it("tags the inbox and the enquiry label, then the user subject", () => {
    expect(buildSubject("legal", "DPA request")).toBe(
      "[ADMIN] Legal & terms — DPA request"
    );
  });

  it("uses a generic tail when the user left the subject blank", () => {
    expect(buildSubject("support", "   ")).toBe(
      "[HELLO] Product support — Contact form submission"
    );
  });

  it("tags hello traffic with the hello prefix", () => {
    expect(buildSubject("bug", "Export button dead")).toBe(
      "[HELLO] Bug report — Export button dead"
    );
  });

  it("normalises an unknown type rather than emitting an undefined tag", () => {
    const subject = buildSubject("bogus", "Hi");
    expect(subject).toBe(`[${INBOX_TAG[INBOX.HELLO]}] ${labelForType(DEFAULT_CONTACT_TYPE)} — Hi`);
    expect(subject).not.toContain("undefined");
  });
});
