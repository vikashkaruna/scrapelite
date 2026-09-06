// netlify/__tests__/workflow-orchestrator-killswitch.test.js
//
// The operator Stop switch on /admin/monitoring gates the orchestrator's WORK
// on BOTH paths — the 5-minute cron and the HTTP endpoints n8n calls.
//
// Why this file exists separately from workflow-orchestrator-handler.test.js:
// that suite deliberately runs with jobControl unmocked (isJobEnabled fails
// open with no Supabase configured, so its 20 assertions are unaffected by the
// switch). Mocking jobControl there would change what those tests prove.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const isJobEnabled = vi.fn();

vi.mock("../functions/lib/jobControl.js", () => ({
  isJobEnabled: (...a) => isJobEnabled(...a),
  // Pass-through: this file is about the switch, not about run bookkeeping.
  withJobRun: (_job, fn) => async (event, context) => fn(event, context),
}));

let fetchMock;

beforeEach(() => {
  // Block body, deliberately: a value returned from beforeEach is treated by
  // vitest as a TEARDOWN callback, which is a live trap this repo has hit.
  vi.resetModules();
  isJobEnabled.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "sk";
  process.env.N8N_BASE_URL = "https://n8n.example.com";
  process.env.WORKFLOW_ORCHESTRATOR_TOKEN = "admin-tok";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const load = async () => (await import("../functions/workflow-orchestrator.js")).handler;

const httpEvent = () => ({
  httpMethod: "POST",
  path: "/api/workflow-orchestrator/run-now",
  headers: { authorization: "Bearer admin-tok" },
  body: "{}",
});

describe("workflow-orchestrator — operator kill switch on the HTTP path", () => {
  it("does no work and reports why when an operator has stopped the job", async () => {
    isJobEnabled.mockResolvedValue(false);
    const handler = await load();

    const res = await handler(httpEvent());
    const body = JSON.parse(res.body);

    expect(body).toMatchObject({
      ok: true,
      job: "workflow-orchestrator",
      skipped: true,
      reason: "disabled_by_operator",
    });
    // The whole point: nothing was dispatched anywhere.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 200, not an error, so n8n does not retry-storm the endpoint", async () => {
    // n8n treats any non-2xx as a retryable failure. Refusing a stopped
    // pipeline with 4xx/5xx would turn one operator stop into a retry loop.
    isJobEnabled.mockResolvedValue(false);
    const handler = await load();

    const res = await handler(httpEvent());
    expect(res.statusCode).toBe(200);
  });

  it("consults the switch for the job id that netlify.toml actually schedules", async () => {
    isJobEnabled.mockResolvedValue(false);
    const handler = await load();
    await handler(httpEvent());

    // A drifted id here would read as "enabled" for ever, because isJobEnabled
    // fails open for an unknown job.
    expect(isJobEnabled).toHaveBeenCalledWith("workflow-orchestrator");
  });

  it("lets the request through when the job is enabled", async () => {
    isJobEnabled.mockResolvedValue(true);
    const handler = await load();

    const res = await handler(httpEvent());
    const body = JSON.parse(res.body || "{}");
    expect(body.reason).not.toBe("disabled_by_operator");
  });

  it("fails OPEN — an unreadable switch means the pipeline runs", async () => {
    // Same asymmetry as every other isJobEnabled call site: a Supabase blip
    // must never silently stop the automation pipeline.
    isJobEnabled.mockResolvedValue(true);
    const handler = await load();

    const res = await handler(httpEvent());
    expect(JSON.parse(res.body || "{}").skipped).not.toBe(true);
  });
});
