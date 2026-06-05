// linkCategorizer.js — assign a single semantic category to each scraped link.
//
// Pure heuristics (host + extension based), no network. Used both as the always-on
// baseline and as the fallback when AI categorization (see aiService.js) is off or
// fails, and by the UI to tag links that were saved before this feature existed.

import { hostOf, isExternal } from "./utils.js";

// Ordered: the first category that matches wins.
export const CATEGORY_KEYS = ["email", "social", "document", "media", "internal", "external"];

export const CATEGORY_META = {
  internal: { label: "Internal", icon: "link" },
  external: { label: "External", icon: "external" },
  social: { label: "Social", icon: "share" },
  email: { label: "Email", icon: "mail" },
  document: { label: "Document", icon: "file" },
  media: { label: "Media", icon: "image" },
};

const SOCIAL_HOSTS = [
  "facebook.com", "fb.com", "twitter.com", "x.com", "instagram.com", "linkedin.com",
  "youtube.com", "youtu.be", "tiktok.com", "pinterest.com", "reddit.com", "github.com",
  "gitlab.com", "discord.com", "discord.gg", "t.me", "telegram.org", "whatsapp.com",
  "wa.me", "threads.net", "mastodon.social", "medium.com", "snapchat.com", "twitch.tv",
  "vimeo.com", "dribbble.com", "behance.net", "stackoverflow.com",
];
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|odt|ods|odp|zip|rar|7z|gz|tar)(\?|#|$)/i;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|flac)(\?|#|$)/i;

// Classify one link into exactly one CATEGORY_KEYS value.
export function categoryOf(href, baseUrl) {
  const h = String(href || "");
  if (/^mailto:/i.test(h)) return "email";
  const host = hostOf(h);
  if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith("." + s))) return "social";
  if (DOC_EXT.test(h)) return "document";
  if (MEDIA_EXT.test(h)) return "media";
  return isExternal(h, baseUrl) ? "external" : "internal";
}

// Validate a (possibly AI-supplied) category string.
export function isCategory(value) {
  return CATEGORY_KEYS.includes(value);
}

// Count links per category (using stored category when present, heuristic otherwise),
// returned in CATEGORY_KEYS display order, omitting empties.
export function categoryCounts(links, baseUrl) {
  const counts = {};
  for (const l of links || []) {
    const c = isCategory(l.category) ? l.category : categoryOf(l.href, baseUrl);
    counts[c] = (counts[c] || 0) + 1;
  }
  return CATEGORY_KEYS.filter((k) => counts[k]).map((k) => ({
    key: k,
    count: counts[k],
    ...CATEGORY_META[k],
  }));
}
