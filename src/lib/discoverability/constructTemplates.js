// constructTemplates.js — the ready-made fixes.
//
// PURE. Given the facts an audit already gathered, produce something the user
// can paste. This is the module that separates the product from a checklist:
// "add Organization schema" is advice, and a filled-in JSON-LD block with the
// brand's own name, logo and profile links already in it is a fix.
//
// ── EVERY CONSTRUCT IS A DRAFT, AND SAYS SO ────────────────────────────────
// These are generated from what the page already exposes. They are correct in
// SHAPE always, and correct in CONTENT only as far as the source page was.
// Anything the audit could not observe is emitted as an explicit
// `TODO:` placeholder rather than a plausible invention — a schema block
// containing a hallucinated founder name or a made-up support address is worse
// than no schema block, because it will be published without being read.
//
// Nothing here writes to a site. The BRD lists automatic deployment and direct
// CMS publishing as explicitly out of scope, and generating copy-ready assets
// while leaving the publish decision with a human is the whole point.

import { CONTENT_KINDS } from "./contentCoverage.js";

/** Query shapes, taken from the coverage model so the two cannot drift. */
const CONTENT_KIND_QUERY = Object.fromEntries(
  Object.entries(CONTENT_KINDS).map(([k, v]) => [k, v.query]),
);

const TODO = (what) => `TODO: ${what}`;

/**
 * Coerce a builder's array argument.
 *
 * buildConstruct() passes `facts = {}` by default, so a builder whose argument
 * is a LIST (faqSchema, howToSchema, breadcrumbSchema, headingTree) receives an
 * object when the pipeline has nothing to give it. Without this, `.map` throws,
 * buildConstruct catches, and the recommendation silently loses the very asset
 * it promised — a failure that looks like "no attachment" rather than a bug.
 */
const asArray = (v) => (Array.isArray(v) ? v : []);

/** Stable JSON-LD formatting so the same facts always produce the same bytes. */
function jsonLd(obj) {
  return `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`;
}

function firstSentence(text = "", maxWords = 60) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

// ── Answer blocks ──────────────────────────────────────────────────────────

/**
 * A 40-60 word answer-first block, as markdown.
 *
 * When the page already contains a candidate passage we reshape THAT rather
 * than writing new prose, because the author's own words are the ones they will
 * actually publish. With no candidate we emit a scaffold with the word budget
 * marked, so the shape is unmistakable even though the substance is theirs.
 */
export function answerBlock({ question = "", existingText = "", subject = "" } = {}) {
  const heading = question || (subject ? `What is ${subject}?` : TODO("the question this section answers"));
  const seed = firstSentence(existingText, 60);
  const body = seed
    ? seed
    : `${TODO("40-60 word direct answer")} — open by resolving the question in one self-contained statement that names its subject explicitly, so the passage still makes sense when quoted on its own.`;

  return {
    type: "markdown_block",
    format: "markdown",
    label: "Answer-first block",
    note: "Place immediately below the heading, before any narrative. Target 40-60 words. Avoid opening with 'this', 'it' or 'as mentioned above' — the passage has to survive being quoted alone.",
    body: `## ${heading}\n\n${body}\n`,
  };
}

/** A visible FAQ section, in markdown, matching what the schema will declare. */
export function faqContentBlock(items = []) {
  const list = asArray(items);
  const rows = list.length
    ? list
    : [{ question: TODO("question a reader actually asks"), answer: TODO("40-60 word answer") }];
  const body = rows
    .map((i) => `### ${i.question}\n\n${i.answer}\n`)
    .join("\n");
  return {
    type: "markdown_block", format: "markdown", label: "Visible FAQ section",
    note: "The visible text must match the FAQPage markup word for word. Markup describing text a reader cannot see risks being disregarded entirely.",
    body: `## Frequently asked questions\n\n${body}`,
  };
}

// ── JSON-LD ────────────────────────────────────────────────────────────────

