// competitorTracking.js — who else the engine named, and how sure we are.
//
// PURE. Shared by React and `netlify/`.
//
// AI Share of Voice needs a competitor set, and there are two ways to get one.
// They have different warranties, and this module refuses to blend them.
//
// ── DECLARED IS MEASURED; DISCOVERED IS INFERRED ───────────────────────────
// A DECLARED competitor is a url the operator typed at intake (W2). Matching it
// is exact: the domain either appears in the citation list or it does not.
//
// A DISCOVERED competitor is a domain the engine cited that is neither ours nor
// a general reference. That is a real signal — it is the set of pages actually
// answering the question — but calling every such domain a "competitor" is a
// guess. Wikipedia is not a competitor. Nor is a review site, or a forum.
//
// So every entry carries `declared`, and the two are counted separately all the
// way to the UI. An SOV that silently mixed them would report a number nobody
// could defend in the meeting where it gets questioned — and the whole reason
// this module reports coverage everywhere else is that an indefensible number
// is worse than an absent one.

/**
 * Domains that appear in answers constantly and compete with nobody.
 *
 * ⚠️ DELIBERATELY SHORT. Every name here is a domain we will never report as a
 * competitor, so a wrong entry silently hides a real rival. The bar is "this is
 * reference infrastructure", not "I have not heard of them".
 */
export const NON_COMPETITOR_HOSTS = Object.freeze([
  "wikipedia.org", "wikimedia.org", "wiktionary.org",
  "github.com", "gitlab.com", "stackoverflow.com", "stackexchange.com",
  "reddit.com", "quora.com", "medium.com", "substack.com",
  "youtube.com", "vimeo.com",
  "linkedin.com", "x.com", "twitter.com", "facebook.com", "instagram.com",
  "google.com", "bing.com", "apple.com", "microsoft.com", "amazon.com",
  "crunchbase.com", "g2.com", "capterra.com", "trustpilot.com", "producthunt.com",
  "forbes.com", "techcrunch.com", "gartner.com", "statista.com",
  "arxiv.org", "doi.org", "nih.gov", "who.int",
]);

/** Strip `www.` and lowercase, so one host has one spelling. */
export function bareHost(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let host = raw;
  try { host = new URL(raw).hostname; }
  catch {
    host = raw.replace(/^https?:\/\//i, "").split("/")[0];
  }
  host = host.replace(/^www\./i, "").toLowerCase();
  return host || null;
}

/** Is this reference infrastructure rather than a rival? */
export function isNonCompetitorHost(host) {
  const h = bareHost(host);
  if (!h) return true;
  return NON_COMPETITOR_HOSTS.some((n) => h === n || h.endsWith("." + n));
}

/** The registrable-ish root, so `docs.acme.com` and `acme.com` are one rival. */
export function rootHost(host) {
  const h = bareHost(host);
  if (!h) return null;
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  // Two-part public suffixes we actually meet (co.uk, com.au, co.in...).
  const tail2 = parts.slice(-2).join(".");
  if (/^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(tail2)) return parts.slice(-3).join(".");
  return tail2;
}

/**
 * Who else appeared in this answer.
 *
 * `declared` competitors are matched exactly against the operator's own list.
 * Everything else cited is a CANDIDATE, marked `declared: false`, and reference
 * infrastructure is dropped rather than reported as a rival.
 */
export function competitorsInAnswer({ citations = [], ourHost = "", declared = [] } = {}) {
  const ours = rootHost(ourHost);
  const declaredRoots = new Map();
  for (const d of Array.isArray(declared) ? declared : []) {
    const root = rootHost(d);
    if (root && root !== ours) declaredRoots.set(root, d);
  }

  const seen = new Map();
  for (const c of Array.isArray(citations) ? citations : []) {
    const url = typeof c === "string" ? c : c?.url || "";
    const root = rootHost(url);
    if (!root || root === ours) continue;

    const isDeclared = declaredRoots.has(root);
    // A declared competitor is reported even if it is also on the
    // non-competitor list: the operator's own judgement outranks our heuristic.
    if (!isDeclared && isNonCompetitorHost(root)) continue;

    const prev = seen.get(root);
    if (prev) { prev.citations += 1; continue; }
    seen.set(root, {
      host: root,
      declared: isDeclared,
      // Declared is a fact about the operator's list. Discovered is an
      // inference about what a cited domain means, and is scored as one.
      confidence: isDeclared ? 100 : 45,
      citations: 1,
    });
  }
  return [...seen.values()].sort((a, b) =>
    (b.declared - a.declared) || (b.citations - a.citations) || a.host.localeCompare(b.host));
}

/**
 * AI Share of Voice across a set of runs.
 *
 * 🔴 DECLARED AND DISCOVERED ARE REPORTED SEPARATELY, NOT SUMMED.
 * `sovDeclared` is defensible: a fixed, operator-chosen field of rivals, and a
 * share within it means something. `sovObserved` includes discovered domains
 * and so has a denominator that moves with whatever the engine happened to
 * cite — useful as a direction, indefensible as a target. A single blended
 * number would be quoted as the first and computed as the second.
 *
 * Both are null when there is nothing to divide by. Never zero: "no answer
 * cited anyone" and "we hold none of the share" are opposite findings.
 */
export function shareOfVoice(runs = [], { ourHost = "" } = {}) {
  const answered = (Array.isArray(runs) ? runs : []).filter((r) => r && !r.error);
  const ours = rootHost(ourHost);

  let ourMentions = 0;
  const declaredTally = new Map();
  const discoveredTally = new Map();

  for (const r of answered) {
    if (r.cited || r.mention) ourMentions += 1;
    for (const c of r.competitors || []) {
      const bucket = c.declared ? declaredTally : discoveredTally;
      bucket.set(c.host, (bucket.get(c.host) || 0) + 1);
    }
  }

  const declaredTotal = [...declaredTally.values()].reduce((a, b) => a + b, 0);
  const discoveredTotal = [...discoveredTally.values()].reduce((a, b) => a + b, 0);

  const share = (mine, theirs) => {
    const denom = mine + theirs;
    return denom > 0 ? Math.round((mine / denom) * 1000) / 10 : null;
  };

  const rank = (m) => [...m.entries()]
    .map(([host, appearances]) => ({ host, appearances }))
    .sort((a, b) => b.appearances - a.appearances || a.host.localeCompare(b.host));

  return {
    ourHost: ours,
    ourAppearances: ourMentions,
    // Against the operator's own named field. This is the number to report.
    sovDeclared: share(ourMentions, declaredTotal),
    declaredCompetitors: rank(declaredTally),
    // Against everyone cited. A direction, not a target — the denominator moves.
    sovObserved: share(ourMentions, declaredTotal + discoveredTotal),
    discoveredCompetitors: rank(discoveredTally),
    answeredRuns: answered.length,
  };
}
