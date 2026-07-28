// usageService.js — V5 usage metering. Tracks extractions + enrichments per month
// in localStorage. BillingProvider syncs to Supabase via usageRepo.js.
import { getEffectivePlanById, getEffectivePlanMap } from "./pricingOverrides.js";
import { activeEntitlement, can } from "./entitlementModel.js";

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
  return raw[mk] ?? { month: mk, extractions: 0, enrichments: {}, batchRuns: 0, contentGenerations: 0 };
}

function writeUsage(usage) {
  const raw = ls(USAGE_KEY) ?? {};
  raw[monthKey()] = usage;
  const keys = Object.keys(raw).sort();
  keys.slice(0, Math.max(0, keys.length - 3)).forEach((k) => delete raw[k]);
  lsSet(USAGE_KEY, raw);
}

export function incrementExtractions(count = 1) {
  const u = readUsage();
  u.extractions += count;
  writeUsage(u);
  return { ...u };
}

export function incrementEnrichments(url) {
  const u = readUsage();
  const key = url || "__global__";
  u.enrichments[key] = (u.enrichments[key] ?? 0) + 1;
  writeUsage(u);
  return { ...u };
}

export function incrementBatchRuns(count = 1) {
  const u = readUsage();
  u.batchRuns = (u.batchRuns ?? 0) + count;
  writeUsage(u);
  return { ...u };
}

export function incrementContentGenerations(count = 1) {
  const u = readUsage();
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
// Signatures and return shapes are unchanged so the ~28 existing call sites in
// Preview / Dashboard / Batch / ExtractionProvider keep working untouched —
// including canExport/canEmailExport returning a bare boolean.
function planCtx(extra) {
  return { planMap: getEffectivePlanMap(), usage: readUsage(), ...extra };
}

export function canExtract(planId, bonusExtractions = 0) {
  return can(activeEntitlement(planId), "extract", planCtx({ bonus: bonusExtractions }));
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

// Does the account have enough monthly extraction quota to run a batch of N URLs?
export function canExtractBatch(planId, urlCount, bonusExtractions = 0) {
  return can(
    activeEntitlement(planId),
    "extract.batch",
    planCtx({ urlCount, bonus: bonusExtractions }),
  );
}
