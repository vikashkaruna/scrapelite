// src/lib/scrapeConsentService.test.js
//
// The client half of "I have permission to extract this site". Two things are
// worth pinning: host normalisation must agree with the server's (a grant
// stored under one spelling and read under another is a grant that silently
// never applies), and the pre-flight hint must stay a HINT — broad enough to
// be useful, and never confused with the grant itself.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  consentHostOf,
  knownDisallowedHost,
  hasConsentFor,
  KNOWN_DISALLOWED_HOSTS,
} from "./scrapeConsentService.js";

vi.mock("./apiClient.js", () => ({
  apiClient: { getScrapeConsent: vi.fn() },
}));
const { apiClient } = await import("./apiClient.js");

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("consentHostOf", () => {
  it("lowercases and strips www., so one grant covers both spellings", () => {
    expect(consentHostOf("https://www.LinkedIn.com/in/someone")).toBe("linkedin.com");
    expect(consentHostOf("LinkedIn.com")).toBe("linkedin.com");
  });

  it("keeps other subdomains distinct", () => {
    // Permission for a company's careers site is not permission for its API
    // host, so normalisation must not collapse to the registrable domain.
    expect(consentHostOf("https://api.example.com")).toBe("api.example.com");
    expect(consentHostOf("https://careers.example.com")).toBe("careers.example.com");
  });

  it("drops path, query and fragment", () => {
    expect(consentHostOf("https://linkedin.com/in/x?y=1#z")).toBe("linkedin.com");
  });

  it("returns empty for junk rather than guessing", () => {
    expect(consentHostOf("")).toBe("");
    expect(consentHostOf(null)).toBe("");
  });
});

describe("knownDisallowedHost — the pre-flight hint", () => {
  it("recognises a known blocked site from a full URL", () => {
    expect(knownDisallowedHost("https://www.linkedin.com/in/vikashkaruna")?.label).toBe("LinkedIn");
  });

  it("matches subdomains too", () => {
    // A WARNING may be broad; a GRANT may not. These are deliberately
    // different rules, and this is the broad one.
    expect(knownDisallowedHost("https://in.linkedin.com/company/x")?.label).toBe("LinkedIn");
  });

  it("does not fire for an ordinary site", () => {
    expect(knownDisallowedHost("https://example.com/pricing")).toBeNull();
  });

  it("does not fire on a lookalike domain", () => {
    // "notlinkedin.com" must not match "linkedin.com" via a bare substring.
    expect(knownDisallowedHost("https://notlinkedin.com/x")).toBeNull();
  });

  it("lists every entry with a host and a human label", () => {
    for (const entry of KNOWN_DISALLOWED_HOSTS) {
      expect(entry.host).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });
});

describe("hasConsentFor", () => {
  it("reports a granted host", async () => {
    apiClient.getScrapeConsent.mockResolvedValue({ granted: true });
    expect(await hasConsentFor("linkedin.com")).toBe(true);
  });

  it("reads an unreachable endpoint as NO grant", async () => {
    // Fail closed. The opposite would let a network blip look like permission
    // to scrape a site that refused us.
    apiClient.getScrapeConsent.mockRejectedValue(new Error("offline"));
    expect(await hasConsentFor("linkedin.com")).toBe(false);
  });

  it("does not call the API for an unusable host", async () => {
    expect(await hasConsentFor("")).toBe(false);
    expect(apiClient.getScrapeConsent).not.toHaveBeenCalled();
  });
});