export function organizationSchema({ name = "", url = "", logo = "", sameAs = [], description = "" } = {}) {
  const obj = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: name || TODO("legal or trading name"),
    url: url || TODO("https://your-domain.example"),
    logo: logo || TODO("https://your-domain.example/logo.png"),
    description: description || TODO("one sentence describing what the organisation does"),
    sameAs: sameAs.length ? sameAs : [TODO("https://www.linkedin.com/company/..."), TODO("https://x.com/...")],
  };
  return {
    type: "jsonld", format: "html", label: "Organization schema",
    note: "sameAs is the cheapest identity signal available — list only profiles you actually control. Place in <head> or at the end of <body>.",
    body: jsonLd(obj),
  };
}

export function personSchema({ name = "", url = "", jobTitle = "", sameAs = [], worksFor = "" } = {}) {
  const obj = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: name || TODO("author's full name"),
    url: url || TODO("https://your-domain.example/authors/..."),
    jobTitle: jobTitle || TODO("role that establishes relevant expertise"),
    ...(worksFor ? { worksFor: { "@type": "Organization", name: worksFor } } : {}),
    sameAs: sameAs.length ? sameAs : [TODO("author's professional profile URL")],
  };
  return {
    type: "jsonld", format: "html", label: "Person (author) schema",
    note: "Pair with a visible byline linking to a real author page. A name alone establishes nothing; the credential is what turns authorship into authority.",
    body: jsonLd(obj),
  };
}

export function articleSchema({ headline = "", url = "", author = "", publisher = "", datePublished = "", dateModified = "", description = "" } = {}) {
  const obj = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: headline || TODO("the page's H1"),
    description: description || TODO("one-sentence summary"),
    url: url || TODO("canonical URL"),
    author: { "@type": "Person", name: author || TODO("author's full name") },
    publisher: { "@type": "Organization", name: publisher || TODO("publishing organisation") },
    datePublished: datePublished || TODO("YYYY-MM-DD"),
    dateModified: dateModified || datePublished || TODO("YYYY-MM-DD"),
  };
  return {
    type: "jsonld", format: "html", label: "Article schema",
    note: "dateModified must reflect a real edit. Bumping it without changing anything is a trust signal you can only spend once.",
    body: jsonLd(obj),
  };
}

/**
 * FAQPage markup.
 *
 * Built from the questions and answers ALREADY VISIBLE on the page, never from
 * invented ones. That is not a stylistic preference: markup that describes text
 * a reader cannot see is the exact failure mode issue SH-07 exists to report,
 * and a generator that produced it would be manufacturing the defect the engine
 * is meant to catch.
 */
export function faqSchema(items = []) {
  const list = asArray(items);
  const rows = list.length ? list : [{ question: TODO("visible question"), answer: TODO("visible answer") }];
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: rows.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
  return {
    type: "jsonld", format: "html", label: "FAQPage schema",
    note: "Generated from the questions and answers already visible on your page. If you add entries here, add them to the page too — markup describing invisible text is worse than no markup.",
    body: jsonLd(obj),
    derivedFromVisibleContent: list.length > 0,
  };
}

export function howToSchema({ name = "", steps = [], totalTime = "" } = {}) {
  const list = asArray(steps);
  const rows = list.length ? list : [{ name: TODO("step 1 name"), text: TODO("what the reader does") }];
  const obj = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: name || TODO("what this procedure achieves"),
    ...(totalTime ? { totalTime } : {}),
    step: rows.map((s, idx) => ({
      "@type": "HowToStep",
      position: idx + 1,
      name: s.name || `Step ${idx + 1}`,
      text: s.text || TODO("what the reader does in this step"),
      ...(s.url ? { url: s.url } : {}),
    })),
  };
  return {
    type: "jsonld", format: "html", label: "HowTo schema",
    note: "Only score-worthy when the steps are visible on the page and ordered. Each HowToStep should map to one visible step.",
    body: jsonLd(obj),
    derivedFromVisibleContent: list.length > 0,
  };
}

export function breadcrumbSchema(trail = []) {
  const list = asArray(trail);
  const rows = list.length ? list : [
    { name: "Home", url: TODO("https://your-domain.example/") },
    { name: TODO("Section"), url: TODO("https://your-domain.example/section") },
  ];
  const obj = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: rows.map((t, idx) => ({
      "@type": "ListItem", position: idx + 1, name: t.name, item: t.url,
    })),
  };
  return {
    type: "jsonld", format: "html", label: "BreadcrumbList schema",
    note: "Mirror the navigation path a reader actually sees, not an idealised site map.",
    body: jsonLd(obj),
  };
}

