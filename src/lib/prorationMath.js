// prorationMath.js — credit for unused time when a user changes plan mid-cycle.
//
// Pure, no I/O, clock injected.
//
// ── THE RULE THAT MATTERS ────────────────────────────────────────────────────
// The credit is computed from what the user ACTUALLY PAID for the current
// period — `invoices.taxable_minor` of the invoice that opened it — not from
// the plan's list price. A customer who used a 20% coupon paid 20% less, and
// crediting them list price would refund money they never handed over. Where no
// such invoice exists (a legacy row, an admin comp, a migrated subscription)
// the credit is zero and the line is simply omitted, which is honest: we cannot
// evidence what was paid, so we do not invent it.
//
// The credit reduces the TAXABLE VALUE of the new supply, before GST. That is
// the correct treatment for a reduction known at the time of supply; a
// reduction discovered afterwards would require a credit note instead.

/** Plan ranking, for deciding upgrade vs downgrade. Mirrors plan_rank() in SQL. */
const RANK = { agency: 6, business: 5, developer: 4, pro: 4, select: 3, go: 2, free: 1 };

export function planRank(planId) {
  return RANK[String(planId || "free").toLowerCase()] ?? 0;
}

export function isUpgrade(fromPlanId, toPlanId) {
  return planRank(toPlanId) > planRank(fromPlanId);
}

export function isDowngrade(fromPlanId, toPlanId) {
  return planRank(toPlanId) < planRank(fromPlanId);
}

function toMs(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Credit for the unused remainder of the current period, in minor units.
 *
 * @param {object} a
 * @param {number} a.paidTaxableMinor  taxable value of the invoice that opened the period
 * @param {string|Date} a.periodStart
 * @param {string|Date} a.periodEnd
 * @param {Date} [a.now]
 * @returns {number} integer minor units, 0 ≤ credit ≤ paidTaxableMinor
 */
export function prorate({ paidTaxableMinor, periodStart, periodEnd, now = new Date() }) {
  const paid = Math.max(0, Math.round(Number(paidTaxableMinor) || 0));
  const start = toMs(periodStart);
  const end = toMs(periodEnd);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);

  if (!paid || start == null || end == null) return 0;

  const total = end - start;
  if (total <= 0) return 0;

  // Already expired → nothing unused. Never negative.
  const unused = Math.max(0, end - nowMs);
  if (unused === 0) return 0;

  // Cannot credit more than was paid (guards a clock skew that puts `now`
  // before the period even started).
  return Math.min(paid, Math.round((paid * unused) / total));
}

/**
 * Describe a plan change so the UI can explain it before the user commits.
 *
 * Requirement 12: a downgrade must warn clearly about what is lost, but must
 * NEVER be blocked. `losses` is derived from the two plans' limits rather than
 * hand-written copy, so it cannot drift when a plan's limits change.
 *
 * @returns {{direction, losses: string[], gains: string[], effective: 'now'|'period_end'}}
 */
export function describePlanChange(fromPlan, toPlan) {
  const from = fromPlan?.limits ?? {};
  const to = toPlan?.limits ?? {};
  const losses = [];
  const gains = [];

  const num = (label, key, fmt = (v) => v) => {
    const a = from[key];
    const b = to[key];
    if (a == null || b == null || a === b) return;
    const aInf = a === Infinity;
    const bInf = b === Infinity;
    if (bInf) { gains.push(`${label}: unlimited`); return; }
    if (aInf) { losses.push(`${label} drops from unlimited to ${fmt(b)}`); return; }
    if (b < a) losses.push(`${label} drops from ${fmt(a)} to ${fmt(b)}`);
    else gains.push(`${label} rises to ${fmt(b)}`);
  };

  num("Extractions per month", "extractions", (v) => v.toLocaleString());
  num("URLs per batch", "batch_max_urls", (v) => v.toLocaleString());
  num("Scheduled monitors", "scheduled_monitoring");
  num("Team seats", "team_seats");
  num("Workspaces", "workspaces");

  const lostFormats = (from.exports || []).filter((f) => !(to.exports || []).includes(f));
  if (lostFormats.length) losses.push(`${lostFormats.map((f) => f.toUpperCase()).join(", ")} export`);
  const gainedFormats = (to.exports || []).filter((f) => !(from.exports || []).includes(f));
  if (gainedFormats.length) gains.push(`${gainedFormats.map((f) => f.toUpperCase()).join(", ")} export`);

  const flags = [
    ["email_export", "Email export"],
    ["api_access", "API access"],
    ["white_label_pdf", "White-label PDF"],
    ["priority_support", "Priority support"],
    ["integrations", "Push integrations (HubSpot, Notion, Airtable, Slack)"],
    ["browser_extension", "Browser extension"],
  ];
  for (const [key, label] of flags) {
    if (from[key] && !to[key]) losses.push(label);
    if (!from[key] && to[key]) gains.push(label);
  }

  const direction = isDowngrade(fromPlan?.id, toPlan?.id)
    ? "downgrade"
    : isUpgrade(fromPlan?.id, toPlan?.id)
      ? "upgrade"
      : "same";

  return {
    direction,
    losses,
    gains,
    // Upgrades take effect immediately (prorated); downgrades wait for the end
    // of the period the customer has already paid for.
    effective: direction === "downgrade" ? "period_end" : "now",
  };
}
