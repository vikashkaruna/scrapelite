import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEED_TEMPLATES } from "../lib/templates/seedTemplates.js";
import { HANDOFF } from "../lib/templates/templateHandoffs.js";

const SRC = readFileSync(resolve(process.cwd(), "src/pages/Templates.jsx"), "utf8");
// The hand-off map moved to its own module (2026-09-24) so tests can import it.
const MAP = readFileSync(resolve(process.cwd(), "src/lib/templates/templateHandoffs.js"), "utf8");
const DISC = readFileSync(resolve(process.cwd(), "src/pages/Discoverability.jsx"), "utf8");

describe("the audit template hands off instead of running a thin copy", () => {
  it("declares discoverability_audit as a hand-off", () => {
    expect(MAP).toMatch(/HANDOFF = \{/);
    expect(MAP).toMatch(/discoverability_audit:\s*\{/);
    expect(MAP).toMatch(/to: "\/discoverability"/);
  });

  it("hands off BEFORE anything is spent — no run row, no credits", () => {
    // The interception must come first in run(), ahead of estimate/startRun.
    const body = SRC.slice(SRC.indexOf("async function run()"));
    const handoffAt = body.indexOf("HANDOFF[template.template_key]");
    const startAt = body.indexOf("api.startRun");
    expect(handoffAt).toBeGreaterThan(-1);
    expect(startAt).toBeGreaterThan(-1);
    expect(handoffAt, "hand-off must be checked before a run is started").toBeLessThan(startAt);
  });

  it("passes the domain as auditUrl — the key Discoverability actually reads", () => {
    expect(MAP).toMatch(/auditUrl:/);
    // The contract on the receiving end.
    expect(DISC).toMatch(/location\.state\?\.auditUrl/);
  });

  // PREFILL, NEVER AUTO-RUN. Discoverability's own comment: "auto-running would
  // spend an audit credit on defaults they never saw, which is the kind of
  // surprise a quota makes expensive." A hand-off must not set autorun.
  it("does not arm autorun — the user presses the button themselves", () => {
    const block = MAP.slice(MAP.indexOf("discoverability_audit:"), MAP.indexOf("discoverability_audit:") + 500);
    expect(block).not.toMatch(/autorun/);
  });

  it("does not show this template's credit estimate beside a hand-off button", () => {
    // Showing a cost for a button that spends nothing here is a plain lie.
    expect(SRC).toMatch(/handoff \? \(\s*<span className="tpl-estimate">\{handoff\.why\}/);
  });

  it("every hand-off names a published template, and every module delegate has a hand-off", () => {
    const published = new Set(SEED_TEMPLATES.filter((t) => t.status === "published").map((t) => t.template_key));
    for (const k of Object.keys(HANDOFF)) expect(published, `HANDOFF references unknown template "${k}"`).toContain(k);
    // A published delegate with no hand-off would fall through to the page runner
    // and run an extraction the template never described.
    for (const t of SEED_TEMPLATES.filter((x) => x.status === "published" && x.prompt_bundle?.delegate)) {
      expect(HANDOFF[t.template_key], `${t.template_key} delegates but has no hand-off`).toBeTruthy();
    }
  });

  it("every hand-off opens a real route and names its module", () => {
    const APP = readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8");
    const routes = new Set([...APP.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
    for (const [k, h] of Object.entries(HANDOFF)) {
      expect(routes, `${k} -> ${h.to}`).toContain(h.to);
      expect(h.module, k).toBeTruthy();
      expect(h.why, k).toBeTruthy();
    }
  });
});
