// htmlParse.js — turn a page's HTML into the facts the audit scores.
//
// ── WHY THIS IS HAND-ROLLED ────────────────────────────────────────────────
// There is no DOM in a Netlify function. jsdom is a devDependency (test-only)
// and pulling a parser into the runtime bundle for this would add megabytes to
// every cold start of a function that has ten seconds to work with. Everything
// the four pillars need — a heading tree, meta tags, JSON-LD blocks, list and
// table counts, visible Q&A pairs — is extractable with bounded patterns.
//
// ── SAFETY RULES FOR PARSING UNTRUSTED HTML ────────────────────────────────
// 1. CAP THE INPUT. Everything below runs over a hard byte ceiling. An audit
//    that hangs on a 40MB page is worse than one that says "too large".
// 2. NO NESTED QUANTIFIERS. Every pattern here is `[^>]*` or a lazy match
//    terminated by a literal, both linear. `(\\s*\\w+)*`-shaped patterns are how
//    a regex parser becomes a denial-of-service vector.
// 3. NEVER THROW. A malformed page is a finding, not a crash. Every extractor
//    returns an empty/neutral result rather than propagating a parse error,
//    because losing the whole audit to one bad tag would hide the 19 signals
//    that parsed fine.

import { decodeHtmlEntities } from "../htmlEntities.js";

/** Hard ceiling on the HTML we will parse. Larger pages are truncated. */
export const MAX_HTML_BYTES = 2_000_000;

