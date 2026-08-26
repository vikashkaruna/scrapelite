// auditUrl.js — the canonical identity of an audited page.
//
// PURE. Builds on canonicalSourceUrl() from urlIdentity.js rather than
// re-implementing the protocol/host/trailing-slash rules, so the two cannot
// drift.
//
// ── WHY AUDITS NEED A STRICTER CANONICAL THAN EXTRACTIONS ──────────────────
// An extraction is a one-off: two slightly different URLs producing two rows is
// harmless. An audit's whole value is its HISTORY, and history only accumulates
// when the same page resolves to the same target every time. A campaign link
// with ?utm_source=newsletter is the same page as the bare URL, and letting it
// open a second target silently splits one trend line into two — each showing
// a single point, neither showing the improvement the user is looking for.

import { canonicalSourceUrl } from "../urlIdentity.js";

/**
 * Query parameters that identify a CAMPAIGN, not a page.
 *
 * Deliberately a strict list rather than a pattern. Stripping anything that
 * merely looks like tracking would eventually eat a real parameter — `?id=`,
 * `?ref=` on a docs site — and merge two genuinely different pages into one
 * history, which is a worse and much harder-to-notice failure than splitting.
 */
export const TRACKING_PARAMS = Object.freeze([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "ttclid",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "igshid", "vero_id", "yclid",
]);

/**
 * @param {string} value
 * @returns {string} the canonical URL, or "" when unparseable or non-HTTP
 */
export function canonicalAuditUrl(value) {
  const base = canonicalSourceUrl(value);
  if (!base) return "";
  try {
    const url = new URL(base);
    // A fragment addresses a position within a page, not a different page.
    url.hash = "";
    for (const p of TRACKING_PARAMS) url.searchParams.delete(p);
    // Sort what remains, so ?a=1&b=2 and ?b=2&a=1 are one target rather than two.
    url.searchParams.sort();
    // Drop a trailing "?" left behind once every param has been removed.
    let out = url.toString();
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
  } catch {
    return "";
  }
}

/** The bare host, www-stripped, for grouping and for robots lookups. */
export function auditHost(value) {
  try { return new URL(value).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

/** Do two URLs address the same audited page? */
export function sameAuditTarget(a, b) {
  const ca = canonicalAuditUrl(a);
  return Boolean(ca) && ca === canonicalAuditUrl(b);
}
