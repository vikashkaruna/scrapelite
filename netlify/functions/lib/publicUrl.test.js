// netlify/functions/lib/publicUrl.test.js
// C-37 — 100% branch coverage maintained.

import { describe, expect, it } from "vitest";
import { isPublicHttpUrl, isPublicHttpUrlAsync } from "./publicUrl.js";

describe("isPublicHttpUrl — happy path", () => {
  it("accepts a public IPv4 http URL", () => {
    expect(isPublicHttpUrl("http://93.184.216.34/")).toBe(true);
  });

  it("accepts a public IPv4 https URL", () => {
    expect(isPublicHttpUrl("https://93.184.216.34/")).toBe(true);
  });

  it("accepts a public IPv6 URL", () => {
    expect(isPublicHttpUrl("https://[2606:2800:220:1::1]/")).toBe(true);
  });
});

describe("isPublicHttpUrl — rejected (private IP / unsafe host)", () => {
  it("rejects 127.0.0.1 (loopback)", () => {
    expect(isPublicHttpUrl("http://127.0.0.1/x")).toBe(false);
  });

  it("rejects 10.x.x.x (RFC 1918)", () => {
    expect(isPublicHttpUrl("http://10.0.0.1/x")).toBe(false);
  });

  it("rejects 172.16.x.x (RFC 1918)", () => {
    expect(isPublicHttpUrl("http://172.16.5.5/x")).toBe(false);
  });

  it("rejects 192.168.x.x (RFC 1918)", () => {
    expect(isPublicHttpUrl("http://192.168.1.1/")).toBe(false);
  });

  it("rejects 169.254.x.x (link-local)", () => {
    expect(isPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects 100.64.x.x (CGNAT)", () => {
    expect(isPublicHttpUrl("http://100.64.0.1/")).toBe(false);
  });

  it("rejects 0.0.0.0", () => {
    expect(isPublicHttpUrl("http://0.0.0.0/")).toBe(false);
  });

  it("rejects ::1 (IPv6 loopback)", () => {
    expect(isPublicHttpUrl("http://[::1]/")).toBe(false);
  });

  it("rejects fc00:: (IPv6 unique-local)", () => {
    expect(isPublicHttpUrl("http://[fc00::1]/")).toBe(false);
  });

  it("rejects fe80:: (IPv6 link-local)", () => {
    expect(isPublicHttpUrl("http://[fe80::1]/")).toBe(false);
  });

  it("rejects an IPv4-mapped IPv6 (::ffff:127.0.0.1)", () => {
    expect(isPublicHttpUrl("http://[::ffff:127.0.0.1]/")).toBe(false);
  });
});

describe("isPublicHttpUrl — hostnames", () => {
  it("accepts a hostname (sync variant assumes public; async variant checks DNS)", () => {
    expect(isPublicHttpUrl("https://example.com/")).toBe(true);
  });
});

describe("isPublicHttpUrl — invalid input", () => {
  it("throws for empty string", () => {
    expect(() => isPublicHttpUrl("")).toThrow(/required/i);
  });

  it("throws for non-string", () => {
    expect(() => isPublicHttpUrl(null)).toThrow();
    expect(() => isPublicHttpUrl(undefined)).toThrow();
  });

  it("throws for whitespace or control chars", () => {
    expect(() => isPublicHttpUrl("http://exa mple.com/")).toThrow(/control|whitespace/i);
  });

  it("throws for a non-http(s) scheme", () => {
    expect(() => isPublicHttpUrl("file:///etc/passwd")).toThrow(/Disallowed scheme/);
    expect(() => isPublicHttpUrl("gopher://example.com/")).toThrow(/Disallowed scheme/);
    expect(() => isPublicHttpUrl("ftp://example.com/")).toThrow(/Disallowed scheme/);
  });

  it("throws for a malformed URL", () => {
    // "not a url" trips the whitespace check first (which throws)
    expect(() => isPublicHttpUrl("not a url")).toThrow(/whitespace|control|Malformed/i);
    // A URL with valid syntax but malformed parse throws Malformed
    expect(() => isPublicHttpUrl("http://[bad-ipv6/")).toThrow();
  });

  it("throws for a URL that exceeds the length cap", () => {
    const long = "https://example.com/" + "a".repeat(3000);
    expect(() => isPublicHttpUrl(long)).toThrow(/exceeds/);
  });
});

describe("isPublicHttpUrlAsync — hostname resolution", () => {
  it("accepts a hostname that resolves to a public IP", async () => {
    // Use a well-known public hostname. lookup() may be slow in CI; allow
    // a generous timeout via vitest's default.
    const ok = await isPublicHttpUrlAsync("https://example.com/");
    expect(ok).toBe(true);
  });

  it("rejects a hostname that resolves to a private IP (loopback)", async () => {
    // localhost typically resolves to 127.0.0.1 / ::1
    const ok = await isPublicHttpUrlAsync("http://localhost/x");
    expect(ok).toBe(false);
  });
});
