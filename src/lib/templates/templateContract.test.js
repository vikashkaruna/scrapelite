// Parity between what a seed template PROMISES and what the runner can DELIVER.
//
// Three defects shipped together and none was catchable by a per-template test,
// because each half looked correct on its own:
//   1. `questions` / `comparison` / `delegate` were declared in prompt_bundle
//      and never executed.
//   2. Output blocks declared `from:` keys the renderer ignored — it filled
//      every `list` from talking_points and had no `table` branch at all.
//   3. No template declared which subpages it needs, so all of them fell
//      through to a prompt-prose guess that sent five of seven to `pricing`.
//
// Same shape as cron-registry-parity: one side declares, the other executes,
// and nothing asserted they agree. The failure is silence — a block that never
// renders looks identical to a site that has nothing to put in it.
import { describe, expect, it } from "vitest";
import { SEED_TEMPLATES } from "./seedTemplates.js";
import { RELATED_PAGE_HINTS } from "../extractionPresets.js";

// Prompts executeRun() actually runs. Update BOTH when adding one.
const EXECUTED_PROMPTS = new Set(["extract", "summarize", "talking_points", "questions"]);
// Prompts belonging to a different execution path, with the path named.
const DELEGATED_PROMPTS = { comparison: "executeVisibilityBrief", delegate: "the discoverability audit engine" };

// Keys the runner can populate on `output`, plus the structured extraction.
const OUTPUT_KEYS = new Set(["talking_points", "questions", "comparison", "rows"]);

describe("seed template contract", () => {
  it("every declared prompt is either executed or explicitly delegated", () => {
    const orphans = [];
    for (const t of SEED_TEMPLATES) {
      for (const key of Object.keys(t.prompt_bundle || {})) {
        if (EXECUTED_PROMPTS.has(key) || key in DELEGATED_PROMPTS) continue;
        orphans.push(`${t.template_key}.${key}`);
      }
    }
    // A prompt in a seed is a promise on a screen. If nothing runs it, the
    // block it feeds is permanently empty and the run reads as "incomplete".
    expect(orphans).toEqual([]);
  });

  it("every output block's `from:` can actually be populated", () => {
    const unfillable = [];
    for (const t of SEED_TEMPLATES) {
      const fields = new Set((t.extraction_schema?.fields || []).map((f) => f.name));
      for (const b of t.output_schema?.blocks || []) {
        if (!b.from) continue;
        // Resolvable as either a synthesis output or an extraction field —
        // the two places resolveBlockData() looks.
        if (OUTPUT_KEYS.has(b.from) || fields.has(b.from)) continue;
        unfillable.push(`${t.template_key}: block "${b.title}" reads from "${b.from}"`);
      }
    }
    expect(unfillable).toEqual([]);
  });

  it("every template declares which subpages it needs", () => {
    // Without this they fall through to guessRelatedPageHintsKey(), which is a
    // first-match regex over prompt PROSE — it sent the Due Diligence Brief,
    // which wants team and founding year, to /pricing.
    const missing = SEED_TEMPLATES
      .filter((t) => t.prompt_bundle?.extract && !t.related_key)
      .map((t) => t.template_key);
    expect(missing).toEqual([]);
  });

  it("every declared related_key is a real hint bucket", () => {
    // The server sanitises enrichKey against this same map, so a typo here is
    // silently no related pages at all — the failure mode being fixed.
    const bad = SEED_TEMPLATES
      .filter((t) => t.related_key && !RELATED_PAGE_HINTS[t.related_key])
      .map((t) => `${t.template_key} -> ${t.related_key}`);
    expect(bad).toEqual([]);
  });

  it("a template's hint bucket matches what its schema actually asks for", () => {
    // The specific mis-pairing that caused the reported bug: due_diligence
    // wants people/traction, so it must not be pointed at pricing pages.
    const dd = SEED_TEMPLATES.find((t) => t.template_key === "due_diligence_brief");
    expect(dd.related_key).toBe("diligence");
    expect(RELATED_PAGE_HINTS.diligence).toContain("about");
    expect(RELATED_PAGE_HINTS.diligence).toContain("team");

    const proof = SEED_TEMPLATES.find((t) => t.template_key === "customer_proof_extractor");
    expect(proof.related_key).toBe("proof");
    expect(RELATED_PAGE_HINTS.proof).toContain("case-studies");

    const pricing = SEED_TEMPLATES.find((t) => t.template_key === "competitor_pricing_tracker");
    expect(pricing.related_key).toBe("pricing");
  });
});
