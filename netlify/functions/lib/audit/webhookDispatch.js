// webhookDispatch.js — deliver audit events to a user's registered endpoints.
//
// ── SIGNED, SO THE RECEIVER CAN TELL IT WAS US ─────────────────────────────
// Every delivery carries an HMAC of the raw body plus a timestamp, using the
// SAME `sign()` the n8n integration uses. An unsigned webhook is a URL anybody
// who learns it can post to, and the receiver has no way to tell a real audit
// result from a forged one.
//
// ── DELIVERY NEVER FAILS THE AUDIT ─────────────────────────────────────────
// Every function here swallows its own errors. A user's endpoint being down,
// slow or wrong is their problem to see in the delivery log, not a reason to
// fail an audit that already ran and was already charged for. The failure is
// recorded on the webhook row so it is visible rather than silent.

import { sign } from "../n8nSignature.js";
import { isPublicHttpUrlAsync } from "../publicUrl.js";
import { decryptSecret } from "../integrationSecrets.js";
import { webhooksForEvent, recordWebhookDelivery } from "./auditStore.js";

const DELIVERY_TIMEOUT_MS = 8_000;

/** Events a webhook may subscribe to. */
export const WEBHOOK_EVENTS = Object.freeze([
  "audit.completed",
  "audit.failed",
  "audit.regressed",
  "recommendation.created",
  // W8 — the recommendation lifecycle. A queue that can be driven by API but
  // whose movement nothing can subscribe to forces every integration to poll,
  // and a poller that runs every minute learns about a state change no faster
  // than one that runs every hour while costing sixty times as much.
  //
  // ⚠️ ONE EVENT PER STATE RATHER THAN A GENERIC `recommendation.updated`.
  // A subscriber that only cares about validation should not have to receive —
  // and filter — every assignment and every note edit to find it.
  "recommendation.accepted",
  "recommendation.assigned",
  "recommendation.in_progress",
  "recommendation.implemented",
  "recommendation.validation_scheduled",
  "recommendation.validated",
  "recommendation.no_measurable_change",
  "recommendation.regressed",
  "recommendation.dismissed",
  "recommendation.reopened",
]);

/**
 * The delivered payload.
 *
 * Deliberately a SUMMARY, not the full audit. A complete payload with every
 * signal, issue, recommendation and construct runs to hundreds of kilobytes,
 * which is hostile to a receiving endpoint and slow to sign. The `links` block
 * points at the full result for anything that wants it.
 */
export function buildWebhookPayload(eventType, { audit, result, diff, siteUrl }) {
  const base = siteUrl || process.env.URL || process.env.SITE_URL || "https://datiq.app";
  return {
    event: eventType,
    // Stamped by the caller so the value is the same one stored on the audit
    // rather than a second clock reading a few milliseconds later.
    audit_id: audit?.id || result?.auditId || null,
    target_url: audit?.target_url || result?.target?.url || null,
    scores: result ? {
      overall: result.finalScore, seo: result.seoScore,
      aeo: result.aeoScore, geo: result.geoScore, coverage: result.coverage,
    } : null,
    issue_counts: result ? {
      total: (result.issues || []).length,
      critical: (result.issues || []).filter((i) => i.severity === "critical").length,
    } : null,
    top_recommendations: (result?.recommendations || []).slice(0, 3).map((r) => ({
      code: r.code, title: r.title, priority: r.priority, owner: r.owner,
    })),
    change: diff ? {
      headline: diff.headline,
      overall: diff.frameworks?.overall ?? null,
      resolved: diff.issues?.resolvedCount ?? 0,
      introduced: diff.issues?.introducedCount ?? 0,
    } : null,
    links: {
      results: `${base}/api/discoverability/audits/${audit?.id || ""}/results`,
      report: `${base}/api/discoverability/audits/${audit?.id || ""}/report`,
      app: `${base}/discoverability?audit=${audit?.id || ""}`,
    },
  };
}

async function deliverOne(webhook, rawBody, fetchImpl = fetch) {
  // Re-check the destination at DELIVERY time, not only at registration.
  // A hostname that resolved publicly last month can be re-pointed at a private
  // address; without this, a registered webhook becomes a standing SSRF primitive.
  if (!(await isPublicHttpUrlAsync(webhook.target_url))) {
    return { ok: false, status: 0, error: "destination is not a public address" };
  }

  let secret = null;
  try { secret = decryptSecret(webhook.secret_encrypted); } catch { secret = null; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "DatIQ-Webhook/1.0",
      "X-DatIQ-Event": "discoverability",
    };
    if (secret) headers["X-DatIQ-Signature"] = sign(secret, rawBody);

    const res = await fetchImpl(webhook.target_url, {
      method: "POST", headers, body: rawBody, signal: ctrl.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timer);
    return {
      ok: false, status: 0,
      error: err?.name === "AbortError" ? "timed out" : (err?.message || "delivery failed"),
    };
  }
}

/**
 * Fan out one event to every subscribed webhook.
 *
 * @returns {Promise<{delivered, failed, results}>} always resolves
 */
export async function dispatchAuditEvent(userId, eventType, context, opts = {}) {
  if (!userId || !WEBHOOK_EVENTS.includes(eventType)) {
    return { delivered: 0, failed: 0, results: [] };
  }

  let hooks = [];
  try { hooks = await webhooksForEvent(userId, eventType); } catch { hooks = []; }
  // Array.isArray, not just a length check. A degraded PostgREST read returns
  // no rows rather than an empty array, and `undefined.length` here would throw
  // INSIDE audit completion — failing an audit that already ran and was already
  // charged for, because nobody could be told about it.
  if (!Array.isArray(hooks) || hooks.length === 0) return { delivered: 0, failed: 0, results: [] };

  const payload = buildWebhookPayload(eventType, context);
  // Signed over the EXACT bytes sent. Re-serialising before signing is how a
  // signature comes to cover a different string from the one delivered.
  const rawBody = JSON.stringify(payload);

  const results = await Promise.all(
    hooks.map(async (w) => {
      const r = await deliverOne(w, rawBody, opts.fetchImpl);
      try { await recordWebhookDelivery(w.id, r.status); } catch { /* logging is best-effort */ }
      return { id: w.id, url: w.target_url, ...r };
    }),
  );

  return {
    delivered: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
