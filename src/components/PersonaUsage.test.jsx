// PersonaUsage.test.jsx — which role consumed the plan this month.
//
// Two properties matter more than the layout:
//   * the breakdown adds up to the totals it explains — it is computed from the
//     same record, never a parallel counter
//   * a month recorded BEFORE attribution existed says so, rather than showing
//     zeros, which would read as "nobody used it" — the opposite of the truth

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PersonaUsage, { personaRows } from "./PersonaUsage.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";

const usage = (byPersona, totals = {}) => ({
  month: "2026-08", extractions: 0, enrichments: {}, batchRuns: 0, contentGenerations: 0,
  ...totals, byPersona,
});

describe("personaRows", () => {
  it("sorts by total work, heaviest first", () => {
    const rows = personaRows({
      seo:   { extractions: 2, audits: 0, batchRuns: 0, contentGenerations: 0 },
      sales: { extractions: 9, audits: 0, batchRuns: 0, contentGenerations: 0 },
    });
    expect(rows.map((r) => r.id)).toEqual(["sales", "seo"]);
  });

  it("drops a persona with no usage rather than listing a row of zeros", () => {
    const rows = personaRows({ seo: { extractions: 0, audits: 0, batchRuns: 0, contentGenerations: 0 } });
    expect(rows).toEqual([]);
  });

  it("names unattributed work rather than hiding it", () => {
    // Work done before anyone picked a role is still work; omitting it would
    // make the breakdown fail to add up to the total.
    const rows = personaRows({ __none__: { extractions: 4, audits: 0, batchRuns: 0, contentGenerations: 0 } });
    expect(rows[0].label).toBe("No role selected");
  });

  it("uses each persona's real label", () => {
    const rows = personaRows({ seo: { extractions: 1, audits: 0, batchRuns: 0, contentGenerations: 0 } });
    expect(rows[0].label).toBe(PERSONA_BY_ID.seo.label);
  });
});

describe("PersonaUsage", () => {
  it("renders a row per persona with its counts", () => {
    render(<PersonaUsage usage={usage({
      sales: { extractions: 12, audits: 3, batchRuns: 1, contentGenerations: 0 },
    }, { extractions: 12, batchRuns: 1 })} />);
    expect(screen.getByText(PERSONA_BY_ID.sales.label)).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();          // 12 + 3 + 1
    expect(screen.getByText(/Extractions 12/)).toBeInTheDocument();
    expect(screen.getByText(/Audits 3/)).toBeInTheDocument();
  });

  it("says a pre-attribution month cannot be broken down", () => {
    // NOT zeros. Zeros here would read as "nobody used it".
    render(<PersonaUsage usage={usage({}, { extractions: 40 })} />);
    expect(screen.getByText(/recorded before per-role tracking started/i)).toBeInTheDocument();
  });

  it("says nothing was used when nothing was", () => {
    render(<PersonaUsage usage={usage({})} />);
    expect(screen.getByText(/Nothing used yet this month/i)).toBeInTheDocument();
  });

  it("survives a usage record with no byPersona at all", () => {
    render(<PersonaUsage usage={{ month: "2026-08", extractions: 0 }} />);
    expect(screen.getByText(/Nothing used yet this month/i)).toBeInTheDocument();
  });
});
