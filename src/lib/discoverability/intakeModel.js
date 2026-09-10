// intakeModel.js — what was ASKED FOR, before anything is measured.
//
// PURE. Zero I/O. Imported by React and by netlify/ alike, so the intake the
// composer validates is the intake the server stores.
//
// ── WHY THIS IS A SEPARATE MODULE FROM auditProfiles.js ────────────────────
// `auditProfiles.js` answers "which lens does the report lead with" — a
// property of the OUTPUT. This file answers "what did the customer say they
// were trying to achieve, where, and against whom" — a property of the INPUT,
// captured before a single byte is fetched and never revised by the run.
//
// Keeping them apart matters because the two have different truth conditions.
// A profile can be re-derived from the page at any time; a goal cannot be
// re-derived from anything. If nobody asked "what are you trying to achieve?"
// at intake, that answer is gone — which is why every column this module feeds
// is nullable rather than back-fillable, and why `primary_goal` is stored as
// NULL on historical audits instead of being guessed into one.

import { AUDIT_PROFILES } from "./auditProfiles.js";

// ── Audit type ─────────────────────────────────────────────────────────────
//
// The BRD lists five. Three of them the engine can produce today; two of them
// it cannot, and they are declared here anyway with `available: false`.
//
// That is deliberate, and it is the opposite of the usual instinct to omit
// what is not built. The vocabulary is a stored CONTRACT — the CHECK
// constraint in the migration lists all five — and adding a value to a live
// enum later is a migration plus a deploy plus a window in which the API and
// the database disagree about what is legal. Declaring the full vocabulary now
// costs nothing.
//
// What must NOT happen is an audit ROW claiming to be a domain snapshot when a
// single page was fetched. So the API refuses an unavailable type outright
// rather than accepting it and running something else: a mislabelled row is
// worse than a rejected request, because the rejection is visible in the
// moment and the mislabel is discovered a quarter later inside a trend line.
export const AUDIT_TYPES = Object.freeze({
  url: {
    id: "url", label: "Single page", available: true, callerSelectable: true,
    description: "Fetch and score one page.",
  },
  domain: {
    id: "domain", label: "Domain snapshot", available: false, callerSelectable: true,
    description: "Sample a domain's key pages and score the set.",
    unavailableReason: "Domain snapshots are not available yet — audit the pages individually for now.",
  },
  benchmark: {
    // Created BY the benchmark route, which audits every member of a set. A
    // caller cannot ask for one here: a benchmark audit with no benchmark
    // behind it is a row that belongs to nothing.
    id: "benchmark", label: "Benchmark member", available: true, callerSelectable: false,
    description: "One member of a competitive set, audited as part of that set.",
  },
  prompt_monitor: {
    id: "prompt_monitor", label: "Prompt monitor", available: false, callerSelectable: true,
    description: "Track how answer engines respond to a set of prompts over time.",
    unavailableReason: "Prompt monitoring is not available yet.",
  },
  rerun: {
    // Set by the rerun route, which also sets the baseline. Accepting it on
    // POST /audits would let an audit call itself a re-audit with nothing to
    // be a re-audit OF, and the whole point of the type is that a baseline
    // exists.
    id: "rerun", label: "Re-audit", available: true, callerSelectable: false,
    description: "A re-run measured against the audit it re-ran.",
  },
});

export const AUDIT_TYPE_IDS = Object.freeze(Object.keys(AUDIT_TYPES));

/** The types a caller may name on POST /audits today. */
export const SELECTABLE_AUDIT_TYPE_IDS = Object.freeze(
  AUDIT_TYPE_IDS.filter((id) => AUDIT_TYPES[id].callerSelectable && AUDIT_TYPES[id].available),
);

