// usageService.js — V5 usage metering. Tracks extractions + enrichments per month
// in localStorage. BillingProvider syncs to Supabase via usageRepo.js.
import { getEffectivePlanMap } from "./pricingOverrides.js";

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

// ── Monthly usage ─────────────────────────────────────────────────────────────
export function readUsage() {
  const raw = ls(USAGE_KEY) ?? {};
  const mk = monthKey();
  return raw[mk] ?? { month: mk, extractions: 0, enrichments: {} };
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

// ── Limit checks — always return { allowed, remaining } for consistency ────────
export function canExtract(planId, bonusExtractions = 0) {
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free;
  const { extractions } = readUsage();
  const limit = plan.limits.extractions === Infinity
    ? Infinity
    : plan.limits.extractions + bonusExtractions;

  if (limit === Infinity) return { allowed: true, remaining: Infinity };
  if (extractions >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `You've used all ${limit} extraction${limit === 1 ? "" : "s"} this month. Upgrade or purchase a top-up bundle.`,
    };
  }
  return { allowed: true, remaining: limit - extractions };
}

export function canEnrich(planId, url) {
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free;
  if (plan.limits.enrichments_per_extraction === Infinity) {
    return { allowed: true, remaining: Infinity };
  }
  const used  = readUsage().enrichments?.[url] ?? 0;
  const limit = plan.limits.enrichments_per_extraction;
  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Your ${plan.name} plan allows ${limit} enrichment${limit === 1 ? "" : "s"} per extraction. Upgrade to unlock more.`,
    };
  }
  return { allowed: true, remaining: limit - used };
}

export function canExport(planId, format) {
  const planMap = getEffectivePlanMap();
  return (planMap[planId] ?? planMap.free).limits.exports.includes(format);
}

export function canEmailExport(planId) {
  const planMap = getEffectivePlanMap();
  return (planMap[planId] ?? planMap.free).limits.email_export;
}

// Check if the plan supports batch mode and whether N URLs fit within the batch limit.
// bonusBatchUrls is from top-up "Batch Pack" bundles.
export function canBatch(planId, urlCount = 1, bonusBatchUrls = 0) {
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free;
  const planLimit = plan.limits.batch_max_urls || 0;
  const effectiveLimit = planLimit + (bonusBatchUrls || 0);

  if (effectiveLimit === 0) {
    return {
      allowed: false,
      remaining: 0,
      reason:
        "Batch mode requires the Business or Agency plan, or a Batch Pack top-up bundle.",
    };
  }
  if (urlCount > effectiveLimit) {
    return {
      allowed: false,
      remaining: effectiveLimit,
      reason: `Your plan supports up to ${effectiveLimit} URLs per batch. Reduce your list or upgrade.`,
    };
  }
  return { allowed: true, remaining: effectiveLimit - urlCount };
}

// Check if the account has enough monthly extraction quota to run a batch of N URLs.
export function canExtractBatch(planId, urlCount, bonusExtractions = 0) {
  const planMap = getEffectivePlanMap();
  const plan = planMap[planId] ?? planMap.free;
  const { extractions } = readUsage();
  const limit =
    plan.limits.extractions === Infinity
      ? Infinity
      : plan.limits.extractions + bonusExtractions;

  if (limit === Infinity) return { allowed: true, remaining: Infinity };

  const remaining = limit - extractions;
  if (remaining < urlCount) {
    return {
      allowed: false,
      remaining: Math.max(0, remaining),
      reason: `You need ${urlCount} extraction${urlCount > 1 ? "s" : ""} but only have ${Math.max(0, remaining)} remaining this month. Upgrade or purchase a top-up bundle.`,
    };
  }
  return { allowed: true, remaining: remaining };
}
