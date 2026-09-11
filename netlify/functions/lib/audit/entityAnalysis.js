// entityAnalysis.js — the Entity Authority pillar.
//
// Whether a machine can work out WHO published this and WHETHER to trust them.
// This is the pillar that decides which of several equally-correct sources gets
// cited, and it is the one GEO guidance weights most heavily.
//
// The citation-footprint signal is supplied by the sampling layer rather than
// read off the page. When no sampling engine is configured it arrives as null,
// the signal drops out of the pillar, and the remaining four re-weight — an
// unsampled brand is UNKNOWN, never uncited.

import {
  citationFootprintScore, shareOfVoice, freshnessScore,
} from "../../../../src/lib/discoverability/signalScorers.js";
import { findSchema } from "./htmlParse.js";
import { nullEvidenceCollector } from "./evidenceCollector.js";

/** Properties that make each identity type actually resolvable. */
const IDENTITY_REQUIREMENTS = Object.freeze({
  Organization: ["name", "url", "logo", "sameAs"],
  Person:       ["name", "url", "jobTitle"],
  Article:      ["headline", "author", "datePublished"],
  Product:      ["name", "description", "offers"],
  SoftwareApplication: ["name", "description", "offers"],
  WebSite:      ["name", "url"],
});

/**
 * The property WITHOUT WHICH a block cannot identify the thing it declares.
 *
 * ── NOT THE SAME QUESTION AS COMPLETENESS ──────────────────────────────────
 * `IDENTITY_REQUIREMENTS` above asks "how well is this entity described"; a
 * block missing `logo` is thin, and thinness is what the signal score is for.
 * This asks "is there an entity here AT ALL". A block that declares itself an
 * Organization and never says which organization gives a resolver a node to
 * build and no identity to attach — and a half-built node is what gets merged
 * into the wrong knowledge-graph entry, which is a worse outcome than never
 * having claimed one. That is why it is a multiplicative blocker and not
 * another few points off a signal.
 *
 * ⚠️ `WebSite` IS DELIBERATELY ABSENT. The sitelinks-searchbox pattern is a
 * WebSite block carrying `url` and `potentialAction` and nothing else, which is
 * both extremely common and entirely correct. Including it here would fire this
 * blocker on a large share of perfectly healthy sites, and a penalty that cries
 * wolf is worse than no penalty: it teaches its reader to dismiss the ones that
 * are real.
 */
const NAMING_PROPERTY = Object.freeze({
  Organization: "name",
  Person: "name",
  Product: "name",
  SoftwareApplication: "name",
  Article: "headline",
  BlogPosting: "headline",
});

/** Does a block carry the one property that says what it IS? */
function identifiesItself(block, type) {
  const key = NAMING_PROPERTY[type];
  if (!block || !key) return true;
  const v = block[key];
  // schema.org permits a language-tagged object here, and a block using one is
  // named — just not as a bare string. Reading only `typeof v === "string"`
  // would report a correctly-internationalised page as broken.
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Boolean(v["@value"] || v.name);
  }
  if (Array.isArray(v)) return v.some((x) => typeof x === "string" && x.trim());
  return typeof v === "string" && v.trim().length > 0;
}

