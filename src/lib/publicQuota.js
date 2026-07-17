// src/lib/publicQuota.js — FA1 (free-tier "Public Report" quota mechanic).
//
// Council intent: "Unlimited free extractions if published as public indexed
// DatIQ-branded pages; private runs consume quota. Feeds F04/F11 content
// flywheel."
//
// Implementation: keep a counter of `publicExtractions` per month alongside
// the regular `extractions` counter. The Free plan can extract as many
// public extractions as it wants; only private extractions eat the monthly
// cap. Paid plans ignore the mechanic entirely (their limits are higher
// anyway and the loop is less valuable to them).
//
// The data is stored in the same `datiq.usage` shape as the existing
// extraction counter so we don't grow a new localStorage key. The function
// here is a thin layer that the extraction flow calls on share + extraction.

import { readUsage } from "./usageService.js";

const USAGE_KEY = "datiq.usage";

function writeUsageShape(usage) {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY)) || {};
    const mk = (usage.month ||
      `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
    raw[mk] = { ...raw[mk], ...usage };
    const keys = Object.keys(raw).sort();
    keys.slice(0, Math.max(0, keys.length - 3)).forEach((k) => delete raw[k]);
    localStorage.setItem(USAGE_KEY, JSON.stringify(raw));
  } catch { /* skip */ }
}

/** Read this month's public-extraction count (default 0). */
export function readPublicCount() {
  const u = readUsage();
  return u.publicExtractions || 0;
}

/** Increment public-extraction count (returns the new value). */
export function incrementPublicExtractions(count = 1) {
  const u = readUsage();
  u.publicExtractions = (u.publicExtractions || 0) + count;
  writeUsageShape(u);
  return u.publicExtractions;
}

/** Decrement — used when a user un-shares a public extraction in the same month. */
export function decrementPublicExtractions(count = 1) {
  const u = readUsage();
  u.publicExtractions = Math.max(0, (u.publicExtractions || 0) - count);
  writeUsageShape(u);
  return u.publicExtractions;
}

/**
 * Build a human-readable quota summary string for the UI.
 * - Free + 0 public: "X of 10 used"
 * - Free + N public: "X of 10 used · N public (unlimited)"
 * - Paid: "X used (unlimited on <plan>)"
 */
export function buildQuotaCopy({ used, limit, publicCount, planName, isPublic = false }) {
  if (limit === Infinity) {
    return `${used} used · Unlimited on ${planName}`;
  }
  if (isPublic) {
    return "Public report — doesn't count against your quota";
  }
  const base = `${used} of ${limit} used`;
  if (publicCount > 0) {
    return `${base} · ${publicCount} public (unlimited)`;
  }
  return base;
}

export function isPublicExtractionFree(planId) {
  // Council: the mechanic is the Free-tier growth flywheel. Paid plans
  // already have generous limits, so the public mechanic is a no-op for
  // them (the share button still works the same way; the UI just doesn't
  // surface the "unlimited" framing).
  return planId === "free" || !planId;
}
