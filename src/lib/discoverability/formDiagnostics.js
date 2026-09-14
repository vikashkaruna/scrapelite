// formDiagnostics.js — 9 Per-Form Metrics & Form Friction Diagnostics (Stage 3 / P3B).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 9 PER-FORM METRICS (LOCKED — §5 / §11.9) ───────────────────────────
// 1. views                 (impression count)
// 2. starts                (interaction starts)
// 3. submits               (successful submissions)
// 4. completion_rate       (submits / starts)
// 5. abandonment_rate      ((starts - submits) / starts)
// 6. field_errors          (validation errors)
// 7. completion_time_sec   (average completion time in seconds)
// 8. device_split          (desktop vs mobile vs tablet breakdown)
// 9. last_field_touched    (last field touched before abandonment)

export const FORM_METRIC_KEYS = Object.freeze([
  "views",
  "starts",
  "submits",
  "completion_rate",
  "abandonment_rate",
  "field_errors",
  "completion_time_sec",
  "device_split",
  "last_field_touched",
]);

/**
 * Analyzes form performance metrics and flags key friction bottlenecks.
 *
 * @param {object} rawFormData
 * @param {number} rawFormData.views
 * @param {number} rawFormData.starts
 * @param {number} rawFormData.submits
 * @param {number} [rawFormData.fieldErrors=0]
 * @param {number} [rawFormData.completionTimeSec=null]
 * @param {object} [rawFormData.deviceSplit={}]
 * @param {object} [rawFormData.lastFieldTouched={}]
 * @param {object} [options={}]
 * @returns {object} Diagnostic result containing all 9 metrics, friction flags, and recommendations
 */
export function evaluateFormDiagnostics(rawFormData = {}, options = {}) {
  const views = Math.max(0, Number(rawFormData.views || 0));
  const starts = Math.max(0, Number(rawFormData.starts || 0));
  const submits = Math.max(0, Number(rawFormData.submits || 0));
  const fieldErrors = Math.max(0, Number(rawFormData.fieldErrors ?? rawFormData.field_errors ?? 0));
  const completionTimeSec = rawFormData.completionTimeSec ?? rawFormData.completion_time_sec ?? null;

  const rawDevice = rawFormData.deviceSplit || rawFormData.device_split || {};
  const deviceSplit = {
    desktop: Number(rawDevice.desktop || 0),
    mobile: Number(rawDevice.mobile || 0),
    tablet: Number(rawDevice.tablet || 0),
  };

  const lastFieldTouched = rawFormData.lastFieldTouched || rawFormData.last_field_touched || {};

  // Compute rates
  let completionRate = null;
  let abandonmentRate = null;
  if (starts > 0) {
    const rawComp = (submits / starts) * 100;
    completionRate = Math.min(100, Math.round(rawComp * 10) / 10);
    abandonmentRate = Math.max(0, Math.round((100 - completionRate) * 10) / 10);
  }

  const metrics = {
    views,
    starts,
    submits,
    completion_rate: completionRate,
    abandonment_rate: abandonmentRate,
    field_errors: fieldErrors,
    completion_time_sec: completionTimeSec !== null ? Math.round(Number(completionTimeSec) * 10) / 10 : null,
    device_split: deviceSplit,
    last_field_touched: lastFieldTouched,
  };

  const frictionFlags = [];
  const recommendations = [];

  // Flag: High abandonment
  if (abandonmentRate !== null && abandonmentRate > 60) {
    frictionFlags.push("HIGH_ABANDONMENT_RATE");
    recommendations.push({
      code: "REDUCE_FORM_LENGTH",
      title: "Reduce form fields to decrease visitor drop-off",
      impact: "high",
      detail: `Form abandonment is ${abandonmentRate}%. Consider removing non-critical fields or splitting into a 2-step progressive flow.`,
    });
  }

  // Flag: High validation errors
  if (starts > 0 && fieldErrors / starts > 0.4) {
    frictionFlags.push("HIGH_VALIDATION_ERRORS");
    recommendations.push({
      code: "INLINE_FIELD_VALIDATION",
      title: "Add real-time inline validation feedback",
      impact: "medium",
      detail: `Average ${Math.round((fieldErrors / starts) * 10) / 10} errors encountered per start. Provide clear formatting hints and inline validation before submit.`,
    });
  }

  // Flag: Slow completion time (> 120s)
  if (completionTimeSec !== null && completionTimeSec > 120) {
    frictionFlags.push("SLOW_COMPLETION_TIME");
    recommendations.push({
      code: "SIMPLIFY_FIELD_INPUTS",
      title: "Streamline field inputs and enable autofill",
      impact: "medium",
      detail: `Average completion time is ${completionTimeSec}s. Enable browser autofill and simplify selector inputs.`,
    });
  }

  // Flag: Bottleneck fields in lastFieldTouched
  const fieldDrops = Object.entries(lastFieldTouched).sort((a, b) => b[1] - a[1]);
  if (fieldDrops.length > 0 && fieldDrops[0][1] > 0) {
    const [topField, count] = fieldDrops[0];
    frictionFlags.push("FIELD_DROPOFF_BOTTLENECK");
    recommendations.push({
      code: "REEXAMINE_BOTTLENECK_FIELD",
      title: `Evaluate necessity of field '${topField}'`,
      impact: "high",
      detail: `'${topField}' is the most frequent exit point before form submission (${count} exits). Consider making it optional or moving downstream.`,
    });
  }

  return {
    form_id: options.formId || rawFormData.form_id || "default_form",
    page_url: options.pageUrl || rawFormData.page_url || "/",
    metrics,
    friction_flags: frictionFlags,
    recommendations,
  };
}
