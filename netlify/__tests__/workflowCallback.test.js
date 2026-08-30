// netlify/__tests__/workflowCallback.test.js
import { describe, it, expect, vi } from "vitest";
import {
  handleCallback,
  authenticateCallback,
  CALLBACK_STATE,
} from "../functions/lib/workflowCallback.js";
import { sign, buildHeader } from "../functions/lib/n8nSignature.js";
import { STATE } from "../functions/lib/workflowEnqueue.js";

const SECRET = "secret-1234567890abcdef1234567890abcdef";
const ADMIN_TOKEN = "admin-token-xyz";

function createMockClient(events = {}) {
  const eventStore = { ...events };
  const runs = [];

  return {
    base: "https://mock.supabase.co",
    headers: { apikey: "key" },
    runs,
    eventStore,
    fetch: vi.fn(async (url, options = {}) => {
      const method = options.method || "GET";
      const u = new URL(url);

      if (u.pathname.endsWith("/workflow_events")) {
        const idMatch = u.searchParams.get("id");
        const id = idMatch ? idMatch.replace(/^eq\./, "") : null;

        if (method === "GET") {
          const row = id ? eventStore[id] : null;
          return {
            ok: true,
            status: 200,
            json: async () => (row ? [row] : []),
          };
        }

        if (method === "PATCH") {
          const body = JSON.parse(options.body || "{}");
          if (id && eventStore[id]) {
            eventStore[id] = { ...eventStore[id], ...body };
            return {
              ok: true,
              status: 200,
              json: async () => [eventStore[id]],
            };
          }
          return { ok: false, status: 404 };
        }
      }

      if (u.pathname.endsWith("/workflow_runs")) {
        if (method === "POST") {
          const body = JSON.parse(options.body || "{}");
          runs.push(body);
          return { ok: true, status: 201, json: async () => [body] };
        }
      }

      return { ok: false, status: 404 };
    }),
  };
}

describe("workflowCallback.authenticateCallback", () => {
  const env = { n8nSecret: SECRET, adminToken: ADMIN_TOKEN };

  it("authenticates via valid HMAC-SHA256 signature header", () => {
    const rawBody = JSON.stringify({ event_id: "e1", state: "done" });
    const now = Date.now();
    const header = buildHeader(SECRET, rawBody, now);

    const res = authenticateCallback(env, rawBody, { "X-DatIQ-Signature": header });
    expect(res.ok).toBe(true);
    expect(res.method).toBe("hmac");
  });

  it("authenticates via Bearer secret token", () => {
    const rawBody = JSON.stringify({ event_id: "e1", state: "done" });
    const res = authenticateCallback(env, rawBody, { Authorization: `Bearer ${SECRET}` });
    expect(res.ok).toBe(true);
    expect(res.method).toBe("bearer_secret");
  });

  it("authenticates via Bearer admin token", () => {
    const rawBody = JSON.stringify({ event_id: "e1", state: "done" });
    const res = authenticateCallback(env, rawBody, { Authorization: `Bearer ${ADMIN_TOKEN}` });
    expect(res.ok).toBe(true);
    expect(res.method).toBe("bearer_admin");
  });

  it("rejects unauthorized requests with no credentials", () => {
    const rawBody = JSON.stringify({ event_id: "e1", state: "done" });
    const res = authenticateCallback(env, rawBody, {});
    expect(res.ok).toBe(false);
  });

  it("rejects invalid signature", () => {
    const rawBody = JSON.stringify({ event_id: "e1", state: "done" });
    const header = `t=${Date.now()},v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb`;
    const res = authenticateCallback(env, rawBody, { "X-DatIQ-Signature": header });
    expect(res.ok).toBe(false);
  });
});

