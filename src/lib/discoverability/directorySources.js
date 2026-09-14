// directorySources.js — W12. The directory registry.
//
// PURE. Zero I/O. Imported by React AND `netlify/`.
//
// ── WHAT THIS IS ──────────────────────────────────────────────────────────
// A business is discoverable in an answer engine partly through pages it owns
// (P1) and partly through records it does NOT own: a Google Business Profile,
// a Justdial listing, an MCA filing. When those disagree about the name, the
// address or the phone number, an engine resolving "who is Acme and where are
// they" has several answers and picks one. That is the failure W12 measures.
//
// ── D5, AND THE COPY RULE THAT FALLS OUT OF IT ────────────────────────────
// Acquisition is three-tier and the tiers are NOT equally available:
//   (i)   an authorised API, where the customer has connected their own account
//   (ii)  a listing URL the customer declares
//   (iii) a public listing page fetched through the existing compliance engine
//         (robots + SSRF + host allowlist + per-host attestation)
//
// 🔴 SO COVERAGE IS PER-CUSTOMER, AND THE PRODUCT COPY MUST SAY SO.
// "50+ directories audited" is a claim this engine cannot keep for anybody: a
// customer who has authorised nothing gets tier-(iii) sources only. The honest
// sentence is "N configured sources, coverage depending on what each customer
// authorises", and `coverageClaim()` below is the one place it is built, so it
// cannot drift into marketing copy in a stronger form. `directorySources.test.js`
// asserts the forbidden phrasing never appears.
//
// ⚠️ SOURCE IDS ARE A PUBLIC CONTRACT, exactly like the signal and issue codes.
// They travel in stored rows, per-directory match records and every historical
// diff. "google_business_profile matched" is only a true sentence if that id
// still means the same source. Add sources; never repurpose or renumber one.

/**
 * The five tiers, and what each weighs.
 *
 * D21 adopts §9.6's published reach multipliers and normalises them against
 * the 5x maximum for the 0–1 scorer: 5x/4x/4x/3x/1x. The final published tier
 * is a 1–2x range; we record the range and conservatively score 1x until a
 * source-specific reach rule supports the higher value. `rank` still orders
 * remediation, so a statutory filing may follow a major aggregator even when
 * both carry the document's 4x scoring weight.
 */
export const SOURCE_TIERS = Object.freeze({
  authoritative: {
    id: "authoritative", rank: 1, multiplier: 5, weight: 1.00,
    label: "Authoritative",
    describes: "The record the engine keeps itself. What it answers from before it reads anything else.",
  },
  major_aggregator: {
    id: "major_aggregator", rank: 2, multiplier: 4, weight: 0.80,
    label: "Major aggregator",
    describes: "A national directory that feeds many downstream surfaces, so one wrong value propagates.",
  },
  registry: {
    id: "registry", rank: 3, multiplier: 4, weight: 0.80,
    label: "Official registry",
    describes: "A statutory filing. The most trustworthy record and one of the least read — high trust, low reach.",
  },
  vertical: {
    id: "vertical", rank: 4, multiplier: 3, weight: 0.60,
    label: "Vertical directory",
    describes: "Industry-specific. Decisive inside its category and invisible outside it.",
  },
  social_review: {
    id: "social_review", rank: 5, multiplier: 1, multiplierRange: Object.freeze([1, 2]), weight: 0.20,
    label: "Social and review",
    describes: "A profile or review surface. Rarely the resolving record, frequently the contradicting one.",
  },
});

export const TIER_IDS = Object.freeze(
  Object.values(SOURCE_TIERS).sort((a, b) => a.rank - b.rank).map((t) => t.id),
);

/**
 * How a source can be read. D5's three tiers, named.
 *
 * `authorized_api` sources are the ones a customer must connect. They are
 * declared here whether or not the adapter is built, because the registry is a
 * stored contract and widening it later is a migration plus a deploy plus a
 * window where the API and the database disagree about what is legal — the
 * same reasoning 0049 applies to the audit types the engine cannot yet run.
 */
export const ACQUISITION = Object.freeze({
  authorized_api: {
    id: "authorized_api", label: "Authorised API",
    requiresCustomerAction: true,
    describes: "Read through the customer's own connected account. Highest fidelity, and unavailable until they connect it.",
  },
  declared_url: {
    id: "declared_url", label: "Declared listing URL",
    requiresCustomerAction: true,
    describes: "The customer tells us where their listing is and we read that page under the compliance engine.",
  },
  public_listing: {
    id: "public_listing", label: "Public listing page",
    requiresCustomerAction: false,
    describes: "Found and read under robots.txt, the SSRF guard and the host allowlist, like every other fetch this product makes.",
  },
});

export const ACQUISITION_IDS = Object.freeze(Object.keys(ACQUISITION));

const src = (id, label, tier, acquisition, opts = {}) => ({
  id, label, tier, acquisition,
  region: opts.region || "global",
  // ⚠️ `built` is the honest state of the ADAPTER, not of the source. A source
  // whose adapter does not exist is declared and reported as not checked — it
  // is never scored 0, and never silently omitted either.
  built: opts.built === true,
  verticals: Object.freeze(opts.verticals || []),
  // Which NAP fields this source actually publishes. A source that never shows
  // a phone number cannot contradict one, and counting it as a phone mismatch
  // would manufacture a finding out of the source's own format.
  publishes: Object.freeze(opts.publishes || ["name", "address", "phone"]),
  note: opts.note || null,
});