/** Elements whose text is never visible content. */
const NON_CONTENT = /<(script|style|noscript|template|svg|iframe|object|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi;
const SELF_CLOSING_NOISE = /<(br|hr|img|input|source|track)\b[^>]*\/?>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;

/** Truncate to the byte ceiling, reporting whether anything was lost. */
export function capHtml(html) {
  const s = String(html || "");
  if (s.length <= MAX_HTML_BYTES) return { html: s, truncated: false, bytes: s.length };
  return { html: s.slice(0, MAX_HTML_BYTES), truncated: true, bytes: s.length };
}

/** Decode the entity subset that actually appears in headings and answers. */
export function decodeEntities(text = "") {
  // One pass — chained replaces double-decoded "&amp;lt;" into "<".
  return decodeHtmlEntities(text);
}

/** Strip tags from a fragment and normalise whitespace. */
export function textOf(fragment = "") {
  return decodeEntities(String(fragment).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** Remove scripts, styles and comments — everything a reader never sees. */
export function visibleHtml(html = "") {
  return String(html).replace(COMMENTS, " ").replace(NON_CONTENT, " ");
}

/** Plain visible text of the page. */
export function visibleText(html = "") {
  return textOf(visibleHtml(html).replace(SELF_CLOSING_NOISE, " "));
}

export function wordCount(text = "") {
  const t = String(text).trim();
  return t ? t.split(/\s+/).length : 0;
}

// ── Headings ───────────────────────────────────────────────────────────────

/**
 * The heading tree, in document order.
 *
 * `position` is how far into the visible text this heading sits, as a
 * percentage — the fact behind the "your answer is buried" finding. It is
 * computed against the STRIPPED text length rather than the raw HTML offset,
 * because a page with 200KB of inline SVG before its H1 has not buried
 * anything from a reader's point of view.
 */
export function extractHeadings(html = "") {
  const clean = visibleHtml(html);
  const out = [];
  const re = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(clean)) !== null) {
    if (++guard > 2000) break;                 // pathological page; stop counting
    const text = textOf(m[3]);
    out.push({
      level: Number(m[1]),
      text,
      empty: text.length === 0,
      htmlIndex: m.index,
      id: attrValue(m[2], "id"),
      isQuestion: isQuestionText(text),
    });
  }

  const totalLen = clean.length || 1;
  for (const h of out) h.position = Math.round((h.htmlIndex / totalLen) * 1000) / 10;
  return out;
}

/** Does this heading read as a question a person would type or ask? */
export function isQuestionText(text = "") {
  const t = String(text).trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  // Interrogative openers, which cover headings written without the mark.
  return /^(what|why|how|when|where|who|which|can|do|does|did|is|are|will|should|would)\b/i.test(t);
}

/**
 * Count structural defects in the heading tree.
 *
 * A "skip" is a descent of more than one level (H2 → H4). Going back UP any
 * number of levels is normal document structure and is not a defect — a new H2
 * after an H4 is simply the next section.
 */
export function analyseHeadingTree(headings = []) {
  let skipped = 0;
  let empty = 0;
  let prev = 0;
  for (const h of headings) {
    if (h.empty) empty += 1;
    if (prev > 0 && h.level > prev + 1) skipped += 1;
    prev = h.level;
  }
  const h1s = headings.filter((h) => h.level === 1);
  return {
    total: headings.length,
    skipped,
    empty,
    h1Count: h1s.length,
    h1Text: h1s[0]?.text || "",
    questionHeadings: headings.filter((h) => h.isQuestion && !h.empty).length,
    maxDepth: headings.reduce((a, h) => Math.max(a, h.level), 0),
  };
}

// ── Metadata ───────────────────────────────────────────────────────────────

/**
 * Read one attribute off a tag, quoted OR unquoted.
 *
 * `<meta name=viewport content=width=device-width>` is valid HTML and common in
 * hand-written and minified pages. A quote-only matcher silently reports the
 * attribute as absent, which turned into a phantom "no viewport declaration"
 * finding (TA-12) on pages that had one — a false accusation, which is the
 * worst kind of audit output.
 */
export function attrValue(tag, name) {
  if (!tag) return null;
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = String(tag).match(re);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[3] ?? "";
  return decodeEntities(raw).trim();
}

/** Build an attribute matcher fragment that tolerates unquoted values. */
function attrIs(name, value) {
  return `\\b${name}\\s*=\\s*["']?${value}["']?(?=[\\s/>])`;
}

function metaContent(html, matcher) {
  const re = new RegExp(`<meta\\b[^>]*${matcher}[^>]*>`, "i");
  const tag = (html.match(re) || [])[0];
  return tag ? attrValue(tag, "content") : null;
}

export function extractMeta(html = "") {
  const h = String(html);
  const titleTag = h.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const canonical = h.match(new RegExp(`<link\\b[^>]*${attrIs("rel", "canonical")}[^>]*>`, "i"));
  const canonicalHref = canonical ? attrValue(canonical[0], "href") : null;

  const robots = metaContent(h, attrIs("name", "robots"));
  return {
    title: titleTag ? textOf(titleTag[1]) : null,
    description: metaContent(h, attrIs("name", "description")),
    canonical: canonicalHref,
    robots,
    // A page-level directive beats robots.txt for indexing, so both are read.
    noindex: robots ? /\bnoindex\b/i.test(robots) : false,
    nofollow: robots ? /\bnofollow\b/i.test(robots) : false,
    viewport: metaContent(h, attrIs("name", "viewport")),
    ogTitle: metaContent(h, attrIs("property", "og:title")),
    ogDescription: metaContent(h, attrIs("property", "og:description")),
    ogType: metaContent(h, attrIs("property", "og:type")),
    lang: attrValue((h.match(/<html\b[^>]*>/i) || [])[0], "lang"),
    // Answer engines read the page-level AI directives too.
    aiRobots: metaContent(h, `\\bname\\s*=\\s*["']?(?:googlebot|google-extended|gptbot)["']?(?=[\\s/>])`),
  };
}

// ── Structured data ────────────────────────────────────────────────────────

/**
 * JSON-LD blocks.
 *
 * Reports blocks that FAILED to parse separately from the ones that succeeded,
 * because "your markup does not parse" (issue TA-13) and "you have no markup"
 * (TA-15) are different problems with different fixes, and a parser that
 * quietly skipped the broken block would report the second when the truth is
 * the first.
 */
export function extractJsonLd(html = "") {
  const blocks = [];
  const errors = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(String(html))) !== null) {
    if (++guard > 100) break;
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // A @graph, or a bare array, both hold several entities in one block.
      const items = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.["@graph"]) ? parsed["@graph"]
        : [parsed];
      for (const item of items) if (item && typeof item === "object") blocks.push(item);
    } catch (err) {
      errors.push({ snippet: raw.slice(0, 200), message: err?.message || "invalid JSON" });
    }
  }
  return { blocks, errors };
}

