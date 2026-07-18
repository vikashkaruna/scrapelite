// netlify/functions/lib/proxyConfig.test.js — F36 (light anti-bot: proxy rotation).

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadProxyPool,
  pickProxy,
  resetProxyCounterForTests,
  _internal,
} from "../../functions/lib/proxyConfig.js";

const { parseProxies } = _internal;

describe("parseProxies (F36)", () => {
  it("returns an empty array for missing/empty input", () => {
    expect(parseProxies(undefined)).toEqual([]);
    expect(parseProxies("")).toEqual([]);
    expect(parseProxies("   ")).toEqual([]);
  });

  it("splits comma-separated URLs and trims whitespace", () => {
    const out = parseProxies("http://a.com:8080,  https://b.com:8080");
    expect(out).toEqual(["http://a.com:8080", "https://b.com:8080"]);
  });

  it("rejects non-http(s) URLs (would-be command-injection bait)", () => {
    expect(parseProxies("javascript:alert(1)")).toEqual([]);
    expect(parseProxies("file:///etc/passwd")).toEqual([]);
  });

  it("keeps user:pass credentials in the URL", () => {
    expect(parseProxies("http://user:pass@p1.com:8080")).toEqual([
      "http://user:pass@p1.com:8080",
    ]);
  });
});

describe("loadProxyPool (F36)", () => {
  it("returns empty pool + default strategy when env is empty", () => {
    const p = loadProxyPool({});
    expect(p.proxies).toEqual([]);
    expect(p.strategy).toBe("round-robin");
  });

  it("uses PROXY_STRATEGY=random when set", () => {
    const p = loadProxyPool({ PROXY_STRATEGY: "random" });
    expect(p.strategy).toBe("random");
  });
});

describe("pickProxy (F36)", () => {
  beforeEach(() => resetProxyCounterForTests());

  it("returns null when no proxies are configured", () => {
    expect(pickProxy({})).toBeNull();
  });

  it("round-robins through the pool in order", () => {
    const env = { PROXY_URLS: "http://p1,http://p2,http://p3" };
    expect(pickProxy(env)).toBe("http://p1");
    expect(pickProxy(env)).toBe("http://p2");
    expect(pickProxy(env)).toBe("http://p3");
    expect(pickProxy(env)).toBe("http://p1"); // wraps
  });

  it("random strategy returns one of the configured proxies", () => {
    const env = { PROXY_URLS: "http://p1,http://p2", PROXY_STRATEGY: "random" };
    for (let i = 0; i < 20; i++) {
      const p = pickProxy(env);
      expect(["http://p1", "http://p2"]).toContain(p);
    }
  });

  it("state resets via resetProxyCounterForTests", () => {
    const env = { PROXY_URLS: "http://p1,http://p2" };
    expect(pickProxy(env)).toBe("http://p1");
    expect(pickProxy(env)).toBe("http://p2");
    resetProxyCounterForTests();
    expect(pickProxy(env)).toBe("http://p1");
  });
});
