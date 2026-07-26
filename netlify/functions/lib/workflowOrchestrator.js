// netlify/functions/lib/workflowOrchestrator.js
//
// Pure logic for the workflow orchestrator. No I/O imports; all database
// + network access is injected via the `client` and `env` arguments.
// This keeps every function unit-testable with a plain fetch mock.
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §6
//
// Responsibilities:
//   1. Re-queue any rows stuck in 'processing' (started_at too old)
//   2. Claim pending rows in batches (optimistic concurrency via state filter)
//   3. POST each claimed event to the n8n webhook for its kind
//   4. Log the attempt in workflow_runs
//   5. Mark the event done (on 2xx) OR bump attempts + apply backoff (on failure)
//   6. Mark the event 'failed' when attempts >= max_attempts

import { sign, buildHeader } from "./n8nSignature.js";
import { backoffMs, STATE } from "./workflowEnqueue.js";

// Maps each event kind to the n8n webhook path on the self-hosted n8n.
// The user has an existing n8n at https://n8n-k8q6.srv1738397.hstgr.cloud/
// (Hostinger VPS). The path is whatever they set in the workflow's Webhook
// trigger node.
export const KIND_TO_N8N_WEBHOOK = Object.freeze({
  "schedule.changed": "/webhook/datiq/schedule-changed",
  "contact.received": "/webhook/datiq/contact-received",
  "user.lifecycle":   "/webhook/datiq/user-event",
  "op.alert":         "/webhook/datiq/op-event",
  // "payment.captured" deferred to V2 (user decision 2026-07-26).
});

export const STUCK_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes
export const DISPATCH_TIMEOUT_MS = 10_000;
export const POLL_LIMIT = 50;
export const RESPONSE_BODY_MAX = 4096;
export const ERROR_MAX = 1000;

const n8nFetch = (env, path) => {
  const base = String(env.n8nBase || "").replace(/\/+$/, "");
  return `${base}${path}`;
};

// ── 1. Re-queue stuck 'processing' rows ─────────────────────────────────
// A row is "stuck" if state='processing' and started_at < cutoff.
// We re-queue it as 'pending' with a note in last_error.
export async function requeueStuck(client, { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - STUCK_PROCESSING_MS).toISOString();
  const res = await fetch(
    `${client.base}/workflow_events?state=eq.processing&started_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        state: STATE.PENDING,
        last_error: "stuck in processing — auto-requeued by orchestrator",
        next_attempt_at: now.toISOString(),
        started_at: null,
        updated_at: now.toISOString(),
      }),
    }
  );
  if (!res.ok) throw new Error(`requeueStuck: supabase ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}

// ── 2. Claim pending rows ──────────────────────────────────────────────
// Two-step claim for safety against parallel orchestrator invocations:
//   1. SELECT up to `limit` candidates (state=pending AND next_attempt_at<=now)
//   2. For each candidate, PATCH state='processing' WHERE state='pending'
//      (so if another container already claimed it, our PATCH is a no-op)
export async function claimPending(client, { limit = POLL_LIMIT, now = new Date() } = {}) {
  const selectRes = await fetch(
    `${client.base}/workflow_events?` +
      `state=eq.pending&` +
      `next_attempt_at=lte.${encodeURIComponent(now.toISOString())}&` +
      `order=next_attempt_at.asc&` +
      `limit=${limit}&` +
      `select=*`,
    { headers: client.headers }
  );
  if (!selectRes.ok) throw new Error(`claim select: supabase ${selectRes.status}`);
  const candidates = await selectRes.json();
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const claimed = [];
  for (const c of candidates) {
    const updateRes = await fetch(
      `${client.base}/workflow_events?id=eq.${encodeURIComponent(c.id)}&state=eq.pending`,
      {
        method: "PATCH",
        headers: { ...client.headers, Prefer: "return=representation" },
        body: JSON.stringify({
          state: STATE.PROCESSING,
          started_at: now.toISOString(),
          attempts: (c.attempts || 0) + 1,
          updated_at: now.toISOString(),
        }),
      }
    );
    if (!updateRes.ok) continue;
    const updated = await updateRes.json();
    if (Array.isArray(updated) && updated.length > 0) {
      claimed.push(updated[0]);
    }
    // If updated is empty, another container claimed it — skip silently.
  }
  return claimed;
}

// ── 3. Dispatch a single event to n8n ──────────────────────────────────
export async function dispatchOne(env, client, row, { fetchImpl = fetch, now = new Date() } = {}) {
  const path = KIND_TO_N8N_WEBHOOK[row.kind];
  if (!path) {
    return await markFailed(client, row, `unknown kind '${row.kind}'`, { now });
  }
  if (!env.n8nBase) {
    return await markFailed(client, row, "N8N_BASE_URL not configured", { now });
  }
  const url = n8nFetch(env, path);
  const rawBody = JSON.stringify(row);
  const headers = {
    "Content-Type": "application/json",
    "X-DatIQ-Signature": buildHeader(env.n8nSecret || "", rawBody, now.getTime()),
    "X-DatIQ-Event-Id": row.id,
    "X-DatIQ-Event-Kind": row.kind,
  };

  const start = Date.now();
  const run = await startRun(client, row, "n8n", rawBody, { now });
  let dispatchOk = false;
  let responseStatus = null;
  let responseBody = null;
  let error = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: controller.signal,
    });
    clearTimeout(timer);
    responseStatus = res.status;
    responseBody = (await res.text()).slice(0, RESPONSE_BODY_MAX);
    dispatchOk = res.status >= 200 && res.status < 300;
    if (!dispatchOk) error = `n8n ${res.status}`;
  } catch (err) {
    error = `network: ${err.message}`;
  }
  const durationMs = Date.now() - start;

  await finishRun(client, run?.id, {
    response_status: responseStatus,
    response_body: responseBody,
    duration_ms: durationMs,
    error: error ? String(error).slice(0, ERROR_MAX) : null,
    finished_at: new Date().toISOString(),
  });

  if (dispatchOk) {
    // n8n's Webhook trigger returns 200 as soon as the workflow is queued.
    // The actual delivery is logged in workflow_runs (and in n8n itself).
    await markDone(client, row, { now });
    return { ok: true };
  }
  return await markFailedOrRetry(client, row, error, { now });
}