/** Every @type present, flattened and de-duplicated. */
export function schemaTypes(blocks = []) {
  const types = new Set();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    const t = node["@type"];
    if (typeof t === "string") types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && types.add(x));
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  blocks.forEach((b) => walk(b));
  return [...types];
}

/** Find the first block of a given @type, searching nested graphs. */
export function findSchema(blocks = [], type) {
  const want = String(type).toLowerCase();
  const search = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 6) return null;
    if (Array.isArray(node)) {
      for (const n of node) { const f = search(n, depth + 1); if (f) return f; }
      return null;
    }
    const t = node["@type"];
    const matches = typeof t === "string" ? t.toLowerCase() === want
      : Array.isArray(t) ? t.some((x) => String(x).toLowerCase() === want)
      : false;
    if (matches) return node;
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") { const f = search(v, depth + 1); if (f) return f; }
    }
    return null;
  };
  return search(blocks);
}

/** Microdata itemtypes — the older markup style, still common on ecommerce. */
export function extractMicrodata(html = "") {
  const types = new Set();
  const re = /\bitemtype\s*=\s*["']([^"']+)["']/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(String(html))) !== null) {
    if (++guard > 500) break;
    const last = m[1].split("/").filter(Boolean).pop();
    if (last) types.add(last);
  }
  return [...types];
}

/**
 * A microdata INVENTORY, not just the list of types.
 *
 * `extractMicrodata` above answers "what types are declared", which is all the
 * entity analyser needs. The BRD asks for a *"JSON-LD/microdata schema
 * inventory"*, and an inventory has to say how many of each and which
 * properties they carry — otherwise "you have Product markup" cannot be
 * distinguished from "you have forty Product blocks, none of which names a
 * price", and those call for opposite advice.
 *
 * Regex rather than a DOM walk, for the same reason the rest of this file is:
 * a Netlify function has no DOM, and pulling one in for an inventory would add
 * seconds to an audit already bounded at 8s. The cost is that properties are
 * attributed to the document rather than nested under their own item — stated
 * here so nobody reads the output as a parse tree. It is enough to answer
 * "is anything describing a price?", which is the question it exists for.
 */
export function extractMicrodataInventory(html = "") {
  const src = String(html);
  const byType = new Map();
  const typeRe = /\bitemtype\s*=\s*["']([^"']+)["']/gi;
  let m;
  let guard = 0;
  while ((m = typeRe.exec(src)) !== null) {
    if (++guard > 500) break;
    const type = m[1].split("/").filter(Boolean).pop();
    if (!type) continue;
    byType.set(type, (byType.get(type) || 0) + 1);
  }
  if (byType.size === 0) return [];

  const props = new Set();
  const propRe = /\bitemprop\s*=\s*["']([^"']+)["']/gi;
  guard = 0;
  while ((m = propRe.exec(src)) !== null) {
    if (++guard > 1000) break;
    for (const name of m[1].split(/\s+/)) if (name) props.add(name);
  }

  return [...byType.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }))
    .slice(0, 40)
    .map((entry) => ({ ...entry, properties: [...props].slice(0, 40) }));
}

// ── Content structures ─────────────────────────────────────────────────────

