import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("prompt-monitor cron handler and runOnce", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runOnce handles unconfigured answer engine safely", async () => {
    const { runOnce } = await import("../functions/prompt-monitor.js");
    const result = await runOnce(Date.now(), { DISABLE_AI_CITATION_SAMPLING: "1" });
    expect(result).toHaveProperty("reason", "no answer engine configured");
    expect(result.ran).toBe(0);
  });

  it("exports handler wrapped with withJobRun that executes and returns 200", async () => {
    const { handler } = await import("../functions/prompt-monitor.js");
    expect(typeof handler).toBe("function");
    const res = await handler({ opsTrigger: "manual" });
    expect(res).toHaveProperty("statusCode", 200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("ran");
  });
});