// ── Primary goal ───────────────────────────────────────────────────────────
//
// The field that makes an audit contextual rather than generic. It changes
// which lens leads the report, and in P2 it is what tells the brand, product,
// service and local modules which of them the customer actually came for.
//
// ⚠️ IT CHANGES NO SCORE. Same discipline as the profile: the four framework
// views are always computed with identical weightings whatever the goal says,
// because a customer who switches goal between two runs must not see movement
// in the trend line that no change to their page caused.
export const PRIMARY_GOALS = Object.freeze({
  seo_health: {
    id: "seo_health", label: "SEO health", suggestedProfile: "seo",
    description: "Classic search: crawlability, rendering, canonicals, Core Web Vitals.",
  },
  ai_citations: {
    id: "ai_citations", label: "AI citations", suggestedProfile: "geo",
    description: "Being the source a generative engine names when it answers.",
  },
  product_discovery: {
    id: "product_discovery", label: "Product discovery", suggestedProfile: "ecommerce",
    description: "Products found, described completely, and comparable.",
  },
  service_leads: {
    id: "service_leads", label: "Service leads", suggestedProfile: "services",
    description: "Service intent answered, with the proof a buyer looks for.",
  },
  local_discovery: {
    id: "local_discovery", label: "Local discovery", suggestedProfile: "local",
    description: "Found for a place: identity, address consistency, local intent.",
  },
  competitor_intelligence: {
    // Deliberately balanced, not a profile that favours anybody. A competitive
    // set scored under a lens that flatters one member is not a benchmark, and
    // the number would be quoted as though it were.
    id: "competitor_intelligence", label: "Competitor intelligence", suggestedProfile: "balanced",
    description: "How you compare, under a lens that favours nobody.",
  },
});

export const PRIMARY_GOAL_IDS = Object.freeze(Object.keys(PRIMARY_GOALS));

// ── How the profile was chosen ─────────────────────────────────────────────
//
// Stored, not derived. This is the same rule the evidence envelope enforces
// one layer down — an observed fact and an inference must never be presented
// as the same kind of thing — applied to the report's own framing. "You are
// reading the GEO view because you asked for it" and "because we guessed from
// your schema" are different claims, and a customer who disagrees with the
// second one needs to be able to see that it was a guess.
export const AUDIT_PROFILE_SOURCES = Object.freeze({
  explicit: { id: "explicit", label: "You chose it" },
  goal: { id: "goal", label: "From your goal" },
  inferred: { id: "inferred", label: "Inferred from the page" },
  default: { id: "default", label: "Default" },
});

export const AUDIT_PROFILE_SOURCE_IDS = Object.freeze(Object.keys(AUDIT_PROFILE_SOURCES));

// ── Geography ──────────────────────────────────────────────────────────────

/** Longest we will store for any one geography field. */
export const MAX_GEOGRAPHY_FIELD = 80;

const clean = (v) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_GEOGRAPHY_FIELD) : "");

/**
 * Normalise a target geography, or return null.
 *
 * ⚠️ NULL, NEVER `{}`. Absence has to have exactly one shape or every consumer
 * needs two checks and one of them eventually gets forgotten — and an empty
 * object reads, in a UI and in an export, as "we asked and they said nowhere",
 * which is a different claim from "nobody was asked".
 *
 * Country is upper-cased when it is already an ISO 3166-1 alpha-2 code and
 * otherwise left as the customer typed it. Guessing "India" → "IN" is a lookup
 * table this module has no business carrying, and half-guessing it — matching
 * some spellings and not others — would make the field silently inconsistent
 * across rows, which is worse for the P2 local work than free text is.
 */
export function normaliseGeography(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const rawCountry = clean(input.country);
  const country = /^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : rawCountry;
  const region = clean(input.region ?? input.state);
  const city = clean(input.city);

  // BCP-47 shape where it is recognisably one — `en-in` and `EN-IN` are the
  // same tag and must not become two rows.
  const rawLang = clean(input.language);
  const bcp47 = /^([a-z]{2,3})(?:[-_]([a-z]{2}|[0-9]{3}))?$/i.exec(rawLang);
  const language = bcp47
    ? bcp47[2] ? `${bcp47[1].toLowerCase()}-${bcp47[2].toUpperCase()}` : bcp47[1].toLowerCase()
    : rawLang;

  if (!country && !region && !city && !language) return null;
  return {
    country: country || null,
    region: region || null,
    city: city || null,
    language: language || null,
  };
}

// ── Competitor URLs ────────────────────────────────────────────────────────

/**
 * How many competitors one audit may name.
 *
 * Matches MAX_BENCHMARK_URLS. These are RECORDED CONTEXT, not audits — naming
 * a competitor here fetches nothing and spends no credit, and the benchmark
 * route is what turns them into runs. The cap exists so the column cannot be
 * used as unbounded storage, not because each entry costs anything.
 */
export const MAX_COMPETITOR_URLS = 10;