export function countStructures(html = "") {
  const clean = visibleHtml(html);
  const count = (re) => (clean.match(re) || []).length;
  return {
    lists: count(/<ul\b[^>]*>/gi) + count(/<ol\b[^>]*>/gi),
    orderedLists: count(/<ol\b[^>]*>/gi),
    listItems: count(/<li\b[^>]*>/gi),
    tables: count(/<table\b[^>]*>/gi),
    paragraphs: count(/<p\b[^>]*>/gi),
    images: count(/<img\b[^>]*>/gi),
    imagesWithAlt: count(/<img\b[^>]*\balt\s*=\s*["'][^"']+["'][^>]*>/gi),
  };
}

// ── Passages ───────────────────────────────────────────────────────────────

/**
 * The text immediately following each heading — the candidate answer passages.
 *
 * "Immediately following" is the whole point: an answer that appears three
 * paragraphs after its heading is not answer-first, and slicing to the NEXT
 * heading is what makes that measurable.
 */
export function extractPassages(html = "") {
  const clean = visibleHtml(html);
  const headings = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(clean)) !== null) {
    if (++guard > 2000) break;
    headings.push({ level: Number(m[1]), text: textOf(m[2]), start: m.index, end: re.lastIndex });
  }

  const passages = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const sliceEnd = i + 1 < headings.length ? headings[i + 1].start : clean.length;
    const body = textOf(clean.slice(h.end, sliceEnd));
    passages.push({
      heading: h.text,
      level: h.level,
      text: body,
      wordCount: wordCount(body),
      position: Math.round((h.start / (clean.length || 1)) * 1000) / 10,
      isQuestion: isQuestionText(h.text),
    });
  }

  // Text before the first heading — the lede. On many pages this is where the
  // direct answer actually lives, so it must be a candidate too.
  if (headings.length > 0 && headings[0].start > 0) {
    const lede = textOf(clean.slice(0, headings[0].start));
    if (wordCount(lede) >= 10) {
      passages.unshift({ heading: null, level: 0, text: lede, wordCount: wordCount(lede), position: 0, isQuestion: false });
    }
  }
  return passages;
}

/**
 * Does a passage stand on its own when quoted?
 *
 * A deterministic pre-screen, not a verdict. Opening with a bare pronoun or a
 * back-reference is strong evidence the passage depends on what came before.
 * The AI evaluator refines this where it is available; this is what keeps the
 * signal measurable when it is not.
 */
export function passageIndependence(text = "") {
  const t = String(text).trim();
  if (!t) return null;
  let score = 100;
  const first = t.split(/(?<=[.!?])\s+/)[0] || t;

  // A leading pronoun or back-reference means the subject is somewhere above.
  if (/^(this|these|those|it|they|that|he|she|such)\b/i.test(first)) score -= 45;
  if (/\b(as (mentioned|noted|discussed|described) (above|earlier|previously))\b/i.test(t)) score -= 25;
  if (/\b(the (former|latter))\b/i.test(t)) score -= 15;
  if (/^(also|additionally|furthermore|moreover|however|but|and|so|therefore|then)\b/i.test(first)) score -= 20;
  // Naming a proper noun early is the clearest sign the passage is self-contained.
  if (/\b[A-Z][a-z]{2,}\b/.test(first)) score += 10;

  return Math.max(0, Math.min(100, score));
}

// ── Visible FAQ detection ──────────────────────────────────────────────────

/**
 * Question/answer pairs a READER can see.
 *
 * This is what makes issue SH-07 checkable. FAQPage markup is only meaningful
 * if the questions and answers are on the page; comparing the markup against
 * this list is how the engine tells "you have FAQs but no markup" (SH-06) from
 * "your markup describes text nobody can see" (SH-07) — opposite fixes.
 *
 * Two shapes are recognised: question-style headings with text under them, and
 * <details>/<summary> accordions, which is how most FAQ components render.
 */
