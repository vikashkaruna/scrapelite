// promptTaxonomy.js — what we ask an answer engine, and why.
//
// PURE. Shared by React and `netlify/`, like every other model in this folder.
//
// The shipped `defaultPrompts` is five templates built from the page's own
// subject. That tests brand and category recall and nothing else, which makes
// every downstream metric a measurement of two questions asked five ways.
//
// The PRD names seven kinds — brand, category, buyer problem, comparison,
// industry, local, trust — and a PromptSet as the cross product of
// Category × Service/Product × Persona × Industry × Geography × Intent.
//
// ── WE NEVER INVENT A DIMENSION ────────────────────────────────────────────
// A cross product is only as honest as its inputs. We observe the subject and
// the brand; geography, competitors, industries and personas are DECLARED or
// they are absent, and an absent dimension is simply not crossed. Guessing that
// a plumbing site serves "London" because most do would put a city into a
// prompt, into a stored run, into a citation metric, and eventually into a
// customer's board deck — on no evidence at all.
//
// ── COMMERCIAL INTENT IS DECLARED, NOT CLASSIFIED ──────────────────────────
// RecommendationRate is measured over commercial prompts — the ones where being
// named is a recommendation rather than a mention. Because we GENERATE these,
// we know each one's intent by construction, which is strictly better than
// inferring it from prose afterwards. `classifyPromptKind` exists only for
// prompts a user wrote themselves, where we genuinely have to guess, and it
// says so by returning a confidence.

/** How many prompts one generated set may hold. */
export const MAX_GENERATED_PROMPTS = 60;

/**
 * The seven kinds, in the order they are worth asking.
 *
 * Order is not cosmetic: an audit samples the first N of a set, so a kind
 * placed low is a kind that a 10-prompt audit will usually never ask. Brand and
 * category lead because they apply to every subject and need no declaration.
 * Local and industry sit last because they only exist when someone typed them,
 * and a set that leads with them would spend a small sample on the narrowest
 * questions.
 *
 * `commercial: true` marks the kinds where being named IS a recommendation —
 * somebody is choosing. Being mentioned in "what is X" is recall; being named
 * in "best tools for X" is advocacy, and conflating them is what makes a
 * citation metric feel unactionable.
 */
export const PROMPT_KINDS = Object.freeze({
  category: {
    id: "category", label: "Category", commercial: true, requires: ["subject"],
    describes: "The unbranded plural query, asked before the reader knows any vendor.",
  },
  buyer_problem: {
    id: "buyer_problem", label: "Buyer problem", commercial: true, requires: ["subject"],
    describes: "The job phrased as a problem, which is how most people actually search.",
  },
  comparison: {
    id: "comparison", label: "Comparison", commercial: true, requires: ["subject"],
    describes: "Head-to-head and alternatives. Names declared rivals where there are any.",
  },
  brand: {
    id: "brand", label: "Brand", commercial: false, requires: ["brand"],
    describes: "Direct recall. Does the engine know this brand at all, and describe it correctly?",
  },
  trust: {
    id: "trust", label: "Trust", commercial: false, requires: ["brand"],
    describes: "Whether the engine treats the brand as a credible source rather than merely a known one.",
  },
  industry: {
    id: "industry", label: "Industry", commercial: true, requires: ["subject", "industry"],
    describes: "The subject inside one sector's constraints. Only asked when a sector was declared.",
  },
  local: {
    id: "local", label: "Local", commercial: true, requires: ["subject", "place"],
    describes: "The subject in a named place. Only asked when a geography was declared.",
  },
});

export const PROMPT_KIND_IDS = Object.freeze(Object.keys(PROMPT_KINDS));

/** The kinds where being named is a recommendation, not a mention. */
export const COMMERCIAL_KIND_IDS = Object.freeze(
  PROMPT_KIND_IDS.filter((k) => PROMPT_KINDS[k].commercial),
);

/** Lookup that returns null rather than throwing for an unknown id. */
export function promptKind(id) {
  return PROMPT_KINDS[id] || null;
}

/** Is a prompt of this kind one where being named counts as a recommendation? */
export function isCommercialKind(id) {
  return COMMERCIAL_KIND_IDS.includes(id);
}

// ── Dimensions ─────────────────────────────────────────────────────────────

/**
 * The place string a local prompt uses, most specific first.
 *
 * ⚠️ Returns null rather than a country when only a country is known. "Plumbers
 * in India" is not a local query, it is a national one dressed as a local one,
 * and it would report local visibility a business never had.
 */
export function placeFrom(geography) {
  if (!geography || typeof geography !== "object") return null;
  const city = String(geography.city || "").trim();
  const region = String(geography.region || "").trim();
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  if (region) return region;
  return null;
}

/** A competitor's readable name, from a declared url. */
export function competitorName(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    return label ? label : host;
  } catch {
    return raw.replace(/^www\./, "").split("/")[0] || null;
  }
}

// ── Generation ─────────────────────────────────────────────────────────────

