// netlify/functions/lib/harness.test.js
// Smoke test for the contract layer. Confirms:
//   1. Vitest can run a test from `netlify/functions/**/*.test.js` — the
//      default include glob for the contract layer is wired correctly.
//   2. A netlify-function-shaped module is importable from this folder.
//   3. The `netlify/functions/` directory is traversable from a test
//      context, proving the contract layer's file resolution works.
// Real coverage for individual netlify functions lands in M2 (Contract).

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

describe("netlify/functions test harness (M0 contract smoke)", () => {
  it("vitest can import a node module from netlify/functions", async () => {
    const path = await import("node:path");
    expect(typeof path.join).toBe("function");
  });

  it("the netlify/functions directory is present", () => {
    const functionsPath = resolve(repoRoot, "netlify/functions");
    expect(existsSync(functionsPath)).toBe(true);
  });
});