export function detectVisibleFaq(html = "") {
  const pairs = [];
  const clean = visibleHtml(html);

  // <details><summary>Q</summary>A</details>
  const det = /<details\b[^>]*>([\s\S]*?)<\/details\s*>/gi;
  let m;
  let guard = 0;
  while ((m = det.exec(clean)) !== null) {
    if (++guard > 200) break;
    const inner = m[1];
    const sum = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i);
    if (!sum) continue;
    const question = textOf(sum[1]);
    const answer = textOf(inner.replace(sum[0], " "));
    if (question && answer) pairs.push({ question, answer, source: "details" });
  }

  // Question headings with a real answer beneath.
  //
  // Two deliberate restrictions, both for PRECISION. This list decides whether
  // we tell someone "you have FAQs but no FAQPage markup" (SH-06), and that
  // advice is wrong — and looks careless — if we counted things that are not
  // FAQs:
  //
  //   • Level 2 or deeper. An H1 phrased as a question is the page's SUBJECT,
  //     not an FAQ entry. "What is GEO?" as the title of a GEO explainer is
  //     the article, not an item in its FAQ.
  //   • A literal question mark. isQuestionText() also matches interrogative
  //     openers, which is right for "are your headings phrased as questions"
  //     (AC-07) but far too loose here: it turns every "How GEO differs from
  //     SEO" section of a normal article into a phantom FAQ entry.
  for (const p of extractPassages(clean)) {
    if (!p.heading || p.level < 2) continue;
    if (!p.heading.trim().endsWith("?")) continue;
    if (p.wordCount < 5) continue;                   // a heading with no answer
    if (pairs.some((x) => x.question === p.heading)) continue;
    pairs.push({ question: p.heading, answer: p.text, source: "heading" });
  }

  return pairs;
}

/** Ordered, visible steps — the precondition for HowTo markup being honest. */
export function detectVisibleSteps(html = "") {
  const clean = visibleHtml(html);
  const steps = [];
  const ol = clean.match(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/i);
  if (ol) {
    const re = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi;
    let m;
    let guard = 0;
    while ((m = re.exec(ol[1])) !== null) {
      if (++guard > 100) break;
      const text = textOf(m[1]);
      if (text) steps.push({ name: text.split(/[.:]/)[0].slice(0, 80), text });
    }
  }
  if (steps.length === 0) {
    // "Step 1", "Step 2" headings are the other common shape.
    for (const h of extractHeadings(clean)) {
      if (/^step\s*\d+\b/i.test(h.text)) steps.push({ name: h.text, text: h.text });
    }
  }
  return steps;
}

// ── Links, authorship, dates ───────────────────────────────────────────────

const SOCIAL_HOSTS = [
  "linkedin.com", "x.com", "twitter.com", "facebook.com", "instagram.com",
  "youtube.com", "github.com", "crunchbase.com", "wikidata.org", "wikipedia.org",
  "g2.com", "capterra.com", "trustpilot.com", "producthunt.com", "medium.com",
];

export function extractLinks(html = "", baseUrl = "") {
  let baseHost = "";
  try { baseHost = new URL(baseUrl).hostname.replace(/^www\./, ""); } catch { /* no base */ }

  const clean = visibleHtml(html);
  const internal = [];
  const external = [];
  const profiles = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  let m;
  let guard = 0;
  while ((m = re.exec(clean)) !== null) {
    if (++guard > 3000) break;
    const href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    const text = textOf(m[2]);
    let host = "";
    try { host = new URL(href, baseUrl || "https://example.invalid").hostname.replace(/^www\./, ""); }
    catch { continue; }
    const entry = { href, text, host };
    if (baseHost && host === baseHost) internal.push(entry);
    else {
      external.push(entry);
      if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith("." + s))) profiles.push(entry);
    }
  }
  return { internal, external, profiles, internalCount: internal.length, externalCount: external.length };
}

