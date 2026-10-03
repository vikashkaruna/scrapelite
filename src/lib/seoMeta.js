// src/lib/seoMeta.js — Q6 (shareable report links) — pure SEO meta helper.
//
// Sets document title, meta description, OG/Twitter tags. Used by the
// public report page and gallery. Idempotent — re-setting the same
// content updates in place rather than appending duplicates.

import { breadcrumbFor } from "./pageSeo.js";

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

/**
 * The production origin, hard-coded on purpose.
 *
 * Callers used to build canonical/og:url from `window.location.origin`. That is
 * wrong in two environments that matter: under scripts/prerender.mjs the origin
 * is http://localhost:4319, so the committed HTML would ship a localhost

 * canonical to production; and on a branch deploy it would canonicalise to the
 * preview host, inviting Google to index the preview instead of the real site.
 *
 * A canonical must name the ONE URL you want indexed, which is never the URL
 * the code happens to be running on.
 */
export const SITE_ORIGIN = "https://datiq.app";

/** Absolute production URL for a path, with any query string dropped. */
export function canonicalUrl(pathname) {
  const clean = String(pathname || "/").split(/[?#]/)[0];
  return `${SITE_ORIGIN}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

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
  // ⚠️ The canonical is the whole point, and it was missing here.
  //
  // This helper set og:url but never <link rel="canonical">, so every page
  // using it — /changelog, /gallery, /vs/battlecard and all six programmatic
  // pages — kept the one hard-coded in index.html, which points at the
  // HOMEPAGE. Google was being told nine distinct pages were all duplicates
  // of "/" and dropped them from the index accordingly. og:url is a social
  // sharing hint; it carries no canonicalisation weight whatsoever.
  //
  // Caught by the canonical assertion in scripts/prerender.mjs, which fails
  // the build rather than silently emitting a wrong one.
  if (url)          setLinkRel("canonical", url);
  if (type)         setMetaTag("property", "og:type", type);
  if (image)        setMetaTag("property", "og:image", image);
  if (title || description) {
    setMetaTag("name", "twitter:card", image ? "summary_large_image" : "summary");
    if (title)       setMetaTag("name", "twitter:title", title);
    if (description) setMetaTag("name", "twitter:description", description);
  }

  // ── BreadcrumbList (SH-09) ────────────────────────────────────────────────
  // useSeo() does the same thing for the pages that use IT. This is the second
  // of the two SEO mechanisms in the app, and it covers exactly the nine pages
  // the first one misses — /changelog, /gallery, /vs/battlecard and all six
  // programmatic routes. Adding it to only one of the two would have left a
  // hole shaped like whichever pages happened to use the other helper, which is
  // how the missing-canonical bug above survived as long as it did.
  if (url) applyBreadcrumb(url);
}

/**
 * Write (or replace) this page's BreadcrumbList, derived from its own URL.
 *
 * Tagged with a data attribute so a second call replaces rather than appends —
 * a page asserting two different positions in the site hierarchy is worse than
 * one asserting none.
 */
function applyBreadcrumb(url) {
  if (typeof document === "undefined") return;
  let path = null;
  try { path = new URL(url, "https://datiq.app").pathname; } catch { return; }
  const crumb = breadcrumbFor(path);
  const existing = document.head.querySelector('script[data-datiq-breadcrumb]');
  if (!crumb) {
    if (existing) existing.parentNode.removeChild(existing);
    return;
  }
  const el = existing || document.createElement("script");
  el.type = "application/ld+json";
  el.setAttribute("data-datiq-breadcrumb", "1");
  el.textContent = JSON.stringify(crumb);
  if (!existing) document.head.appendChild(el);
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
const BOT_NAMES = [
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider", "yandex",
  "gptbot", "chatgpt-user", "claudebot", "anthropic-ai",
  "perplexitybot", "cohere-ai", "ccbot", "applebot",
  "meta-externalagent", "google-extended"
];

/**
 * Block search engines and AI crawlers from indexing, following, caching or
 * generating a snippet of the current page.
 *
 * Applied to /admin/* — see AdminLayout.jsx. The combination of:
 *   - <meta name="robots" content="noindex, nofollow, ...">
 *   - search-engine specific bot directives (googlebot, bingbot, etc.)
 *   - AI/GEO/AEO bot directives (gptbot, claudebot, perplexitybot, etc.)
 *   - removal of structured data (application/ld+json and breadcrumbs)
 *   - neutral og:title / og:description / og:url / twitter:* overrides
 *   - canonical link removed
 *   - document.title neutralised
 * covers the path where a crawler bypasses robots.txt, ignores the meta
 * robots tag, ignores the X-Robots-Tag HTTP header, and tries to extract a
 * snippet anyway. There is no public page in the SPA that links to
 * /admin/*, the sitemap has none of those URLs, and robots.txt disallows
 * them for every user-agent.
 */
export function setNoIndex() {
  if (typeof document === "undefined") return;
  // 1. The decisive signal for standard crawlers.
  setMetaTag("name", "robots", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noydir");
  // 2. Specific search engine bots and AI / GEO / AEO crawlers.
  setMetaTag("name", "googlebot", "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate");
  setMetaTag("name", "bingbot", "noindex, nofollow, noarchive, nosnippet, noimageindex");
  setMetaTag("name", "slurp", "noindex, nofollow, noarchive, nosnippet");
  setMetaTag("name", "duckduckbot", "noindex, nofollow");
  setMetaTag("name", "baiduspider", "noindex, nofollow");
  setMetaTag("name", "yandex", "noindex, nofollow, noarchive");
  for (const bot of ["gptbot", "chatgpt-user", "claudebot", "anthropic-ai", "perplexitybot", "cohere-ai", "ccbot", "applebot", "meta-externalagent", "google-extended"]) {
    setMetaTag("name", bot, "noindex, nofollow");
  }

  // 3. Neutralise every tag a snippet could leak from. Keep the public
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

  // 4. Drop the canonical link — without it, crawlers must fall back to
  //    the URL in the request, which is /admin/*, and X-Robots-Tag
  //    forbids indexing that anyway.
  removeMetaTag("rel", "canonical");
  const linkCanon = document.head.querySelector('link[rel="canonical"]');
  if (linkCanon) linkCanon.remove();

  // 5. Strip any JSON-LD / schema structured data so GEO/AEO bots extract no entities
  const ldScripts = document.head.querySelectorAll('script[type="application/ld+json"]');
  for (const s of ldScripts) s.remove();
  const breadcrumb = document.head.querySelector('script[data-datiq-breadcrumb]');
  if (breadcrumb) breadcrumb.remove();
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
  for (const bot of BOT_NAMES) {
    removeMetaTag("name", bot);
  }
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
  for (const bot of BOT_NAMES) {
    removeMetaTag("name", bot);
  }
}
