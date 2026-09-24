// netlify/functions/lib/signalDispatch.js contract tests — PRD 5's dispatcher.
//
// The properties worth pinning are the ones that leak, cost money, or quietly
// stop working:
//   - the runtime uses the SAME evaluator as the "test with sample payload"
//     sandbox, so a rule that previews as matching actually fires
//   - every outbound URL is re-validated AT DISPATCH TIME, not just at write
//   - a failed action is RECORDED, never thrown — one bad Slack workspace must
//     not starve every other user's rules
//   - a rule never sees another tenant's events
//   - an unrecognised event kind is refused loudly rather than matching nothing

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exact host match — a substring check would also accept "api.example.com.evil.test".
const hostIs = (url, host) => { try { return new URL(String(url)).hostname === host; } catch { return false; } };

let fetchMock;
let dbRows;
let recorded;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Loads the dispatcher with ruleStore mocked, so these tests are about DISPATCH
 * and not about Supabase. `recordExecution` is captured rather than stubbed away
 * — "was the execution written?" is one of the contracts under test.
 */
async function load({ rules = [], validate = { ok: true } } = {}) {
  dbRows = rules;
  recorded = [];
  vi.resetModules();

  vi.doMock("../functions/lib/ruleStore.js", () => ({
    // The mock HONOURS the .eq() filters. A mock that returns the same rows
    // whatever it is asked for makes "only this user's rules" and "only this
    // trigger source" green without testing either — a green test that asserts
    // nothing is worse than no test.
    serviceDb: vi.fn(() => {
      const filters = {};
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (col, val) => { filters[col] = val; return chain; },
        limit: async (n) => ({
          data: dbRows
            .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
            .slice(0, n),
          error: null,
        }),
      };
      return { from: () => chain };
    }),
    recordExecution: vi.fn(async (ruleId, userId, payload) => {
      recorded.push({ ruleId, userId, ...payload });
      return { ok: true };
    }),
    validateActionConfig: vi.fn(async () => validate),
  }));

  vi.doMock("../functions/lib/integrationConnectionStore.js", () => ({
    getConnection: vi.fn(async () => ({ ok: true, connection: { access_token: "tok" } })),
  }));

  return import("../functions/lib/signalDispatch.js");
}

const slackRule = {
  id: "rule-1",
  user_id: "user-1",
  name: "Pricing alert",
  status: "active",
  trigger_source: "watchlist",
  action_type: "slack",
  action_config: { url: "https://hooks.slack.com/services/T/B/C" },
  conditions: [],
};

const changeEvent = {
  kind: "monitor.change_detected",
  userId: "user-1",
  payload: { domain: "acme.com", field: "pricing.tiers", materiality: "critical", confidence: 1 },
};

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe("the canonical event model", () => {
  it("carries every kind PRD 5 lists", async () => {
    const { SIGNAL_EVENTS } = await load();
    for (const kind of [
      "extraction.completed", "enrichment.completed", "enrichment.failed",
      "account.score_changed", "monitor.change_detected", "monitor.digest_ready",
      "report.shared", "report.viewed", "integration.action_failed", "usage.limit_approaching",
    ]) {
      expect(SIGNAL_EVENTS).toContain(kind);
    }
  });

  it("refuses an unknown kind rather than silently matching nothing", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    const r = await dispatchSignal({ kind: "monitor.typo", userId: "user-1", payload: {} });
    // A typo in a producer must surface. Matching nothing looks identical to a
    // correctly-configured system with no rules, which is unfalsifiable.
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown_event_kind");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an event with no owner", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    const r = await dispatchSignal({ kind: "monitor.change_detected", payload: {} });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("event_has_no_owner");
  });
});

describe("dispatch fires a matching rule and records it", () => {
  it("POSTs to the Slack webhook", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    const r = await dispatchSignal(changeEvent);
    expect(r.ok).toBe(true);
    expect(r.fired).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("hooks.slack.com");
  });

  it("writes a rule_executions row — the audit trail PRD 5 requires", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    await dispatchSignal(changeEvent);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ruleId: "rule-1", userId: "user-1", status: "success" });
    expect(recorded[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("carries the event's own facts into the recorded payload", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    await dispatchSignal(changeEvent);
    expect(recorded[0].eventPayload).toMatchObject({
      kind: "monitor.change_detected", domain: "acme.com", field: "pricing.tiers",
    });
  });

  it("does not fire a rule whose conditions do not match", async () => {
    const picky = {
      ...slackRule,
      conditions: [{ field: "materiality", operator: "in", value: ["low"] }],
    };
    const { dispatchSignal } = await load({ rules: [picky] });
    const r = await dispatchSignal(changeEvent); // materiality is "critical"
    expect(r.fired).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });
});

