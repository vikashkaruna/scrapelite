import { describe, it, expect } from "vitest";
import { normalizeDomain, dedupeEntries } from "./identityModel.js";

describe("identityModel", () => {
  describe("normalizeDomain", () => {
    it("strips protocols, www, paths, queries, and hashes", () => {
      expect(normalizeDomain("https://www.stripe.com/pricing?ref=1#top")).toBe("stripe.com");
      expect(normalizeDomain("http://stripe.com/")).toBe("stripe.com");
      expect(normalizeDomain("stripe.com")).toBe("stripe.com");
    });

    it("extracts domain from email addresses", () => {
      expect(normalizeDomain("john.doe@acme.com")).toBe("acme.com");
      expect(normalizeDomain("CEO <founder@startup.io>")).toBe("startup.io");
    });

    it("handles ports and uppercase characters", () => {
      expect(normalizeDomain("WWW.GOOGLE.COM:8080/search")).toBe("google.com");
    });

    it("preserves legitimate subdomains while removing www", () => {
      expect(normalizeDomain("https://app.posthog.com/insights")).toBe("app.posthog.com");
      expect(normalizeDomain("https://docs.stripe.com")).toBe("docs.stripe.com");
      expect(normalizeDomain("https://www.blog.github.com")).toBe("blog.github.com");
    });

    it("returns null for invalid domains or empty strings", () => {
      expect(normalizeDomain("")).toBeNull();
      expect(normalizeDomain("not-a-domain")).toBeNull();
      expect(normalizeDomain(null)).toBeNull();
      expect(normalizeDomain("  ")).toBeNull();
    });
  });

  describe("dedupeEntries", () => {
    it("deduplicates mixed format inputs and tracks duplicate counts", () => {
      const inputs = [
        "https://stripe.com/pricing",
        "stripe.com",
        "www.stripe.com",
        "https://github.com",
        "invalid-domain",
        "GITHUB.COM/",
      ];

      const result = dedupeEntries(inputs);
      expect(result).toHaveLength(2);

      const stripe = result.find((r) => r.canonical === "stripe.com");
      expect(stripe).toBeDefined();
      expect(stripe.duplicateCount).toBe(3);

      const github = result.find((r) => r.canonical === "github.com");
      expect(github).toBeDefined();
      expect(github.duplicateCount).toBe(2);
    });

    it("supports multiline or comma separated text strings", () => {
      const rawText = `
        stripe.com, https://linear.app
        https://stripe.com
        linear.app
      `;

      const result = dedupeEntries(rawText);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.canonical)).toEqual(["stripe.com", "linear.app"]);
    });
  });
});
