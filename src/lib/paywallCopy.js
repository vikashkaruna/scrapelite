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
  let planId = "pro"; // default: Pro unlocks 10,000 credits/mo, integrations and signal routing
  if (ctx.kind === "batch") {
    const urls = ctx.urls || 0;
    if (urls > 250) planId = "agency";      // Agency = up to 500 URLs/run
    else if (urls > 100) planId = "business"; // Business = up to 250 URLs/run
    else if (urls > 50) planId = "pro";     // Pro = up to 100 URLs/run
    else if (urls > 20) planId = "select";  // Select = up to 50 URLs/run
    else if (urls > 5) planId = "go";       // Go = up to 20 URLs/run
  } else if (ctx.kind === "export") {
    if (ctx.format === "json") planId = "go";       // JSON export = Go+
    else if (ctx.format === "pdf" || ctx.format === "markdown") planId = "go"; // PDF/MD = Go+
    else planId = "go";
  } else if (ctx.kind === "schedule") {
    planId = "select"; // More monitor slots: Free 1, Go 2, Select 5
  } else if (ctx.kind === "integrations") {
    planId = "select"; // Push integrations first appear on Select (Free/Go are excluded)
  } else if (ctx.kind === "api") {
    planId = "business"; // API access = Business+
  } else if (ctx.kind === "batch_runs") {
    // A guest out of free batch runs needs an ACCOUNT, not an upgrade — the
    // free plan already includes batch. Recommending a paid tier here would
    // sell past the thing that actually unblocks them.
    planId = "free";
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
    // Distinct from "batch" above. That one is "this batch is too BIG for your
    // plan" (a batch_max_urls cap). This one is "you've used all your free
    // batch RUNS" — a count of runs, nothing to do with size. They shared a
    // kind, so exhausting your run allowance produced "You need 20 URLs in one
    // batch": a limit the user never hit, quoting a number derived from
    // guest_batch_hard_limit x 4 that meant nothing to them.
    case "batch_runs": {
      const used = context.used || 0;
      title = `You've used all ${used} free batch run${used !== 1 ? "s" : ""}`;
      body = `Create a free account for ${cp.limits?.extractions || 10} extractions a month, `
           + `saved to your dashboard instead of just this browser.`;
      ctaLabel = "Create a free account";
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
      title = `More scheduled monitors on ${plan.name}`;
      body = `${plan.limits?.scheduled_monitoring ?? "More"} scheduled monitors — check a URL daily and get an email alert when content changes. Includes ${plan.limits?.credits?.toLocaleString() || "more"} credits/mo.`;
      ctaLabel = `Upgrade to ${plan.name} — ${annualStr}/mo, billed annually`;
      break;
    }
    case "api": {
      title = `API access is on ${plan.name} and above`;
      body = `Build apps on top of DatIQ with REST API keys and webhooks, with ${plan.limits?.credits?.toLocaleString() || "more"} credits/mo included.`;
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
      body = `${plan.name} gives you ${plan.limits?.credits?.toLocaleString() || "more"} credits/mo, CSV import and ${plan.limits?.scheduled_monitoring ?? "more"} scheduled monitors — for ${annualStr}/mo, billed annually.`;
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