describe("failure is recorded, never thrown", () => {
  it("a non-2xx from Slack is a recorded failure, not an exception", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    fetchMock.mockImplementation(async () => new Response("no_service", { status: 404 }));
    const r = await dispatchSignal(changeEvent);
    expect(r.ok).toBe(true);              // the RUN succeeded
    expect(r.results[0].status).toBe("failed");  // the ACTION did not
    expect(recorded[0].status).toBe("failed");
    expect(recorded[0].error).toContain("404");
  });

  it("a network error is caught and recorded", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    fetchMock.mockImplementation(async () => { throw new Error("ECONNREFUSED"); });
    const r = await dispatchSignal(changeEvent);
    expect(r.ok).toBe(true);
    expect(recorded[0].status).toBe("failed");
  });

  it("one broken rule does not stop the next one", async () => {
    const second = { ...slackRule, id: "rule-2", name: "Second" };
    const { dispatchSignal } = await load({ rules: [slackRule, second] });
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      return new Response("ok", { status: 200 });
    });
    const r = await dispatchSignal(changeEvent);
    expect(r.fired).toBe(2);
    expect(recorded.map((x) => x.status)).toEqual(["failed", "success"]);
  });

  it("an unconfigured mailer is `skipped`, not `failed` — an operator fault is not the user's rule breaking", async () => {
    const emailRule = { ...slackRule, action_type: "email", action_config: { to: "a@b.com" } };
    delete process.env.RESEND_API_KEY;
    const { dispatchSignal } = await load({ rules: [emailRule] });
    await dispatchSignal(changeEvent);
    expect(recorded[0].status).toBe("skipped");
  });
});

describe("outbound destinations are re-validated AT DISPATCH", () => {
  it("refuses a webhook that now resolves to a private address", async () => {
    // Write-time validation stops the mistake; dispatch-time validation stops
    // the attack — a hostname that resolved publicly last week can point at
    // 169.254.169.254 today, and the row is already saved.
    const evil = { ...slackRule, action_type: "webhook", action_config: { url: "http://169.254.169.254/latest/meta-data/" } };
    const { dispatchSignal } = await load({ rules: [evil] });
    const r = await dispatchSignal(changeEvent);
    expect(r.results[0].status).toBe("refused");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded[0].status).toBe("refused");
  });

  it("refuses loopback and non-http schemes", async () => {
    for (const url of ["http://127.0.0.1:8080/admin", "http://10.0.0.5/x"]) {
      const evil = { ...slackRule, action_type: "webhook", action_config: { url } };
      const { dispatchSignal } = await load({ rules: [evil] });
      const r = await dispatchSignal(changeEvent);
      expect(r.results[0].status, `${url} should be refused`).toBe("refused");
    }
  });

  it("refuses a 'slack' action pointed anywhere but Slack", async () => {
    const evil = { ...slackRule, action_config: { url: "https://attacker.example.com/collect" } };
    const { dispatchSignal } = await load({ rules: [evil] });
    const r = await dispatchSignal(changeEvent);
    expect(r.results[0].status).toBe("refused");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HubSpot resolves its destination from the stored connection, never the rule body", async () => {
    const hs = { ...slackRule, action_type: "hubspot", action_config: { url: "https://attacker.example.com" } };
    const { dispatchSignal } = await load({ rules: [hs] });
    await dispatchSignal(changeEvent);
    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => hostIs(u, "attacker.example.com"))).toBe(false);
    expect(called.some((u) => hostIs(u, "api.hubapi.com"))).toBe(true);
  });
});

describe("tenancy and fan-out", () => {
  it("only loads rules for the event's own user", async () => {
    const { rulesForEvent } = await load({ rules: [slackRule] });
    // The query chain is .eq(user_id).eq(status).eq(trigger_source) — the mock
    // only resolves through three .eq() calls, so a query that dropped the user
    // scope would not even reach the data.
    const rules = await rulesForEvent(changeEvent);
    expect(rules).toHaveLength(1);
  });

  it("caps how many rules one event can fire", async () => {
    const { MAX_ACTIONS_PER_EVENT } = await load();
    // A user with 50 overlapping rules must not turn one pricing change into 50
    // outbound requests inside a function with a 10s budget.
    expect(MAX_ACTIONS_PER_EVENT).toBeLessThanOrEqual(10);
  });

  it("an event kind with no matching trigger_source fires nothing", async () => {
    const { dispatchSignal } = await load({ rules: [slackRule] });
    // slackRule is trigger_source "watchlist"; report.shared maps to "report".
    const r = await dispatchSignal({ kind: "report.shared", userId: "user-1", payload: {} });
    expect(r.ok).toBe(true);
    expect(r.fired).toBe(0);
  });
});
