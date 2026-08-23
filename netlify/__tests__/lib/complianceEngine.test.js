// netlify/functions/lib/complianceEngine.test.js — FD3 (robots.txt parser + check).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { _internal, isPathAllowed, checkCompliance, _resetRobotsCacheForTests } from "../../functions/lib/complianceEngine.js";

const { parseRobots, DEFAULT_CRAWL_DELAY_MS } = _internal;

describe("parseRobots (FD3)", () => {
  it("parses simple Disallow rules", () => {
    const text = `User-agent: *
Disallow: /private
Disallow: /admin
Allow: /
`;
    const r = parseRobots(text, "DatIQBot/1.0");
    expect(r.rules.length).toBe(3);
    expect(r.crawlDelaySec).toBeNull();
  });

  it("parses Crawl-delay", () => {
    const text = `User-agent: *
Crawl-delay: 5
Disallow: /x
`;
    const r = parseRobots(text, "DatIQBot/1.0");
    expect(r.crawlDelaySec).toBe(5);
  });

  it("prefers the per-agent block over * when both match", () => {
    const text = `User-agent: *
Disallow: /

User-agent: DatIQBot
Disallow: /public
Allow: /
`;
    const r = parseRobots(text, "DatIQBot/1.0");
    // The per-agent block is the one we want; its rules should win.
    const disallow = r.rules.find((x) => x.type === "disallow");
    expect(disallow?.path).toBe("/public");
  });

  it("ignores comments and blank lines", () => {
    const text = `
# this is a comment

User-agent: *
# another comment
Disallow: /x
`;
    const r = parseRobots(text, "DatIQBot/1.0");
    expect(r.rules.length).toBe(1);
  });
});

describe("isPathAllowed (FD3)", () => {
  it("permits everything when no rules match", () => {
    expect(isPathAllowed([], "/anything")).toBe(true);
  });

  it("blocks a path that matches a Disallow rule", () => {
    const rules = [{ type: "disallow", path: "/private" }];
    expect(isPathAllowed(rules, "/private/secret")).toBe(false);
  });

  it("allows a path that matches an Allow rule", () => {
    const rules = [{ type: "allow", path: "/public" }];
    expect(isPathAllowed(rules, "/public/page")).toBe(true);
  });

  it("longest match wins between Allow and Disallow", () => {
    const rules = [
      { type: "disallow", path: "/private" },
      { type: "allow", path: "/private/sub" },
    ];
    expect(isPathAllowed(rules, "/private/sub/page")).toBe(true);
    expect(isPathAllowed(rules, "/private/other")).toBe(false);
  });

  it("supports wildcard * in path", () => {
    const rules = [{ type: "disallow", path: "/*.json" }];
    expect(isPathAllowed(rules, "/api/x.json")).toBe(false);
    expect(isPathAllowed(rules, "/api/x.html")).toBe(true);
  });
});

describe("checkCompliance (FD3)", () => {
  beforeEach(() => {
    _resetRobotsCacheForTests();
  });

  it("returns allowed=true when host has no robots.txt (fail open)", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }));
    const r = await checkCompliance("https://x.com/path");
    expect(r.allowed).toBe(true);
  });

  it("returns allowed=false when robots.txt disallows the path", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow: /private\n",
    }));
    const r = await checkCompliance("https://x.com/private/secret");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/disallows/i);
  });

  it("returns crawlDelayMs from Crawl-delay directive", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nCrawl-delay: 3\n",
    }));
    const r = await checkCompliance("https://x.com/p");
    expect(r.crawlDelayMs).toBe(3000);
  });

  it("falls back to default Crawl-delay when none is set", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow:\n",
    }));
    const r = await checkCompliance("https://x.com/p");
    expect(r.crawlDelayMs).toBe(DEFAULT_CRAWL_DELAY_MS);
  });

  it("blocks hosts not on the operator permitted-hosts list", async () => {
    const r = await checkCompliance("https://x.com/p", { permittedHosts: "y.com,z.com" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not on the operator/);
  });

  it("permits hosts on the operator permitted-hosts list (even with strict robots)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "User-agent: *\nDisallow: /\n",
    }));
    const r = await checkCompliance("https://x.com/p", { permittedHosts: "x.com" });
    expect(r.allowed).toBe(true);
  });

  it("fails open on network error", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); });
    const r = await checkCompliance("https://x.com/p");
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/permits/);
  });
});

// The prose in `reason` is for humans. Callers must branch on `code`, because
// matching the sentence is exactly what broke: the client's error classifier
// pattern-matched the message, found nothing, and reported a deliberate
// refusal as "Something went wrong. An unexpected error occurred."
describe("checkCompliance — structured verdict", () => {
  beforeEach(() => { _resetRobotsCacheForTests(); });

  it("codes a robots.txt refusal as robots_disallowed and names the host", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => "User-agent: *\nDisallow: /\n",
    }));
    const r = await checkCompliance("https://www.linkedin.com/company/anthropic");
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("robots_disallowed");
    expect(r.host).toBe("www.linkedin.com");
  });

  it("codes an allowed scrape as allowed", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }));
    const r = await checkCompliance("https://example.com/p");
    expect(r.code).toBe("allowed");
  });

  it("codes an operator-allowlist rejection separately from a robots refusal", async () => {
    // These must stay distinguishable: a user may attest their way past the
    // SITE's rules, but never past their own operator's allowlist.
    const r = await checkCompliance("https://x.com/p", { permittedHosts: "y.com" });
    expect(r.code).toBe("host_not_permitted");
  });

  it("codes an unparseable URL as invalid_url instead of throwing", async () => {
    const r = await checkCompliance("not a url");
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("invalid_url");
  });

  it("echoes the full path verbatim, including the /in/ segment", async () => {
    // A support report says WHICH url was refused only if the path is the real
    // one. A truncated or rewritten path sends the next reader hunting a bug
    // that does not exist.
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => "User-agent: *\nDisallow: /\n",
    }));
    const r = await checkCompliance("https://www.linkedin.com/in/vikashkaruna");
    expect(r.path).toBe("/in/vikashkaruna");
    expect(r.reason).toContain("path=/in/vikashkaruna");
  });

  it("keeps the query string in the echoed path", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200, text: async () => "User-agent: *\nDisallow: /\n",
    }));
    const r = await checkCompliance("https://x.com/search?q=hello");
    expect(r.path).toBe("/search?q=hello");
  });
});

describe("parseRobots — user-agent matching is by product token", () => {
  it("does NOT let a bare prefix like 'D' capture our block", () => {
    // Regression: matching was `ourUa.startsWith(agent)`, so a record aimed at
    // some other crawler whose name is a prefix of ours silently replaced the
    // `*` rules we should have obeyed — quietly making us MORE permissive than
    // the site asked for.
    const text = `User-agent: *
Disallow: /

User-agent: D
Allow: /
`;
    const r = parseRobots(text, "DatIQBot/1.0");
    expect(isPathAllowed(r.rules, "/anything")).toBe(false);
  });

  it("still matches our own product token, with or without a version suffix", () => {
    const bare = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: DatIQBot\nAllow: /\n", "DatIQBot/1.0");
    expect(isPathAllowed(bare.rules, "/x")).toBe(true);
    const versioned = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: DatIQBot/1.0\nAllow: /\n", "DatIQBot/1.0");
    expect(isPathAllowed(versioned.rules, "/x")).toBe(true);
  });

  it("is case-insensitive about our name", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: datiqbot\nAllow: /\n", "DatIQBot/1.0");
    expect(isPathAllowed(r.rules, "/x")).toBe(true);
  });
});
