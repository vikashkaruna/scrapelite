// netlify/__tests__/extract-budget.test.js
//
// /api/extract must own a wall-clock budget.
//
// The scrape chain is a SERIAL fallback (4 providers x 20s = 80s) against a
// Netlify function killed at 10s. `runScrapeChain` has always accepted a
// `deadlineAt`; extract.js never passed one, so on a hard target the platform
// killed the request and answered with an HTML error page. That HTML is not
// JSON, and the client could only report it generically — which is how three
// template runs failed telling the user to "sign in again".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runScrapeChain = vi.fn();
const runMapChain = vi.fn();

vi.mock("../functions/lib/scrapeProviders.js", () => ({
  runScrapeChain: (...a) => runScrapeChain(...a),
  runMapChain: (...a) => runMapChain(...a),
  scrapeProviderStatus: () => ({}),
}));

let fetchMock;

beforeEach(() => {
  delete process.env.PERMITTED_HOSTS;
  delete process.env.EXTRACT_BUDGET_MS;
  vi.resetModules();
  runScrapeChain.mockReset();
  runMapChain.mockReset();
  fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 })); // robots.txt
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const call = async (body = { url: "https://example.com" }) => {
  const { handler } = await import("../functions/extract.js");
  return handler({ httpMethod: "POST", body: JSON.stringify(body) });
};

describe("extract — wall-clock budget", () => {
  it("passes a finite deadlineAt to the scrape chain", async () => {
    runScrapeChain.mockResolvedValue({
      ok: true, html: "<html><title>x</title></html>",
      metadata: { title: "x" }, source: "direct", attempts: [],
    });
    const before = Date.now();
    await call();
    expect(runScrapeChain).toHaveBeenCalled();
    const opts = runScrapeChain.mock.calls[0][1];
    expect(Number.isFinite(opts.deadlineAt)).toBe(true);
    // Default budget is 8s: the deadline must be ahead of now, and not absurd.
    expect(opts.deadlineAt).toBeGreaterThan(before);
    expect(opts.deadlineAt).toBeLessThanOrEqual(before + 130_000);
  });

  it("honours EXTRACT_BUDGET_MS", async () => {
    process.env.EXTRACT_BUDGET_MS = "20000";
    runScrapeChain.mockResolvedValue({
      ok: true, html: "<html><title>x</title></html>",
      metadata: { title: "x" }, source: "direct", attempts: [],
    });
    const before = Date.now();
    await call();
    const opts = runScrapeChain.mock.calls[0][1];
    expect(opts.deadlineAt).toBeGreaterThan(before + 15_000);
  });

  it("a deadline-skipped chain returns 504 extract_timeout, not a generic 502", async () => {
    runScrapeChain.mockResolvedValue({
      ok: false,
      error: "All scrape providers failed or are unconfigured.",
      attempts: [
        { provider: "firecrawl", error: "aborted", code: "timeout" },
        { provider: "spider", skipped: "deadline" },
      ],
    });
    const r = await call();
    expect(r.statusCode).toBe(504);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("extract_timeout");
    // Must not blame the customer's page for our own limit.
    expect(body.error).toMatch(/limit on our side/i);
    expect(body.error).not.toMatch(/sign in/i);
  });

  it("a genuine provider failure is still 502, not mislabelled a timeout", async () => {
    runScrapeChain.mockResolvedValue({
      ok: false,
      error: "All scrape providers failed or are unconfigured.",
      attempts: [{ provider: "direct", error: "Direct 403", status: 403 }],
    });
    const r = await call();
    expect(r.statusCode).toBe(502);
    expect(JSON.parse(r.body).code).not.toBe("extract_timeout");
  });
});