/**
 * Normalise a competitor list.
 *
 * Returns `{ urls, rejected }` rather than a bare array. A caller who sent
 * eleven URLs, or one with a typo, has to be told which ones did not make it —
 * silently keeping ten of eleven is how a customer ends up believing a
 * competitor is being tracked when it is not.
 */
export function normaliseCompetitorUrls(input) {
  if (!Array.isArray(input)) return { urls: [], rejected: [] };

  const urls = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of input) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) continue;
    if (urls.length >= MAX_COMPETITOR_URLS) { rejected.push(trimmed); continue; }

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed;
    try { parsed = new URL(withScheme); } catch { rejected.push(trimmed); continue; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") { rejected.push(trimmed); continue; }

    // The fragment never reaches a server, so two URLs differing only by hash
    // are one competitor, and keeping both would double-count them.
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    const normalised = parsed.toString();
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    urls.push(normalised);
  }

  return { urls, rejected };
}

// ── Profile inference ──────────────────────────────────────────────────────

/**
 * Guess the profile from what the page declares about itself.
 *
 * Returns null when nothing in the page argues for a lens — which is the
 * common case, and much better than reaching for a weak signal. `balanced` is
 * then chosen by `resolveAuditProfile` as the DEFAULT, and the stored source
 * says so, so a customer reading the overall view is never told the page was
 * analysed as e-commerce because it happened to contain the word "buy".
 *
 * Schema is weighed above page type because schema is the page ASSERTING what
 * it is, while a page type is our own reading of it. When the two disagree the
 * page's own declaration wins.
 */
export function inferAuditProfile({ pageType = null, schemaTypes = [] } = {}) {
  const types = (Array.isArray(schemaTypes) ? schemaTypes : []).map((t) => String(t).toLowerCase());
  const has = (...names) => names.some((n) => types.includes(n));

  // A LocalBusiness subtype is still a local business. `Dentist`, `Restaurant`
  // and `ProfessionalService` all inherit from it and all mean the same thing
  // for the lens, so the suffix is matched rather than an enumeration of the
  // ~200 subtypes schema.org defines — a list that would be stale on arrival.
  const localish = types.some((t) => /(?:localbusiness|business|store|shop|restaurant|clinic|dentist|physician|hotel)$/.test(t));
  if (localish || has("place", "postaladdress", "geocoordinates")) return "local";

  if (has("softwareapplication", "webapplication", "mobileapplication", "saas")) return "saas";
  if (has("service", "professionalservice")) return "services";
  if (has("product", "offer", "aggregateoffer", "productgroup")) return "ecommerce";

  switch (pageType) {
    case "location": return "local";
    case "service": return "services";
    case "product": return "ecommerce";
    // Documentation is what a software product publishes; almost nothing else
    // does. It is the one page type that names a business model on its own.
    case "docs": return "saas";
    default: return null;
  }
}

/**
 * Settle the profile, and record WHY.
 *
 * Order is: what the customer chose, then what they said they were trying to
 * achieve, then what the page declares, then the neutral default.
 *
 * A stated goal outranks page inference on purpose. Someone who selected
 * "local discovery" has told us their intent in words; the schema on the page
 * is our reading of markup they may not control and may be trying to fix. When
 * a customer's stated intent and our guess disagree, the customer is right —
 * they know what they came for, and we know only what the HTML says.
 */
export function resolveAuditProfile({
  requested = null, primaryGoal = null, pageType = null, schemaTypes = [],
} = {}) {
  if (requested && AUDIT_PROFILES[requested]) {
    return { profile: requested, source: "explicit" };
  }
  const goal = primaryGoal ? PRIMARY_GOALS[primaryGoal] : null;
  if (goal && AUDIT_PROFILES[goal.suggestedProfile]) {
    return { profile: goal.suggestedProfile, source: "goal" };
  }
  const inferred = inferAuditProfile({ pageType, schemaTypes });
  if (inferred && AUDIT_PROFILES[inferred]) {
    return { profile: inferred, source: "inferred" };
  }
  return { profile: "balanced", source: "default" };
}

/** Reference data for the composer, in one call. */
export function intakeVocabulary() {
  return {
    audit_types: AUDIT_TYPES,
    selectable_audit_types: SELECTABLE_AUDIT_TYPE_IDS,
    primary_goals: PRIMARY_GOALS,
    profile_sources: AUDIT_PROFILE_SOURCES,
    max_competitor_urls: MAX_COMPETITOR_URLS,
  };
}
