// netlify/functions/lib/workflowEnqueue.js
//
// Tiny module used by every DatIQ server function that wants to push an
// event into the workflow pipeline (scheduled-runner.js, contact-email.js,
// payment-webhook.js, etc.). The pipeline:
//
//   producer (e.g. scheduled-runner)
//     → enqueue({kind, ref_id, user_id, payload, channels})
//     → row in public.workflow_events with state='pending'
//     → netlify/functions/workflow-orchestrator.js polls every 5 min
//     → POSTs the event to the n8n webhook for that kind
//     → n8n workflow fans out per-channel and updates state
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §3 and §5
//
// API shape matches the rest of the Netlify Functions (REST, no SDK).
// The `client` arg is the same shape as the `sb()` helper in
// scheduled-runner.js: { base, headers }. We don't import it from there
// because the lib/ files stay environment-free so they can be unit-tested
// with a plain object as the client.

const KIND_WHITELIST = new Set([
  "schedule.changed",
  "contact.received",
  "user.lifecycle",
  "payment.captured",
  "op.alert",
]);

export const STATE = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const MAX_ATTEMPTS_DEFAULT = 5;

// Pure ID generator. Timestamp prefix + 8 chars of base36 → collision-safe
// at any reasonable DatIQ scale (the n8n workflows are idempotent on
// (kind, ref_id) so a duplicate is recoverable, not catastrophic).
export function genId(prefix = "wfe") {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${Date.now().toString(36)}_${s}`;
}

// Build an event row (no I/O). Validates kind + channels. Returns the
// row that should be POSTed to /rest/v1/workflow_events.
export function buildEvent({
  kind,
  refId = null,
  userId = null,
  payload = {},
  channels = [],
  maxAttempts = MAX_ATTEMPTS_DEFAULT,
  nextAttemptAt = null,
  id = null,
} = {}) {
  if (!kind || typeof kind !== "string") {
    throw new Error("workflowEnqueue.buildEvent: kind is required");
  }
  if (!KIND_WHITELIST.has(kind)) {
    throw new Error(
      `workflowEnqueue.buildEvent: unknown kind '${kind}'. ` +
        `Allowed: ${[...KIND_WHITELIST].join(", ")}`
    );
  }
  if (!Array.isArray(channels)) {
    throw new Error("workflowEnqueue.buildEvent: channels must be an array");
  }
  if (channels.length === 0) {
    // Not fatal — the n8n workflow can decide — but warn so callers
    // don't accidentally enqueue events with no destination.
    console.warn(`[DatIQ] workflowEnqueue: enqueuing ${kind} with empty channels`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new Error("workflowEnqueue.buildEvent: maxAttempts must be 1..20");
  }
  const now = new Date().toISOString();
  return {
    id: id || genId("wfe"),
    kind,
    ref_id: refId,
    user_id: userId,
    payload: payload || {},
    channels: channels || [],
    state: STATE.PENDING,
    attempts: 0,
    max_attempts: maxAttempts,
    next_attempt_at: nextAttemptAt || now,
    started_at: null,
    finished_at: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

// POST one event to Supabase REST. Returns { ok, event?, error? }.
// Never throws — callers (especially scheduled-runner) prefer to log
// and move on rather than fail the whole scrape cycle on an enqueue
// error.
export async function enqueueEvent(client, event) {
  if (!client || !client.base || !client.headers) {
    return { ok: false, error: "workflowEnqueue.enqueueEvent: missing client" };
  }
  if (!event || !event.id || !event.kind) {
    return { ok: false, error: "workflowEnqueue.enqueueEvent: invalid event" };
  }
  try {
    const res = await fetch(`${client.base}/workflow_events`, {
      method: "POST",
      headers: { ...client.headers, Prefer: "return=representation" },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `supabase ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    const rows = await res.json();
    return { ok: true, event: Array.isArray(rows) ? rows[0] : rows };
  } catch (err) {
    return { ok: false, error: `network: ${err.message}` };
  }
}

// Convenience wrapper: build + enqueue in one call.
export async function enqueue(client, opts) {
  let event;
  try {
    event = buildEvent(opts);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return enqueueEvent(client, event);
}

// Backoff schedule for the orchestrator. Returns ISO timestamp.
// Attempts: 0 → next attempt = now, 1 → +1m, 2 → +5m, 3 → +30m,
// 4 → +2h, 5+ → +12h (and the orchestrator will mark as 'failed').
export function backoffMs(attempts) {
  const n = Math.max(0, Math.min(10, Number(attempts) || 0));
  const table = [0, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
  // Note: can't use `||` here — table[0] is 0 and would fall through.
  return n < table.length ? table[n] : table[table.length - 1];
}

export function nextAttemptAt(attempts, from = new Date()) {
  return new Date(from.getTime() + backoffMs(attempts)).toISOString();
}

export { KIND_WHITELIST };
