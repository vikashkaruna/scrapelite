// src/lib/seoMeta.test.js — Q6 (shareable report links) — SEO meta tests.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setMeta, _clearMetaForTests } from "./seoMeta.js";

beforeEach(() => {
  _clearMetaForTests();
  document.title = "";
});

afterEach(() => {
  _clearMetaForTests();
});

describe("Q6 — seoMeta: pure SEO meta setter", () => {
  it("sets document.title", () => {
    setMeta({ title: "Hello World" });
    expect(document.title).toBe("Hello World");
  });

  it("sets the description meta tag", () => {
    setMeta({ description: "A test description" });
    const el = document.head.querySelector('meta[name="description"]');
    expect(el).toBeTruthy();
    expect(el.getAttribute("content")).toBe("A test description");
  });

  it("sets the OG meta tags", () => {
    setMeta({ title: "T", description: "D", url: "https://example.com/p/abc" });
    const ogTitle = document.head.querySelector('meta[property="og:title"]');
    const ogDesc  = document.head.querySelector('meta[property="og:description"]');
    const ogUrl   = document.head.querySelector('meta[property="og:url"]');
    expect(ogTitle.getAttribute("content")).toBe("T");
    expect(ogDesc.getAttribute("content")).toBe("D");
    expect(ogUrl.getAttribute("content")).toBe("https://example.com/p/abc");
  });

  it("sets the Twitter card meta tags", () => {
    setMeta({ title: "T", description: "D" });
    const card = document.head.querySelector('meta[name="twitter:card"]');
    const tt   = document.head.querySelector('meta[name="twitter:title"]');
    expect(card).toBeTruthy();
    expect(card.getAttribute("content")).toBe("summary");
    expect(tt.getAttribute("content")).toBe("T");
  });

  it("upgrades twitter:card to summary_large_image when an image is set", () => {
    setMeta({ title: "T", description: "D", image: "https://example.com/og.png" });
    const card = document.head.querySelector('meta[name="twitter:card"]');
    expect(card.getAttribute("content")).toBe("summary_large_image");
  });

  it("is idempotent — calling twice doesn't duplicate tags", () => {
    setMeta({ title: "A" });
    setMeta({ title: "B" });
    expect(document.head.querySelectorAll('meta[property="og:title"]').length).toBe(1);
    expect(document.title).toBe("B");
  });
});
