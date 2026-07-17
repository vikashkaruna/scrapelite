// src/lib/seoMeta.js — Q6 (shareable report links) — pure SEO meta helper.
//
// Sets document title, meta description, OG/Twitter tags. Used by the
// public report page and gallery. Idempotent — re-setting the same
// content updates in place rather than appending duplicates.

const META_NAMES = [
  "description",
  "og:title",
  "og:description",
  "og:url",
  "og:type",
  "og:image",
  "twitter:card",
  "twitter:title",
  "twitter:description",
];

function setMetaTag(attr, key, content) {
  if (typeof document === "undefined") return;
  const sel = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function setMeta({ title, description, url, image, type = "article" }) {
  if (typeof document === "undefined") return;
  if (title) document.title = title;
  if (description) setMetaTag("name", "description", description);
  if (title)        setMetaTag("property", "og:title", title);
  if (description)  setMetaTag("property", "og:description", description);
  if (url)          setMetaTag("property", "og:url", url);
  if (type)         setMetaTag("property", "og:type", type);
  if (image)        setMetaTag("property", "og:image", image);
  if (title || description) {
    setMetaTag("name", "twitter:card", image ? "summary_large_image" : "summary");
    if (title)       setMetaTag("name", "twitter:title", title);
    if (description) setMetaTag("name", "twitter:description", description);
  }
}

// Used by tests to reset.
export function _clearMetaForTests() {
  if (typeof document === "undefined") return;
  for (const key of META_NAMES) {
    const attr = key.startsWith("og:") ? "property" : "name";
    const el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (el) el.remove();
  }
}
