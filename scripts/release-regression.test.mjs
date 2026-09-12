import { describe, expect, it } from "vitest";
import {
  parseCliArgs,
  runDeploymentContracts,
  summarize,
  validateOptions,
} from "./release-regression.mjs";

const HEADERS = { "content-type": "application/json" };

function deployFetcher(overrides = {}) {
  const responses = {
    "/api/v1/_health": { status: 200, body: { ok: true, version: "v1" } },
    "/api/discoverability/profiles": { status: 200, body: { profiles: { balanced: { label: "Balanced" } } } },
    "/api/discoverability/audits": { status: 401, body: { code: "AUTH_REQUIRED" } },
    ...overrides,
  };
  return async (url) => {
    const key = new URL(url).pathname;
    const response = responses[key] || { status: 404, body: { error: "not found" } };
    return new Response(JSON.stringify(response.body), { status: response.status, headers: HEADERS });
  };
}

describe("release regression CLI", () => {
  it("keeps deployed verification read-only by default", () => {
    const options = parseCliArgs(["--base-url", "https://preview.example.test"]);
    expect(options.allowLiveWrite).toBe(false);
    expect(options.withUi).toBe(true);
    expect(options.token).toBe("");
  });

  it("requires all full-regression safeguards before a request can run", () => {
    const options = parseCliArgs([
      "--full", "--environment", "staging", "--base-url", "https://staging.example.test",
      "--discover-url", "https://owned.example.test",
    ]);
    expect(() => validateOptions(options)).toThrow(/DATIQ_TEST_BEARER_TOKEN/);
  });

  it("rejects RLS verification for a branch preview", () => {
    const options = parseCliArgs([
      "--base-url", "https://preview.example.test", "--verify-rls",
    ]);
    expect(() => validateOptions(options)).toThrow(/staging or production/);
  });
});

describe("read-only deployed contracts", () => {
  it("accepts the expected API and Discoverability response shapes", async () => {
    const options = validateOptions(parseCliArgs(["--base-url", "https://preview.example.test"]));
    const checks = await runDeploymentContracts(options, { fetcher: deployFetcher() });
    expect(checks).toHaveLength(3);
    expect(checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("reports a routing or authorization-shape regression instead of passing it", async () => {
    const options = validateOptions(parseCliArgs(["--base-url", "https://preview.example.test"]));
    const checks = await runDeploymentContracts(options, {
      fetcher: deployFetcher({ "/api/discoverability/audits": { status: 200, body: { audits: [] } } }),
    });
    expect(checks.find((check) => check.name.includes("protects account history"))).toMatchObject({ status: "failed" });
  });
});

describe("release summary", () => {
  it("exposes skipped coverage as a deviation rather than claiming a full pass", () => {
    const options = validateOptions(parseCliArgs(["--base-url", "https://preview.example.test"]));
    const result = summarize(options, [
      { name: "Public route", status: "passed" },
      { name: "Live audit", status: "skipped", detail: "Requires test credentials." },
    ], new Date().toISOString());
    expect(result.verdict).toBe("passed_with_deviations");
    expect(result.deviations).toEqual(["Live audit: Requires test credentials."]);
  });
});