/** A visible byline, from markup or from the common "By Name" pattern. */
export function detectAuthor(html = "", jsonLdBlocks = []) {
  const article = findSchema(jsonLdBlocks, "Article") || findSchema(jsonLdBlocks, "BlogPosting");
  const person = findSchema(jsonLdBlocks, "Person");
  const webPage = findSchema(jsonLdBlocks, "WebPage");
  const schemaAuthor = article?.author?.name || (typeof article?.author === "string" ? article.author : null)
    || person?.name
    || webPage?.author?.name || (typeof webPage?.author === "string" ? webPage.author : null)
    || null;

  const clean = visibleHtml(html);
  const relAuthor = clean.match(/<[^>]*\brel\s*=\s*["']author["'][^>]*>([\s\S]*?)<\//i);
  const classAuthor = clean.match(/<[^>]*class\s*=\s*["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\//i);
  const byline = clean.match(/\b(?:By|Published\s+by)\s+(?:<[^>]+>\s*)*([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,3})\b/i);

  const visibleName = textOf(relAuthor?.[1] || "") || textOf(classAuthor?.[1] || "") || byline?.[1] || null;

  return {
    name: schemaAuthor || visibleName || null,
    visible: Boolean(visibleName),
    inSchema: Boolean(schemaAuthor),
    // A bio page is what turns a name into a credential.
    bioLinked: /rel\s*=\s*["']author["']/i.test(clean) || /href\s*=\s*["'][^"']*\/(author|authors|team|about)\/?["']/i.test(clean),
    credentials: Boolean(person?.jobTitle || article?.author?.jobTitle || person?.worksFor || webPage?.author),
    sameAs: [].concat(person?.sameAs || article?.author?.sameAs || webPage?.author?.sameAs || []).filter((s) => typeof s === "string"),
  };
}

/** Published / modified dates, from markup first and visible text second. */
export function detectDates(html = "", jsonLdBlocks = []) {
  const article = findSchema(jsonLdBlocks, "Article") || findSchema(jsonLdBlocks, "BlogPosting")
    || findSchema(jsonLdBlocks, "WebPage");
  const clean = visibleHtml(html);

  const timeTag = clean.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i);
  const metaModified = metaContent(html, attrIs("property", "article:modified_time"));
  const metaPublished = metaContent(html, attrIs("property", "article:published_time"));

  const published = article?.datePublished || metaPublished || timeTag?.[1] || null;
  const modified = article?.dateModified || metaModified || null;

  // A visible date matters separately from a machine-readable one: the reader's
  // trust comes from seeing it, the machine's from parsing it.
  const visibleDate = Boolean(timeTag)
    || /\b(last\s+updated|updated\s+on|published\s+on|reviewed\s+on)\b/i.test(clean)
    || /\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(textOf(clean).slice(0, 4000));

  return { published, modified, visibleDate, best: modified || published || null };
}

/**
 * Every fact this module can extract, in one call.
 *
 * The pipeline uses this so each analyser reads from ONE parse rather than
 * re-scanning the page five times — the difference between an audit that fits
 * a function's time budget and one that does not.
 */
export function parsePage(rawHtml = "", url = "") {
  const { html, truncated, bytes } = capHtml(rawHtml);
  const meta = extractMeta(html);
  const { blocks: jsonLd, errors: jsonLdErrors } = extractJsonLd(html);
  const headings = extractHeadings(html);
  const text = visibleText(html);

  return {
    url,
    canonical: meta.canonical || url,
    truncated,
    bytes,
    meta,
    jsonLd,
    jsonLdErrors,
    schemaTypes: [...new Set([...schemaTypes(jsonLd), ...extractMicrodata(html)])],
    microdata: extractMicrodataInventory(html),
    headings,
    headingStats: analyseHeadingTree(headings),
    passages: extractPassages(html),
    structures: countStructures(html),
    faqPairs: detectVisibleFaq(html),
    steps: detectVisibleSteps(html),
    links: extractLinks(html, url),
    author: detectAuthor(html, jsonLd),
    dates: detectDates(html, jsonLd),
    text,
    wordCount: wordCount(text),
  };
}
