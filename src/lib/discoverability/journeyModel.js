// journeyModel.js — 9 Funnel Stages & Journey Analysis (Stage 3 / P3B).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 9 FUNNEL STAGES (LOCKED — §5 / §11.9) ──────────────────────────────
// 1. search_impression    (search/AI exposure)
// 2. landing_session      (landing session)
// 3. engaged_session      (engaged session)
// 4. key_content_seen     (key content seen)
// 5. primary_cta_view     (primary CTA view)
// 6. primary_cta_click    (primary CTA click)
// 7. action_start         (form/cart/booking start)
// 8. conversion_complete  (conversion complete)
// 9. qualified_outcome    (qualified lead / revenue / successful outcome)
//
// ⚠️ STANDING GOVERNANCE RULE (§11.9):
// "A stage with no instrumentation is EXCLUDED AND NAMED; a funnel that treats
// missing instrumentation as a drop-off invents a leak the customer does not have."

export const FUNNEL_STAGES = Object.freeze([
  {
    key: "search_impression",
    label: "Search & AI Exposure",
    order: 1,
    description: "Search engine impressions or AI answer citations that exposed the brand/page to the audience.",
    relevantEvents: ["page_view"], // or search console impression metrics
  },
  {
    key: "landing_session",
    label: "Landing Session",
    order: 2,
    description: "Visitors arriving and initializing a session on the target page.",
    relevantEvents: ["page_view"],
  },
  {
    key: "engaged_session",
    label: "Engaged Session",
    order: 3,
    description: "Visitors scrolling past 50% or spending meaningful dwell time engaging with the content.",
    relevantEvents: ["scroll_50", "scroll_75", "scroll_90"],
  },
  {
    key: "key_content_seen",
    label: "Key Content Seen",
    order: 4,
    description: "Visitors viewing core value proposition, pricing, or product details.",
    relevantEvents: ["pricing_view", "form_view"],
  },
  {
    key: "primary_cta_view",
    label: "Primary CTA View",
    order: 5,
    description: "Visitors whose viewport scrolled to bring the primary conversion CTA into view.",
    relevantEvents: ["primary_cta_view"],
  },
  {
    key: "primary_cta_click",
    label: "Primary CTA Click",
    order: 6,
    description: "Visitors who clicked the primary CTA to initiate the conversion journey.",
    relevantEvents: ["primary_cta_click"],
  },
  {
    key: "action_start",
    label: "Action Start",
    order: 7,
    description: "Visitors who focused a form field, started a booking, or added to cart.",
    relevantEvents: ["form_start", "booking_start", "add_to_cart", "checkout_start", "chat_start"],
  },
  {
    key: "conversion_complete",
    label: "Conversion Complete",
    order: 8,
    description: "Visitors who successfully submitted a form, finished booking, or completed purchase.",
    relevantEvents: ["form_submit", "booking_complete", "purchase_complete", "conversion_complete", "phone_click", "whatsapp_click"],
  },
  {
    key: "qualified_outcome",
    label: "Qualified Outcome",
    order: 9,
    description: "Downstream verified qualified lead, pipeline opportunity, or retained customer outcome.",
    relevantEvents: ["qualified_conversion"],
  },
]);

export const FUNNEL_STAGE_KEYS = Object.freeze(FUNNEL_STAGES.map((s) => s.key));

/**
 * Calculates a funnel from a set of stage inputs or aggregated event counts.
 *
 * ⚠️ Missing telemetry produces `measured: false` and `unmeasured_reason`.
 * Drop-offs are ONLY computed between consecutive MEASURED stages.
 *
 * @param {object} rawStageInputs - Map of stageKey -> count (number), or { count, measured, reason }
 * @param {object} [options={}] - Options (e.g. name, attributionWindow)
 * @returns {object} Funnel evaluation result
 */
export function calculateJourneyFunnel(rawStageInputs = {}, options = {}) {
  const stages = [];
  let previousMeasuredStage = null;
  let firstMeasuredStage = null;
  let lastMeasuredStage = null;
  const caveats = [];

  for (const def of FUNNEL_STAGES) {
    const rawVal = rawStageInputs[def.key];
    let isMeasured = false;
    let count = null;
    let unmeasuredReason = null;

    if (rawVal !== undefined && rawVal !== null) {
      if (typeof rawVal === "number") {
        isMeasured = true;
        count = Math.max(0, Math.round(rawVal));
      } else if (typeof rawVal === "object") {
        if (rawVal.measured === false) {
          isMeasured = false;
          unmeasuredReason = rawVal.reason || "Telemetry not instrumented for this stage.";
        } else if (typeof rawVal.count === "number") {
          isMeasured = true;
          count = Math.max(0, Math.round(rawVal.count));
        } else {
          isMeasured = false;
          unmeasuredReason = rawVal.reason || "No valid count provided for stage.";
        }
      }
    } else {
      isMeasured = false;
      unmeasuredReason = "No telemetry instrumented for this stage.";
    }

    let conversionRateFromPrevious = null;
    let dropOffRateFromPrevious = null;

    if (isMeasured) {
      if (!firstMeasuredStage) {
        firstMeasuredStage = { key: def.key, count };
      }
      lastMeasuredStage = { key: def.key, count };

      if (previousMeasuredStage && previousMeasuredStage.count > 0) {
        const rate = (count / previousMeasuredStage.count) * 100;
        conversionRateFromPrevious = Math.min(100, Math.round(rate * 10) / 10);
        dropOffRateFromPrevious = Math.max(0, Math.round((100 - conversionRateFromPrevious) * 10) / 10);
      } else if (previousMeasuredStage && previousMeasuredStage.count === 0) {
        conversionRateFromPrevious = 0;
        dropOffRateFromPrevious = 0;
      }

      previousMeasuredStage = { key: def.key, count };
    } else {
      caveats.push(`Stage '${def.label}' (${def.key}) is unmeasured; excluded from drop-off calculations.`);
    }

    stages.push({
      key: def.key,
      label: def.label,
      order: def.order,
      description: def.description,
      measured: isMeasured,
      status: isMeasured ? "measured" : "unmeasured",
      count,
      unmeasured_reason: unmeasuredReason,
      conversion_rate_from_previous_measured: conversionRateFromPrevious,
      drop_off_rate_from_previous_measured: dropOffRateFromPrevious,
      compared_against_stage: isMeasured && previousMeasuredStage && previousMeasuredStage.key !== def.key
        ? previousMeasuredStage.key
        : null,
    });
  }

  const measuredCount = stages.filter((s) => s.measured).length;
  const coveragePercent = Math.round((measuredCount / FUNNEL_STAGES.length) * 100);

  let overallConversionRate = null;
  if (firstMeasuredStage && lastMeasuredStage && firstMeasuredStage.key !== lastMeasuredStage.key) {
    if (firstMeasuredStage.count > 0) {
      overallConversionRate = Math.round((lastMeasuredStage.count / firstMeasuredStage.count) * 1000) / 10;
    } else {
      overallConversionRate = 0;
    }
  }

  return {
    funnel_name: options.name || "standard_9_stage",
    stages,
    total_stages: FUNNEL_STAGES.length,
    measured_stages_count: measuredCount,
    coverage_percent: coveragePercent,
    overall_conversion_rate: overallConversionRate,
    first_measured_stage: firstMeasuredStage ? firstMeasuredStage.key : null,
    last_measured_stage: lastMeasuredStage ? lastMeasuredStage.key : null,
    caveats,
  };
}
