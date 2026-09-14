import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_GATE_SCOPES } from "./release-gate-scopes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const RELEASE_SRC = readFileSync(join(ROOT, "scripts/release-regression.mjs"), "utf8");
const DISCOVERABILITY_SRC = readFileSync(join(ROOT, "scripts/verify-discoverability-e2e.mjs"), "utf8");

describe("D22 release-gate division of labour", () => {
  it("gives each runner a disjoint set of owned checks", () => {
    const releaseOwns = new Set(RELEASE_GATE_SCOPES.release.owns);
    const discoverabilityOwns = new Set(RELEASE_GATE_SCOPES.discoverability.owns);
    expect([...releaseOwns].filter((item) => discoverabilityOwns.has(item))).toEqual([]);
  });

  it("keeps both commands explicit instead of hiding an audit-spending runner inside the other", () => {
    expect(PACKAGE.scripts[RELEASE_GATE_SCOPES.release.command]).toBe("node scripts/release-regression.mjs");
    expect(PACKAGE.scripts[RELEASE_GATE_SCOPES.discoverability.command]).toBe("node scripts/verify-discoverability-e2e.mjs");
  });

  it("makes both production runners report the shared scope registry", () => {
    expect(RELEASE_SRC).toMatch(/RELEASE_GATE_SCOPES\.release/);
    expect(DISCOVERABILITY_SRC).toMatch(/RELEASE_GATE_SCOPES\.discoverability/);
  });

  it("states the write boundary separately for each safety model", () => {
    expect(RELEASE_GATE_SCOPES.release.writeBoundary).toMatch(/allow-live-write/);
    expect(RELEASE_GATE_SCOPES.discoverability.writeBoundary).toMatch(/allow-writes.*allow-audits/);
  });
});
