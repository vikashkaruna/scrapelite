// netlify/functions/lib/bulkEnrich.js — real enrichment for PRD 3.
//
// ── WHAT THIS REPLACES, AND WHY IT MATTERED ─────────────────────────────────
//
// The shipped enricher never fetched anything. It built firmographics by string
// matching on the domain name:
//
//     const isTech = domain.includes("tech") || domain.includes("io") || …
//     industry: isTech ? "Software" : "Services",
//     employee_count: 55,          // the same 55 for every company on earth
//     has_pricing: true,           // always
//     confidence_score: 0.95       // stamped on the invention
//
// Every ICP score in the product was computed from that. This repository has
// already had to fix production serving locally-generated fixture prose badged
// as `ai_generated`; this is the same defect in a more expensive place, because
// a RevOps user routes real outbound off these scores.
//
// ── THE RULE THIS MODULE IS BUILT ON ────────────────────────────────────────
//
// A field is either OBSERVED, INFERRED, or ABSENT. Never invented.
//
//   observed  — read literally off the page (title, a /pricing link, meta
//               description). Confidence 1.
//   inferred  — an AI reading of the page's own text (industry, size band).
//               Carries the model's own confidence, and is labelled as inferred
//               all the way to the UI.
//   absent    — we could not determine it. The field is OMITTED, never
//               defaulted. `evaluateIcp` already treats an absent field as
//               unmeasured and redistributes its weight (§1.6), so honesty here
//               produces a lower COVERAGE rather than a wrong SCORE — which is
//               the distinction the whole discoverability scorer is built on.
//
// If the AI chain is unavailable, the inferred fields are simply absent. The
// record still scores on what was observed, and its coverage says so. That is
// strictly better than the previous behaviour, which was to be confidently
// wrong at 0.95 while every provider was down.

import { runScrapeChain } from "./scrapeProviders.js";
import { extractPageContent } from "./pageContent.js";
import { checkCompliance } from "./complianceEngine.js";
import { isPublicHttpUrlAsync } from "./publicUrl.js";
import { runChain } from "./aiProviders.js";

/** Per-domain wall-clock ceiling. The caller's budget still governs the loop. */
const DOMAIN_TIMEOUT_MS = 9000;

/** Employee bands, not a fabricated headcount. Nobody can read "55" off a page. */
export const EMPLOYEE_BANDS = Object.freeze(["1-10", "11-50", "51-200", "201-1000", "1000+"]);

/**
 * Fields we ask the model for. Deliberately short: every extra field is another
 * opportunity for a confident guess, and the ICP rules only use a handful.
 */
const INFERENCE_PROMPT = `You are reading the homepage text of a company website.
Return ONLY a JSON object. Use null for anything the text does not support.
Never guess. If the page does not say, the answer is null.

{
  "industry": "<one of: Software, SaaS, Fintech, Ecommerce, Healthcare, Manufacturing, Services, Media, Education, Other, or null>",
  "employee_band": "<one of: 1-10, 11-50, 51-200, 201-1000, 1000+, or null>",
  "target_customer": "<short phrase the page itself uses, or null>",
  "confidence": <0..1, how well the text supported these answers>
}`;

/** Tolerant JSON extraction — a model may wrap its object in prose or a fence. */
function parseJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Only accept a value the model was actually allowed to return. */
function acceptEnum(value, allowed) {
  if (typeof value !== "string") return undefined;
  const hit = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return hit || undefined;
}

const INDUSTRIES = [
  "Software", "SaaS", "Fintech", "Ecommerce", "Healthcare",
  "Manufacturing", "Services", "Media", "Education", "Other",
];

/**
 * Enrich one domain.
 *
 * @returns {{
 *   ok: boolean, reason?: string,
 *   fields: Record<string, any>,
 *   provenance: Record<string, {method: string, source: string, confidence: number}>,
 *   confidence: number, sourceUrl: string|null, pagesFetched: number
 * }}
 */
