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

// Meta tags that participate in the SEO surface. setNoIndex() rewrites the
// public ones to neutral values so even a crawler that ignores the
// `robots: noindex` directive cannot extract a misleading snippet.
const NOINDEX_NEUTRAL_TITLE = "DatIQ";
const NOINDEX_NEUTRAL_DESC  = "Restricted area.";

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

function removeMetaTag(attr, key) {
  if (typeof document === "undefined") return;
  const el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (el) el.remove();
}

function setLinkRel(rel, href) {
  if (typeof document === "undefined") return;
  const sel = `link[rel="${rel}"]`;
  let el = document.head.querySelector(sel);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
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

/**
 * Block search engines and AI crawlers from indexing, following, caching or
 * generating a snippet of the current page.
 *
 * Applied to /admin/* — see AdminLayout.jsx. The combination of:
 *   - <meta name="robots" content="noindex, nofollow, ...">
 *   - neutral og:title / og:description / og:url / twitter:* overrides
 *   - canonical link removed
 *   - document.title neutralised
 *   - the static index.html default canonical pointing at /
 * covers the path where a crawler bypasses robots.txt, ignores the meta
 * robots tag, ignores the X-Robots-Tag HTTP header, and tries to extract a
 * snippet anyway. There is no public page in the SPA that links to
 * /admin/*, the sitemap has none of those URLs, and robots.txt disallows
 * them for every user-agent.
 */
export function setNoIndex() {
  if (typeof document === "undefined") return;
  // 1. The decisive signal.
  setMetaTag("name", "robots", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noydir");
  // 2. Neutralise every tag a snippet could leak from. Keep the public
  //    DatIQ brand so the page is not obviously broken, but say nothing
  //    about the actual admin content.
  document.title = NOINDEX_NEUTRAL_TITLE;
  setMetaTag("name", "description", NOINDEX_NEUTRAL_DESC);
  setMetaTag("property", "og:title", NOINDEX_NEUTRAL_TITLE);
  setMetaTag("property", "og:description", NOINDEX_NEUTRAL_DESC);
  setMetaTag("property", "og:url", "");
  setMetaTag("property", "og:type", "website");
  removeMetaTag("property", "og:image");
  setMetaTag("name", "twitter:card", "summary");
  setMetaTag("name", "twitter:title", NOINDEX_NEUTRAL_TITLE);
  setMetaTag("name", "twitter:description", NOINDEX_NEUTRAL_DESC);
  removeMetaTag("name", "twitter:image");
  // 3. Drop the canonical link — without it, crawlers must fall back to
  //    the URL in the request, which is /admin/*, and X-Robots-Tag
  //    forbids indexing that anyway.
  removeMetaTag("rel", "canonical");
  // Some crawlers also accept a rel="canonical" on a <link> element.
  const linkCanon = document.head.querySelector('link[rel="canonical"]');
  if (linkCanon) linkCanon.remove();
  void setLinkRel; // silence unused-import lint; kept for future use
}

/**
 * Restore the public-DatIQ default meta tags. Called when leaving the
 * /admin section so the next public page is not still noindexed.
 *
 * The values mirror the ones in /index.html so a hard navigation back to a
 * public page looks the same whether the user came from /admin or hit the
 * URL cold.
 */
export function setPublicDefaultMeta() {
  if (typeof document === "undefined") return;
  setMetaTag("name", "robots", "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1");
  setLinkRel("canonical", "https://datiq.app/");
  // The rest of the public tags (title, description, og:*, twitter:*) get
  // reset by setMeta() on the public page that mounts next; we only own
  // the ones we set aggressively in setNoIndex().
}

// Used by tests to reset.
export function _clearMetaForTests() {
  if (typeof document === "undefined") return;
  for (const key of META_NAMES) {
    const attr = key.startsWith("og:") ? "property" : "name";
    const el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (el) el.remove();
  }
  removeMetaTag("name", "robots");
  removeMetaTag("rel", "canonical");
}
