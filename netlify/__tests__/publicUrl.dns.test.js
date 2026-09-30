// netlify/__tests__/publicUrl.dns.test.js
// C-37a companion to publicUrl.test.js — the DNS-lookup branch of
// isPublicHttpUrlAsync, with node:dns/promises mocked so the outcome does
// not depend on the machine's resolver. Guards the contract that a domain
// which does not resolve (typo / NXDOMAIN) is a `false` answer in
// production-like env, never a thrown error (the schedules 500 bug).
import { afterEach, describe, expect, it, vi } from "vitest";

const lookupState = { impl: () => [] };

vi.mock("node:dns/promises", () => {
  const lookup = vi.fn(async (host, opts) => lookupState.impl(host, opts));
  return { lookup, default: { lookup } };
});

const { isPublicHttpUrlAsync } = await import("../functions/lib/publicUrl.js");

const PUBLIC_ADDR = [{ address: "93.184.216.34", family: 4 }];
const PRIVATE_ADDR = [{ address: "10.0.0.7", family: 4 }];

describe("isPublicHttpUrlAsync — DNS outcomes (mocked resolver)", () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.CONTEXT;
    lookupState.impl = () => [];
    vi.clearAllMocks();
  });

  it("a resolving public hostname is accepted", async () => {
    process.env.NODE_ENV = "production";
    lookupState.impl = () => PUBLIC_ADDR;
    await expect(isPublicHttpUrlAsync("https://example.com/")).resolves.toBe(true);
  });

  it("a resolving PRIVATE hostname is rejected", async () => {
    process.env.NODE_ENV = "production";
    lookupState.impl = () => PRIVATE_ADDR;
    await expect(isPublicHttpUrlAsync("https://internal.example/")).resolves.toBe(false);
  });

  it("a non-resolving hostname (typo/NXDOMAIN) is false — not a throw — in production-like env", async () => {
    process.env.NODE_ENV = "production";
    lookupState.impl = () => {
      const e = new Error("queryA ENOTFOUND wrongdomain123.example");
      e.code = "ENOTFOUND";
      throw e;
    };
    await expect(isPublicHttpUrlAsync("https://wrongdomain123.example/")).resolves.toBe(false);
  });

  it("offline test/dev environments keep the bypass: unresolvable hostnames pass", async () => {
    process.env.NODE_ENV = "test";
    lookupState.impl = () => {
      const e = new Error("queryA ENOTFOUND fake.test");
      e.code = "ENOTFOUND";
      throw e;
    };
    await expect(isPublicHttpUrlAsync("https://fake.test/")).resolves.toBe(true);
  });
});
