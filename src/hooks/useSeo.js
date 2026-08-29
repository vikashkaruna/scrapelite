// src/hooks/useSeo.js — AEO/GEO/SEO per-route meta injection.
//
// Pushes SEO-relevant values (title, meta description, canonical URL,
// Open Graph, Twitter card, JSON-LD) into document.head on mount, and
// restores the previous values on unmount. This keeps the document head
// correct as React Router navigates between routes, and is the React-side
// counterpart to the per-page static HTML files in public/<route>/.
//
// For the SPA shell itself (/, /preview, /dashboard, etc.) the static
// index.html in /public provides the defaults. For per-page additions
// (FAQPage, Article, BreadcrumbList) this hook injects and cleans up.
//
// This hook does NOT touch the site-wide Organization / WebSite /
// SoftwareApplication schemas — those are baked into index.html and
// shared across every page.

import { useEffect, useRef } from "react";
import { breadcrumbFor } from "../lib/pageSeo.js";

const HOOK_ID = "datiq-useSeo";

function ensureMeta(attr, key) {
  // attr is either "name" or "property"; key is the value (e.g. "description")
  const sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

function ensureLink(rel, key) {
  const sel = `link[rel="${rel}"]${key ? `[${key}]` : ""}`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    if (key) el.setAttribute(key.split("=")[0], key.split("=")[1] || "");
    document.head.appendChild(el);
  }
  return el;
}