// ── Structure & metadata ───────────────────────────────────────────────────

/**
 * A corrected heading outline.
 *
 * Repairs skipped levels by pulling each heading up to at most one level below
 * its parent, and flags empty ones. The text is never rewritten — only the
 * level — because renaming an author's sections is not a defect fix, it is an
 * edit they did not ask for.
 */
export function headingTree(headings = []) {
  const rows = asArray(headings);
  const fixed = [];
  let prev = 0;
  let seenH1 = false;
  for (const h of rows) {
    const level = Math.max(1, Math.min(6, Number(h.level) || 1));
    let corrected;
    if (level === 1 && seenH1) {
      // A second H1 is the SH-02 defect. Capping at prev+1 does not catch it
      // (min(1, 2) is still 1), so duplicate H1s have to be demoted explicitly
      // or the "corrected" outline reproduces the very problem it repairs.
      corrected = 2;
    } else if (prev === 0) {
      corrected = Math.min(level, 1);   // the document must open at H1
    } else {
      corrected = Math.min(level, prev + 1);   // at most one level deeper
    }
    if (corrected === 1) seenH1 = true;
    fixed.push({
      ...h,
      level: corrected,
      changed: corrected !== level,
      // Trimmed: a heading containing only whitespace is an empty heading. The
      // untrimmed check passed "  " through as real text and printed a heading
      // marker with nothing after it.
      empty: !String(h.text ?? "").trim(),
    });
    prev = corrected;
  }
  const body = fixed
    .map((h) => `${"#".repeat(h.level)} ${h.empty ? TODO("heading text — this tag is currently empty") : h.text}` +
      (h.changed ? `   <!-- was H${h.originalLevel ?? "?"} -->` : ""))
    .join("\n");

  return {
    type: "heading_tree", format: "markdown", label: "Corrected heading outline",
    note: "Levels only. Section wording is left exactly as you wrote it — the defect is the nesting, not the copy.",
    body: body || TODO("this page has no headings; start with a single H1"),
    corrections: fixed.filter((h) => h.changed).length,
  };
}

/** Title and meta description options, sized to what actually renders. */
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 155;

/**
 * Annotate a string we actually observed with its own length.
 *
 * Never annotates a scaffold: measuring a `TODO:` line reports the length of
 * our own prompt text, which is both meaningless and actively misleading — it
 * would tell an author their description fits when they have not written one.
 */
function lengthNote(text, max) {
  if (!text || /TODO:/.test(text)) return "";
  const n = text.length;
  return n > max ? ` · ${n} chars, over ${max} — will truncate` : ` · ${n} chars`;
}

/**
 * Title and description options.
 *
 * THREE ANGLES, NOT THREE REWORDINGS. Direct, benefit-led, and question form.
 * The question variant earns its place because answer engines match a query to
 * a passage, and a title already phrased as the question is the cheapest way to
 * make that match explicit.
 *
 * Where the page already carries a title or description, that text leads as
 * Option A — the author's own words are the ones they will actually publish,
 * the same reasoning `answerBlock` applies to its candidate passage.
 *
 * ⚠️ THE OTHER TWO ANGLES STAY SCAFFOLDS EVEN WHEN WE HAVE A DESCRIPTION.
 * Re-angling someone's sentence into "benefit-led" is writing, not
 * transforming, and there is no deterministic way to do it from the page
 * alone. A meta description is copy that ships verbatim, so a confident
 * machine rewrite is exactly the invention this module exists to refuse.
 */
