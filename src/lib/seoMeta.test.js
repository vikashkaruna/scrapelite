// src/lib/seoMeta.test.js — Q6 (shareable report links) — SEO meta tests.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  setMeta, setNoIndex, setPublicDefaultMeta, _clearMetaForTests,
} from "./seoMeta.js";

beforeEach(() => {
  _clearMetaForTests();
  // Re-seed a public-page default so setPublicDefaultMeta / setNoIndex can
  // be tested against a realistic starting state.
  setMeta({
    title: "DatIQ — Public product title",
    description: "Public product description that should be hidden inside /admin.",
    url: "https://datiq.app/",
    image: "https://datiq.app/og.png",
  });
  // Add a canonical link to mirror the static index.html
  let canon = document.head.querySelector('link[rel="canonical"]');
  if (!canon) {
    canon = document.createElement("link");
    canon.setAttribute("rel", "canonical");
    document.head.appendChild(canon);
  }
  canon.setAttribute("href", "https://datiq.app/");
});

afterEach(() => {
  _clearMetaForTests();
  document.title = "";
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

describe("seoMeta: /admin noindex signal", () => {
  it("setNoIndex rewrites the robots meta to noindex,nofollow,noarchive,nosnippet,noimageindex,notranslate,noydir", () => {
    setNoIndex();
    const el = document.head.querySelector('meta[name="robots"]');
    expect(el).toBeTruthy();
    expect(el.getAttribute("content")).toMatch(/^noindex/);
    for (const token of ["nofollow", "noarchive", "nosnippet", "noimageindex", "notranslate", "noydir"]) {
      expect(el.getAttribute("content")).toContain(token);
    }
  });

  it("setNoIndex neutralises title, description, og:* and twitter:* to non-leaky values", () => {
    setNoIndex();
    expect(document.title).not.toMatch(/Public product title/);
    const desc = document.head.querySelector('meta[name="description"]');
    expect(desc.getAttribute("content")).not.toMatch(/Public product description/);
    const ogT = document.head.querySelector('meta[property="og:title"]');
    const ogD = document.head.querySelector('meta[property="og:description"]');
    const ogU = document.head.querySelector('meta[property="og:url"]');
    const twT = document.head.querySelector('meta[name="twitter:title"]');
    const twD = document.head.querySelector('meta[name="twitter:description"]');
    for (const el of [ogT, ogD, ogU, twT, twD]) {
      expect(el).toBeTruthy();
      expect(el.getAttribute("content")).not.toMatch(/Public/);
    }
    // og:image and twitter:image are removed entirely (nothing to leak from)
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.head.querySelector('meta[name="twitter:image"]')).toBeNull();
  });

  it("setNoIndex removes the canonical <link> so crawlers fall back to the request URL", () => {
    setNoIndex();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("setPublicDefaultMeta restores the index,follow robots tag and a / canonical", () => {
    setNoIndex();
    setPublicDefaultMeta();
    const el = document.head.querySelector('meta[name="robots"]');
    expect(el.getAttribute("content")).toMatch(/^index,?\s*follow/);
    const canon = document.head.querySelector('link[rel="canonical"]');
    expect(canon).toBeTruthy();
    expect(canon.getAttribute("href")).toBe("https://datiq.app/");
  });

  it("setNoIndex sets bot-specific directives for search engines and AI/GEO/AEO crawlers", () => {
    setNoIndex();
    for (const bot of ["googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider", "yandex"]) {
      const el = document.head.querySelector(`meta[name="${bot}"]`);
      expect(el, `expected meta[name="${bot}"]`).toBeTruthy();
      expect(el.getAttribute("content")).toContain("noindex");
    }
    for (const bot of ["gptbot", "chatgpt-user", "claudebot", "anthropic-ai", "perplexitybot", "cohere-ai", "ccbot", "applebot", "meta-externalagent", "google-extended"]) {
      const el = document.head.querySelector(`meta[name="${bot}"]`);
      expect(el, `expected meta[name="${bot}"]`).toBeTruthy();
      expect(el.getAttribute("content")).toBe("noindex, nofollow");
    }
  });

  it("setNoIndex strips structured data (JSON-LD and breadcrumbs)", () => {
    const s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "SoftwareApplication" });
    document.head.appendChild(s);

    const b = document.createElement("script");
    b.setAttribute("data-datiq-breadcrumb", "1");
    document.head.appendChild(b);

    setNoIndex();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    expect(document.head.querySelector('script[data-datiq-breadcrumb]')).toBeNull();
  });

  it("setPublicDefaultMeta removes bot-specific noindex tags", () => {
    setNoIndex();
    setPublicDefaultMeta();
    for (const bot of ["googlebot", "bingbot", "gptbot", "claudebot", "perplexitybot"]) {
      expect(document.head.querySelector(`meta[name="${bot}"]`)).toBeNull();
    }
  });

  it("setNoIndex is idempotent — calling twice leaves exactly one robots tag", () => {
    setNoIndex();
    setNoIndex();
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(1);
  });
});

// ── BreadcrumbList (SH-09) ──────────────────────────────────────────────────
// setMeta() is the SECOND of two SEO mechanisms in the app; useSeo() is the
// other. Nine pages use only this one — /changelog, /gallery, /vs/battlecard
// and all six programmatic routes — so a breadcrumb added to useSeo alone left
// a hole shaped like exactly those pages. That is the same hole the missing
// canonical sat in for as long as it did.
//
// It is also the test that would have caught this being wired up wrong: the
// import initially landed INSIDE a JSDoc block, so the module still loaded
// cleanly and only threw when setMeta was actually called.
describe("setMeta — breadcrumbs", () => {
  it("writes a BreadcrumbList derived from the page's own URL", () => {
    setMeta({ title: "t", description: "d", url: "https://datiq.app/use-cases/seo-audit" });
    const el = document.head.querySelector('script[data-datiq-breadcrumb]');
    expect(el).toBeTruthy();
    const bc = JSON.parse(el.textContent);
    expect(bc["@type"]).toBe("BreadcrumbList");
    expect(bc.itemListElement.map((i) => i.name)).toEqual(["Home", "Use cases", "SEO audit"]);
    expect(bc.itemListElement.at(-1).item).toBe("https://datiq.app/use-cases/seo-audit");
  });

  it("replaces rather than appends on a second call", () => {
    setMeta({ title: "a", url: "https://datiq.app/changelog" });
    setMeta({ title: "b", url: "https://datiq.app/gallery" });
    const all = document.head.querySelectorAll('script[data-datiq-breadcrumb]');
    expect(all.length).toBe(1);
    expect(JSON.parse(all[0].textContent).itemListElement.at(-1).name).toBe("Gallery");
  });

  it("writes none for the site root", () => {
    setMeta({ title: "home", url: "https://datiq.app/" });
    expect(document.head.querySelector('script[data-datiq-breadcrumb]')).toBeNull();
  });
});
