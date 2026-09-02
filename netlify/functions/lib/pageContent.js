// pageContent.js — turn raw scraped HTML into text a model can actually reason over.
//
// ── WHY THE OLD ONE-LINER WASN'T ENOUGH ──────────────────────────────────────
// extract.js used to do `html.replace(/<[^>]+>/g," ")`. That is fine for a
// word count and useless for extraction, because it destroys exactly the
// structure the hard capabilities depend on:
//
//   • A pricing table becomes "Pro $29 10 seats Unlimited Business $79 50" —
//     the row/column relationship that says WHICH price belongs to WHICH plan
//     is gone, so the model has to guess, and guessing is what produced the
//     half-right pricing extractions.
//   • Nav, cookie banners and footers survive at full weight, so on a long
//     page the truncation window fills with chrome before it reaches content.
//   • Link text and its href are separated, so "Contact us" loses /contact.
//
// This module keeps block structure as lightweight markdown (headings, list
// items, table rows as `a | b | c`), drops boilerplate containers, and
// preserves mailto:/tel: targets — which is the single highest-yield signal
// for the contacts capability and was previously thrown away entirely.

const BOILERPLATE_TAGS = ["script", "style", "noscript", "svg", "template", "iframe", "canvas"];

// Containers whose content is almost never the answer. Removed only when the
// document also has a plausible main region — a page that IS a nav (a sitemap)
// must not come back empty.
const CHROME_SELECTORS = ["nav", "header", "footer", "aside"];

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
  "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”",
  "&bull;": "•", "&middot;": "·", "&times;": "×", "&trade;": "™", "&copy;": "©", "&reg;": "®",
};

export function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch { return " "; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ENTITIES[m] ?? " ");
}

function stripTags(html) {
  return decodeEntities(String(html || "").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

function removeBlocks(html, tags) {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), " ");
  }
  return out;
}

/** Prefer <main>/<article>/[role=main] when one exists and carries real bulk. */
function isolateMain(html) {
  for (const re of [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<div\b[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
  ]) {
    const m = html.match(re);
    // 600 chars is the "is this actually the content" floor — some SPAs ship an
    // empty <main> shell and the real content sits in a sibling div.
    if (m && m[1] && stripTags(m[1]).length > 600) return { html: m[1], isolated: true };
  }
  return { html, isolated: false };
}

/**
 * Convert one HTML fragment to structure-preserving plain text.
 * Order matters: block markers are inserted BEFORE tags are stripped.
 */
function toStructuredText(html) {
  let s = html;

  // mailto:/tel: — surface the target next to its label. This is the only
  // reliable contact signal on most sites and tag-stripping erased it.
  s = s.replace(/<a\b[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, addr, label) => ` ${stripTags(label)} <${decodeEntities(addr).trim()}> `);
  s = s.replace(/<a\b[^>]*href=["']tel:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, num, label) => ` ${stripTags(label)} (tel: ${decodeEntities(num).trim()}) `);

  // Social/profile hrefs — keep the URL beside the anchor text so the social
  // capability can read the actual profile, not just the word "LinkedIn".
  s = s.replace(
    /<a\b[^>]*href=["'](https?:\/\/(?:[a-z0-9-]+\.)*(?:linkedin|twitter|x|facebook|instagram|youtube|github|tiktok|discord|threads|mastodon|bsky)\.[a-z.]+\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, label) => ` ${stripTags(label)} [${href}] `);

  // Headings → markdown, so section boundaries survive.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, lvl, inner) => `\n\n${"#".repeat(Number(lvl))} ${stripTags(inner)}\n`);

  // Tables → pipe rows. This is what makes a pricing grid legible.
  s = s.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => {
    const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]));
    return cells.length ? `\n| ${cells.join(" | ")} |` : "\n";
  });

  // List items and definition terms.
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${stripTags(inner)}`);
  s = s.replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, (_, inner) => `\n- ${stripTags(inner)}: `);

  // Remaining block-level elements become paragraph breaks.
  s = s.replace(/<\/?(p|div|section|br|tr|table|ul|ol|dl|blockquote|figcaption)\b[^>]*>/gi, "\n");

  s = stripTags(s);

  return s
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/**
 * Extract readable, structure-preserving content from a page's HTML.
 *
 * @param {string} html
 * @param {{maxChars?:number}} [opts]
 * @returns {{text:string, chars:number, truncated:boolean, isolated:boolean, mode:string}}
 */
export function extractPageContent(html, opts = {}) {
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 60_000;
  if (!html || typeof html !== "string") {
    return { text: "", chars: 0, truncated: false, isolated: false, mode: "empty" };
  }
  let cleaned;
  try {
    cleaned = removeBlocks(html, BOILERPLATE_TAGS).replace(/<!--[\s\S]*?-->/g, " ");
  } catch {
    return { text: "", chars: 0, truncated: false, isolated: false, mode: "error" };
  }

  const { html: mainHtml, isolated } = isolateMain(cleaned);

  // Only drop chrome when what remains still looks like a page. On a thin SPA
  // shell the nav IS most of the text, and stripping it leaves nothing to read.
  let body = mainHtml;
  const withoutChrome = removeBlocks(mainHtml, CHROME_SELECTORS);
  if (stripTags(withoutChrome).length > 400) body = withoutChrome;

  let text;
  try {
    text = toStructuredText(body);
  } catch {
    text = stripTags(body);
  }

  // Last-resort floor: if structure-aware parsing produced almost nothing
  // (malformed markup, unusual framework output), fall back to the whole
  // document flattened. A worse read beats an empty one.
  if (text.length < 200) {
    const flat = stripTags(cleaned).replace(/\s+/g, " ").trim();
    if (flat.length > text.length) {
      return {
        text: flat.slice(0, maxChars), chars: flat.length,
        truncated: flat.length > maxChars, isolated: false, mode: "flat",
      };
    }
  }

  return {
    text: text.slice(0, maxChars),
    chars: text.length,
    truncated: text.length > maxChars,
    isolated,
    mode: isolated ? "main" : "document",
  };
}

/** Back-compat: the old flat behaviour, for callers that only want a word bag. */
export function htmlToPlainText(html) {
  if (!html || typeof html !== "string") return "";
  try {
    return stripTags(removeBlocks(html, BOILERPLATE_TAGS).replace(/<!--[\s\S]*?-->/g, " "))
      .replace(/\s+/g, " ").trim();
  } catch { return ""; }
}
