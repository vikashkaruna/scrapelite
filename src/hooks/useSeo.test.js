// src/hooks/useSeo.test.js — AEO/GEO/SEO per-route meta injection unit tests.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSeo } from "./useSeo.js";

const SITE_TITLE = "DatIQ: The Unified Web Intelligence Platform | Intelligence from Web";
const SITE_DESCRIPTION =
  "DatIQ is the unified web intelligence platform — extract, enrich and operationalize data from any public URL, batch, or scheduled run.";

function setSiteDefaults() {
  document.title = SITE_TITLE;
  const meta = document.createElement("meta");
  meta.setAttribute("name", "description");
  meta.setAttribute("content", SITE_DESCRIPTION);
  document.head.appendChild(meta);
  const link = document.createElement("link");
  link.setAttribute("rel", "canonical");
  link.setAttribute("href", "https://datiq.app/");
  document.head.appendChild(link);
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  setSiteDefaults();
});

afterEach(() => {
  document.head.innerHTML = "";
});

describe("useSeo", () => {
  it("sets the document title on mount", () => {
    renderHook(() =>
      useSeo({ title: "About DatIQ — the no-code web intelligence platform | DatIQ.app" }),
    );
    expect(document.title).toBe(
      "About DatIQ — the no-code web intelligence platform | DatIQ.app",
    );
  });

  it("updates the meta description on mount", () => {
    renderHook(() =>
      useSeo({
        title: "About DatIQ",
        description: "DatIQ is the no-code web intelligence platform...",
      }),
    );
    const meta = document.head.querySelector('meta[name="description"]');
    expect(meta?.getAttribute("content")).toBe(
      "DatIQ is the no-code web intelligence platform...",
    );
  });

  it("sets the canonical URL on mount", () => {
    renderHook(() => useSeo({ canonical: "https://datiq.app/about" }));
    const link = document.head.querySelector('link[rel="canonical"]');
    expect(link?.getAttribute("href")).toBe("https://datiq.app/about");
  });

  it("injects JSON-LD with a unique data attribute", () => {
    const schema = {
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "What is DatIQ?", acceptedAnswer: { text: "..." } },
      ],
    };
    renderHook(() => useSeo({ jsonLd: [schema] }));
    const script = document.head.querySelector('script[data-datiq-seo]');
    expect(script).toBeTruthy();
    expect(JSON.parse(script.textContent)).toEqual(schema);
  });

  it("handles multiple JSON-LD schemas in one call", () => {
    renderHook(() =>
      useSeo({
        jsonLd: [
          { "@type": "FAQPage", mainEntity: [] },
          { "@type": "Article", headline: "What is DatIQ?" },
        ],
      }),
    );
    const scripts = document.head.querySelectorAll("script[data-datiq-seo]");
    expect(scripts.length).toBe(2);
  });

  it("restores the previous title on unmount", () => {
    const { unmount } = renderHook(() => useSeo({ title: "About DatIQ" }));
    expect(document.title).toBe("About DatIQ");
    unmount();
    expect(document.title).toBe(SITE_TITLE);
  });

  it("restores the previous meta description on unmount", () => {
    const { unmount } = renderHook(() =>
      useSeo({ description: "A new description" }),
    );
    expect(
      document.head.querySelector('meta[name="description"]').getAttribute("content"),
    ).toBe("A new description");
    unmount();
    expect(
      document.head.querySelector('meta[name="description"]').getAttribute("content"),
    ).toBe(SITE_DESCRIPTION);
  });

  it("removes JSON-LD scripts on unmount", () => {
    const { unmount } = renderHook(() =>
      useSeo({ jsonLd: [{ "@type": "FAQPage", mainEntity: [] }] }),
    );
    expect(
      document.head.querySelectorAll("script[data-datiq-seo]").length,
    ).toBe(1);
    unmount();
    expect(
      document.head.querySelectorAll("script[data-datiq-seo]").length,
    ).toBe(0);
  });

  it("supports navigating between two pages (second restore picks up first's state)", () => {
    const first = renderHook(() => useSeo({ title: "Page A", description: "Desc A" }));
    expect(document.title).toBe("Page A");
    const second = renderHook(() => useSeo({ title: "Page B", description: "Desc B" }));
    expect(document.title).toBe("Page B");
    // Unmount the second page — the head should snap back to "Page A".
    second.unmount();
    expect(document.title).toBe("Page A");
    first.unmount();
    expect(document.title).toBe(SITE_TITLE);
  });

  it("does not crash when called with no options", () => {
    expect(() => renderHook(() => useSeo())).not.toThrow();
  });
});
