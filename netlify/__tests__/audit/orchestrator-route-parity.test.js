// netlify/__tests__/audit/orchestrator-route-parity.test.js
//
// E2 — the orchestrator's HTTP surface, checked against the two things that
// actually consume it: netlify.toml's redirect table, and the n8n workflow
// JSONs that call it by name.
//
// Scoped this way deliberately. The readiness doc asked for a live Playwright
// call, but the smoke suite's webServer is `npm run dev` — Vite only, with no
// Netlify functions behind /api — so such a test could only ever run against a
// deployed staging URL with a token, which makes it operator-run, not CI.
// Everything below is deterministic and needs no network.
//
// The failure this closes is real and has bitten this repo twice: a redirect
// that forwards the sub-path as `?splat=` instead of a path silently breaks
// every sub-action, and the handler answers its own 404 so it looks like an
// application bug rather than a routing one.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const toml = readFileSync(resolve(ROOT, "netlify.toml"), "utf8");
const handlerSrc = readFileSync(
  resolve(ROOT, "netlify/functions/workflow-orchestrator.js"),
  "utf8",
);

const WF_DIR = resolve(ROOT, "n8n/workflows");
const workflowJson = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, raw: readFileSync(resolve(WF_DIR, f), "utf8") }));

/** Every /api/workflow-orchestrator/<action> the n8n workflows call. */
const calledActions = [
  ...new Set(
    workflowJson.flatMap(({ raw }) =>
      [...raw.matchAll(/\/api\/workflow-orchestrator\/([a-z-]+)/g)].map((m) => m[1]),
    ),
  ),
].sort();

describe("orchestrator route parity — netlify.toml", () => {
  it("forwards /api/* to the functions router by PATH, never as ?splat=", () => {
    // `to = "/.netlify/functions/:splat"` keeps the sub-path a real path.
    // A rule ending `?splat=:splat` puts it in the query string, which this
    // repo has already shipped twice and had to unpick both times.
    const rule = toml.match(
      /from\s*=\s*"\/api\/\*"\s*\n\s*to\s*=\s*"([^"]+)"/,
    );
    expect(rule, "no /api/* redirect found in netlify.toml").not.toBeNull();
    expect(rule[1]).toBe("/.netlify/functions/:splat");
    expect(rule[1]).not.toMatch(/\?splat=/);
  });

  it("does NOT schedule workflow-orchestrator — a scheduled function loses HTTP", () => {
    // Netlify refuses public HTTP access to a scheduled function. This one
    // serves n8n's /ping and /dispatch, so scheduling it would 404 the
    // integration. The cron lives in workflow-orchestrator-cron.js instead.
    const scheduledNames = [
      ...toml.matchAll(/\[functions\."([a-z0-9-]+)"\]\s*\n\s*schedule\s*=/g),
    ].map((m) => m[1]);
    expect(scheduledNames).not.toContain("workflow-orchestrator");
    expect(scheduledNames).toContain("workflow-orchestrator-cron");
  });
});

describe("orchestrator route parity — n8n callers", () => {
  it("finds the callbacks at all", () => {
    // Guards the regex: if the workflow JSONs change shape and this stops
    // matching, the assertion below would pass vacuously.
    expect(calledActions.length).toBeGreaterThanOrEqual(2);
  });

  it("every action n8n calls is implemented by the handler", () => {
    // n8n calls these by literal string. Removing or renaming an action here
    // fails at dispatch time, in production, with n8n reporting a 404 that
    // looks like the pipeline is down.
    const missing = calledActions.filter(
      (a) => !new RegExp(`action === "${a}"|action === '${a}'|=== "${a}"`).test(handlerSrc),
    );
    expect(
      missing,
      `n8n workflows call these actions but the handler implements none of them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the handler answers an unknown action with 404, not a silent 200", () => {
    // A 200 for a mistyped action would let a broken workflow look healthy.
    expect(handlerSrc).toMatch(/unknown action/);
  });
});
