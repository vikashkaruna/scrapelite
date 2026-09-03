import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEED_TEMPLATES } from "../lib/templates/seedTemplates.js";

const SRC = readFileSync(resolve(process.cwd(), "src/pages/Templates.jsx"), "utf8");
const DISC = readFileSync(resolve(process.cwd(), "src/pages/Discoverability.jsx"), "utf8");

describe("the audit template hands off instead of running a thin copy", () => {
  it("declares discoverability_audit as a hand-off", () => {
    expect(SRC).toMatch(/HANDOFF = \{/);
    expect(SRC).toMatch(/discoverability_audit:\s*\{/);
    expect(SRC).toMatch(/to: "\/discoverability"/);
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
    expect(SRC).toMatch(/auditUrl:/);
    // The contract on the receiving end.
    expect(DISC).toMatch(/location\.state\?\.auditUrl/);
  });

  // PREFILL, NEVER AUTO-RUN. Discoverability's own comment: "auto-running would
  // spend an audit credit on defaults they never saw, which is the kind of
  // surprise a quota makes expensive." A hand-off must not set autorun.
  it("does not arm autorun — the user presses the button themselves", () => {
    const block = SRC.slice(SRC.indexOf("const HANDOFF"), SRC.indexOf("const HANDOFF") + 900);
    expect(block).not.toMatch(/autorun/);
  });

  it("does not show this template's credit estimate beside a hand-off button", () => {
    // Showing a cost for a button that spends nothing here is a plain lie.
    expect(SRC).toMatch(/handoff \? \(\s*<span className="tpl-estimate">\{handoff\.why\}/);
  });

  it("every hand-off target is a real seeded template", () => {
    const keys = [...SRC.matchAll(/^\s{2}([a-z_]+):\s*\{$/gm)].map((m) => m[1]);
    const seeded = new Set(SEED_TEMPLATES.map((t) => t.template_key));
    const inHandoff = SRC.slice(SRC.indexOf("const HANDOFF"), SRC.indexOf("};", SRC.indexOf("const HANDOFF")));
    for (const k of keys) {
      if (inHandoff.includes(`${k}:`)) {
        expect(seeded, `HANDOFF references unknown template "${k}"`).toContain(k);
      }
    }
  });
});