/**
 * The India-first source pack.
 *
 * ⚠️ INDIA FIRST IS A PRODUCT DECISION, NOT A LIMIT. `region` is declared per
 * source so a US or EU pack is additive. The Indian aggregators sit in tier 2
 * because in this market they genuinely are the aggregators — Justdial and
 * IndiaMART feed a large share of what a local answer resolves from.
 */
export const DIRECTORY_SOURCES = Object.freeze([
  // ── Tier 1 — what the engines answer from ──
  src("google_business_profile", "Google Business Profile", "authoritative", "authorized_api",
    { publishes: ["name", "address", "phone", "hours", "categories", "service_area"],
      note: "The single highest-leverage record for a local business. Needs the customer's own OAuth." }),
  src("bing_places", "Bing Places", "authoritative", "declared_url"),
  src("apple_business_connect", "Apple Business Connect", "authoritative", "authorized_api",
    { publishes: ["name", "address", "phone", "hours"] }),

  // ── Tier 2 — the Indian aggregators ──
  src("justdial", "Justdial", "major_aggregator", "public_listing", { region: "IN" }),
  src("indiamart", "IndiaMART", "major_aggregator", "public_listing",
    { region: "IN", verticals: ["b2b", "manufacturing", "wholesale"] }),
  src("sulekha", "Sulekha", "major_aggregator", "public_listing", { region: "IN" }),
  src("tradeindia", "TradeIndia", "major_aggregator", "public_listing",
    { region: "IN", verticals: ["b2b", "manufacturing", "export"] }),

  // ── Tier 3 — statutory registries ──
  src("mca", "MCA (Ministry of Corporate Affairs)", "registry", "declared_url",
    { region: "IN", publishes: ["name", "address", "registry_identifier"],
      note: "The registered office, which is frequently NOT the trading address. A difference here is often correct — see LD-05." }),
  src("gst_portal", "GST portal", "registry", "declared_url",
    { region: "IN", publishes: ["name", "address", "registry_identifier"] }),

  // ── Tier 4 — verticals ──
  src("practo", "Practo", "vertical", "public_listing", { region: "IN", verticals: ["healthcare"] }),
  src("zomato", "Zomato", "vertical", "public_listing", { region: "IN", verticals: ["food", "hospitality"] }),
  src("magicbricks", "MagicBricks", "vertical", "public_listing", { region: "IN", verticals: ["real_estate"] }),
  src("clutch", "Clutch", "vertical", "declared_url", { verticals: ["services", "agency", "software"] }),
  src("g2", "G2", "vertical", "declared_url",
    { verticals: ["software"], publishes: ["name"] }),

  // ── Tier 5 — social and review ──
  src("facebook_page", "Facebook Page", "social_review", "declared_url"),
  src("linkedin_company", "LinkedIn company page", "social_review", "declared_url",
    { publishes: ["name", "address"] }),
  src("trustpilot", "Trustpilot", "social_review", "declared_url", { publishes: ["name"] }),
  src("glassdoor", "Glassdoor", "social_review", "public_listing", { publishes: ["name", "address"] }),
]);

export const SOURCE_BY_ID = Object.freeze(
  Object.fromEntries(DIRECTORY_SOURCES.map((s) => [s.id, s])),
);

export const SOURCE_IDS = Object.freeze(DIRECTORY_SOURCES.map((s) => s.id));

/** The weight one source contributes, from its tier. */
export function weightOf(sourceId) {
  const s = SOURCE_BY_ID[sourceId];
  return s ? SOURCE_TIERS[s.tier].weight : 0;
}

/** Sources relevant to a region, with `global` always included. */
export function sourcesForRegion(region) {
  const want = (region || "").toUpperCase();
  return DIRECTORY_SOURCES.filter((s) => s.region === "global" || s.region.toUpperCase() === want);
}

/** Sources relevant to a vertical. A source with no declared vertical applies to all. */
export function sourcesForVertical(vertical) {
  if (!vertical) return [...DIRECTORY_SOURCES];
  return DIRECTORY_SOURCES.filter((s) => s.verticals.length === 0 || s.verticals.includes(vertical));
}

/**
 * The one place the coverage sentence is built.
 *
 * 🔴 NEVER RETURNS A FLAT "N DIRECTORIES AUDITED". That claim is false for
 * every customer who has authorised nothing, and it is the exact shape of
 * over-claim this repository has already had to remove from live pages twice
 * (four fabricated testimonials; a "1,200+ CI analysts" stat behind nothing).
 * The number of CONFIGURED sources is a fact about us; the number AUDITED is a
 * fact about one customer's authorisations, and the two sentences are not
 * interchangeable.
 */
export function coverageClaim({ checked = 0, region = null } = {}) {
  const configured = region ? sourcesForRegion(region).length : DIRECTORY_SOURCES.length;
  const scope = region ? ` configured for ${region.toUpperCase()}` : " configured";
  if (!checked) {
    return `${configured} sources${scope}. None checked yet — coverage depends on what you authorise.`;
  }
  return `${checked} of ${configured} sources${scope} checked. Coverage depends on what you authorise.`;
}

/** What a customer must do to unlock a source, or null when nothing is needed. */
export function unlockAction(sourceId) {
  const s = SOURCE_BY_ID[sourceId];
  if (!s) return null;
  const acq = ACQUISITION[s.acquisition];
  if (!acq.requiresCustomerAction) return null;
  return acq.id === "authorized_api"
    ? { action: "connect", label: `Connect your ${s.label} account`, sourceId }
    : { action: "declare_url", label: `Tell us your ${s.label} listing URL`, sourceId };
}
