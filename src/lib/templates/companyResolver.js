// companyResolver.js — PURE. Turn a typed company NAME into candidate domains,
// and score what came back.
//
// The owner's ask: "let users enter a company name and let the box
// auto-discover the required details, and allow the user to modify them."
//
// ── WHY CANDIDATE-GUESSING AND NOT A SEARCH API ─────────────────────────────
// DatIQ has no search provider, and adding one for a convenience field means a
// new vendor, a new key, a new bill and a new outage surface for a feature
// whose failure mode is "the user types the domain themselves". Guessing a
// short, ordered candidate list and CONFIRMING each against the real page is
// cheaper, has no new dependency, and is honest: we only ever claim a domain
// we actually fetched and whose page corroborated the name.
//
// ── RESOLUTION IS A SUGGESTION, NEVER AN ANSWER ─────────────────────────────
// A wrong domain silently researched is worse than no resolution: the user
// gets a confident brief about the wrong company. So every result carries a
// `confidence` and the UI is required to leave the field editable. Nothing
// here auto-submits.

/** Words that never help identify a domain. */
const NOISE = new Set([
  "inc", "inc.", "llc", "ltd", "ltd.", "limited", "corp", "corp.", "corporation",
  "company", "co", "co.", "plc", "gmbh", "sa", "srl", "bv", "pty", "pvt",
  "private", "technologies", "technology", "labs", "group", "holdings",
  "the", "and", "&",
]);

// TLDs tried, in likelihood order. `.in` is included and NOT an afterthought:
// the PRD ships a "Lead List Builder for Indian SMBs" against IndiaMART /
// Justdial / MCA, so an Indian company is a first-class case here, not an edge
// one. Omitting it would make the feature quietly useless for a segment the
// product explicitly targets.
const TLDS = ["com", "io", "ai", "in", "co", "net", "org"];

/** Strip a company name to the token a domain is likely built from. */
export function nameToSlug(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((w) => !NOISE.has(w));
  return words.join("");
}

/**
 * Ordered candidate domains for a typed name.
 *
 * Deliberately SHORT and ordered by likelihood: each candidate costs a real
 * fetch, and a list of thirty would turn a convenience field into a crawl.
 * `.com` first because it remains the overwhelming default for the B2B
 * companies these templates target.
 *
 * @param {string} name
 * ⚠️ THIS IS A SUGGESTION MECHANISM, NOT A RESOLVER. It will miss companies
 * whose domain does not derive from their name — "Protean eGov Technologies"
 * is at proteantech.in, which no amount of guessing reaches. That is fine and
 * expected: when it misses, the user types the domain, which is exactly what
 * they do today. The feature is strictly additive and must never present
 * itself as authoritative.
 *
 * @param {{max?: number}} [opts]
 * @returns {string[]}
 */
export function candidateDomains(name, { max = 5 } = {}) {
  const raw = String(name || "").trim();
  if (!raw) return [];

  // Already a domain? Then there is nothing to guess — return it alone rather
  // than inventing five wrong alternatives around a correct answer.
  const asDomain = raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(asDomain)) return [asDomain];

  const slug = nameToSlug(raw);
  if (!slug) return [];

  // Two stems, interleaved: the whole name joined, and the FIRST TOKEN alone.
  // Companies overwhelmingly shorten — "Protean eGov Technologies" is
  // protean-something, not proteanegovtechnologies-something — so trying only
  // the full join misses the common case entirely.
  const first = nameToSlug(String(raw).split(/\s+/)[0]);
  const stems = first && first !== slug ? [first, slug] : [slug];

  const out = [];
  for (const tld of TLDS) {
    for (const stem of stems) {
      const c = `${stem}.${tld}`;
      if (!out.includes(c)) out.push(c);
      if (out.length >= max) return out;
    }
  }
  return out.slice(0, max);
}

/**
 * How well a fetched page corroborates the typed name.
 *
 * Returns 0..1. The caller decides the threshold; this only measures.
 * The comparison is on the SLUG rather than raw text so "Protean eGov
 * Technologies" matches a page titled "Protean" — the noise words we strip to
 * build a candidate are the same ones a page title tends to drop.
 */
export function scoreMatch(typedName, page = {}) {
  const want = nameToSlug(typedName);
  if (!want) return 0;
  // `= {}` only fires for undefined, and a FAILED FETCH yields null — which is
  // the common case here, not an edge one.
  const p = page || {};
  const hay = nameToSlug([p.siteName, p.title, p.description].filter(Boolean).join(" "));
  if (!hay) return 0;
  if (hay.includes(want)) return 1;
  // A partial: the typed name's first token appears. Weak, and reported as
  // weak — the UI shows it as a suggestion to confirm, not a resolved answer.
  const first = nameToSlug(String(typedName).split(/\s+/)[0]);
  if (first && first.length >= 4 && hay.includes(first)) return 0.6;
  return 0;
}

/** The verdict for one candidate, given what its page said. */
export function judge(typedName, domain, page) {
  const confidence = scoreMatch(typedName, page || {});
  return {
    domain,
    confidence,
    // `confirmed` means the page itself corroborated the name. Anything less
    // is offered for the user to accept or overwrite, never applied silently.
    confirmed: confidence >= 1,
    title: page?.title || null,
    description: page?.description || null,
  };
}

/** Pick the best of several judged candidates, or null. */
export function bestOf(results) {
  const list = (Array.isArray(results) ? results : []).filter((r) => r && r.confidence > 0);
  if (!list.length) return null;
  return list.sort((a, b) => b.confidence - a.confidence)[0];
}