export async function enrichDomain(canonicalDomain, opts = {}) {
  const empty = { fields: {}, provenance: {}, confidence: 0, sourceUrl: null, pagesFetched: 0 };
  if (!canonicalDomain) return { ok: false, reason: "no_domain", ...empty };

  const url = `https://${canonicalDomain}`;
  const deadlineAt = opts.deadlineAt || Date.now() + DOMAIN_TIMEOUT_MS;

  // SSRF guard, then the site's own robots.txt — the same order and the same
  // reasoning as extract.js. A refusal here costs the customer nothing.
  try {
    if (!(await isPublicHttpUrlAsync(url))) return { ok: false, reason: "url_not_public", ...empty };
  } catch (e) {
    return { ok: false, reason: `url_rejected: ${e.message}`, ...empty };
  }

  try {
    const verdict = await checkCompliance(url);
    if (verdict && verdict.allowed === false) {
      return { ok: false, reason: verdict.code || "robots_disallowed", ...empty };
    }
  } catch {
    // Fails open by design — see complianceEngine.js.
  }

  let scraped;
  try {
    scraped = await runScrapeChain(url, { deadlineAt });
  } catch (e) {
    return { ok: false, reason: `fetch_failed: ${e.message}`, ...empty };
  }

  const html = scraped?.data?.html || "";
  if (!html) return { ok: false, reason: "empty_response", ...empty };

  const content = extractPageContent(html, { maxChars: 40_000 });
  const title = scraped?.data?.metadata?.title || "";

  const fields = {};
  const provenance = {};
  const observe = (key, value) => {
    if (value === undefined || value === null || value === "") return;
    fields[key] = value;
    provenance[key] = { method: "observed", source: url, confidence: 1 };
  };

  // ── OBSERVED ──────────────────────────────────────────────────────────────
  // The company name as the site itself writes it, with the common
  // " | tagline" / " – tagline" suffix removed.
  const name = String(title).split(/\s[|–—-]\s/)[0].trim();
  observe("company_name", name || undefined);
  observe("domain", canonicalDomain);

  const metaDesc = (html.match(/<meta[^>]+name=["']?description["']?[^>]*content=["']([^"']{10,300})["']/i) || [])[1];
  observe("description", metaDesc && metaDesc.trim());

  // A pricing page either is linked or is not. This is the single most useful
  // observable commercial signal and needs no model to read.
  const hasPricing = /href=["'][^"']*\/(pricing|plans)\b/i.test(html);
  fields.has_pricing = hasPricing;
  provenance.has_pricing = { method: "observed", source: url, confidence: 1 };

  const hasCareers = /href=["'][^"']*\/(careers|jobs)\b/i.test(html);
  fields.has_careers = hasCareers;
  provenance.has_careers = { method: "observed", source: url, confidence: 1 };

  // ── INFERRED ──────────────────────────────────────────────────────────────
  // Everything below is a model reading the page's own words. If the chain is
  // unavailable these fields stay ABSENT and the ICP coverage drops honestly.
  let aiConfidence = 0;
  if (content.text && content.text.length > 120 && opts.useAi !== false) {
    try {
      const reply = await runChain(
        [{ role: "user", content: `${INFERENCE_PROMPT}\n\n---\n${content.text.slice(0, 12_000)}` }],
        400,
        { area: "classification", tier: "fast" },
      );
      const text = reply?.content?.[0]?.text || "";
      const parsed = parseJsonObject(text);
      if (parsed) {
        const industry = acceptEnum(parsed.industry, INDUSTRIES);
        const band = acceptEnum(parsed.employee_band, EMPLOYEE_BANDS);
        const conf = Number(parsed.confidence);
        aiConfidence = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;

        if (industry) {
          fields.industry = industry;
          provenance.industry = { method: "inferred", source: url, confidence: aiConfidence };
        }
        if (band) {
          fields.employee_band = band;
          provenance.employee_band = { method: "inferred", source: url, confidence: aiConfidence };
        }
        if (typeof parsed.target_customer === "string" && parsed.target_customer.trim()) {
          fields.target_customer = parsed.target_customer.trim().slice(0, 200);
          provenance.target_customer = { method: "inferred", source: url, confidence: aiConfidence };
        }
      }
    } catch {
      // An AI outage leaves the inferred fields absent. Deliberately silent at
      // this level: the caller reports coverage, which is where a user can see
      // that this record was thinner than usual.
    }
  }

  // Overall confidence is the WEAKEST link that actually contributed, not an
  // average — averaging lets three certain observations hide one shaky guess.
  const confidences = Object.values(provenance).map((p) => p.confidence);
  const confidence = confidences.length ? Math.min(...confidences) : 0;

  return {
    ok: true,
    fields,
    provenance,
    confidence,
    aiConfidence,
    sourceUrl: url,
    pagesFetched: 1,
    source: scraped?.source || null,
  };
}

/**
 * Fields whose inferred value is weak enough to be worth a human's eye.
 * Feeds the review queue PRD 3 asks for ("human review queue for uncertain
 * contacts/data"), driven by measured confidence rather than the previous
 * code's `if (!isTech)`.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export function fieldsNeedingReview(provenance = {}, threshold = REVIEW_CONFIDENCE_THRESHOLD) {
  return Object.entries(provenance)
    .filter(([, p]) => p.method === "inferred" && Number(p.confidence) < threshold)
    .map(([field, p]) => ({ field, confidence: Number(p.confidence) }));
}

export const _internal = { parseJsonObject, acceptEnum, INDUSTRIES, INFERENCE_PROMPT };
