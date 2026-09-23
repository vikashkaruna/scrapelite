// usageService.js — V5 usage metering. Tracks extractions + enrichments per month
// in localStorage. BillingProvider syncs to Supabase via usageRepo.js.
import { getEffectivePlanById, getEffectivePlanMap } from "./pricingOverrides.js";
import { activeEntitlement, can } from "./entitlementModel.js";
import { getCachedCredits } from "./credits/creditClient.js";

const USAGE_KEY = "datiq.usage";
const SUB_KEY   = "datiq.subscription";

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ls(k)      { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function lsSet(k,v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Subscription ──────────────────────────────────────────────────────────────
export function readSubscription() {
  return ls(SUB_KEY) ?? { planId: "free", activatedAt: null, addons: [], coupon: null, bonusExtractions: 0 };
}
export function writeSubscription(sub) { lsSet(SUB_KEY, sub); }

/**
 * Apply the once-only signup trial credit for a given plan.
 *
 * Reads `getEffectivePlanById(planId).trialCredit ?? 0` — only the Free plan
 * currently defines a credit (25 extractions per the Q2 2026-07-15 decision).
 * The grant is persisted in `datiq.subscription` as `trialCreditAppliedAt` so
 * subsequent calls (e.g. a re-render or a fallback path) are idempotent.
 *
 * @param {string} planId
 * @returns {{ applied: boolean, credit: number, sub: object }}
 */
export function applyTrialCredit(planId) {
  const plan = getEffectivePlanById(planId);
  const credit = plan?.trialCredit ?? 0;
  const sub = readSubscription();
  if (credit <= 0 || sub.trialCreditAppliedAt) {
    return { applied: false, credit: 0, sub };
  }
  const updated = {
    ...sub,
    trialCreditAppliedAt: new Date().toISOString(),
    bonusExtractions: (sub.bonusExtractions || 0) + credit,
  };
  writeSubscription(updated);
  return { applied: true, credit, sub: updated };
}

// ── Monthly usage ─────────────────────────────────────────────────────────────
export function readUsage() {
  const raw = ls(USAGE_KEY) ?? {};
  const mk = monthKey();
  // `byPersona` is additive and always defaulted, so a record written before it
  // existed reads back without it and every caller still works. Historic months
  // genuinely have no persona breakdown — that is a fact about the past, and the
  // UI says so rather than showing a misleading zero.
  const rec = raw[mk] ?? { month: mk, extractions: 0, enrichments: {}, batchRuns: 0, contentGenerations: 0 };
  if (!rec.byPersona) rec.byPersona = {};
  return rec;
}

function writeUsage(usage) {
  const raw = ls(USAGE_KEY) ?? {};
  raw[monthKey()] = usage;
  const keys = Object.keys(raw).sort();
  keys.slice(0, Math.max(0, keys.length - 3)).forEach((k) => delete raw[k]);
  lsSet(USAGE_KEY, raw);
}

/**
 * Attribute usage to the persona that was active when it happened.
 *
 * ── WHY THIS IS TRACKED AT ALL ─────────────────────────────────────────────
 * Persona has always shaped what the product SHOWS — examples, quick actions,
 * prompt framing — but nothing recorded which one was in use when a unit was
 * spent. So "which of my team's roles is consuming the plan?" had no answer,
 * on a product that sells team seats.
 *
 * ── WHY IT IS A NESTED MAP AND NOT A SECOND RECORD ─────────────────────────
 * The totals stay exactly where they were. `byPersona` is a breakdown OF them,
 * so the two can never disagree about the month — the failure mode a parallel
 * counter always eventually reaches, and the same reason audits are counted
 * from their rows rather than from a counter column.
 *
 * `null` persona is recorded under `__none__` rather than dropped: work done
 * before anyone picked a role is still work, and silently omitting it would
 * make the breakdown fail to add up to the total.
 */
/**
 * The persona in effect right now.
 *
 * Resolved HERE rather than threaded through every caller, deliberately. Four
 * separate call sites increment usage (extractions, enrichments, batch runs,
 * content generations) and a fifth is arriving for audits; asking each to
 * remember to pass the persona is exactly the shape of the guest-credit leak,
 * where checking and blocking were two steps each caller wired itself and four
 * of them drifted. One read, one place, and a new counter is attributed
 * correctly without its author having to know this exists.
 *
 * Reads PersonaProvider's own key. Wrapped: storage throws outright in some
 * privacy-hardened contexts, and losing a usage COUNT because a breakdown could
 * not be attributed would be a bad trade.
 */
function activePersonaId() {
  try {
    // PersonaProvider writes the id as a RAW string (see its read/write
    // helpers) — not JSON. Parsing it would be wrong for every real value.
    return localStorage.getItem("datiq.persona") || null;
  } catch {
    return null;
  }
}

function bumpPersona(usage, personaId, field, count) {
  const key = personaId || activePersonaId() || "__none__";
  const row = usage.byPersona[key] || { extractions: 0, enrichments: 0, batchRuns: 0, contentGenerations: 0, audits: 0 };
  row[field] = (row[field] || 0) + count;
  usage.byPersona[key] = row;
}

/** Audits have their own monthly budget server-side; this is the local view. */
export function incrementAudits(count = 1, personaId = null) {
  const u = readUsage();
  u.audits = (u.audits || 0) + count;
  bumpPersona(u, personaId, "audits", count);
  writeUsage(u);
  return { ...u };
}

export function incrementExtractions(count = 1, personaId = null) {
  const u = readUsage();
  u.extractions += count;
  bumpPersona(u, personaId, "extractions", count);
  writeUsage(u);
  return { ...u };
}

export function incrementEnrichments(url, personaId = null) {
  const u = readUsage();
  const key = url || "__global__";
  u.enrichments[key] = (u.enrichments[key] ?? 0) + 1;
  bumpPersona(u, personaId, "enrichments", 1);
  writeUsage(u);
  return { ...u };
}

export function incrementBatchRuns(count = 1, personaId = null) {
  const u = readUsage();
  bumpPersona(u, personaId, "batchRuns", count);
  u.batchRuns = (u.batchRuns ?? 0) + count;
  writeUsage(u);
  return { ...u };
}

export function incrementContentGenerations(count = 1, personaId = null) {
  const u = readUsage();
  bumpPersona(u, personaId, "contentGenerations", count);
  u.contentGenerations = (u.contentGenerations ?? 0) + count;
  writeUsage(u);
  return { ...u };
}

// ── Limit checks ──────────────────────────────────────────────────────────────
// These are now thin PLAN-ONLY adapters over entitlementModel.can(), which is
// the single implementation of every capability rule and is shared with the
// Netlify functions. They deliberately pass a synthetic always-active
// entitlement: this layer answers "does the PLAN allow it", not "is the account
// in good standing". Lifecycle (suspended / deactivated) is applied one level
// up, in BillingProvider, where the real entitlement row is available.
//
// Signatures and return shapes are unchanged, including canExport /
// canEmailExport returning a bare boolean.
//
// ⚠️ The comment here used to claim "~28 existing call sites in Preview /
// Dashboard / Batch / ExtractionProvider". There are none: the gates moved to
// BillingProvider, which calls `can()` directly, and nobody updated this. It
// is left corrected rather than deleted because the wrappers are still the
// documented client-side API and now read the credit pool like everything
// else.
function planCtx(extra) {
  // ── THE CREDIT BALANCE, FROM THE UX CACHE ──────────────────────────────
  // ⚠️ A HINT, NEVER AUTHORIZATION. This is the browser's 60s-cached copy so
  // a button can be disabled without a round-trip; the server re-sums the
  // ledger at the moment it charges. A stale or missing cache reads as
  // "unknown", which entitlementModel deliberately lets through — refusing a
  // paying customer because the browser had not fetched yet would be far
  // worse than letting one request reach a server that will decide properly.
  return {
    planMap: getEffectivePlanMap(),
    usage: readUsage(),
    credits: getCachedCredits() || undefined,
    ...extra,
  };
}

// `bonusExtractions` is accepted and ignored: top-up extraction bundles are
// retired (D15) and the pool is the budget. Kept in the signature so a caller
// passing it does not become a TypeError on the day it stops meaning anything.
export function canExtract(planId, _bonusExtractions = 0) {
  return can(activeEntitlement(planId), "extract", planCtx());
}

export function canEnrich(planId, url) {
  return can(activeEntitlement(planId), "enrich", planCtx({ url }));
}

export function canExport(planId, format) {
  return can(activeEntitlement(planId), `export.${format}`, planCtx()).allowed;
}

export function canEmailExport(planId) {
  return can(activeEntitlement(planId), "export.email", planCtx()).allowed;
}

// Does the plan support batch mode, and do N URLs fit the per-batch cap?
// bonusBatchUrls comes from top-up "Batch Pack" bundles.
export function canBatch(planId, urlCount = 1, bonusBatchUrls = 0) {
  return can(activeEntitlement(planId), "batch", planCtx({ urlCount, bonusBatchUrls }));
}

// Does the account have enough CREDIT to run a batch of N URLs? One page = 1.
export function canExtractBatch(planId, urlCount, _bonusExtractions = 0) {
  return can(activeEntitlement(planId), "extract.batch", planCtx({ urlCount }));
}