const TEMPLATES = Object.freeze({
  category: (d) => [
    `What are the best ${d.subject} tools?`,
    `Which companies are leading in ${d.subject}?`,
    `What should I look for when choosing a ${d.subject} provider?`,
  ],
  buyer_problem: (d) => [
    `How do I solve ${d.subject} without hiring a specialist?`,
    `What is the fastest way to get started with ${d.subject}?`,
    `What goes wrong most often with ${d.subject}?`,
  ],
  comparison: (d) => (d.competitors.length
    ? d.competitors.slice(0, 4).map((c) => `${d.brand || d.subject} vs ${c} — which is better?`)
    : [`What are the alternatives to ${d.brand || d.subject}?`]),
  brand: (d) => [
    `What is ${d.brand} and who is it for?`,
    `What does ${d.brand} do differently from its competitors?`,
  ],
  trust: (d) => [
    `Is ${d.brand} a credible source on ${d.subject || "this topic"}?`,
    `What do people say about ${d.brand}?`,
  ],
  industry: (d) => d.industries.slice(0, 3).map((i) => `What is the best ${d.subject} solution for ${i}?`),
  local: (d) => [
    `Who offers ${d.subject} in ${d.place}?`,
    `What is the best ${d.subject} provider near ${d.place}?`,
  ],
});

/** Does this kind have every dimension it needs? */
function satisfied(kindId, d) {
  return PROMPT_KINDS[kindId].requires.every((r) => {
    if (r === "subject") return Boolean(d.subject);
    if (r === "brand") return Boolean(d.brand);
    if (r === "place") return Boolean(d.place);
    if (r === "industry") return d.industries.length > 0;
    return false;
  });
}

/**
 * Build a prompt set from the dimensions we actually have.
 *
 * Deterministic: the same inputs produce the same prompts in the same order,
 * every time. That matters because a prompt set is stored and re-run, and a
 * set that reshuffled itself would make two runs incomparable while looking
 * like a change in visibility.
 *
 * Returns records, not strings — each prompt carries the kind that produced it,
 * so RecommendationRate can be measured over commercial prompts without anyone
 * having to classify the text afterwards.
 */
export function generatePrompts({
  brand = "", subject = "", competitors = [], geography = null,
  industries = [], limit = MAX_GENERATED_PROMPTS,
} = {}) {
  const d = {
    brand: String(brand || "").trim(),
    subject: String(subject || "").trim(),
    competitors: (Array.isArray(competitors) ? competitors : [])
      .map(competitorName).filter(Boolean),
    place: placeFrom(geography),
    industries: (Array.isArray(industries) ? industries : [])
      .map((i) => String(i || "").trim()).filter(Boolean),
  };

  // Neither dimension observed means we have nothing to ask ABOUT. An empty set
  // is the honest answer; a generic "what is this website" is not a measurement.
  if (!d.subject && !d.brand) return [];

  const out = [];
  for (const kindId of PROMPT_KIND_IDS) {
    if (!satisfied(kindId, d)) continue;
    for (const text of TEMPLATES[kindId](d)) {
      if (out.length >= Math.min(limit, MAX_GENERATED_PROMPTS)) return out;
      if (out.some((p) => p.prompt === text)) continue;   // same text, one row
      out.push({ prompt: text, kind: kindId, commercial: PROMPT_KINDS[kindId].commercial });
    }
  }
  return out;
}

/** Which dimensions were available, and which were not. Drives the UI's "why so few". */
export function describeDimensions({ brand = "", subject = "", competitors = [], geography = null, industries = [] } = {}) {
  return {
    subject: Boolean(String(subject || "").trim()),
    brand: Boolean(String(brand || "").trim()),
    competitors: (Array.isArray(competitors) ? competitors : []).filter(Boolean).length,
    place: placeFrom(geography),
    industries: (Array.isArray(industries) ? industries : []).filter(Boolean).length,
  };
}

// ── Classifying a prompt somebody else wrote ───────────────────────────────

const KIND_HINTS = Object.freeze([
  ["comparison", /\b(vs\.?|versus|compared? to|alternatives? to|better than|instead of)\b/i],
  ["local", /\b(near me|nearby|in my area|local)\b/i],
  ["category", /\b(best|top|leading|which (tools?|companies|vendors|providers)|recommend)\b/i],
  ["buyer_problem", /\b(how (do|can) i|how to|why does|what goes wrong|fix|solve|without)\b/i],
  ["trust", /\b(credible|trustworthy|reliable|reputation|reviews?|what do people say)\b/i],
  ["industry", /\b(for (healthcare|finance|legal|retail|education|manufacturing|government|nonprofit)|in the [a-z ]+ (sector|industry))\b/i],
]);

/**
 * Guess the kind of a prompt a user wrote, and say how sure we are.
 *
 * ⚠️ ONLY FOR USER-WRITTEN PROMPTS. Anything `generatePrompts` produced already
 * carries its kind, and re-deriving it from the text would replace a fact with
 * a guess. The confidence is part of the return for the same reason a signal
 * carries coverage: a RecommendationRate computed over guessed intents deserves
 * to be read more cautiously than one computed over declared intents.
 */
export function classifyPromptKind(text) {
  const s = String(text || "").trim();
  if (!s) return { kind: null, commercial: false, confidence: 0 };
  for (const [kind, re] of KIND_HINTS) {
    if (re.test(s)) return { kind, commercial: PROMPT_KINDS[kind].commercial, confidence: 70 };
  }
  // No hint matched. `brand` is the residual rather than a match, because a
  // bare "What is X?" is brand or category recall depending on what X is, and
  // we cannot tell from the sentence alone.
  return { kind: "brand", commercial: false, confidence: 30 };
}
