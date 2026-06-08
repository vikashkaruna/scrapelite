// usageService.js — V5 usage metering. Tracks extractions + enrichments per month
// in localStorage, enforces plan limits, and exposes helpers for BillingProvider.
import { PLAN_BY_ID } from "./pricingConfig.js";

const USAGE_KEY  = "scrapelite.usage";
const SUB_KEY    = "scrapelite.subscription";

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ls(key)      { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function lsSet(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

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
  // Prune older than 3 months
  const keys = Object.keys(raw).sort();
  keys.slice(0, Math.max(0, keys.length - 3)).forEach((k) => delete raw[k]);
  lsSet(USAGE_KEY, raw);
}

export function incrementExtractions() {
  const u = readUsage();
  u.extractions += 1;
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

// ── Limit checks ──────────────────────────────────────────────────────────────
export function canExtract(planId, bonusExtractions = 0) {
  const plan = PLAN_BY_ID[planId] ?? PLAN_BY_ID.free;
  const { extractions } = readUsage();
  const limit = plan.limits.extractions === Infinity ? Infinity : plan.limits.extractions + bonusExtractions;
  if (limit === Infinity) return { allowed: true };
  if (extractions >= limit) {
    return {
      allowed: false,
      reason: `You've used all ${limit} extraction${limit === 1 ? "" : "s"} this month. Upgrade or purchase a top-up bundle.`,
    };
  }
  return { allowed: true, remaining: limit - extractions };
}

export function canEnrich(planId, url) {
  const plan = PLAN_BY_ID[planId] ?? PLAN_BY_ID.free;
  if (plan.limits.enrichments_per_extraction === Infinity) return { allowed: true };
  const used = readUsage().enrichments?.[url] ?? 0;
  const limit = plan.limits.enrichments_per_extraction;
  if (used >= limit) {
    return {
      allowed: false,
      reason: `Your ${plan.name} plan allows ${limit} enrichment${limit === 1 ? "" : "s"} per extraction. Upgrade to unlock more.`,
    };
  }
  return { allowed: true, remaining: limit - used };
}

export function canExport(planId, format) {
  return (PLAN_BY_ID[planId] ?? PLAN_BY_ID.free).limits.exports.includes(format);
}

export function canEmailExport(planId) {
  return (PLAN_BY_ID[planId] ?? PLAN_BY_ID.free).limits.email_export;
}