export function metaTags({ title = "", description = "", brand = "", primaryPhrase = "" } = {}) {
  const phrase = primaryPhrase || title || TODO("primary phrase");
  const suffix = brand ? ` | ${brand}` : "";

  const options = [
    `${phrase}${suffix}`,
    `${phrase}: ${TODO("the specific benefit or answer")}${suffix}`,
    `${TODO("question form")} ${phrase}?${suffix}`,
  ];

  const descriptions = [
    description || `${TODO("40-155 character answer")}. Resolve the query in the opening clause, then add one supporting fact.`,
    `${TODO("the outcome the reader gets")}. ${TODO("one concrete detail that proves it")}.`,
    `${TODO("the question a searcher would type")} ${TODO("the answer, in one self-contained clause")}.`,
  ];

  const angles = ["direct", "benefit-led", "question form — useful for answer engines"];

  const body = options
    .map((titleOption, i) => [
      `<!-- Option ${"ABC"[i]} — ${angles[i]}${lengthNote(titleOption, META_TITLE_MAX)} -->`,
      `<title>${titleOption}</title>`,
      `<!-- description${lengthNote(descriptions[i], META_DESCRIPTION_MAX)} -->`,
      `<meta name="description" content="${descriptions[i]}">`,
    ].join("\n"))
    .join("\n\n");

  return {
    type: "meta_tags", format: "html", label: "Title & description options",
    note: `Titles are truncated around ${META_TITLE_MAX} characters and descriptions around ${META_DESCRIPTION_MAX}. Lead with the phrase, not the brand. Pick one pairing — the three angles are alternatives, not a sequence.`,
    body,
    options,
    descriptions,
  };
}

/** The AI crawler crawlers most commonly checked for answer-engine visibility. */
export const AI_CRAWLERS = Object.freeze([
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-Web", "anthropic-ai",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider",
]);

/**
 * A robots.txt block permitting answer-engine crawlers.
 *
 * Emitted as ADVICE, never as a fix applied on the user's behalf. Whether to
 * let generative engines train on or cite your content is an editorial and
 * commercial decision, not a score to be maximised — so the construct says what
 * each entry does and leaves the choice with the reader.
 */
export function robotsTxtBlock({ blocked = [], sitemapUrl = "" } = {}) {
  const list = asArray(blocked);
  const focus = list.length ? list : AI_CRAWLERS;
  const lines = [
    "# Answer-engine crawlers. Allowing these makes your pages eligible to be",
    "# retrieved and cited by AI assistants.",
    "#",
    "# Blocking them is a legitimate choice. This block only makes the decision",
    "# explicit rather than accidental. Remove any agent you do not want.",
    "",
    ...focus.flatMap((ua) => [`User-agent: ${ua}`, "Allow: /", ""]),
    sitemapUrl ? `Sitemap: ${sitemapUrl}` : `Sitemap: ${TODO("https://your-domain.example/sitemap.xml")}`,
  ];
  return {
    type: "robots_txt", format: "text", label: "robots.txt — answer-engine access",
    note: "Append to the robots.txt at your domain root. A more specific User-agent block overrides the wildcard one, so these entries win over a blanket Disallow.",
    body: lines.join("\n"),
    agents: focus,
  };
}

// ── Entity assets ──────────────────────────────────────────────────────────

/**
 * A canonical entity card — the page a model should land on when it needs to
 * state a fact about the brand. The BRD calls this out specifically: being
 * mentioned without being cited usually means the fact lives on somebody
 * else's page, and this is the page that takes it back.
 */
export function entityCard({ brand = "", description = "", founded = "", location = "", sameAs = [], offerings = [] } = {}) {
  const name = brand || TODO("brand name");
  const facts = [
    `- **What it is:** ${description || TODO("one sentence, no marketing adjectives")}`,
    `- **Founded:** ${founded || TODO("year")}`,
    `- **Based in:** ${location || TODO("city, country")}`,
    offerings.length
      ? `- **Offerings:** ${offerings.join(", ")}`
      : `- **Offerings:** ${TODO("the products or services, named plainly")}`,
    sameAs.length
      ? `- **Profiles:** ${sameAs.join(" · ")}`
      : `- **Profiles:** ${TODO("official profile URLs")}`,
  ].join("\n");

  return {
    type: "markdown_block", format: "markdown", label: "Canonical entity card",
    note: "Publish at a stable URL and link to it from the footer and About page. Write the facts flatly — an answer engine quoting this should be able to reproduce it verbatim without editing out marketing language.",
    body: `# ${name}\n\n## What is ${name}?\n\n${TODO("40-60 word plain definition")}\n\n## Key facts\n\n${facts}\n`,
  };
}