describe("workflowCallback.handleCallback", () => {
  const env = { n8nSecret: SECRET, adminToken: ADMIN_TOKEN };

  it("returns 400 on invalid JSON body", async () => {
    const client = createMockClient();
    const res = await handleCallback(env, client, "not-json", { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid json");
  });

  it("returns 400 if event_id is missing", async () => {
    const client = createMockClient();
    const rawBody = JSON.stringify({ state: "done" });
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("missing event_id");
  });

  it("returns 400 if state is invalid", async () => {
    const client = createMockClient();
    const rawBody = JSON.stringify({ event_id: "e1", state: "unknown_state" });
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid state");
  });

  it("returns 404 if event is not found in database", async () => {
    const client = createMockClient({});
    const rawBody = JSON.stringify({ event_id: "e_nonexistent", state: "done" });
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("event not found");
  });

  it("marks event done and creates a run record when state='done'", async () => {
    const client = createMockClient({
      e_done: {
        id: "e_done",
        kind: "schedule.changed",
        state: STATE.PROCESSING,
        attempts: 1,
      },
    });

    const rawBody = JSON.stringify({
      event_id: "e_done",
      state: CALLBACK_STATE.DONE,
      output: { emailSent: true, messageId: "msg-123" },
      duration_ms: 350,
    });

    const now = new Date("2026-08-30T12:00:00Z");
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` }, { now });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      event_id: "e_done",
      state: STATE.DONE,
    });

    // Verify DB update
    expect(client.eventStore.e_done.state).toBe(STATE.DONE);
    expect(client.eventStore.e_done.finished_at).toBe("2026-08-30T12:00:00.000Z");
    expect(client.eventStore.e_done.last_error).toBeNull();

    // Verify run record created
    expect(client.runs).toHaveLength(1);
    expect(client.runs[0]).toEqual({
      event_id: "e_done",
      run_type: "n8n_callback",
      response_status: 200,
      response_body: JSON.stringify({ emailSent: true, messageId: "msg-123" }),
      duration_ms: 350,
      finished_at: "2026-08-30T12:00:00.000Z",
    });
  });

  it("re-schedules event as pending with backoff when state='failed' and attempts < max_attempts", async () => {
    const client = createMockClient({
      e_fail_retry: {
        id: "e_fail_retry",
        kind: "schedule.changed",
        state: STATE.PROCESSING,
        attempts: 1,
        max_attempts: 5,
      },
    });

    const rawBody = JSON.stringify({
      event_id: "e_fail_retry",
      state: CALLBACK_STATE.FAILED,
      error: "Resend 429 Too Many Requests",
      duration_ms: 120,
    });

    const now = new Date("2026-08-30T12:00:00Z");
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` }, { now });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe(STATE.PENDING);
    expect(res.body.attempts).toBe(2);
    expect(res.body.terminal).toBe(false);

    // Verify DB update
    expect(client.eventStore.e_fail_retry.state).toBe(STATE.PENDING);
    expect(client.eventStore.e_fail_retry.attempts).toBe(2);
    expect(client.eventStore.e_fail_retry.last_error).toBe("Resend 429 Too Many Requests");
    expect(client.eventStore.e_fail_retry.next_attempt_at).toBe("2026-08-30T12:05:00.000Z"); // +5m for attempt 2

    // Verify run record created
    expect(client.runs[0].error).toBe("Resend 429 Too Many Requests");
    expect(client.runs[0].response_status).toBe(500);
  });

  it("marks event permanently failed when attempts reach max_attempts", async () => {
    const client = createMockClient({
      e_fail_terminal: {
        id: "e_fail_terminal",
        kind: "schedule.changed",
        state: STATE.PROCESSING,
        attempts: 4,
        max_attempts: 5,
      },
    });

    const rawBody = JSON.stringify({
      event_id: "e_fail_terminal",
      state: CALLBACK_STATE.FAILED,
      error: "Destination permanently deleted",
      duration_ms: 80,
    });

    const now = new Date("2026-08-30T12:00:00Z");
    const res = await handleCallback(env, client, rawBody, { Authorization: `Bearer ${SECRET}` }, { now });

    expect(res.status).toBe(200);
    expect(res.body.state).toBe(STATE.FAILED);
    expect(res.body.attempts).toBe(5);
    expect(res.body.terminal).toBe(true);

    // Verify DB update
    expect(client.eventStore.e_fail_terminal.state).toBe(STATE.FAILED);
    expect(client.eventStore.e_fail_terminal.attempts).toBe(5);
    expect(client.eventStore.e_fail_terminal.finished_at).toBe("2026-08-30T12:00:00.000Z");
    expect(client.eventStore.e_fail_terminal.next_attempt_at).toBeNull();
  });
});