/** How complete is one schema block against the properties that matter? */
export function schemaCompleteness(block, type) {
  const required = IDENTITY_REQUIREMENTS[type];
  if (!block || !required) return null;
  const present = required.filter((k) => {
    const v = block[k];
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  return Math.round((present.length / required.length) * 100);
}

export function analyseEntityAuthority(parsed, ctx = {}) {
  const signals = {};
  const reasons = {};
  const issues = [];
  const E = ctx.evidence || nullEvidenceCollector();

  const jsonLd = parsed.jsonLd || [];
  const org = findSchema(jsonLd, "Organization");
  const person = findSchema(jsonLd, "Person");
  const article = findSchema(jsonLd, "Article") || findSchema(jsonLd, "BlogPosting");
  const product = findSchema(jsonLd, "Product") || findSchema(jsonLd, "SoftwareApplication");
  const website = findSchema(jsonLd, "WebSite");

  // ── schema identity completeness ─────────────────────────────────────────
  // Averaged over the types PRESENT, not over all five. A blog post has no
  // Product schema and must not be marked down for it — that would push every
  // page toward declaring types it has no business declaring.
  const parts = [
    org && schemaCompleteness(org, "Organization"),
    person && schemaCompleteness(person, "Person"),
    article && schemaCompleteness(article, "Article"),
    product && (schemaCompleteness(product, "Product") ?? schemaCompleteness(product, "SoftwareApplication")),
    website && schemaCompleteness(website, "WebSite"),
  ].filter((v) => typeof v === "number");

  if (parts.length === 0) {
    signals.schema_identity_completeness = 0;
    issues.push({
      code: "EA-01", signalCode: "schema_identity_completeness", measuredScore: 0,
      evidence: "No Organization, Person, Article, Product or WebSite markup identifies who publishes this page.",
      details: { schemaTypesFound: parsed.schemaTypes || [] },
    });
    if ((parsed.schemaTypes || []).length === 0) {
      issues.push({
        code: "TA-15", signalCode: "structured_data_validity", measuredScore: 0,
        evidence: "The page carries no structured data of any kind.",
        details: {},
      });
    } else {
      issues.push({
        code: "EA-10", signalCode: "schema_identity_completeness", measuredScore: 0,
        evidence: `Structured data is present (${(parsed.schemaTypes || []).join(", ")}) but none of it describes the publisher or the page type.`,
        details: { schemaTypesFound: parsed.schemaTypes },
      });
    }
  } else {
    signals.schema_identity_completeness = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
    if (!org) {
      issues.push({
        code: "EA-01", signalCode: "schema_identity_completeness",
        measuredScore: signals.schema_identity_completeness,
        evidence: "Page-level markup is present, but nothing declares the publishing organisation.",
        details: { schemaTypesFound: parsed.schemaTypes },
      });
    } else if (signals.schema_identity_completeness < 75) {
      const missing = (IDENTITY_REQUIREMENTS.Organization || []).filter((k) => !org[k]);
      issues.push({
        code: "EA-02", signalCode: "schema_identity_completeness",
        measuredScore: signals.schema_identity_completeness,
        evidence: `Organization markup is missing ${missing.join(", ") || "key properties"}.`,
        details: { missing },
      });
    }
    if (!article && !product && (parsed.wordCount || 0) > 300) {
      issues.push({
        code: "EA-10", signalCode: "schema_identity_completeness",
        measuredScore: signals.schema_identity_completeness,
        evidence: "No Article or Product markup declares what kind of page this is.",
        details: {},
      });
    }
  }

  // ── EA-11: declared, and unresolvable ────────────────────────────────────
  //
  // Checked OUTSIDE the parts.length branch above, because the two conditions
  // are independent: a page can have a perfectly complete Organization block
  // and a nameless Product block beside it, and that Product is exactly as
  // unresolvable as it would be alone.
  //
  // Only blocks that are actually PRESENT are examined. An absent Person block
  // is not an invalid one — that is EA-01's territory, and firing both on the
  // same page would report one absence twice.
  const unresolvable = [
    ["Organization", org], ["Person", person],
    [article?.["@type"] === "BlogPosting" ? "BlogPosting" : "Article", article],
    [product?.["@type"] === "SoftwareApplication" ? "SoftwareApplication" : "Product", product],
  ].filter(([type, block]) => block && !identifiesItself(block, type));

  if (unresolvable.length > 0) {
    const types = unresolvable.map(([type]) => type);
    issues.push({
      code: "EA-11", signalCode: "schema_identity_completeness",
      measuredScore: signals.schema_identity_completeness ?? 0,
      evidence: `${types.join(" and ")} markup is present but carries no ${
        types.length === 1 ? `\`${NAMING_PROPERTY[types[0]]}\`` : "identifying property"
      }, so there is nothing for an engine to resolve it to.`,
      details: { unresolvable: types },
    });
  }

  // ── sameAs / profile linkage ─────────────────────────────────────────────
  const schemaSameAs = []
    .concat(org?.sameAs || [], person?.sameAs || [], website?.sameAs || [])
    .filter((s) => typeof s === "string" && /^https?:\/\//i.test(s));
  const uniqueSameAs = [...new Set(schemaSameAs)];
  const visibleProfiles = (parsed.links?.profiles || []).map((p) => p.href);

  if (uniqueSameAs.length === 0 && visibleProfiles.length === 0) {
    signals.sameas_consistency = 0;
    issues.push({
      code: "EA-03", signalCode: "sameas_consistency", measuredScore: 0,
      evidence: "No sameAs entries and no links to official profiles, so nothing confirms which entity this page belongs to.",
      details: {},
    });
  } else if (uniqueSameAs.length === 0) {
    // Profiles are linked in the page but never declared as sameAs. The
    // relationship is visible to a human and invisible to a parser.
    signals.sameas_consistency = 40;
    issues.push({
      code: "EA-03", signalCode: "sameas_consistency", measuredScore: 40,
      evidence: `${visibleProfiles.length} profile link${visibleProfiles.length === 1 ? " is" : "s are"} present in the page but not declared as sameAs in the markup.`,
      details: { profiles: visibleProfiles.slice(0, 8) },
    });
  } else {
    // Three or more distinct official profiles is a well-resolved entity.
    signals.sameas_consistency = Math.min(100, 40 + uniqueSameAs.length * 20);
  }

  // ── author trust ─────────────────────────────────────────────────────────
  const author = parsed.author || {};
  if (!author.name) {
    signals.author_trust_signals = 0;
    issues.push({
      code: "EA-04", signalCode: "author_trust_signals", measuredScore: 0,
      evidence: "The page has no named author, in the markup or on the page.",
      details: {},
    });
  } else {
    let s = 40;                                    // a name at all
    if (author.visible) s += 20;                   // and a reader can see it
    if (author.inSchema) s += 15;                  // and a parser can read it
    if (author.bioLinked) s += 15;                 // and it leads somewhere real
    if (author.credentials) s += 10;               // and that somewhere has standing
    signals.author_trust_signals = Math.min(100, s);
    if (!author.bioLinked || !author.credentials) {
      issues.push({
        code: "EA-05", signalCode: "author_trust_signals",
        measuredScore: signals.author_trust_signals,
        evidence: `"${author.name}" is credited${author.bioLinked ? "" : " but links to no author page"}${author.credentials ? "" : " and shows no credentials"}.`,
        details: { author: author.name, bioLinked: author.bioLinked, credentials: author.credentials },
      });
    }
  }

  // ── freshness and sourcing ───────────────────────────────────────────────
  const dates = parsed.dates || {};
  const best = dates.best ? Date.parse(dates.best) : NaN;
  const ageDays = Number.isFinite(best) && ctx.now
    ? Math.max(0, Math.floor((ctx.now - best) / 86_400_000))
    : Number.isFinite(best) ? null : null;

  // Outbound links to somewhere other than social profiles read as sourcing.
  const outbound = (parsed.links?.external || []).filter(
    (l) => !(parsed.links?.profiles || []).some((p) => p.href === l.href),
  );
  const hasSourceLinks = outbound.length >= 2;

  signals.freshness_and_sources = freshnessScore({
    ageDays, hasVisibleDate: Boolean(dates.visibleDate), hasSourceLinks,
  });
  if (!dates.visibleDate) {
    issues.push({
      code: "EA-06", signalCode: "freshness_and_sources",
      measuredScore: signals.freshness_and_sources,
      evidence: "No published or last-updated date is visible to a reader.",
      details: { schemaDate: dates.best },
    });
  }
  if (!hasSourceLinks && (parsed.wordCount || 0) > 500) {
    issues.push({
      code: "EA-07", signalCode: "freshness_and_sources",
      measuredScore: signals.freshness_and_sources,
      evidence: `${parsed.wordCount} words with ${outbound.length} outbound reference${outbound.length === 1 ? "" : "s"} — claims are largely unattributed.`,
      details: { outboundCount: outbound.length },
      confidenceOverride: 60,   // link count is a proxy for sourcing, not proof
    });
  }

  // ── AI visibility (WAVI) ─────────────────────────────────────────────────
  // v3. The richer read of the same evidence `citation_footprint` scores, which
  // is why the two SPLIT one weight rather than each carrying a full one.
  //
  // 🔴 NULL, NOT ZERO, WHENEVER THE SAMPLE COULD NOT BE TAKEN. A missing engine
  // key, an outage or an exhausted budget must redistribute this signal's
  // weight, not mark the brand invisible — the same rule the whole scorer runs
  // on, and the reason a page whose sample cannot be taken scores identically
  // on v2 and v3.
  const wavi = ctx.citationSample?.wavi || null;
  if (!wavi || wavi.score === null) {
    signals.ai_visibility = null;
    reasons.ai_visibility = ctx.citationSample ? "not_measured" : "no_engine_configured";
  } else {
    signals.ai_visibility = wavi.score;
  }

  // ── citation footprint (supplied by the sampling layer) ──────────────────
  const sample = ctx.citationSample || null;
  if (!sample || !sample.promptCount) {
    // No engine configured, or sampling failed. UNKNOWN, not zero — see the
    // header of scoringModel.js for why that distinction is load-bearing.
    signals.citation_footprint = null;
    reasons.citation_footprint = "not_measured";
  } else {
    signals.citation_footprint = citationFootprintScore({
      prompts: sample.promptCount,
      mentions: sample.mentions,
      citations: sample.citations,
      sentiment: sample.sentiment,
    });
    if (sample.citations === 0 && sample.mentions === 0) {
      issues.push({
        code: "EA-08", signalCode: "citation_footprint", measuredScore: 0,
        evidence: `Across ${sample.promptCount} sampled prompts the brand was neither mentioned nor cited.`,
        details: { engine: sample.engine, promptCount: sample.promptCount },
        confidenceOverride: sample.live ? 80 : 55,
      });
    } else if (sample.citations === 0 && sample.mentions > 0) {
      issues.push({
        code: "EA-09", signalCode: "citation_footprint",
        measuredScore: signals.citation_footprint,
        evidence: `The brand was mentioned in ${sample.mentions} of ${sample.promptCount} sampled answers but cited as the source in none.`,
        details: { engine: sample.engine, mentions: sample.mentions },
        confidenceOverride: sample.live ? 80 : 55,
      });
    }
  }

  // ── record what was read ─────────────────────────────────────────────────
  // One record per signal, emitted after the branches settle. Note that
  // citation_footprint's method is `answer_engine`, not `raw_html`: it is the
  // one signal in this pillar that was not read off the customer's own page,
  // and its lower default confidence says so without anyone having to remember.
  E.signal("schema_identity_completeness", {
    method: "json_ld",
    selector: "script[type='application/ld+json']",
    section: "Identity markup",
    observedValue: { types_scored: parts.length, types_found: (parsed.schemaTypes || []).length },
    structured: { schema_types: parsed.schemaTypes || [] },
  });
  E.signal("sameas_consistency", {
    method: uniqueSameAs.length ? "json_ld" : "raw_html",
    selector: uniqueSameAs.length ? "sameAs" : "a[href]",
    section: "Official profile linkage",
    observedValue: { sameAs: uniqueSameAs.length, visible_profiles: visibleProfiles.length },
    structured: { sameAs: uniqueSameAs.slice(0, 8), visible: visibleProfiles.slice(0, 8) },
  });
  E.signal("author_trust_signals", {
    method: "raw_html",
    section: "Byline and author credentials",
    observedValue: {
      named: Boolean(author.name),
      bio_linked: Boolean(author.bioLinked),
      credentials: Boolean(author.credentials),
      visible: Boolean(author.visible),
    },
    excerpt: author.name || "",
  });
  E.signal("freshness_and_sources", {
    method: "raw_html",
    section: "Dates and outbound attribution",
    observedValue: {
      visible_date: Boolean(dates.visibleDate),
      age_days: ageDays,
      outbound_references: outbound.length,
    },
    structured: { date_published: dates.published || null, date_modified: dates.modified || null },
  });
  if (sample && sample.promptCount) {
    E.signal("citation_footprint", {
      method: "answer_engine",
      sourceUrl: parsed.url || undefined,
      section: `${sample.engine || "answer engine"} prompt sample`,
      observedValue: {
        prompts: sample.promptCount,
        mentions: sample.mentions,
        citations: sample.citations,
        live: Boolean(sample.live),
      },
      // A recall-only sample is a model's memory of the brand, not a retrieval
      // result, so it is worth materially less than a live one — and the record
      // says which it was rather than leaving the reader to guess.
      confidence: sample.live ? undefined : 0.35,
      structured: { engine: sample.engine || null, sentiment: sample.sentiment ?? null },
    });
  }

  return {
    signals, reasons, issues,
    facts: {
      brand_name: org?.name || website?.name || null,
      schema_types: parsed.schemaTypes || [],
      sameAs_links: uniqueSameAs,
      visible_profile_links: visibleProfiles.slice(0, 12),
      authors: author.name ? [{
        name: author.name,
        bio_page_present: Boolean(author.bioLinked),
        credentials_present: Boolean(author.credentials),
        visible: Boolean(author.visible),
      }] : [],
      third_party_mentions: outbound.length,
      last_updated_visible: Boolean(dates.visibleDate),
      date_published: dates.published || null,
      date_modified: dates.modified || null,
      age_days: ageDays,
      ai_citation_sample: sample ? {
        engine: sample.engine,
        live: Boolean(sample.live),
        prompt_count: sample.promptCount,
        mentions: sample.mentions,
        citations: sample.citations,
        share_of_voice: shareOfVoice({ prompts: sample.promptCount, citations: sample.citations }),
        sentiment_score: sample.sentiment,
      } : null,
    },
  };
}