export function authorBio({ name = "", role = "", credentials = [], profileUrl = "" } = {}) {
  return {
    type: "markdown_block", format: "markdown", label: "Author bio block",
    note: "Place under the byline or at the foot of the article, and link it to a real author page carrying the same claims.",
    body: [
      `**${name || TODO("author's full name")}** — ${role || TODO("role establishing relevant expertise")}`,
      ``,
      credentials.length
        ? credentials.map((c) => `- ${c}`).join("\n")
        : `- ${TODO("credential, experience or publication that supports this expertise")}`,
      ``,
      profileUrl ? `[Profile](${profileUrl})` : `[Profile](${TODO("author page URL")})`,
    ].join("\n"),
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

/** Asset type → generator. The keys match `asset` in issueCatalog.js. */
// ── Internal links ─────────────────────────────────────────────────────────

/**
 * Anchor text that describes the act of clicking rather than the destination.
 *
 * These are the standard offenders. Anchor text is one of the few signals that
 * describes a page from the OUTSIDE, which is why both crawlers and retrieval
 * systems weight it — and "click here" describes nothing at all.
 */
export const VAGUE_ANCHORS = Object.freeze([
  "click here", "here", "read more", "learn more", "more", "this", "this page",
  "link", "this link", "find out more", "see more", "details", "read this",
  "continue", "go", "view", "see", "check it out",
]);

const normaliseAnchor = (t) => String(t || "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

/** Is this anchor text one of the known non-descriptive forms? */
export function isVagueAnchor(text) {
  const n = normaliseAnchor(text);
  return n.length > 0 && VAGUE_ANCHORS.includes(n);
}

/**
 * A starting-point anchor derived from the target's OWN url slug.
 *
 * This is a transformation, not an invention: `/guides/answer-engines` really
 * does say "answer engines", and it is the site's own word for that page. It is
 * still only a starting point, which is why it is labelled "suggested" and
 * never written as though it were final copy.
 *
 * Returns "" when the slug yields nothing meaningful — a bare "/", a numeric id,
 * a hash-like segment. The caller emits a TODO there rather than a guess.
 */
export function anchorFromHref(href) {
  const raw = String(href || "").trim();
  // ⚠️ A href containing whitespace is malformed, and `new URL()` will NOT tell
  // you so — given a base it percent-encodes the spaces and hands back a
  // confident-looking `/not%20a%20url%20at%20all`. Rejecting it here is the
  // only place that distinction survives.
  if (!raw || /\s/.test(raw)) return "";
  let path = "";
  try { path = new URL(raw, "https://example.invalid").pathname; }
  catch { return ""; }

  let seg = path.split("/").filter(Boolean).pop() || "";
  // Real slugs are percent-encoded whenever they carry an accent or a
  // non-Latin script, so decoding is what makes this work outside English.
  try { seg = decodeURIComponent(seg); } catch { /* keep the raw segment */ }

  const words = seg
    .replace(/\.(html?|php|aspx?|jsp)$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim();
  if (!words) return "";
  if (/^\d+$/.test(words)) return "";                 // an id is not a description
  if (/^[0-9a-f]{8,}$/i.test(words)) return "";        // nor is a hash
  return words;
}

/**
 * An internal-linking plan built only from the links this page actually has.
 *
 * ⚠️ IT NEVER PROPOSES A PAGE TO LINK TO. The audit reads ONE page, and the
 * sitemap indicator W1 added records only that a sitemap was DECLARED — it does
 * not enumerate the site. So "add a link to your pricing page" would be a guess
 * about a url we have never seen, in a construct the user pastes into live
 * markup. What we can speak to with authority is the anchor text on the links
 * already in front of us, and that is what this fixes.
 */
export function internalLinkPlan({ links = {}, url = "" } = {}) {
  const internal = asArray(links.internal);
  const vague = internal.filter((l) => isVagueAnchor(l.text));
  const empty = internal.filter((l) => !String(l.text || "").trim());

  const rows = vague.map((l) => {
    const suggestion = anchorFromHref(l.href);
    return `| \`${String(l.text).trim()}\` | ${l.href} | ${suggestion || TODO("describe the destination in 2-5 words")} |`;
  });

  const lines = [];

  if (rows.length) {
    lines.push(
      `### Rewrite ${rows.length} non-descriptive anchor${rows.length === 1 ? "" : "s"}`,
      "",
      "| Current anchor | Target | Suggested anchor |",
      "|---|---|---|",
      ...rows,
      "",
      "The suggestion column is taken from each target's own url slug. Treat it as a starting point — the page's real subject beats its filename.",
      "",
    );
  }

  if (empty.length) {
    lines.push(
      `### ${empty.length} internal link${empty.length === 1 ? " has" : "s have"} no text at all`,
      "",
      ...empty.slice(0, 10).map((l) => `- ${l.href}`),
      "",
      "An image-only or empty link passes no anchor signal and is unreachable by screen reader. Give each one visible text, or `aria-label` where the design cannot carry it.",
      "",
    );
  }

  if (!rows.length && !empty.length) {
    lines.push(
      "### No anchor-text problems found on this page",
      "",
      internal.length
        ? `All ${internal.length} internal link${internal.length === 1 ? "" : "s"} carry descriptive text.`
        : `This page has no internal links. ${TODO("link to the pages this one should sit between")} — an orphaned page is reachable only from the sitemap, and anchor text is how the rest of the site describes it.`,
      "",
    );
  }

  lines.push(
    "---",
    `Observed on ${url || TODO("the audited url")}: ${internal.length} internal link${internal.length === 1 ? "" : "s"}, ${asArray(links.external).length} external.`,
  );

  return {
    type: "internal_links", format: "markdown", label: "Internal linking plan",
    note: "Built only from links already on the page. It never proposes a url to link to, because the audit reads one page and cannot see the rest of the site — a suggested target would be a guess pasted into live markup.",
    body: lines.join("\n"),
    vagueCount: vague.length,
    emptyCount: empty.length,
    internalCount: internal.length,
  };
}

// ── Content briefs ─────────────────────────────────────────────────────────

/**
 * What each kind of page has to contain to be worth publishing.
 *
 * These are structural requirements, not prose. We know what a comparison page
 * NEEDS — a verdict, a dimension table, an honest weakness — without knowing
 * anything about the reader's product, and that is exactly the line a
 * deterministic brief can hold: the shape is ours, every fact is theirs.
 */
const BRIEF_SECTIONS = Object.freeze({
  comparison: [
    ["The verdict, first", "One sentence naming who should pick each option. A comparison that withholds its conclusion until the end is quoted by nobody."],
    ["Dimension table", "One row per axis a buyer actually weighs — price, limits, integrations, support. Same axes for both sides, or it is not a comparison."],
    ["Where the alternative genuinely wins", "Name at least one. A comparison with no losses is read as marketing and cited as nothing."],
    ["Who each is for", "Two short profiles. This is the passage answer engines lift when asked \"which should I use\"."],
    ["FAQ + FAQPage JSON-LD", "The \"is X better than Y\" question, answered in 40-60 words, marked up."],
  ],
  use_case: [
    ["The job, in the reader's words", "Named as the outcome they want, not as the feature that delivers it."],
    ["Before and after", "The current workaround, and what replaces it. Concrete enough to recognise."],
    ["The steps", "Numbered, each independently completable. Mark up with HowTo only if these steps are genuinely visible on the page."],
    ["Proof", "One real example, number or quote. TODO: the proof — an invented customer is worse than no proof."],
    ["What it costs and what it needs", "Plan, prerequisites, limits. The questions that otherwise become support tickets."],
  ],
  industry: [
    ["The constraint this sector has and others do not", "Regulatory, procurement, data residency, seasonality. This is the whole reason the page exists."],
    ["Vocabulary", "The sector's own terms for what you do. A buyer searching their own jargon will not find your general page."],
    ["Compliance and certifications", "TODO: what you actually hold — never list a certification you have not been granted."],
    ["Proof from this sector", "A customer, a number or a case study from the same industry. Cross-industry proof does not transfer here."],
    ["Objections specific to this sector", "Answered directly, each in its own heading so it can be retrieved on its own."],
  ],
  category: [
    ["What this category is", "A 40-60 word definition answering the unbranded plural query. The passage most likely to be quoted."],
    ["Selection criteria", "How to choose, before naming any option. This is what makes the page useful rather than a list."],
    ["The options", "Including ones that are not yours. A category page that lists only your product is a product page with a category title."],
    ["When each fits", "One line per option. Turns a list into a decision."],
    ["ItemList or CollectionPage JSON-LD", "Marks the page as an enumeration so it can be surfaced as one."],
  ],
});

const BRIEF_LABEL = Object.freeze({
  comparison: "Comparison page brief",
  use_case: "Use-case page brief",
  industry: "Industry page brief",
  category: "Category page brief",
});

/**
 * A brief for a page this site does not appear to publish.
 *
 * ⚠️ THE BRIEF NEVER NAMES THE PAGE'S SUBJECT UNLESS WE OBSERVED IT. For a
 * comparison we DO have subjects when the operator typed competitor urls at
 * intake (W2 records them and deliberately fetches nothing), so those are the
 * author's own declared competitors and safe to name. Everywhere else the
 * subject is a TODO. Inventing "Acme vs Initech" would put two companies into
 * a brief on no evidence at all.
 */
export function contentBrief({ kind = "category", brand = "", competitorUrls = [], subject = "" } = {}) {
  const id = BRIEF_SECTIONS[kind] ? kind : "category";
  const sections = BRIEF_SECTIONS[id];
  const you = brand || TODO("your product");

  let target;
  if (id === "comparison") {
    const rivals = asArray(competitorUrls).map((u) => {
      try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return String(u); }
    }).filter(Boolean);
    target = rivals.length
      ? `${you} vs ${rivals[0]}${rivals.length > 1 ? ` (then one page each for ${rivals.slice(1).join(", ")})` : ""}`
      : `${you} vs ${TODO("the competitor you lose deals to most often")}`;
  } else if (id === "use_case") {
    target = subject ? `${you} for ${subject}` : `${you} for ${TODO("the job your best customers hire you to finish")}`;
  } else if (id === "industry") {
    target = `${you} for ${TODO("the sector you already have customers in")}`;
  } else {
    target = subject || TODO("the category a reader searches before they know your name");
  }

  const body = [
    `# ${BRIEF_LABEL[id]}`,
    "",
    `**Page:** ${target}`,
    `**Answers queries shaped like:** ${CONTENT_KIND_QUERY[id]}`,
    "",
    "## Required sections",
    "",
    ...sections.flatMap(([h, note], i) => [`${i + 1}. **${h}** — ${note}`]),
    "",
    "## Before publishing",
    "",
    "- Every `TODO:` above is a fact this audit could not observe. Fill them from what you know, not from what sounds right.",
    "- Link this page from somewhere a reader already lands. A page reachable only from the sitemap is reachable by crawlers and nobody else.",
    "- Give it one H1 that contains the query phrase, and question-shaped H2s.",
  ].join("\n");

  return {
    type: "content_brief", format: "markdown", label: BRIEF_LABEL[id],
    note: "A structural brief, not copy. The shape is ours and every fact is yours — anything this audit could not observe is left as a TODO rather than filled with something plausible.",
    body,
    kind: id,
  };
}

export const CONSTRUCT_BUILDERS = Object.freeze({
  answer_block:        answerBlock,
  content_block:       faqContentBlock,
  jsonld_organization: organizationSchema,
  jsonld_person:       personSchema,
  jsonld_article:      articleSchema,
  jsonld_faq:          faqSchema,
  jsonld_howto:        howToSchema,
  jsonld_breadcrumb:   breadcrumbSchema,
  heading_tree:        headingTree,
  meta_tags:           metaTags,
  internal_links:      internalLinkPlan,
  content_brief:       contentBrief,
  robots_txt:          robotsTxtBlock,
  entity_card:         entityCard,
  author_bio:          authorBio,
});

/**
 * Build the construct an issue asks for.
 *
 * Returns null for issues that carry no asset, and for an asset type this build
 * does not recognise. A stored audit written by a newer build must degrade to
 * "no attachment", never to a crash that loses the recommendation with it.
 */
export function buildConstruct(assetType, facts = {}) {
  if (!assetType) return null;
  const fn = CONSTRUCT_BUILDERS[assetType];
  if (typeof fn !== "function") return null;
  try {
    return { assetType, ...fn(facts) };
  } catch {
    return null;
  }
}

/** Does this construct still contain unfilled placeholders? Drives the UI badge. */
export function hasPlaceholders(construct) {
  return Boolean(construct?.body && /TODO:/.test(construct.body));
}
