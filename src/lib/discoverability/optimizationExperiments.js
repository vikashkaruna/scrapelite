// optimizationExperiments.js — Optimization experiments & change records (Stage 4 / P3C).
//
// PURE. Imported by React components and Netlify functions.
//
// ── OPTIMIZATION EXPERIMENTS (LOCKED — §10 / §11.12) ────────────────────────
// Records change records, PRs, Jira tickets, and A/B test observation windows.
//
// ⚠️ CRITICAL GOVERNANCE RULES:
// 1. 🔴 RECORDS, NEVER DEPLOYS (§10 / §11.12).
//    DatIQ observes and measures; it never deploys changes autonomously.
// 2. 🔴 CORRELATION STAYS LABELLED AS CORRELATION (§11.12).
//    Every experiment record carries relationship: "correlation" and explicit
//    seasonality/external attribution caveats.

import { round1 } from "./scoringModel.js";

export const EXPERIMENT_STATUSES = Object.freeze(["draft", "active", "completed", "cancelled"]);

export const CORRELATION_CAVEAT =
  "Observed metric movement between baseline and observation periods is correlational. External factors including search engine algorithm updates, seasonal traffic fluctuations, and unmeasured marketing campaigns contribute to real-world outcomes. Correlation does not establish causation.";

/**
 * Creates and validates an optimization experiment record.
 *
 * @param {object} input
 * @returns {object} Standardized experiment record
 */
export function createExperimentRecord(input = {}) {
  const name = String(
    input.experiment_name || input.experimentName || input.name || ""
  ).trim();
  if (!name) throw new Error("`experiment_name` is required.");

  const expectedMetric = String(
    input.expected_metric || input.expectedMetric || input.metric || "sxo_total_score"
  ).trim();
  const status = EXPERIMENT_STATUSES.includes(input.status) ? input.status : "active";
  const observationDays = Number(
    input.observation_period_days || input.observationPeriodDays || 28
  );
  const baselineValue = input.baseline_value !== undefined && input.baseline_value !== null
    ? Number(input.baseline_value)
    : (input.baselineValue !== undefined && input.baselineValue !== null ? Number(input.baselineValue) : null);

  return {
    experiment_name: name,
    ticket_url: input.ticket_url || input.ticketUrl || null,
    release_tag: input.release_tag || input.releaseTag || null,
    hypothesis: input.hypothesis || null,
    expected_metric: expectedMetric,
    baseline_value: baselineValue,
    current_value: input.current_value !== undefined && input.current_value !== null
      ? Number(input.current_value)
      : (input.currentValue !== undefined && input.currentValue !== null ? Number(input.currentValue) : null),
    status,
    observation_period_days: observationDays,
    start_date: input.start_date || input.startDate || new Date().toISOString(),
    completion_date: input.completion_date || input.completionDate || null,
    audit_id: input.audit_id || input.auditId || null,
    recommendation_id: input.recommendation_id || input.recommendationId || null,
    relationship: "correlation",
    caveat: CORRELATION_CAVEAT,
    caveats: [CORRELATION_CAVEAT],
    results: input.results || {},
  };
}

/**
 * Evaluates the results of an experiment given baseline and current values.
 *
 * @param {object} experiment - The experiment definition
 * @param {number|object} baseline - Baseline metric value or baseline audit
 * @param {number|object} current - Current metric value or current audit
 * @returns {object} Evaluated result with delta and correlation notice
 */
export function evaluateExperimentImpact(arg1 = {}, arg2 = null, arg3 = null) {
  let experiment = arg1;
  let baseline = arg2;
  let current = arg3;

  if (arg1 && (arg1.baselineAudit || arg1.baseline_audit || arg1.baseline !== undefined || arg1.targetMetric || arg1.target_metric)) {
    experiment = {
      experiment_name: arg1.experimentName || arg1.experiment_name || arg1.name || "experiment",
      expected_metric: arg1.targetMetric || arg1.target_metric || arg1.expectedMetric || arg1.expected_metric || "sxo_total_score",
    };
    baseline = arg1.baselineAudit ?? arg1.baseline_audit ?? arg1.baseline ?? null;
    current = arg1.currentAudit ?? arg1.current_audit ?? arg1.current ?? null;
  }

  let bVal = typeof baseline === "number" ? baseline : (experiment.baseline_value ?? null);
  let cVal = typeof current === "number" ? current : (experiment.current_value ?? null);

  // If audits are passed instead of raw numbers, extract the expected metric
  const metric = experiment.expected_metric || "sxo_total_score";
  if (typeof baseline === "object" && baseline !== null) {
    bVal = baseline[metric] ?? baseline.result?.[metric] ?? baseline.master_score ?? baseline.final_score ?? baseline.result?.final_score ?? null;
  }
  if (typeof current === "object" && current !== null) {
    cVal = current[metric] ?? current.result?.[metric] ?? current.master_score ?? current.final_score ?? current.result?.final_score ?? null;
  }

  let delta = null;
  let percentChange = null;

  if (bVal !== null && cVal !== null && Number.isFinite(bVal) && Number.isFinite(cVal)) {
    delta = round1(cVal - bVal);
    if (bVal > 0) {
      percentChange = round1((delta / bVal) * 100);
    }
  }

  return {
    experiment_name: experiment.experiment_name,
    expected_metric: metric,
    baseline_value: bVal,
    current_value: cVal,
    delta,
    percent_change: percentChange,
    relationship: "correlation",
    caveat: CORRELATION_CAVEAT,
    status: experiment.status || "active",
    completed: experiment.status === "completed",
  };
}
