// netlify/functions/lib/headlessProvider.test.js — F36 (headless stub).

import { describe, it, expect } from "vitest";
import {
  isHeadlessAvailable,
  headlessOptions,
  headlessAttribution,
  _internal,
} from "../../functions/lib/headlessProvider.js";

const { UPSTREAM_HEADLESS_PROVIDERS } = _internal;

describe("isHeadlessAvailable (F36)", () => {
  it("returns false when no upstream headless provider is configured", () => {
    expect(isHeadlessAvailable({})).toBe(false);
  });

  it("returns true when FIRECRAWL_API_KEY is set", () => {
    expect(isHeadlessAvailable({ FIRECRAWL_API_KEY: "fc-1" })).toBe(true);
  });

  it("returns true when SPIDER_API_KEY is set", () => {
    expect(isHeadlessAvailable({ SPIDER_API_KEY: "sp-1" })).toBe(true);
  });

  it("returns true when VITE_FIRECRAWL_API_KEY is set (dev fallback)", () => {
    expect(isHeadlessAvailable({ VITE_FIRECRAWL_API_KEY: "fc-1" })).toBe(true);
  });
});

describe("headlessOptions (F36)", () => {
  it("returns renderJs+waitFor for firecrawl", () => {
    const o = headlessOptions("firecrawl");
    expect(o).toEqual({ renderJs: true, waitFor: 3000 });
  });

  it("returns renderJs+waitFor for spider", () => {
    const o = headlessOptions("spider");
    expect(o).toEqual({ renderJs: true, waitFor: 3000 });
  });

  it("returns null for providers that don't support headless", () => {
    expect(headlessOptions("jina")).toBeNull();
    expect(headlessOptions("direct")).toBeNull();
  });

  it("lists the upstream providers that support headless", () => {
    expect(UPSTREAM_HEADLESS_PROVIDERS).toContain("firecrawl");
    expect(UPSTREAM_HEADLESS_PROVIDERS).toContain("spider");
  });
});

describe("headlessAttribution (F36)", () => {
  it("surfaces a clear 'not rendered' note when no headless provider is set", () => {
    const r = headlessAttribution("firecrawl", {});
    expect(r.rendered).toBe(false);
    expect(r.note).toMatch(/static HTML/);
  });

  it("attributes rendering to the upstream provider when one is available", () => {
    const r = headlessAttribution("firecrawl", { FIRECRAWL_API_KEY: "fc-1" });
    expect(r.rendered).toBe(true);
    expect(r.provider).toBe("firecrawl");
    expect(r.note).toMatch(/Rendered via upstream/);
  });
});
