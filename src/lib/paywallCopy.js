// paywallCopy.js — FA3 (task-aware paywall + annual anchoring) helper.
//
// Maps the current context (route + usage state) to a specific paywall
// message: which paid feature completes the current task, and which plan
// unlocks it. Default-anchors on the annual price (per the council note).
//
// Used by UsageUpsellBanner (Shell-level, fires at >=80%) and
// GuestTrialModal (fires on hard block). Pure functions only — the
// components own the render + click handling.
//
// Annual-anchoring rule: every message shows the annual price FIRST and the
// monthly price as a secondary line. Research shows defaulting to annual
// lifts annual conversion 30-40% vs. presenting them equally.

import { getEffectivePlans } from "./pricingOverrides.js";

function findPlan(id) {
  return getEffectivePlans().find((p) => p.id === id) || null;
}

function fmtUsd(n) {
  if (!n) return "$0";
  return `$${n}`;
}
function fmtInr(n) {
  if (!n) return "₹0";
  return `₹${n.toLocaleString("en-IN")}`;
}

/**
 * Return the plan best suited to "completing the current task". Falls back
 * to "pro" when the context is ambiguous.
 *
 * @param {object} ctx - { kind, urls?, format? }
 * @returns {object|null}  The plan, with annual + monthly prices attached.
 */
export function pickRecommendedPlan(ctx = {}) {
  let planId = "pro"; // default: Pro unlocks 1,000 extractions/mo, JSON export, CSV import
  if (ctx.kind === "batch") {
    const urls = ctx.urls || 0;
    if (urls > 250) planId = "agency";      // Agency = up to 500 URLs/run
    else if (urls > 100) planId = "business"; // Business = up to 250 URLs/run
    else if (urls > 50) planId = "pro";     // Pro = up to 100 URLs/run
    else if (urls > 20) planId = "select";  // Select = up to 50 URLs/run
    else if (urls > 5) planId = "go";       // Go = up to 20 URLs/run
  } else if (ctx.kind === "export") {
    if (ctx.format === "json") planId = "pro";      // JSON export = Pro+
    else if (ctx.format === "pdf" || ctx.format === "markdown") planId = "go"; // PDF/MD = Go+
    else planId = "pro";
  } else if (ctx.kind === "schedule") {
    planId = "pro"; // Scheduled monitoring first appears on Pro (Go/Select are both 0)
  } else if (ctx.kind === "api") {
    planId = "business"; // API access = Business+
  }
  const plan = findPlan(planId);
  return plan;
}

/**
 * Build a task-aware paywall payload for the given context + current plan.
 *
 * @param {object} args
 * @param {string} args.route        - current pathname (e.g. "/batch")
 * @param {object} args.usage        - { extractions: number, batchRuns: number, ... }
 * @param {object} args.currentPlan  - the user's current plan (id + limits + price_*)
 * @param {object} [args.ctx]        - explicit context ({ kind, urls, format }); derived from route if missing
 * @param {string} [args.currency]   - "USD" | "INR" (default: USD)
 * @returns {object}  { title, body, ctaLabel, recommendedPlan, savingsLabel }
 */
export function buildPaywallCopy({ route, usage = {}, currentPlan, ctx, currency = "USD" }) {
  const context = ctx || ctxFromRoute(route, usage);
  const plan = pickRecommendedPlan(context);
  const cp = currentPlan || {};
  const isOver = (usage.extractions || 0) >= (cp.limits?.extractions || Infinity);

  // Annual price string
  const annualPrice = currency === "INR" ? plan?.price_inr_annual : plan?.price_usd_annual;
  const monthlyPrice = currency === "INR" ? plan?.price_inr : plan?.price_usd;
  const annualStr = currency === "INR" ? fmtInr(annualPrice) : fmtUsd(annualPrice);
  const monthlyStr = currency === "INR" ? fmtInr(monthlyPrice) : fmtUsd(monthlyPrice);

  // Headline + body
  let title, body, ctaLabel = "See plans";
  switch (context.kind) {
    case "batch": {
      const urls = context.urls || 0;
      const target = plan?.limits?.batch_max_urls;
      const targetLabel = target && target !== Infinity ? `${target}` : "Unlimited";
      title = isOver
        ? `You need ${urls} URLs in one batch`
        : `Batch mode maxes out at ${cp.limits?.batch_max_urls || 5} URLs`;
      body = `${plan.name} handles up to ${targetLabel} URLs per batch and ships with ${plan.limits?.extractions?.toLocaleString() || "more"} extractions/mo.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
      break;
    }
    case "export": {
      const fmt = (context.format || "json").toUpperCase();
      title = `${fmt} export unlocks on ${plan.name}`;
      body = `${plan.name} (${
        currency === "INR" ? fmtInr(plan.price_inr_annual) : fmtUsd(plan.price_usd_annual)
      }/mo annually) unlocks ${fmt} + all other export formats.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
      break;
    }
    case "schedule": {
      title = `Scheduled monitoring starts at ${plan.name}`;
      body = `Monitor a URL daily and get email alerts when content changes. Includes ${plan.limits?.extractions?.toLocaleString() || "more"} extractions/mo.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
      break;
    }
    case "api": {
      title = `API access is on ${plan.name} and above`;
      body = `Build apps on top of DatIQ with REST API keys, webhooks, and 1,000 extractions/mo included.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
      break;
    }
    default: {
      // Single-URL extraction cap, the most common case
      const over = (usage.extractions || 0) >= (cp.limits?.extractions || Infinity);
      const capLabel = cp.limits?.extractions || 10;
      title = over
        ? cp.id === "free"
          ? `You've used all ${capLabel} free extractions`
          : `You've used all ${capLabel} extractions this month`
        : `You're close to your monthly limit`;
      body = `${plan.name} gives you ${plan.limits?.extractions?.toLocaleString() || "more"} extractions/mo, JSON export, and CSV import — for ${annualStr}/mo, billed annually.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
    }
  }

  // Savings label: only show if there's a real annual discount.
  let savingsLabel = null;
  if (plan && annualPrice && monthlyPrice && monthlyPrice > annualPrice) {
    const pct = Math.round(((monthlyPrice - annualPrice) / monthlyPrice) * 100);
    if (pct >= 15) savingsLabel = `Save ${pct}% with annual billing`;
  }

  return {
    context,
    title,
    body,
    ctaLabel,
    savingsLabel,
    monthlyStr,
    annualStr,
    recommendedPlanId: plan?.id || null,
    recommendedPlanName: plan?.name || "Pro",
  };
}

function ctxFromRoute(route, usage) {
  if (!route) return { kind: "single" };
  if (route.startsWith("/batch")) return { kind: "batch", urls: usage.batchUrls || 0 };
  if (route.startsWith("/schedules")) return { kind: "schedule" };
  if (route.startsWith("/dashboard")) return { kind: "export", format: "json" }; // assume JSON intent
  if (route.startsWith("/preview")) return { kind: "single" };
  if (route.startsWith("/account")) return { kind: "single" };
  return { kind: "single" };
}
