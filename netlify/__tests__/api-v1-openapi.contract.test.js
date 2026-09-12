// Release 0 — public API documentation must remain a usable contract.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const spec = JSON.parse(readFileSync(resolve(ROOT, "docs/openapi.v1.json"), "utf8"));

const REQUIRED_PATHS = [
  "/_health",
  "/extractions",
  "/extractions/{id}",
  "/extractions/{id}/enrichments",
  "/extractions/{id}/content",
  "/extractions/{id}/share",
  "/extractions/{id}/feedback",
  "/batches",
  "/batches/{id}",
  "/schedules",
  "/schedules/{id}",
  "/schedules/{id}/run",
  "/gallery",
  "/audits",
  "/audits/{id}",
  "/audits/{id}/results",
  "/audits/{id}/report",
  "/audits/{id}/rerun",
  "/audits/{id}/compare/{baseline}",
  "/audits/{id}/recommendations",
  "/audits/{id}/headings",
  "/audits/{id}/schema",
  "/audits/{id}/answers",
  "/audits/{id}/entities",
  "/audits/{id}/technical",
  "/recommendations/{id}/accept",
  "/recommendations/{id}/dismiss",
  "/targets",
  "/targets/{id}/history",
  "/targets/{id}/trends",
  "/benchmarks",
  "/benchmarks/{id}",
];

describe("api-v1 OpenAPI contract", () => {
  it("is a v3 public contract for the deployed Netlify route", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://datiq.app/api/v1" }),
    ]));
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("documents every stable API path dispatched by the v1 router", () => {
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(REQUIRED_PATHS));
    for (const path of REQUIRED_PATHS) {
      const operations = Object.entries(spec.paths[path]).filter(([key]) => ["get", "post", "patch", "delete"].includes(key));
      expect(operations.length, `${path} has no operation`).toBeGreaterThan(0);
      for (const [, operation] of operations) {
        expect(operation.operationId, `${path} needs an operationId`).toEqual(expect.any(String));
      }
    }
  });

  it("keeps health public and protects the rest of the contract by default", () => {
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.paths["/_health"].get.security).toEqual([]);
  });

  it("uses the same supported extraction intent vocabulary as the router", () => {
    expect(spec.components.schemas.CreateExtraction.properties.intent.enum)
      .toEqual(["summary", "contacts", "pricing", "map", "custom"]);
  });
});
