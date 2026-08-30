// netlify/functions/lib/workflowCallback.js
//
// Core business logic for the DatIQ Workflow Callback endpoint.
// Called by n8n workflows upon completion of an automation task.
//
// Pattern: Server Callback API
// - n8n NEVER needs the master Supabase service_role key.
// - n8n completes its job and POSTs back to `_ctx.callback_url` (/api/workflow-callback)
//   with the event ID, execution status, and output.
// - This endpoint authenticates the call via HMAC-SHA256 signature or shared secret,
//   and executes the database state update using DatIQ's own server-side credentials.

import { verify as verifyHmac } from "./n8nSignature.js";
import { backoffMs, nextAttemptAt, STATE } from "./workflowEnqueue.js";

export const CALLBACK_STATE = Object.freeze({
  DONE: "done",
  FAILED: "failed",
});

function timingSafeMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function authenticateCallback(env, rawBody, headers) {
  const secret = env.n8nSecret || "";
  const adminToken = env.adminToken || "";

  // 1. Try HMAC signature header (recommended)
  const sigHeader = headers["x-datiq-signature"] || headers["X-DatIQ-Signature"];
  if (sigHeader && secret) {
    const result = verifyHmac(secret, rawBody, sigHeader);
    if (result.ok) return { ok: true, method: "hmac" };
  }

  // 2. Try Bearer token header
  const authHeader = headers["authorization"] || headers["Authorization"];
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (secret && timingSafeMatch(token, secret)) {
      return { ok: true, method: "bearer_secret" };
    }
    if (adminToken && timingSafeMatch(token, adminToken)) {
      return { ok: true, method: "bearer_admin" };
    }
  }

  return { ok: false, error: "unauthorized" };
}

export async function handleCallback(env, client, rawBody, headers, { now = new Date() } = {}) {
  const auth = authenticateCallback(env, rawBody, headers);
  if (!auth.ok) {
    return {
      status: 401,
      body: { ok: false, error: "unauthorized: invalid signature or bearer token" },
    };
  }

  let payload;
  try {
    payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  } catch {
    return { status: 400, body: { ok: false, error: "invalid json payload" } };
  }

  const { event_id, state, output, error, duration_ms } = payload || {};
  if (!event_id || typeof event_id !== "string") {
    return { status: 400, body: { ok: false, error: "missing event_id" } };
  }

  if (state !== CALLBACK_STATE.DONE && state !== CALLBACK_STATE.FAILED) {
    return {
      status: 400,
      body: { ok: false, error: `invalid state: must be '${CALLBACK_STATE.DONE}' or '${CALLBACK_STATE.FAILED}'` },
    };
  }

  // 1. Fetch current event from Supabase
  const getRes = await client.fetch(
    `${client.base}/rest/v1/workflow_events?id=eq.${encodeURIComponent(event_id)}&select=*`,
    { headers: client.headers }
  );

  if (!getRes.ok) {
    return { status: 502, body: { ok: false, error: `database fetch error: ${getRes.status}` } };
  }

  const rows = await getRes.json();
  const event = rows && rows[0];
  if (!event) {
    return { status: 404, body: { ok: false, error: `event not found: ${event_id}` } };
  }

  const isoNow = now.toISOString();

  // 2. Transition state
  if (state === CALLBACK_STATE.DONE) {
    const patchRes = await client.fetch(
      `${client.base}/rest/v1/workflow_events?id=eq.${encodeURIComponent(event_id)}`,
      {
        method: "PATCH",
        headers: { ...client.headers, Prefer: "return=representation" },
        body: JSON.stringify({
          state: STATE.DONE,
          finished_at: isoNow,
          last_error: null,
        }),
      }
    );

    if (!patchRes.ok) {
      return { status: 502, body: { ok: false, error: `database patch error: ${patchRes.status}` } };
    }

    // Record run log
    try {
      await client.fetch(`${client.base}/rest/v1/workflow_runs`, {
        method: "POST",
        headers: { ...client.headers, Prefer: "return=minimal" },
        body: JSON.stringify({
          event_id,
          run_type: "n8n_callback",
          response_status: 200,
          response_body: output ? JSON.stringify(output).slice(0, 4096) : null,
          duration_ms: Number(duration_ms) || null,
          finished_at: isoNow,
        }),
      });
    } catch {
      // Run logging is non-blocking
    }

    return {
      status: 200,
      body: { ok: true, event_id, state: STATE.DONE },
    };
  }

  // state === 'failed'
  const currentAttempts = Number(event.attempts) || 1;
  const maxAttempts = Number(event.max_attempts) || 5;
  const nextAttempts = currentAttempts + 1;
  const isTerminal = nextAttempts >= maxAttempts;
  const nextState = isTerminal ? STATE.FAILED : STATE.PENDING;
  const nextAttemptIso = isTerminal ? null : nextAttemptAt(nextAttempts, now);

  const patchRes = await client.fetch(
    `${client.base}/rest/v1/workflow_events?id=eq.${encodeURIComponent(event_id)}`,
    {
      method: "PATCH",
      headers: { ...client.headers, Prefer: "return=representation" },
      body: JSON.stringify({
        state: nextState,
        attempts: nextAttempts,
        next_attempt_at: nextAttemptIso,
        last_error: error ? String(error).slice(0, 1000) : "n8n callback reported failure",
        finished_at: isTerminal ? isoNow : null,
      }),
    }
  );

  if (!patchRes.ok) {
    return { status: 502, body: { ok: false, error: `database patch error: ${patchRes.status}` } };
  }

  // Record failure run log
  try {
    await client.fetch(`${client.base}/rest/v1/workflow_runs`, {
      method: "POST",
      headers: { ...client.headers, Prefer: "return=minimal" },
      body: JSON.stringify({
        event_id,
        run_type: "n8n_callback",
        response_status: 500,
        error: error ? String(error).slice(0, 1000) : "n8n execution failed",
        duration_ms: Number(duration_ms) || null,
        finished_at: isoNow,
      }),
    });
  } catch {
    // Run logging is non-blocking
  }

  return {
    status: 200,
    body: {
      ok: true,
      event_id,
      state: nextState,
      attempts: nextAttempts,
      terminal: isTerminal,
    },
  };
}