// ── 4. State transitions ───────────────────────────────────────────────
export async function markDone(client, row, { now = new Date() } = {}) {
  const res = await fetch(
    `${client.base}/workflow_events?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        state: STATE.DONE,
        finished_at: now.toISOString(),
        last_error: null,
        updated_at: now.toISOString(),
      }),
    }
  );
  if (!res.ok) throw new Error(`markDone: supabase ${res.status}`);
}

export async function markFailed(client, row, error, { now = new Date() } = {}) {
  const res = await fetch(
    `${client.base}/workflow_events?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        state: STATE.FAILED,
        finished_at: now.toISOString(),
        last_error: String(error || "unknown").slice(0, ERROR_MAX),
        updated_at: now.toISOString(),
      }),
    }
  );
  if (!res.ok) throw new Error(`markFailed: supabase ${res.status}`);
  return { ok: false, error };
}

export async function markFailedOrRetry(client, row, error, { now = new Date() } = {}) {
  const attempts = row.attempts || 1;
  if (attempts >= row.max_attempts) {
    await markFailed(client, row, error || `max attempts (${row.max_attempts}) reached`, { now });
    return { ok: false, error, final: true };
  }
  const next = new Date(now.getTime() + backoffMs(attempts)).toISOString();
  const res = await fetch(
    `${client.base}/workflow_events?id=eq.${encodeURIComponent(row.id)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        state: STATE.PENDING,
        next_attempt_at: next,
        last_error: String(error || "unknown").slice(0, ERROR_MAX),
        started_at: null,
        updated_at: now.toISOString(),
      }),
    }
  );
  if (!res.ok) throw new Error(`markFailedOrRetry: supabase ${res.status}`);
  return { ok: false, error, retried: true, nextAttemptAt: next };
}

// ── 5. Per-attempt log helpers ──────────────────────────────────────────
export function genRunId() {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `wfr_${Date.now().toString(36)}_${s}`;
}

export async function startRun(client, event, channel, requestBody, { now = new Date() } = {}) {
  try {
    const res = await fetch(`${client.base}/workflow_runs`, {
      method: "POST",
      headers: { ...client.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        id: genRunId(),
        event_id: event.id,
        attempt_n: event.attempts,
        channel,
        request: { body: String(requestBody || "").slice(0, RESPONSE_BODY_MAX) },
        started_at: now.toISOString(),
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : null;
  } catch {
    return null;
  }
}

export async function finishRun(client, runId, fields) {
  if (!runId) return;
  try {
    await fetch(`${client.base}/workflow_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=minimal" },
      body: JSON.stringify(fields),
    });
  } catch {
    /* best-effort */
  }
}

// ── 6. Full poll + dispatch loop (the worker's main loop) ───────────────
export async function runOnce(env, client, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!client) {
    return { ok: false, reason: "no_client" };
  }
  if (!env.n8nBase) {
    return { ok: false, reason: "no_n8n_base_url" };
  }
  let requeued = 0;
  let dispatched = 0;
  let failed = 0;

  try {
    requeued = await requeueStuck(client, { now });
  } catch (err) {
    console.warn("[DatIQ] orchestrator: requeueStuck failed:", err.message);
  }

  let claimed = [];
  try {
    claimed = await claimPending(client, { now, limit: POLL_LIMIT });
  } catch (err) {
    console.warn("[DatIQ] orchestrator: claimPending failed:", err.message);
    return { ok: false, reason: "claim_failed", error: err.message };
  }

  for (const row of claimed) {
    try {
      const result = await dispatchOne(env, client, row, { fetchImpl, now });
      if (result.ok) dispatched++;
      else failed++;
    } catch (err) {
      failed++;
      console.warn(`[DatIQ] orchestrator: event ${row.id} threw:`, err.message);
    }
  }

  return {
    ok: true,
    scanned: claimed.length,
    dispatched,
    failed,
    requeued,
  };
}
