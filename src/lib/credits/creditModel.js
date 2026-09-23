// src/lib/credits/creditModel.js — estimate vs. actual, and what may be charged.
//
// PURE. Imported by both React (to show the estimate before a run) and the
// Netlify functions (to record the actual after it), so the number the user
// agreed to and the number they are billed are computed by the same code.
//
// ── THE RULE THIS MODULE EXISTS TO ENFORCE ──────────────────────────────────
// Never charge for a refused request. extract.js already orders its gates
// SSRF -> entitlement -> compliance -> guest charge -> rate limiter precisely
// so that everything able to decline sits ABOVE the charge. This module
// inherits that: chargeableEvents() drops anything that did no billable work,
// so a run refused at a gate, served from cache, or skipped by the unchanged-
// content pre-filter (§1.4) produces an EMPTY ledger write, not a zero one.
//
// ── WHY DRIFT IS TRACKED RATHER THAN HIDDEN ─────────────────────────────────
// A template whose estimate is routinely half its actual is mispriced, and the
// only way anyone finds out is if both numbers survive independently and get
// compared. reconcile() is that comparison, and it names the direction:
// an OVERRUN is a trust problem (we charged more than we quoted), an
// UNDERRUN is a pricing problem (we are leaving money on the table).

/** Mirrors credit_ledger.reason in 0037. Keep in sync with the CHECK. */
export const LEDGER_REASONS = Object.freeze([
  "page_fetch", "ai_call", "enrichment", "audit", "monitor_check",
  "template_run", "refund", "grant", "adjustment",
  // 0082 — a message sent by the Prospect Engagement Engine.
  "outreach",
]);

/** Mirrors credit_ledger.unit in 0037. */
export const LEDGER_UNITS = Object.freeze([
  "page", "ai_call", "enrichment", "audit", "monitor_check", "run",
  "message",
]);

/** Map an estimate breakdown unit onto the ledger reason it will be charged as. */
export const UNIT_TO_REASON = Object.freeze({
  run: "template_run",
  page: "page_fetch",
  ai_call: "ai_call",
  enrichment: "enrichment",
  audit: "audit",
  monitor_check: "monitor_check",
});

/**
 * An overrun beyond this fraction of the estimate is flagged. It is not a hard
 * stop — stopping a half-finished run mid-flight would charge for work the user
 * cannot use — it is a signal that the template's cost model needs revisiting.
 */
export const OVERRUN_TOLERANCE = 0.25;

/**
 * Filter raw run events down to the ones that may be billed.
 *
 * An event is chargeable only if it did work a provider actually charged us
 * for. Explicitly NOT chargeable:
 *   - cached:true    the result came from resultCache; no fetch happened
 *   - skipped:true   the §1.4 content-hash pre-filter matched; nothing was read
 *   - failed:true    a provider error. The user gets no value; we eat the cost.
 *   - credits <= 0   nothing to charge
 */
export function chargeableEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => {
    if (!e || typeof e !== "object") return false;
    if (e.cached || e.skipped || e.failed) return false;
    if (!LEDGER_UNITS.includes(e.unit)) return false;
    return Number(e.credits) > 0;
  });
}

/**
 * Collapse chargeable events into one ledger row per (reason, unit) — so a
 * 40-domain run writes ~3 rows, not 120. The ledger stays a legible audit
 * trail rather than a firehose.
 */
export function toLedgerEntries(events, { runId = null, userId = null, workspaceId = null } = {}) {
  const byKey = new Map();
  for (const e of chargeableEvents(events)) {
    const reason = UNIT_TO_REASON[e.unit] || "adjustment";
    const key = `${reason}::${e.unit}`;
    const prev = byKey.get(key) || { reason, unit: e.unit, credits: 0, quantity: 0 };
    prev.credits += Number(e.credits);
    prev.quantity += Number(e.quantity ?? 1);
    byKey.set(key, prev);
  }
  return [...byKey.values()].map((row) => ({
    ...row,
    run_id: runId,
    user_id: userId,
    workspace_id: workspaceId,
  }));
}

/** Total credits a set of events will actually cost. */
export function actualCredits(events) {
  return chargeableEvents(events).reduce((sum, e) => sum + Number(e.credits), 0);
}

/**
 * Compare what we quoted against what we spent.
 * Returns the delta plus a verdict a human can act on.
 */
export function reconcile(estimatedCredits, events) {
  const estimated = Number(estimatedCredits) || 0;
  const actual = actualCredits(events);
  const delta = actual - estimated;
  const ratio = estimated > 0 ? delta / estimated : (actual > 0 ? Infinity : 0);

  let verdict = "on_estimate";
  if (ratio > OVERRUN_TOLERANCE) verdict = "overrun";
  else if (ratio < -OVERRUN_TOLERANCE) verdict = "underrun";

  return {
    estimated,
    actual,
    delta,
    ratio: Number.isFinite(ratio) ? Math.round(ratio * 1000) / 1000 : ratio,
    verdict,
    // An overrun is the one the USER is owed an explanation for.
    needsDisclosure: verdict === "overrun",
  };
}

/**
 * Would this run take the user past their monthly allowance?
 * `spent` comes from credit_balance() — derived from the ledger, never a
 * stored counter (§1.8). `allowance` is Infinity on unlimited plans.
 */
export function checkAllowance({ spent = 0, allowance = Infinity, estimated = 0 }) {
  if (!Number.isFinite(allowance)) {
    return { ok: true, remaining: Infinity, wouldExceedBy: 0 };
  }
  const remaining = Math.max(0, allowance - spent);
  const wouldExceedBy = Math.max(0, estimated - remaining);
  return {
    ok: wouldExceedBy === 0,
    remaining,
    wouldExceedBy,
    // How many units of this run WOULD fit — so the UI can offer "run the
    // first 20 of your 50 domains" instead of a flat refusal.
    partialPossible: remaining > 0 && wouldExceedBy > 0,
  };
}

/** Human-readable one-liner for the pre-run confirmation. */
export function describeEstimate(estimate) {
  if (!estimate || !Array.isArray(estimate.breakdown) || estimate.breakdown.length === 0) {
    return "No credits will be used.";
  }
  const parts = estimate.breakdown.map((b) => `${b.quantity} × ${b.label || b.unit}`);
  const unit = estimate.credits === 1 ? "credit" : "credits";
  return `${estimate.credits} ${unit} — ${parts.join(", ")}`;
}
