// netlify/functions/lib/zapierEmitter.js
//
// Fire-and-forget event emitter for the Zapier integration. Anywhere in
// the codebase that produces a side effect users care about (a new
// extraction saved, an enrichment completed, a monitoring alert) calls
// one of the helpers here; we append a row to `zapier_events` and never
// throw (so a Supabase blip doesn't take down the originating call).
//
// Usage:
//   import { emitNewExtraction } from "./lib/zapierEmitter.js";
//   await emitNewExtraction({ userId, extraction });
//
// All functions are async; callers should NOT await them in hot paths
// unless they want to surface the result.

import { appendEvent } from "./zapierEventStore.js";

export function emitNewExtraction({ userId, extraction }) {
  if (!userId || !extraction) return;
  const payload = {
    id: extraction.id,
    url: extraction.url,
    title: extraction.page_title || extraction.title || null,
    summary: extraction.ai_summary || extraction.summary || null,
    created_at: extraction.created_at,
  };
  // Dedupe by extraction id so retries don't double-emit.
  return appendEvent({
    userId,
    eventType: "new_extraction",
    payload,
    dedupeKey: `extraction:${extraction.id}`,
  }).catch(() => { /* best-effort */ });
}

export function emitNewEnrichment({ userId, extractionId, focus, data }) {
  if (!userId || !extractionId || !focus) return;
  return appendEvent({
    userId,
    eventType: "new_enrichment",
    payload: { extraction_id: extractionId, focus, data },
    dedupeKey: `enrichment:${extractionId}:${focus}:${Date.now()}`,
  }).catch(() => { /* best-effort */ });
}

export function emitMonitoringAlert({ userId, schedule, changedSummary }) {
  if (!userId || !schedule) return;
  return appendEvent({
    userId,
    eventType: "monitoring_alert",
    payload: {
      schedule_id: schedule.id,
      url: Array.isArray(schedule.target) ? schedule.target[0] : schedule.target,
      label: schedule.label,
      previous_hash: changedSummary?.previousHash || null,
      new_hash: changedSummary?.newHash || null,
      detected_at: new Date().toISOString(),
    },
    dedupeKey: `alert:${schedule.id}:${changedSummary?.newHash || Date.now()}`,
  }).catch(() => { /* best-effort */ });
}