function ensureJsonLd(id) {
  const sel = `script[data-datiq-seo="${id}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("script");
    el.setAttribute("type", "application/ld+json");
    el.setAttribute("data-datiq-seo", id);
    document.head.appendChild(el);
  }
  return el;
}

function capture() {
  // Snapshot the current head state so we can restore it on unmount.
  // This matters when the user navigates from one page to another: the
  // previous page's meta should not leak into the new page.
  return {
    title: document.title,
    description:
      document.head.querySelector('meta[name="description"]')?.getAttribute("content") || null,
    canonical:
      document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") || null,
    ogTitle:
      document.head.querySelector('meta[property="og:title"]')?.getAttribute("content") || null,
    ogDescription:
      document.head
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") || null,
    ogImage:
      document.head.querySelector('meta[property="og:image"]')?.getAttribute("content") || null,
    ogUrl:
      document.head.querySelector('meta[property="og:url"]')?.getAttribute("content") || null,
    twitterTitle:
      document.head
        .querySelector('meta[name="twitter:title"]')
        ?.getAttribute("content") || null,
    twitterDescription:
      document.head
        .querySelector('meta[name="twitter:description"]')
        ?.getAttribute("content") || null,
    twitterImage:
      document.head
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute("content") || null,
    robots:
      document.head.querySelector('meta[name="robots"]')?.getAttribute("content") || null,
    jsonLdIds: Array.from(
      document.head.querySelectorAll("script[data-datiq-seo]"),
    ).map((el) => el.getAttribute("data-datiq-seo")),
  };
}

function apply(opts) {
  if (opts.title) document.title = opts.title;
  if (opts.description) {
    ensureMeta("name", "description").setAttribute("content", opts.description);
  }
  if (opts.canonical) {
    ensureLink("canonical").setAttribute("href", opts.canonical);
  }
  if (opts.ogImage) {
    ensureMeta("property", "og:image").setAttribute("content", opts.ogImage);
  } else if (opts.title) {
    // mirror title into og:title if not explicitly set
    ensureMeta("property", "og:title").setAttribute("content", opts.title);
  }
  if (opts.description) {
    ensureMeta("property", "og:description").setAttribute("content", opts.description);
    ensureMeta("name", "twitter:description").setAttribute("content", opts.description);
  }
  if (opts.title) {
    ensureMeta("name", "twitter:title").setAttribute("content", opts.title);
  }
  if (opts.robots) {
    ensureMeta("name", "robots").setAttribute("content", opts.robots);
  }
  if (opts.canonical) {
    ensureMeta("property", "og:url").setAttribute("content", opts.canonical);
  }
  if (opts.jsonLd && Array.isArray(opts.jsonLd)) {
    opts.jsonLd.forEach((schema, i) => {
      const id = `${HOOK_ID}-${i}`;
      const el = ensureJsonLd(id);
      el.textContent = JSON.stringify(schema);
    });
  }
}

function restore(snapshot) {
  document.title = snapshot.title;
  const setOrRemove = (sel, attr, value) => {
    const el = document.head.querySelector(sel);
    if (!el) return;
    if (value == null) {
      el.parentNode.removeChild(el);
    } else {
      el.setAttribute(attr, value);
    }
  };
  setOrRemove('meta[name="description"]', "content", snapshot.description);
  setOrRemove('link[rel="canonical"]', "href", snapshot.canonical);
  setOrRemove('meta[property="og:title"]', "content", snapshot.ogTitle);
  setOrRemove('meta[property="og:description"]', "content", snapshot.ogDescription);
  setOrRemove('meta[property="og:image"]', "content", snapshot.ogImage);
  setOrRemove('meta[property="og:url"]', "content", snapshot.ogUrl);
  setOrRemove('meta[name="twitter:title"]', "content", snapshot.twitterTitle);
  setOrRemove('meta[name="twitter:description"]', "content", snapshot.twitterDescription);
  setOrRemove('meta[name="twitter:image"]', "content", snapshot.twitterImage);
  setOrRemove('meta[name="robots"]', "content", snapshot.robots);
  // Remove any JSON-LD scripts this hook added
  document.head
    .querySelectorAll(`script[data-datiq-seo^="${HOOK_ID}-"]`)
    .forEach((el) => el.parentNode.removeChild(el));
}

/**
 * Every indexable page gets a BreadcrumbList, derived from its own path.
 *
 * Generated HERE rather than written into each page's SEO entry because the
 * defect being fixed (SH-09) was a WHOLE-SITE omission — no page had one — and
 * re-introducing it as a per-page obligation is exactly how it would come back
 * the next time somebody adds a route. Deriving it from the URL also means it
 * cannot drift out of sync with the real navigation path.
 *
 * Skipped for the homepage (a breadcrumb whose only item is the page itself
 * describes nothing) and for noindex pages (the signed-in app is not part of
 * any site hierarchy a crawler should be reading).
 */
function autoBreadcrumb({ canonical, robots, jsonLd }) {
  if (robots && /noindex/i.test(robots)) return null;
  // ⚠️ Never a SECOND one. Eight entries in pageSeo.js already declare their
  // own BreadcrumbList, hand-written to match a real navigation path. Two
  // conflicting BreadcrumbList blocks on one page is worse than none — the
  // page is then asserting two different positions in the site hierarchy, and
  // a crawler is entitled to believe either. The page's own always wins.
  if (Array.isArray(jsonLd) && jsonLd.some((x) => x && x["@type"] === "BreadcrumbList")) return null;
  let path = null;
  if (canonical) {
    try { path = new URL(canonical).pathname; } catch { /* not absolute */ }
  }
  if (!path && typeof window !== "undefined" && window.location) path = window.location.pathname;
  return breadcrumbFor(path);
}

export function useSeo({ title, description, canonical, ogImage, jsonLd, robots } = {}) {
  // Use a ref so the capture/restore happens exactly once per mount/unmount,
  // not on every render. The values are read from the closure on mount.
  const optsRef = useRef({ title, description, canonical, ogImage, jsonLd, robots });
  optsRef.current = { title, description, canonical, ogImage, jsonLd, robots };

  useEffect(() => {
    const snapshot = capture();
    const opts = optsRef.current;
    const crumb = autoBreadcrumb(opts);
    apply(crumb ? { ...opts, jsonLd: [...(opts.jsonLd || []), crumb] } : opts);
    return () => restore(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
