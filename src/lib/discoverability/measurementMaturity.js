// measurementMaturity.js — Measurement Maturity Auditor (MI) for SXO (Stage 3 / P3B).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE MEASUREMENT MATURITY AUDITOR (LOCKED — §0.1 / §11.8 / §11.9) ─────────
// Weight: 0.05 in SXO (0.05 * MI).
// Formula: 0.30 * event_instrumentation + 0.30 * funnel_tracking + 0.20 * form_analytics + 0.20 * experiment_readiness = 1.00
//
// ⚠️ STANDING RULE (§11.8):
// "At 0.05 it is the smallest SXO weight and the largest dependency; a low MI
// must CAVEAT THE FUNNEL, not just cost five points."

import { SXO_LAYERS, weightedMeanMap } from "./sxoModel.js";

export const MI_COMPONENT_WEIGHTS = SXO_LAYERS.mi.componentWeights;

/**
 * Evaluates the Measurement Maturity (MI) layer.
 *
 * @param {object} telemetryData
 * @param {boolean} [telemetryData.connected=false] - Whether an analytics integration is connected
 * @param {number} [telemetryData.trackedEventsCount=0] - Number of normalized events tracked
 * @param {number} [telemetryData.measuredFunnelStagesCount=0] - Number of funnel stages measured (0-9)
 * @param {boolean} [telemetryData.formTrackingActive=false] - Whether form diagnostics telemetry is firing
 * @param {boolean} [telemetryData.experimentsConfigured=false] - Whether optimization experiments/variants are tracked
 * @param {object} [options={}]
 * @returns {object} { score, coverage, maturity_level, components, caveats, findings }
 */
export function evaluateMeasurementMaturity(telemetryData = null, options = {}) {
  const isConnected = Boolean(telemetryData && (telemetryData.connected || telemetryData.active));

  if (!telemetryData || !isConnected) {
    return {
      score: null,
      coverage: 0,
      maturity_level: "unmeasured",
      components: {
        event_instrumentation: null,
        funnel_tracking: null,
        form_analytics: null,
        experiment_readiness: null,
      },
      caveats: [
        "No analytics integration connected. Visitor behavior, funnels, and conversion yield are unmeasured.",
        "Funnel drop-off figures cannot be verified without connected telemetry.",
      ],
      findings: [
        {
          code: "ANALYTICS_NOT_CONNECTED",
          title: "Connect analytics provider to measure visitor journey",
          severity: "high",
          detail: "Connect Google Analytics 4, PostHog, or Plausible to enable SXO journey tracking and conversion attribution.",
        },
      ],
    };
  }

  const eventsCount = Number(telemetryData.trackedEventsCount || telemetryData.eventsCount || 0);
  const funnelStagesCount = Number(telemetryData.measuredFunnelStagesCount || telemetryData.funnelStagesCount || 0);
  const formTracking = Boolean(telemetryData.formTrackingActive || telemetryData.formTrackingEnabled);
  const expActive = Boolean(telemetryData.experimentsConfigured || telemetryData.hasExperiments);

  // 1. Event instrumentation (30%): scales with normalized events tracked (max 24)
  let eventScore = 30;
  if (eventsCount >= 12) eventScore = 100;
  else if (eventsCount >= 6) eventScore = 80;
  else if (eventsCount >= 3) eventScore = 60;
  else if (eventsCount > 0) eventScore = 45;

  // 2. Funnel tracking (30%): scales with measured stages (max 9)
  let funnelScore = 25;
  if (funnelStagesCount >= 8) funnelScore = 100;
  else if (funnelStagesCount >= 5) funnelScore = 80;
  else if (funnelStagesCount >= 3) funnelScore = 60;
  else if (funnelStagesCount > 0) funnelScore = 40;

  // 3. Form analytics (20%)
  const formScore = formTracking ? 95 : 30;

  // 4. Experiment readiness (20%)
  const expScore = expActive ? 90 : 40;

  const rawComponents = {
    event_instrumentation: eventScore,
    funnel_tracking: funnelScore,
    form_analytics: formScore,
    experiment_readiness: expScore,
  };

  const { score, coverage } = weightedMeanMap(rawComponents, MI_COMPONENT_WEIGHTS);

  // Determine maturity level
  let maturityLevel = "minimal";
  if (score >= 85) maturityLevel = "advanced";
  else if (score >= 70) maturityLevel = "intermediate";
  else if (score >= 50) maturityLevel = "basic";

  const caveats = [];
  const findings = [];

  if (funnelStagesCount < 5) {
    caveats.push(`Only ${funnelStagesCount} of 9 journey stages are instrumented; unmeasured stages are excluded from leak detection.`);
    findings.push({
      code: "INCOMPLETE_FUNNEL_TELEMETRY",
      title: "Instrument key transition events in the conversion funnel",
      severity: "medium",
      detail: `Tracking only ${funnelStagesCount}/9 stages limits the ability to locate drop-off bottlenecks.`,
    });
  }

  if (!formTracking) {
    caveats.push("Form field interaction telemetry is absent; form abandonment cannot be pinpointed to specific fields.");
  }

  if (!expActive) {
    caveats.push("No experiment variants or A/B test telemetry linked; impact measurements are correlational rather than causal.");
  }

  return {
    score,
    coverage,
    maturity_level: maturityLevel,
    components: rawComponents,
    caveats,
    findings,
  };
}
